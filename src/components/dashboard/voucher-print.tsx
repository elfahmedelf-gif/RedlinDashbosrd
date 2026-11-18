'use client'

// ============================================================================
// طباعة إذن القبض/الصرف (سند) — A4 print-ready via PrintStage
// يعرض المبلغ بالأرقام والتفقيط العربي + التوقيعات. مستقل عن قيود الـ Dialog.
// ============================================================================

import * as React from 'react'
import { Printer, Truck, Landmark } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { fmtNum, fmtDate } from '@/lib/format'
import { PrintStage, usePrintModal } from './print-stage'

// ---------------------------------------------------------------------------
// التفقيط — تحويل المبلغ إلى كلمات عربية (جنيه مصري)
// ---------------------------------------------------------------------------
const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر']
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون']
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة']

function threeDigits(n: number): string {
  const parts: string[] = []
  const h = Math.floor(n / 100)
  const rest = n % 100
  if (h) parts.push(HUNDREDS[h])
  if (rest) {
    if (rest < 20) parts.push(ONES[rest])
    else {
      const t = Math.floor(rest / 10)
      const o = rest % 10
      parts.push(o ? `${ONES[o]} و${TENS[t]}` : TENS[t])
    }
  }
  return parts.join(' و')
}

function tafqit(amount: number): string {
  const n = Math.floor(Math.abs(amount))
  if (n === 0) return 'صفر جنيه مصري'
  const groups: string[] = []
  const millions = Math.floor(n / 1_000_000)
  const thousands = Math.floor((n % 1_000_000) / 1000)
  const rest = n % 1000
  if (millions) {
    if (millions === 1) groups.push('مليون')
    else if (millions === 2) groups.push('مليونان')
    else if (millions <= 10) groups.push(`${threeDigits(millions)} ملايين`)
    else groups.push(`${threeDigits(millions)} مليونًا`)
  }
  if (thousands) {
    if (thousands === 1) groups.push('ألف')
    else if (thousands === 2) groups.push('ألفان')
    else if (thousands <= 10) groups.push(`${threeDigits(thousands)} آلاف`)
    else groups.push(`${threeDigits(thousands)} ألفًا`)
  }
  if (rest) groups.push(threeDigits(rest))
  return `فقط ${groups.join(' و')} جنيه مصري لا غير`
}

/** تفقيط شامل الكسور (قروش) — يُستخدم في الفواتير الضريبية */
export function tafqitInvoice(amount: number): string {
  const abs = Math.abs(Number(amount) || 0)
  const pounds = Math.floor(abs)
  const piasters = Math.round((abs - pounds) * 100)
  if (piasters === 0) return tafqit(pounds)
  const base = pounds === 0 ? '' : tafqit(pounds).replace(/^فقط /, '').replace(' جنيه مصري لا غير', '')
  const pTxt = `${threeDigits(piasters)} قرشًا`
  const joined = base ? `${base} جنيهًا و${pTxt}` : pTxt
  return `فقط ${joined} لا غير`
}

interface VoucherPrintProps {
  voucher: any
  open: boolean
  onOpenChange: (v: boolean) => void
}

function VoucherContent({ voucher }: { voucher: any }) {
  const isReceipt = voucher.type === 'receipt'
  const today = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })
  const accent = isReceipt ? 'emerald' : 'rose'
  return (
    <div className="p-6" dir="rtl">
      {/* ترويسة السند */}
      <div className="flex items-start justify-between gap-4 border-b-[3px] border-slate-800 pb-3">
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
          <div className="text-[10px] text-slate-400 mt-0.5">تاريخ الإصدار: {today}</div>
        </div>
      </div>

      {/* عنوان السند */}
      <div className={`text-center py-2.5 my-4 rounded-md border-2 ${isReceipt ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-rose-700 bg-rose-50 text-rose-900'}`}>
        <span className="font-extrabold tracking-widest text-base inline-flex items-center gap-2">
          <Landmark className="w-4 h-4" />
          {isReceipt ? 'إذن قبض (نقدية واردة)' : 'إذن صرف (نقدية صادرة)'}
        </span>
      </div>

      {/* الحقول */}
      <div className="space-y-2.5 my-4 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2 border border-slate-300 rounded-md px-3 py-2">
            <span className="text-xs font-bold text-slate-500 w-20 shrink-0">التاريخ</span>
            <span className="font-bold">{fmtDate(voucher.date) || '—'}</span>
          </div>
          <div className="flex items-center gap-2 border border-slate-300 rounded-md px-3 py-2">
            <span className="text-xs font-bold text-slate-500 w-20 shrink-0">الحساب</span>
            <span className="font-bold">{voucher.accountName || 'الصندوق'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 border-2 border-slate-500 rounded-md px-3 py-2.5 bg-slate-50">
          <span className="text-xs font-bold text-slate-500 w-24 shrink-0">{isReceipt ? 'استلمنا من' : 'صرفنا إلى'}</span>
          <span className="font-extrabold flex-1 text-base">{voucher.party?.name || voucher.partyName || '—'}</span>
        </div>
        <div className="flex items-center gap-2 border border-slate-300 rounded-md px-3 py-2">
          <span className="text-xs font-bold text-slate-500 w-24 shrink-0">المبلغ</span>
          <span className={`font-extrabold tnum text-xl ${isReceipt ? 'text-emerald-700' : 'text-rose-700'}`}>{fmtNum(voucher.amount ?? 0)} ج.م</span>
          {voucher.shipment?.shipmentNo && (
            <>
              <span className="text-xs font-bold text-slate-500 w-20 shrink-0 mr-6">الشحنة</span>
              <span className="font-mono font-bold text-slate-700">{voucher.shipment.shipmentNo}</span>
            </>
          )}
        </div>
        <div className={`border-2 rounded-md px-3 py-2.5 ${isReceipt ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}>
          <span className="text-[11px] font-bold text-slate-500 block mb-0.5">المبلغ كتابةً</span>
          <span className="font-extrabold text-slate-900">{tafqit(Number(voucher.amount ?? 0))}</span>
        </div>
        <div className="flex items-start gap-2 border border-slate-300 rounded-md px-3 py-2">
          <span className="text-xs font-bold text-slate-500 w-24 shrink-0 mt-0.5">وذلك عن / البيان</span>
          <span className="flex-1">{voucher.description || (isReceipt ? 'تحصيل نولون شحنات' : 'سداد مستحقات')}</span>
        </div>
        {voucher.journalEntryNo && (
          <div className="text-[11px] text-slate-500">القيد المحاسبي المقابل: <span className="font-mono font-bold">{voucher.journalEntryNo}</span> (مُرحّل تلقائيًا)</div>
        )}
      </div>

      {/* التوقيعات */}
      <div className="grid grid-cols-3 gap-4 mt-10 mb-2">
        <div className="text-center">
          <div className="text-xs font-bold text-slate-700 mb-12">{isReceipt ? 'المحصّل / الأمين' : 'المصرف'}</div>
          <div className="border-t-2 border-slate-500 pt-1 text-[10px] text-slate-400">الاسم والتوقيع</div>
        </div>
        <div className="text-center">
          <div className="text-xs font-bold text-slate-700 mb-12">{isReceipt ? 'الدافع' : 'المستلم (المستحق له)'}</div>
          <div className="border-t-2 border-slate-500 pt-1 text-[10px] text-slate-400">الاسم والتوقيع</div>
        </div>
        <div className="text-center">
          <div className="text-xs font-bold text-slate-700 mb-12">اعتماد المدير</div>
          <div className="border-t-2 border-slate-500 pt-1 text-[10px] text-slate-400">الاسم والتوقيع والختم</div>
        </div>
      </div>

      <div className="text-center text-[9px] text-slate-400 mt-3 border-t border-slate-200 pt-1.5">
        {isReceipt
          ? 'هذا الإذن إثبات استلام النقدية المذكورة أعلاه — يُحفظ مع ملف الحساب.'
          : 'هذا الإذن إثبات صرف النقدية المذكورة أعلاه — يُحفظ مع ملف الحساب.'}
      </div>
    </div>
  )
}

export function VoucherPrint({ voucher, open, onOpenChange }: VoucherPrintProps) {
  const { printModal } = usePrintModal()
  if (!voucher) return null
  return (
    <>
      <PrintStage id="voucher-print-stage">
        <VoucherContent voucher={voucher} />
      </PrintStage>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[95vh] overflow-y-auto voucher-dialog" dir="rtl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>طباعة {voucher.type === 'receipt' ? 'إذن قبض' : 'إذن صرف'} — {voucher.voucherNo}</DialogTitle>
          </DialogHeader>
          <div className="border border-slate-200 rounded-lg overflow-hidden bg-white max-h-[70vh] overflow-y-auto">
            <VoucherContent voucher={voucher} />
          </div>
          <div className="flex items-center justify-between gap-2 mt-2 print:hidden">
            <div className="text-xs text-slate-500">سيتم طباعة السند بحجم A4 كامل دون قيود النافذة</div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button>
              <Button onClick={printModal}><Printer className="size-4" /> طباعة السند</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
