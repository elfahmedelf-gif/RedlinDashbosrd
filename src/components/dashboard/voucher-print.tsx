'use client'

// ============================================================================
// طباعة إذن القبض/الصرف (سند) — جاهز للطباعة A5/A4
// يعرض المبلغ بالأرقام والتفقيط العربي + التوقيعات
// ============================================================================

import * as React from 'react'
import { Printer, Truck, Landmark } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { fmtNum, fmtDate } from '@/lib/format'

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

interface VoucherPrintProps {
  voucher: any
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function VoucherPrint({ voucher, open, onOpenChange }: VoucherPrintProps) {
  if (!voucher) return null
  const isReceipt = voucher.type === 'receipt'
  const today = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[95vh] overflow-y-auto voucher-dialog" dir="rtl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>طباعة {isReceipt ? 'إذن قبض' : 'إذن صرف'} — {voucher.voucherNo}</DialogTitle>
        </DialogHeader>
        <div id="voucher-print-area" className="bg-white text-slate-900 px-6 py-5" dir="rtl" style={{ fontFamily: "'Tahoma','Arial',sans-serif" }}>
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b-2 border-slate-800 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-slate-900 text-white">
                  <Truck className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-lg font-bold leading-tight">شركة النقل والشحن</div>
                  <div className="text-[11px] text-slate-500">Al-Asher Transport & Logistics</div>
                </div>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">القاهرة، مصر — ت: 02xxxxxxxx</div>
            </div>
            <div className="text-left">
              <div className="text-xs text-slate-500">رقم الإذن</div>
              <div className="text-2xl font-bold font-mono tracking-wider">{voucher.voucherNo}</div>
              <div className="text-[11px] text-slate-400 mt-1">{today}</div>
            </div>
          </div>

          {/* Title strip */}
          <div className={`text-center py-2 my-3 rounded-md border-2 ${isReceipt ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-rose-600 bg-rose-50 text-rose-800'}`}>
            <span className="font-bold tracking-widest text-base inline-flex items-center gap-2">
              <Landmark className="w-4 h-4" />
              {isReceipt ? 'إذن قبض (نقدية واردة)' : 'إذن صرف (نقدية صادرة)'}
            </span>
          </div>

          {/* Fields */}
          <div className="space-y-2.5 my-3 text-sm">
            <div className="flex items-center gap-2 border border-slate-300 rounded-md px-3 py-2">
              <span className="text-xs font-bold text-slate-500 w-24 shrink-0">التاريخ</span>
              <span className="font-bold">{fmtDate(voucher.date) || '—'}</span>
              <span className="text-xs font-bold text-slate-500 w-24 shrink-0 mr-6">الحساب</span>
              <span className="font-bold">{voucher.accountName || 'الصندوق'}</span>
            </div>
            <div className="flex items-center gap-2 border border-slate-300 rounded-md px-3 py-2">
              <span className="text-xs font-bold text-slate-500 w-24 shrink-0">{isReceipt ? 'استلمنا من' : 'صرفنا إلى'}</span>
              <span className="font-bold flex-1">{voucher.party?.name || voucher.partyName || '—'}</span>
            </div>
            <div className="flex items-center gap-2 border border-slate-300 rounded-md px-3 py-2">
              <span className="text-xs font-bold text-slate-500 w-24 shrink-0">المبلغ</span>
              <span className="font-bold tnum text-lg">{fmtNum(voucher.amount ?? 0)} ج.م</span>
              {voucher.shipment?.shipmentNo && (
                <>
                  <span className="text-xs font-bold text-slate-500 w-24 shrink-0 mr-6">الشحنة</span>
                  <span className="font-mono font-bold text-primary">{voucher.shipment.shipmentNo}</span>
                </>
              )}
            </div>
            <div className="border-2 border-slate-800 rounded-md px-3 py-2.5 bg-slate-50">
              <span className="text-[11px] font-bold text-slate-500 block mb-0.5">المبلغ كتابةً</span>
              <span className="font-bold">{tafqit(Number(voucher.amount ?? 0))}</span>
            </div>
            <div className="flex items-center gap-2 border border-slate-300 rounded-md px-3 py-2">
              <span className="text-xs font-bold text-slate-500 w-24 shrink-0">وذلك عن / البيان</span>
              <span className="flex-1">{voucher.description || (isReceipt ? 'تحصيل نولون شحنات' : 'سداد مستحقات') }</span>
            </div>
            {voucher.journalEntryNo && (
              <div className="text-[11px] text-slate-500">القيد المحاسبي المقابل: <span className="font-mono font-bold">{voucher.journalEntryNo}</span> (مُرحّل تلقائيًا)</div>
            )}
          </div>

          {/* Signatures */}
          <div className="grid grid-cols-3 gap-3 mt-6 mb-2">
            <div className="text-center">
              <div className="text-xs text-slate-500 mb-8">{isReceipt ? 'المحصل / الأمين' : 'المصرف'}</div>
              <div className="border-t border-slate-400 pt-1 text-[10px] text-slate-400">.......................</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-slate-500 mb-8">{isReceipt ? 'المستلم (الدافع)' : 'المستلم (المستحق له)'}</div>
              <div className="border-t border-slate-400 pt-1 text-[10px] text-slate-400">.......................</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-slate-500 mb-8">اعتماد المدير</div>
              <div className="border-t border-slate-400 pt-1 text-[10px] text-slate-400">.......................</div>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center text-[10px] text-slate-400 mt-2 border-t border-slate-200 pt-1">
            {isReceipt
              ? 'هذا الإذن إثبات استلام النقدية المذكورة أعلاه — يُحفظ مع ملف الحساب.'
              : 'هذا الإذن إثبات صرف النقدية المذكورة أعلاه — يُحفظ مع ملف الحساب.'}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 mt-2 print:hidden">
          <div className="text-xs text-slate-500">طباعة السند بحجم A5/A4</div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button>
            <Button onClick={() => window.print()}><Printer className="size-4" /> طباعة السند</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
