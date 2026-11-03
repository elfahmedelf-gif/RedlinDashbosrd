'use client'

import * as React from 'react'
import { Printer, X, Truck } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { fmtNum, fmtDate } from '@/lib/format'

// ---------------------------------------------------------------------------
// Waybill (بوليصة الشحن) — A4 print-ready template
// ---------------------------------------------------------------------------
// Rendered inside a Dialog with a hidden print stylesheet that hides everything
// except the printable card. The barcode is an illustrative Code128-like SVG
// generated deterministically from the shipment number.

interface WaybillProps {
  shipment: any
  open: boolean
  onOpenChange: (v: boolean) => void
}

/** Deterministic pseudo-barcode (Code128-style) from a string. */
function Barcode({ value, height = 56 }: { value: string; height?: number }) {
  // Stable pseudo-random from string
  const bars: number[] = []
  let seed = 0
  for (let i = 0; i < value.length; i++) seed = (seed * 31 + value.charCodeAt(i)) >>> 0
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  let x = 4
  // start bars
  bars.push(2, 1, 1, 2)
  for (let i = 0; i < value.length; i++) {
    for (let j = 0; j < 4; j++) {
      const w = Math.max(1, Math.round(rand() * 4))
      bars.push(w)
      bars.push(Math.max(1, Math.round(rand() * 3)))
    }
  }
  // end bars
  bars.push(2, 1, 1, 2, 2)
  const totalWidth = bars.reduce((a, b) => a + b, 0) + 8
  let cursor = 4
  return (
    <svg
      width={totalWidth}
      height={height}
      viewBox={`0 0 ${totalWidth} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Barcode ${value}`}
      style={{ display: 'block' }}
    >
      {bars.map((w, idx) => {
        if (idx % 2 === 1) return null // gap
        return <rect key={idx} x={cursor} y={4} width={w} height={height - 8} fill="#0f172a" /> as any
      }).filter(Boolean)}
      <text x={totalWidth / 2} y={height - 2} textAnchor="middle" fontSize="11" fontFamily="monospace" fill="#0f172a" style={{ letterSpacing: '0.15em' }}>
        {value}
      </text>
    </svg>
  )
}

export function WaybillPrint({ shipment, open, onOpenChange }: WaybillProps) {
  if (!shipment) return null

  const customerName = shipment.customer?.name || shipment.recipientName || '-'
  const contractorName = shipment.contractor?.name || '-'
  const size = shipment.loadType === '1.5TON' ? '1.5 طن' : shipment.loadType === '3TON' ? '3 طن' : shipment.loadType === '6M' ? '6 متر' : shipment.loadType ?? '-'
  const margin = (Number(shipment.freightTotal ?? 0)) - (Number(shipment.totalSuppliers ?? 0))
  const paymentMethod = shipment.collectionStatus === 'collected' ? 'تم التحصيل' : shipment.collectionStatus === 'cod' ? 'دفع عند الاستلام (COD)' : 'آجل (مديونية)'
  const today = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[95vh] overflow-y-auto waybill-dialog" dir="rtl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>طباعة بوليصة الشحن — {shipment.shipmentNo}</DialogTitle>
        </DialogHeader>
        {/* Printable area (only this is shown on print via CSS) */}
        <div id="waybill-print-area" className="bg-white text-slate-900 px-6 py-5" dir="rtl" style={{ fontFamily: "'Tahoma','Arial',sans-serif" }}>
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
              <div className="text-[11px] text-slate-500 mt-1">القاهرة، مصر — ت: 02xxxxxxxx — m@cashir.com</div>
            </div>
            <div className="text-left">
              <div className="text-xs text-slate-500">رقم البوليصة</div>
              <div className="text-2xl font-bold font-mono tracking-wider">{shipment.shipmentNo}</div>
              {shipment.billNo && <div className="text-xs text-slate-500 mt-1">رقم الدفتر: {shipment.billNo}</div>}
              <div className="text-[11px] text-slate-400 mt-1">{today}</div>
            </div>
          </div>

          {/* Title strip */}
          <div className="bg-slate-100 text-center py-1.5 my-3 rounded-md">
            <span className="font-bold tracking-wider text-sm">بوليصة شحن طريق (WAYBILL)</span>
          </div>

          {/* Parties: shipper + recipient (two columns) */}
          <div className="grid grid-cols-2 gap-3 my-3">
            <div className="border border-slate-300 rounded-md p-3">
              <div className="text-xs font-bold text-slate-500 mb-1.5 pb-1 border-b border-slate-200">الراسل / العميل (Sender)</div>
              <div className="text-sm font-bold mb-1">{customerName}</div>
              <div className="text-xs text-slate-600 leading-relaxed">
                {shipment.shipToParty && shipment.shipToParty !== customerName && <div>{shipment.shipToParty}</div>}
                {shipment.deliveryPhones && <div dir="ltr" style={{ textAlign: 'right' }}>هاتف: {shipment.deliveryPhones}</div>}
                {shipment.routeCode && <div>خط السير: {shipment.routeCode}</div>}
              </div>
            </div>
            <div className="border border-slate-300 rounded-md p-3">
              <div className="text-xs font-bold text-slate-500 mb-1.5 pb-1 border-b border-slate-200">المستلم (Recipient)</div>
              <div className="text-sm font-bold mb-1">{shipment.recipientName || customerName}</div>
              <div className="text-xs text-slate-600 leading-relaxed">
                <div>الوجهة: {shipment.destination ?? '-'}</div>
                {shipment.destinationEn && <div dir="ltr" style={{ textAlign: 'right' }}>{shipment.destinationEn}</div>}
              </div>
            </div>
          </div>

          {/* Goods / Items table */}
          <div className="my-3">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-2 py-1.5 text-right w-1/4">م</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-right">بيان البضاعة / الحمولة</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-center w-24">النوع</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-center w-24">الكمية</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-slate-300 px-2 py-2 text-center font-mono">1</td>
                  <td className="border border-slate-300 px-2 py-2 text-right">
                    {shipment.shipToParty || shipment.recipientName || customerName}
                    {shipment.notes && <div className="text-[10px] text-slate-500 mt-0.5">ملاحظات: {shipment.notes}</div>}
                  </td>
                  <td className="border border-slate-300 px-2 py-2 text-center">{size}</td>
                  <td className="border border-slate-300 px-2 py-2 text-center font-mono">{fmtNum(shipment.policyQty ?? 1)}</td>
                </tr>
                {/* empty filler rows to make the table look substantial on paper */}
                {Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    <td className="border border-slate-300 px-2 py-2 text-center text-slate-300">—</td>
                    <td className="border border-slate-300 px-2 py-2 text-right text-slate-300">—</td>
                    <td className="border border-slate-300 px-2 py-2 text-center text-slate-300">—</td>
                    <td className="border border-slate-300 px-2 py-2 text-center text-slate-300">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals + payment */}
          <div className="grid grid-cols-2 gap-3 my-3">
            <div className="border border-slate-300 rounded-md p-3">
              <div className="text-xs font-bold text-slate-500 mb-1.5 pb-1 border-b border-slate-200">الناقل / المقاول (Carrier)</div>
              <div className="text-sm font-bold mb-1">{contractorName}</div>
              <div className="text-xs text-slate-600 leading-relaxed">
                <div>نوع المركبة: {size}</div>
                {shipment.vehicleNo && <div dir="ltr" style={{ textAlign: 'right' }}>رقم السيارة: {shipment.vehicleNo}</div>}
                {shipment.branch?.name && <div>الفرع: {shipment.branch.name}</div>}
              </div>
            </div>
            <div className="border border-slate-300 rounded-md p-3">
              <div className="text-xs font-bold text-slate-500 mb-1.5 pb-1 border-b border-slate-200">الإجمالي المالي (Totals)</div>
              <div className="text-xs space-y-1">
                <div className="flex justify-between"><span>نولون العميل</span><span className="font-bold tnum">{fmtNum(shipment.freightTotal ?? 0)} ج.م</span></div>
                <div className="flex justify-between"><span>نولون المقاول</span><span className="tnum">{fmtNum(shipment.totalSuppliers ?? 0)} ج.م</span></div>
                <div className="flex justify-between border-t border-slate-200 pt-1"><span className="font-bold">هامش الربح</span><span className="font-bold tnum text-emerald-700">{fmtNum(margin)} ج.م</span></div>
              </div>
            </div>
          </div>

          {/* Payment + barcode */}
          <div className="grid grid-cols-2 gap-3 my-3 items-center">
            <div className="border border-slate-300 rounded-md p-3">
              <div className="text-xs font-bold text-slate-500 mb-1">طريقة الدفع</div>
              <div className="text-sm font-bold">{paymentMethod}</div>
              <div className="text-[11px] text-slate-600 mt-1">
                تاريخ الشحن: {fmtDate(shipment.date)}
                {shipment.actualDeliveryDate && <div>تاريخ التسليم: {fmtDate(shipment.actualDeliveryDate)}</div>}
              </div>
            </div>
            <div className="border border-slate-300 rounded-md p-3 flex flex-col items-center justify-center">
              <Barcode value={shipment.shipmentNo ?? 'SH-00000'} />
              <div className="text-[10px] text-slate-400 mt-1">باركود توضيحي — امسحه عند الاستلام</div>
            </div>
          </div>

          {/* Signatures */}
          <div className="grid grid-cols-3 gap-3 mt-6 mb-2">
            <div className="text-center">
              <div className="text-xs text-slate-500 mb-8">توقيع الراسل</div>
              <div className="border-t border-slate-400 pt-1 text-[10px] text-slate-400">.......................</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-slate-500 mb-8">توقيع الناقل</div>
              <div className="border-t border-slate-400 pt-1 text-[10px] text-slate-400">.......................</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-slate-500 mb-8">توقيع المستلم</div>
              <div className="border-t border-slate-400 pt-1 text-[10px] text-slate-400">.......................</div>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center text-[10px] text-slate-400 mt-2 border-t border-slate-200 pt-1">
            هذه البوليصة جزء من عقد النقل وتُعتبر دليلًا على استلام البضاعة. يُرجى الاحتفاظ بنسخة موقعة لكل طرف.
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 mt-2 print:hidden">
          <div className="text-xs text-slate-500">اضغط طباعة لطباعة البوليصة بحجم A4</div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button>
            <Button onClick={() => window.print()}><Printer className="size-4" /> طباعة البوليصة</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
