'use client'

// ============================================================================
// طباعة الفاتورة الضريبية الرسمية — A4 Arabic RTL Tax Invoice (PrintStage)
// ترويسة الشركة + السجل الضريبي (من الإعدادات) + بيانات العميل + جدول البنود
// برقم الديليفري + الإجماليات (الضريبة 14%) + التفقيط + خانات التوقيع والختم.
// ============================================================================

import * as React from 'react'
import useSWR from 'swr'
import { Printer, Truck } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { fetcher } from '@/lib/api'
import { fmtNum, fmtDate } from '@/lib/format'
import { PrintStage, usePrintModal } from './print-stage'
import { tafqitInvoice } from './voucher-print'

export interface InvoicePrintData {
  id: string
  invoiceNumber: string
  status: string
  statusLabel: string
  issueDate: string | Date | null
  dueDate: string | Date | null
  subtotal: number
  vatRate: number
  vatAmount: number
  discountAmount: number
  totalAmount: number
  paidAmount: number
  notes?: string | null
  customer: {
    id: string
    name: string
    code?: string | null
    taxNumber?: string | null
    phone?: string | null
    phones?: string | null
    address?: string | null
    city?: string | null
  } | null
  items: {
    id: string
    description: string
    quantity: number
    unitPrice: number
    total: number
    shipment?: { shipmentNo?: string | null; deliveryNumber?: string | null; destination?: string | null } | null
  }[]
}

/** قراءة بيانات الشركة من الإعدادات (الاسم + السجل الضريبي) */
function useCompanySettings(enabled: boolean) {
  const { data } = useSWR<{ items: { key: string; value: string | null }[] }>(
    enabled ? '/api/settings' : null, fetcher, { revalidateOnFocus: false })
  const map = new Map<string, string>()
  for (const s of data?.items ?? []) map.set(s.key, s.value ?? '')
  return {
    companyName: map.get('company_name') || 'شركة النقل والشحن',
    taxNumber: map.get('company_tax_number') || '',
  }
}

const money = (n: number) => fmtNum(Number(n) || 0, 2)

function InvoiceSheet({ invoice, companyName, taxNumber }: { invoice: InvoicePrintData; companyName: string; taxNumber: string }) {
  const issue = fmtDate(invoice.issueDate)
  const due = fmtDate(invoice.dueDate)
  return (
    <div className="p-4 sm:p-8 bg-white text-slate-900 min-w-0" dir="rtl" style={{ fontFamily: "'Tahoma','Arial',sans-serif" }}>
      {/* ===== ترويسة الشركة ===== */}
      <div className="flex flex-col sm:flex-row items-start justify-between gap-4 sm:gap-6 border-b-[3px] border-slate-900 pb-4">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-slate-900 text-white shrink-0">
            <Truck className="w-7 h-7" />
          </div>
          <div>
            <div className="text-xl font-extrabold leading-tight">{companyName}</div>
            <div className="text-[11px] text-slate-500" dir="ltr">Redline Transport &amp; Logistics</div>
            {taxNumber && (
              <div className="text-[11px] mt-1 font-bold">
                السجل الضريبي: <span className="font-mono tracking-wide">{taxNumber}</span>
              </div>
            )}
          </div>
        </div>
        <div className="text-left shrink-0">
          <div className="text-[11px] text-slate-500">فاتورة ضريبية رقم</div>
          <div className="text-3xl font-extrabold font-mono tracking-wider">{invoice.invoiceNumber}</div>
          <div className="text-[11px] text-slate-600 mt-1">تاريخ الإصدار: <b>{issue}</b></div>
          {invoice.dueDate && <div className="text-[11px] text-slate-600">تاريخ الاستحقاق: <b>{due}</b></div>}
        </div>
      </div>

      {/* عنوان الفاتورة */}
      <div className="text-center py-2.5 my-4 rounded-md border-2 border-slate-800 bg-slate-50">
        <span className="font-extrabold tracking-widest text-base">فاتورة مبيعات / نولون نقل</span>
        <span className="mx-2 text-slate-400">|</span>
        <span className="text-xs text-slate-600">Tax Invoice — Freight Services</span>
      </div>

      {/* ===== بيانات العميل ===== */}
      <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
        <div className="border border-slate-300 rounded-md px-3 py-2.5">
          <div className="text-[10px] font-bold text-slate-500 mb-1">فاتورة إلى / العميل</div>
          <div className="font-extrabold text-base leading-tight">{invoice.customer?.name ?? '—'}</div>
          <div className="text-[11px] text-slate-600 mt-1 space-y-0.5">
            {invoice.customer?.code && <div>كود العميل: <b className="font-mono">{invoice.customer.code}</b></div>}
            {invoice.customer?.taxNumber && <div>الرقم الضريبي للعميل: <b className="font-mono">{invoice.customer.taxNumber}</b></div>}
            {(invoice.customer?.phone || invoice.customer?.phones) && (
              <div dir="ltr" className="text-right">{invoice.customer?.phone || invoice.customer?.phones}</div>
            )}
            {(invoice.customer?.address || invoice.customer?.city) && (
              <div className="truncate">{[invoice.customer?.address, invoice.customer?.city].filter(Boolean).join(' — ')}</div>
            )}
          </div>
        </div>
        <div className="border border-slate-300 rounded-md px-3 py-2.5">
          <div className="text-[10px] font-bold text-slate-500 mb-1">بيانات الفاتورة</div>
          <div className="text-[12px] space-y-1 mt-1.5">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">حالة الفاتورة</span>
              <b>{invoice.statusLabel}</b>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">عدد البنود</span>
              <b>{invoice.items.length}</b>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">المسدد</span>
              <b className="tnum">{money(invoice.paidAmount)} ج.م</b>
            </div>
          </div>
        </div>
      </div>

      {/* ===== جدول البنود ===== */}
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="bg-slate-900 text-white">
            <th className="px-2 py-2 text-right font-bold border border-slate-700 w-8">#</th>
            <th className="px-2 py-2 text-right font-bold border border-slate-700">البيان</th>
            <th className="px-2 py-2 text-center font-bold border border-slate-700 w-16">الكمية</th>
            <th className="px-2 py-2 text-center font-bold border border-slate-700 w-24">سعر الوحدة</th>
            <th className="px-2 py-2 text-center font-bold border border-slate-700 w-28">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((it, i) => (
            <tr key={it.id} className={i % 2 ? 'bg-slate-50' : 'bg-white'}>
              <td className="px-2 py-2 border border-slate-300 text-center tnum">{i + 1}</td>
              <td className="px-2 py-2 border border-slate-300">
                <div className="font-medium leading-snug">{it.description}</div>
                {it.shipment && (
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {[it.shipment.deliveryNumber && `ديليفري ${it.shipment.deliveryNumber}`, it.shipment.shipmentNo && `بوليصة ${it.shipment.shipmentNo}`, it.shipment.destination]
                      .filter(Boolean).join(' — ')}
                  </div>
                )}
              </td>
              <td className="px-2 py-2 border border-slate-300 text-center tnum">{fmtNum(it.quantity)}</td>
              <td className="px-2 py-2 border border-slate-300 text-center tnum">{money(it.unitPrice)}</td>
              <td className="px-2 py-2 border border-slate-300 text-center tnum font-bold">{money(it.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ===== الإجماليات + التفقيط ===== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 items-start">
        <div className="border-2 border-slate-800 rounded-md px-3 py-2.5 bg-slate-50">
          <span className="text-[11px] font-bold text-slate-500 block mb-0.5">الإجمالي كتابةً</span>
          <span className="font-extrabold text-[13px] leading-relaxed">{tafqitInvoice(invoice.totalAmount)}</span>
        </div>
        <div className="text-[13px] space-y-1.5">
          <div className="flex items-center justify-between border-b border-slate-200 pb-1">
            <span className="text-slate-600">الإجمالي قبل الضريبة</span>
            <b className="tnum">{money(invoice.subtotal)} ج.م</b>
          </div>
          {invoice.discountAmount > 0 && (
            <div className="flex items-center justify-between border-b border-slate-200 pb-1 text-amber-700">
              <span>الخصم</span>
              <b className="tnum">- {money(invoice.discountAmount)} ج.م</b>
            </div>
          )}
          <div className="flex items-center justify-between border-b border-slate-200 pb-1">
            <span className="text-slate-600">الصافي بعد الخصم</span>
            <b className="tnum">{money(invoice.subtotal - invoice.discountAmount)} ج.م</b>
          </div>
          <div className="flex items-center justify-between border-b border-slate-200 pb-1">
            <span className="text-slate-600">ضريبة القيمة المضافة ({fmtNum(invoice.vatRate)}%)</span>
            <b className="tnum">{money(invoice.vatAmount)} ج.م</b>
          </div>
          <div className="flex items-center justify-between bg-slate-900 text-white rounded-md px-3 py-2">
            <span className="font-bold">الإجمالي النهائي شامل الضريبة</span>
            <b className="tnum text-lg">{money(invoice.totalAmount)} ج.م</b>
          </div>
        </div>
      </div>

      {invoice.notes && (
        <div className="mt-3 text-[11px] text-slate-600 border border-slate-200 rounded-md px-3 py-2">
          <b className="text-slate-500">ملاحظات: </b>{invoice.notes}
        </div>
      )}

      {/* ===== التوقيعات ===== */}
      <div className="grid grid-cols-3 gap-6 mt-10 mb-2">
        <div className="text-center">
          <div className="text-xs font-bold text-slate-700 mb-12">إعداد المحاسب</div>
          <div className="border-t-2 border-slate-400 pt-1 text-[10px] text-slate-400">الاسم والتوقيع</div>
        </div>
        <div className="text-center">
          <div className="text-xs font-bold text-slate-700 mb-12">توقيع العميل (المعتمد له)</div>
          <div className="border-t-2 border-slate-400 pt-1 text-[10px] text-slate-400">الاسم والتوقيع</div>
        </div>
        <div className="text-center">
          <div className="text-xs font-bold text-slate-700 mb-12">اعتماد الإدارة</div>
          <div className="border-t-2 border-slate-400 pt-1 text-[10px] text-slate-400">الاسم والتوقيع والختم</div>
        </div>
      </div>

      <div className="text-center text-[9px] text-slate-400 mt-4 border-t border-slate-200 pt-2 leading-relaxed">
        هذه الفاتورة صادرة إلكترونيًا من نظام إدارة {companyName} — تُعد مستندًا ضريبيًا عند اعتمادها وختمها
      </div>
    </div>
  )
}

export function InvoicePrint({ invoiceId, open, onOpenChange }: { invoiceId: string | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { printModal } = usePrintModal()
  const { data, isLoading } = useSWR<InvoicePrintData & { items: any[] }>(
    open && invoiceId ? `/api/invoices/${invoiceId}` : null, fetcher, { revalidateOnFocus: false })
  const { companyName, taxNumber } = useCompanySettings(open)

  if (!open) return null

  const sheet = isLoading || !data ? (
    <div className="p-10 space-y-3 bg-white"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-32" /><Skeleton className="h-48" /></div>
  ) : (
    <InvoiceSheet invoice={data} companyName={companyName} taxNumber={taxNumber} />
  )

  return (
    <>
      <PrintStage id="invoice-print-stage">
        {sheet}
      </PrintStage>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto voucher-dialog" dir="rtl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>معاينة طباعة الفاتورة الضريبية <span dir="ltr" className="whitespace-nowrap inline-block">{data?.invoiceNumber ?? ''}</span></DialogTitle>
          </DialogHeader>
          <div className="border border-slate-200 rounded-lg bg-white max-h-[62vh] overflow-y-auto overflow-x-auto">
            {sheet}
          </div>
          <div className="flex items-center justify-between gap-2 mt-2 print:hidden">
            <div className="text-xs text-slate-500">ستُطبع الفاتورة بحجم A4 كامل — ترويسة + بنود + تفقيط + توقيعات</div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button>
              <Button onClick={printModal} disabled={isLoading || !data}>
                <Printer className="size-4" /> طباعة الفاتورة
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
