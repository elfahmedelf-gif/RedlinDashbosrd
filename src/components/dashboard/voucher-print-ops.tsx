'use client'

// ============================================================================
// طباعة الإذن التشغيلي (16 نوع) — A4 print-ready via PrintStage
// مستقل عن قيود الـ Dialog. يعرض بيانات الإذن + جدول الشحنات + التوقيعات.
// ============================================================================

import * as React from 'react'
import { Printer, Truck, Landmark, CheckCircle2, User, Building2, PackageCheck, Banknote } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { fmtNum, fmtDate } from '@/lib/format'
import { PrintStage, usePrintModal } from './print-stage'

interface VoucherOpsPrintProps {
  voucher: any
  open: boolean
  onOpenChange: (v: boolean) => void
}

// خريطة ألوان لحالة الشحنة في الطباعة
function shipmentStatusBadge(status: string): { label: string; cls: string } {
  const map: Record<string, { label: string; cls: string }> = {
    new: { label: 'جديدة', cls: 'bg-sky-100 text-sky-700' },
    preparing: { label: 'قيد التجهيز', cls: 'bg-amber-100 text-amber-700' },
    out_for_delivery: { label: 'خرجت للتوصيل', cls: 'bg-indigo-100 text-indigo-700' },
    delivered: { label: 'تم التسليم', cls: 'bg-emerald-100 text-emerald-700' },
    postponed: { label: 'مؤجلة', cls: 'bg-orange-100 text-orange-700' },
    failed: { label: 'فشل', cls: 'bg-rose-100 text-rose-700' },
    returned: { label: 'مرتجعة', cls: 'bg-red-100 text-red-700' },
    cancelled: { label: 'ملغاة', cls: 'bg-gray-200 text-gray-700' },
    received: { label: 'مستلمة بالفرع', cls: 'bg-teal-100 text-teal-700' },
    loaded: { label: 'محمّلة', cls: 'bg-amber-100 text-amber-700' },
    in_transit: { label: 'في الطريق', cls: 'bg-violet-100 text-violet-700' },
    arrived: { label: 'وصلت', cls: 'bg-orange-100 text-orange-700' },
    assigned_courier: { label: 'مُسلّمة لمندوب', cls: 'bg-indigo-100 text-indigo-700' },
    received_returned: { label: 'مرتجعة مستلمة', cls: 'bg-red-100 text-red-700' },
    written_off: { label: 'شُطبت', cls: 'bg-gray-200 text-gray-700' },
  }
  return map[status] ?? { label: status || '—', cls: 'bg-slate-100 text-slate-700' }
}

const ACTION_LABELS: Record<string, string> = {
  submit: 'رفع', approve: 'اعتماد', reject: 'رفض', execute: 'تنفيذ',
  complete: 'إكمال', cancel: 'إلغاء', resubmit: 'إعادة', edit: 'تعديل', create: 'إنشاء',
}

function VoucherOpsContent({ voucher }: { voucher: any }) {
  const today = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })
  const category = voucher.typeCategory ?? 'operational'
  const isFinancial = !!voucher.isFinancial
  const requiresShipments = !!voucher.requiresShipments
  const items: any[] = voucher.items ?? []
  const approvalLog: any[] = voucher.approvalLog ?? []

  const findActor = (action: string) => approvalLog.find((l) => l.action === action)?.userName ?? null
  const creator = voucher.createdByName ?? findActor('create') ?? '—'
  const approver = findActor('approve')
  const executor = findActor('execute')
  const completer = findActor('complete')

  const categoryTitle: Record<string, string> = {
    operational: 'إذن تشغيلي', financial: 'إذن مالي', inventory: 'إذن جرد', special: 'إذن خاص',
  }

  return (
    <div className="p-6" dir="rtl">
      {/* ترويسة الإذن */}
      <div className="flex flex-col sm:flex-row items-start justify-between gap-3 sm:gap-4 border-b-[3px] border-slate-800 pb-3">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-slate-900 text-white shrink-0">
            <Truck className="w-6 h-6" />
          </div>
          <div>
            <div className="text-lg font-extrabold leading-tight text-slate-900">شركة النقل والشحن</div>
            <div className="text-[11px] text-slate-500" dir="ltr">Redline Transport & Logistics</div>
            <div className="text-[10px] text-slate-500 mt-0.5">القاهرة، مصر — ت: 02xxxxxxxx</div>
          </div>
        </div>
        <div className="text-left shrink-0">
          <div className="text-[10px] text-slate-500">رقم الإذن</div>
          <div className="text-2xl font-extrabold font-mono tracking-wider text-slate-900">{voucher.voucherNo}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">تاريخ الإصدار: {fmtDate(voucher.createdAt)}</div>
          <div className="mt-1">
            <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${voucher.statusColor ?? 'bg-slate-100 text-slate-700'}`}>
              {voucher.statusLabel ?? voucher.status}
            </span>
          </div>
        </div>
      </div>

      {/* عنوان الإذن */}
      <div className="text-center py-2.5 my-4 rounded-md border-2 border-slate-700 bg-slate-50">
        <span className="font-extrabold tracking-widest text-base inline-flex items-center gap-2">
          <Landmark className="w-4 h-4" />
          {voucher.typeLabel ?? voucher.type} — {categoryTitle[category] ?? ''}
        </span>
      </div>

      {category === 'inventory' && (
        <div className="my-3 border-2 border-purple-300 rounded-md px-4 py-3 bg-purple-50 text-sm">
          <div className="font-bold text-purple-800 mb-0.5">جرد المخزون</div>
          <div className="text-purple-700 text-xs">
            يتم إجراء الجرد الميداني وتسجيل الفروقات. تتم التسوية المحاسبية لاحقًا بقيد مستقل.
          </div>
        </div>
      )}

      {/* شبكة المعلومات */}
      <div className="grid grid-cols-2 gap-2 my-4 text-sm">
        <InfoRow icon={<Building2 className="w-3.5 h-3.5" />} label="الفرع المصدر" value={voucher.sourceBranch?.name ?? 'الفرع الرئيسي'} />
        <InfoRow icon={<Building2 className="w-3.5 h-3.5" />} label="فرع الاستلام" value={voucher.destBranch?.name ?? '—'} />
        <InfoRow icon={<User className="w-3.5 h-3.5" />} label="الموظف المسؤول" value={voucher.employee?.name ?? '—'} />
        <InfoRow icon={<User className="w-3.5 h-3.5" />} label="المندوب" value={voucher.courier?.name ?? '—'} />
        <InfoRow icon={<User className="w-3.5 h-3.5" />} label="الطرف (عميل/مقاول)" value={voucher.party?.name ?? '—'} />
        <InfoRow icon={<Landmark className="w-3.5 h-3.5" />} label="الحساب" value={voucher.accountName ?? '—'} />
        <InfoRow icon={<Banknote className="w-3.5 h-3.5" />} label="القيمة الإجمالية" value={`${fmtNum(voucher.totalValue ?? 0)} ج.م`} />
        <InfoRow icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="القيد المحاسبي" value={voucher.journalEntryNo ?? '—'} />
      </div>

      {/* المبلغ المالي البارز */}
      {isFinancial && (
        <div className="border-2 border-emerald-700 rounded-md px-4 py-3 bg-emerald-50 my-3 flex items-center justify-between">
          <span className="text-sm font-bold text-emerald-800">المبلغ المعتمد</span>
          <span className="text-2xl font-extrabold tnum text-emerald-800">{fmtNum(voucher.amount ?? 0)} ج.م</span>
        </div>
      )}

      {/* جدول الشحنات المرتبطة */}
      {requiresShipments && items.length > 0 && (
        <div className="my-4">
          <div className="text-xs font-bold text-slate-700 mb-1.5 pb-1 border-b-2 border-slate-300 flex items-center gap-1.5">
            <PackageCheck className="w-3.5 h-3.5" /> الشحنات المرتبطة ({items.length})
          </div>
          <table className="w-full border-collapse text-xs mt-2">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-400 px-2 py-1.5 text-right font-bold w-1/4">رقم الشحنة</th>
                <th className="border border-slate-400 px-2 py-1.5 text-right font-bold">الحالة</th>
                <th className="border border-slate-400 px-2 py-1.5 text-right font-bold">الوجهة</th>
                <th className="border border-slate-400 px-2 py-1.5 text-right font-bold">المستلم</th>
                <th className="border border-slate-400 px-2 py-1.5 text-left font-bold w-24">النولون</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it: any, idx: number) => {
                const s = it.shipment
                if (!s) return (
                  <tr key={idx}>
                    <td className="border border-slate-400 px-2 py-1.5 text-center text-slate-300" colSpan={5}>—</td>
                  </tr>
                )
                const st = shipmentStatusBadge(s.status)
                return (
                  <tr key={idx}>
                    <td className="border border-slate-400 px-2 py-1.5 font-mono font-bold">{s.shipmentNo ?? '—'}</td>
                    <td className="border border-slate-400 px-2 py-1.5">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="border border-slate-400 px-2 py-1.5">{s.destination ?? '—'}</td>
                    <td className="border border-slate-400 px-2 py-1.5">{s.recipientName ?? '—'}</td>
                    <td className="border border-slate-400 px-2 py-1.5 text-left tnum">{fmtNum(s.freightTotal ?? 0)} ج.م</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-bold">
                <td className="border border-slate-400 px-2 py-1.5 text-right" colSpan={4}>الإجمالي ({items.length} شحنة)</td>
                <td className="border border-slate-400 px-2 py-1.5 text-left tnum">{fmtNum(voucher.totalValue ?? 0)} ج.م</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* الملاحظات */}
      {voucher.notes && (
        <div className="my-3 border border-slate-300 rounded-md px-3 py-2 text-sm">
          <div className="text-[11px] font-bold text-slate-500 mb-0.5">ملاحظات</div>
          <div className="whitespace-pre-wrap">{voucher.notes}</div>
        </div>
      )}

      {/* سجل الاعتماد */}
      {approvalLog.length > 0 && (
        <div className="my-3 text-xs">
          <div className="text-[11px] font-bold text-slate-700 mb-1.5 pb-1 border-b border-slate-200">سجل الاعتماد</div>
          <ol className="space-y-1">
            {approvalLog.map((l: any, i: number) => (
              <li key={i} className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-slate-400 shrink-0" />
                <span className="font-bold">{ACTION_LABELS[l.action] ?? l.action}</span>
                <span className="text-slate-500">— {l.userName ?? '—'}</span>
                <span className="text-slate-400">— {fmtDate(l.at)}</span>
                {l.notes && <span className="text-slate-600">— {l.notes}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* التوقيعات */}
      <div className="grid grid-cols-4 gap-3 mt-10 mb-2">
        <SignatureLine label="أنشأه" name={creator} />
        <SignatureLine label="اعتمده" name={approver} />
        <SignatureLine label="نفّذ" name={executor} />
        <SignatureLine label="استلم/أكمل" name={completer} />
      </div>

      <div className="text-center text-[9px] text-slate-400 mt-3 border-t border-slate-200 pt-1.5">
        شركة النقل والشحن · نظام الإدارة المتكامل — إذن آلي {voucher.voucherNo} — {today}
      </div>
    </div>
  )
}

export function VoucherOpsPrint({ voucher, open, onOpenChange }: VoucherOpsPrintProps) {
  const { printModal } = usePrintModal()
  if (!voucher) return null
  return (
    <>
      <PrintStage id="voucher-ops-print-stage">
        <VoucherOpsContent voucher={voucher} />
      </PrintStage>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-3xl max-h-[95vh] overflow-y-auto voucher-ops-dialog"
          dir="rtl"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>طباعة الإذن — {voucher.voucherNo}</DialogTitle>
          </DialogHeader>
          <div className="border border-slate-200 rounded-lg bg-white max-h-[70vh] overflow-y-auto overflow-x-auto">
            <VoucherOpsContent voucher={voucher} />
          </div>
          <div className="flex items-center justify-between gap-2 mt-2 print:hidden">
            <div className="text-xs text-slate-500">سيتم طباعة الإذن بحجم A4 كامل دون قيود النافذة</div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button>
              <Button onClick={printModal}>
                <Printer className="size-4" /> طباعة الإذن
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 border border-slate-300 rounded-md px-3 py-1.5">
      <span className="text-slate-400 shrink-0">{icon}</span>
      <span className="text-xs font-bold text-slate-500 w-24 shrink-0">{label}</span>
      <span className="font-bold flex-1">{value}</span>
    </div>
  )
}

function SignatureLine({ label, name }: { label: string; name: string | null }) {
  return (
    <div className="text-center">
      <div className="text-xs font-bold text-slate-700 mb-1">{label}</div>
      {name && <div className="text-[11px] font-bold text-slate-700 mb-10">{name}</div>}
      {!name && <div className="text-[10px] text-slate-300 mb-10">.......................</div>}
      <div className="border-t-2 border-slate-500 pt-1 text-[10px] text-slate-400">{name ? 'تم' : '.......................'}</div>
    </div>
  )
}
