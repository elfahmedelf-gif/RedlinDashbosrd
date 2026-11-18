'use client'

import * as React from 'react'
import { Printer, X, Truck } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { fmtNum, fmtDate } from '@/lib/format'
import { PrintStage, usePrintModal } from './print-stage'

// ---------------------------------------------------------------------------
// Waybill (بوليصة الشحن) — A4 print-ready professional template
// ---------------------------------------------------------------------------
// آلية الطباعة: نُطلق نسخة طباعة مستقلة في <body> عبر PrintStage (مرئية فقط
// عند print). الـ Dialog الظاهر على الشاشة يحتوي معاينة + أزرار تحكم (تُخفى في الطباعة).
// عند الضغط على "طباعة البوليصة"، يُضاف كلاس "printing-modal" على <body> فيُخفي
// كامل التطبيق + الـ Dialog ويُظهر فقط منصة الطباعة بعرض A4 كامل.

interface WaybillProps {
  shipment: any
  open: boolean
  onOpenChange: (v: boolean) => void
}

/** Deterministic pseudo-barcode (Code128-style) from a string. */
function Barcode({ value, height = 56 }: { value: string; height?: number }) {
  const bars: number[] = []
  let seed = 0
  for (let i = 0; i < value.length; i++) seed = (seed * 31 + value.charCodeAt(i)) >>> 0
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  bars.push(2, 1, 1, 2)
  for (let i = 0; i < value.length; i++) {
    for (let j = 0; j < 4; j++) {
      const w = Math.max(1, Math.round(rand() * 4))
      bars.push(w)
      bars.push(Math.max(1, Math.round(rand() * 3)))
    }
  }
  bars.push(2, 1, 1, 2, 2)
  const totalWidth = bars.reduce((a, b) => a + b, 0) + 8
  // Precompute x positions for black bars (even indices)
  let cursor = 4
  const blackBars: { x: number; w: number }[] = []
  for (let idx = 0; idx < bars.length; idx++) {
    if (idx % 2 === 0) blackBars.push({ x: cursor, w: bars[idx] })
    cursor += bars[idx]
  }
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
      {blackBars.map((b, i) => (
        <rect key={i} x={b.x} y={4} width={b.w} height={height - 16} fill="#0f172a" />
      ))}
      <text x={totalWidth / 2} y={height - 1} textAnchor="middle" fontSize="10" fontFamily="monospace" fill="#0f172a" style={{ letterSpacing: '0.15em' }}>
        {value}
      </text>
    </svg>
  )
}

/** Box للبطاقات (الراسل/المستلم/الناقل) — بحدود نظيفة وعنوان مميز */
function PartyBox({ title, titleEn, children }: { title: string; titleEn?: string; children: React.ReactNode }) {
  return (
    <div className="border-2 border-slate-700 rounded-lg p-3 bg-white">
      <div className="flex items-baseline justify-between border-b-2 border-slate-300 pb-1 mb-2">
        <span className="text-xs font-bold text-slate-700">{title}</span>
        {titleEn && <span className="text-[10px] text-slate-400" dir="ltr">{titleEn}</span>}
      </div>
      <div className="text-xs leading-relaxed text-slate-800 space-y-0.5">{children}</div>
    </div>
  )
}

/** سطر معلومة داخل البطاقة */
function Field({ label, value, mono, ltr }: { label: string; value?: string | number | null; mono?: boolean; ltr?: boolean }) {
  if (value == null || value === '') return null
  return (
    <div className="flex gap-1">
      <span className="text-slate-500 font-medium shrink-0">{label}:</span>
      <span className={`font-bold flex-1 ${mono ? 'font-mono' : ''}`} dir={ltr ? 'ltr' : undefined} style={ltr ? { textAlign: 'right' } : undefined}>
        {value}
      </span>
    </div>
  )
}

/** محتوى البوليصة المشترك بين معاينة الشاشة ومنصة الطباعة */
function WaybillContent({ shipment }: { shipment: any }) {
  const customerName = shipment.customer?.name || shipment.recipientName || '-'
  const contractorName = shipment.contractor?.name || '-'
  const size = shipment.loadType === '1.5TON' ? '1.5 طن' : shipment.loadType === '3TON' ? '3 طن' : shipment.loadType === '6M' ? '6 متر' : shipment.loadType ?? '-'
  const margin = (Number(shipment.freightTotal ?? 0)) - (Number(shipment.totalSuppliers ?? 0))
  const codAmount = Number(shipment.freightTotal ?? 0)
  const paymentMethod = shipment.collectionStatus === 'collected'
    ? 'تم التحصيل'
    : shipment.collectionStatus === 'cod'
      ? 'تحصيل عند التسليم (COD)'
      : 'آجل (مديونية)'
  const today = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })
  const statusLabel = shipment.status ? (SHIPMENT_STATUS_LABELS[shipment.status] ?? shipment.status) : '—'

  return (
    <div className="p-4 sm:p-6 min-w-0" dir="rtl">
      {/* ============ ترويسة البوليصة (Header) ============ */}
      <div className="flex flex-col sm:flex-row items-start justify-between gap-3 sm:gap-4 border-b-[3px] border-slate-800 pb-3">
        {/* يمين: الشركة + الشعار + بيانات الفرع */}
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-slate-900 text-white shrink-0">
            <Truck className="w-6 h-6" />
          </div>
          <div>
            <div className="text-lg font-extrabold leading-tight text-slate-900">شركة النقل والشحن</div>
            <div className="text-[11px] text-slate-500" dir="ltr">Redline Transport & Logistics</div>
            <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">
              {shipment.branch?.name ? `الفرع: ${shipment.branch.name} — ` : ''}القاهرة، مصر
              <br />
              ت: 02xxxxxxxx — info@redline-transport.com
            </div>
          </div>
        </div>
        {/* وسط: عنوان المستند + الحالة */}
        <div className="text-center px-4">
          <div className="text-xl font-extrabold tracking-wider text-slate-900">بوليصة شحن</div>
          <div className="text-[11px] text-slate-500" dir="ltr">WAYBILL / SHIPPING NOTE</div>
          <div className="mt-1.5">
            <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 border border-slate-300 text-slate-700">
              الحالة: {statusLabel}
            </span>
          </div>
        </div>
        {/* يسار: رقم البوليصة + الباركود + تاريخ الإصدار */}
        <div className="text-left shrink-0">
          <div className="text-[10px] text-slate-500">رقم البوليصة</div>
          <div className="text-2xl font-extrabold font-mono tracking-wider text-slate-900">{shipment.shipmentNo}</div>
          {shipment.billNo && <div className="text-[10px] text-slate-500 mt-0.5">رقم الدفتر: {shipment.billNo}</div>}
          <div className="text-[10px] text-slate-400 mt-0.5">تاريخ الإصدار: {today}</div>
          <div className="mt-2 inline-block border border-slate-300 rounded p-1 bg-white">
            <Barcode value={shipment.shipmentNo ?? 'SH-00000'} height={44} />
          </div>
        </div>
      </div>

      {/* ============ شبكة البيانات الرئيسية (Sender + Recipient) ============ */}
      <div className="grid grid-cols-2 gap-3 my-4">
        {/* بطاقة الراسل / العميل */}
        <PartyBox title="بيانات الراسل (العميل)" titleEn="Sender">
          <div className="text-sm font-extrabold text-slate-900 mb-1">{customerName}</div>
          <Field label="الكود" value={shipment.customer?.code} mono />
          <Field label="الهاتف" value={shipment.deliveryPhones || shipment.customer?.phone} ltr />
          <Field label="العنوان" value={shipment.customer?.address || shipment.customer?.city} />
          <Field label="الفرع" value={shipment.branch?.name} />
        </PartyBox>
        {/* بطاقة المرسل إليه / المستلم */}
        <PartyBox title="بيانات المرسل إليه (المستلم)" titleEn="Recipient">
          <div className="text-sm font-extrabold text-slate-900 mb-1">{shipment.recipientName || customerName}</div>
          <Field label="الهاتف" value={shipment.deliveryPhones} ltr />
          <Field label="المحافظة/المنطقة" value={shipment.destination} />
          <Field label="الوجهة (EN)" value={shipment.destinationEn} ltr />
          <Field label="خط السير/التكويد" value={shipment.routeCode} mono />
          <Field label="العنوان التفصيلي" value={shipment.shipToParty && shipment.shipToParty !== customerName ? shipment.shipToParty : null} />
        </PartyBox>
      </div>

      {/* ============ تفاصيل الشحنة والتشغيل ============ */}
      <div className="my-4">
        <div className="text-xs font-bold text-slate-700 mb-1.5 pb-1 border-b-2 border-slate-300">
          تفاصيل الشحنة والتشغيل (Shipment & Logistics Details)
        </div>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-slate-400 px-2 py-1.5 text-right font-bold w-1/3">نوع البضاعة / الوصف</th>
              <th className="border border-slate-400 px-2 py-1.5 text-center font-bold w-20">عدد الطرود</th>
              <th className="border border-slate-400 px-2 py-1.5 text-center font-bold w-24">الوزن/الكمية</th>
              <th className="border border-slate-400 px-2 py-1.5 text-right font-bold w-1/4">الناقل/المقاول</th>
              <th className="border border-slate-400 px-2 py-1.5 text-right font-bold w-1/4">السائق/المندوب</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-slate-400 px-2 py-2">
                {shipment.shipToParty || shipment.recipientName || customerName}
                {shipment.notes && <div className="text-[10px] text-slate-500 mt-0.5">ملاحظات: {shipment.notes}</div>}
              </td>
              <td className="border border-slate-400 px-2 py-2 text-center font-mono">{fmtNum(shipment.policyQty ?? 1)}</td>
              <td className="border border-slate-400 px-2 py-2 text-center">{size}</td>
              <td className="border border-slate-400 px-2 py-2 font-bold">{contractorName}</td>
              <td className="border border-slate-400 px-2 py-2">{shipment.courier?.name ?? '-'}</td>
            </tr>
            {/* صفوف تعبئة لتبدو البوليصة كاملة */}
            {Array.from({ length: 1 }).map((_, i) => (
              <tr key={i}>
                <td className="border border-slate-400 px-2 py-2 text-slate-300">—</td>
                <td className="border border-slate-400 px-2 py-2 text-center text-slate-300">—</td>
                <td className="border border-slate-400 px-2 py-2 text-center text-slate-300">—</td>
                <td className="border border-slate-400 px-2 py-2 text-slate-300">—</td>
                <td className="border border-slate-400 px-2 py-2 text-slate-300">—</td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* تفاصيل إضافية */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-[11px] text-slate-600">
          {shipment.vehicleNo && <div>رقم السيارة: <span dir="ltr" className="font-mono font-bold">{shipment.vehicleNo}</span></div>}
          {shipment.warehouse?.name && <div>المخزن: <span className="font-bold">{shipment.warehouse.name}</span></div>}
          <div>تاريخ الشحن: <span className="font-bold">{fmtDate(shipment.date) || '—'}</span></div>
          {shipment.actualDeliveryDate && <div>تاريخ التسليم: <span className="font-bold">{fmtDate(shipment.actualDeliveryDate)}</span></div>}
        </div>
      </div>

      {/* ============ الملخص المالي والتحصيل (Financial Summary Box) ============ */}
      <div className="my-4">
        <div className="text-xs font-bold text-slate-700 mb-1.5 pb-1 border-b-2 border-slate-300">
          الملخص المالي والتحصيل (Financial Summary)
        </div>
        <table className="w-full border-collapse text-xs border-2 border-slate-700">
          <tbody>
            <tr className="border-b border-slate-300">
              <td className="border border-slate-400 px-3 py-2 font-bold bg-slate-50 w-1/2">قيمة البضاعة / التحصيل (COD)</td>
              <td className="border border-slate-400 px-3 py-2 text-left font-mono tnum w-1/4">{fmtNum(codAmount)} ج.م</td>
              <td className="border border-slate-400 px-3 py-2 bg-slate-50 w-1/4" rowSpan={4}>
                <div className="text-center">
                  <div className="text-[10px] text-slate-500 mb-1">طريقة الدفع</div>
                  <div className="text-sm font-extrabold text-slate-900">{paymentMethod}</div>
                </div>
              </td>
            </tr>
            <tr className="border-b border-slate-300">
              <td className="border border-slate-400 px-3 py-2 font-bold bg-slate-50">قيمة النولون (الشحن)</td>
              <td className="border border-slate-400 px-3 py-2 text-left font-mono tnum">{fmtNum(shipment.freightTotal ?? 0)} ج.م</td>
            </tr>
            <tr className="border-b border-slate-300">
              <td className="border border-slate-400 px-3 py-2 font-bold bg-slate-50">نولون المقاول (التكلفة)</td>
              <td className="border border-slate-400 px-3 py-2 text-left font-mono tnum text-slate-500">{fmtNum(shipment.totalSuppliers ?? 0)} ج.م</td>
            </tr>
            <tr className="border-b-2 border-slate-700 bg-amber-50">
              <td className="border border-slate-700 px-3 py-2.5 font-extrabold text-slate-900 text-sm bg-amber-100">
                الإجمالي المطلوب تحصيله من المستلم
              </td>
              <td className="border border-slate-700 px-3 py-2.5 text-left font-mono tnum text-base font-extrabold text-amber-900">
                {fmtNum(codAmount)} ج.م
              </td>
            </tr>
          </tbody>
        </table>
        <div className="text-[10px] text-slate-500 mt-1">
          هامش الربح للشركة: <span className="font-bold tnum">{fmtNum(margin)} ج.م</span> (داخلي)
        </div>
      </div>

      {/* ============ شروط النقل المختصرة ============ */}
      <div className="my-3 text-[10px] text-slate-600 leading-relaxed border-t border-slate-200 pt-2">
        <span className="font-bold">شروط النقل: </span>
        يُقرّ المرسل بأن البضاعة الموصوفة أعلاه ملكه ومسلّمة بحالتها للناقل، وأن الناقل مسؤول عن وصولها للمرسل إليه.
        أي خسارة أو تلف يقع بعد التسليم يتحمله المستلم. تُعد هذه البوليصة دليلًا على استلام البضاعة.
      </div>

      {/* ============ تذييل البوليصة والإقرارات (Signatures) ============ */}
      <div className="grid grid-cols-3 gap-4 mt-6 mb-2">
        <div className="text-center">
          <div className="text-xs font-bold text-slate-700 mb-10">الموظف المُصدِر / أمين المخزن</div>
          <div className="border-t-2 border-slate-500 pt-1 text-[10px] text-slate-400">الاسم والتوقيع</div>
        </div>
        <div className="text-center">
          <div className="text-xs font-bold text-slate-700 mb-10">المندوب / السائق المستلم</div>
          <div className="border-t-2 border-slate-500 pt-1 text-[10px] text-slate-400">الاسم والتوقيع</div>
        </div>
        <div className="text-center">
          <div className="text-xs font-bold text-slate-700 mb-10">المستلم النهائي (إقرار بالاستلام)</div>
          <div className="border-t-2 border-slate-500 pt-1 text-[10px] text-slate-400">الاسم والتوقيع والختم</div>
        </div>
      </div>

      {/* فاصل سفلي */}
      <div className="text-center text-[9px] text-slate-400 mt-3 border-t border-slate-200 pt-1.5">
        شركة النقل والشحن · نظام الإدارة المتكامل — بوليصة شحن آلية {shipment.shipmentNo} — {today}
      </div>
    </div>
  )
}

// خريطة حالات الشحنة للعرض على البوليصة
const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  new: 'جديدة', preparing: 'قيد التجهيز', out_for_delivery: 'خرجت للتوصيل',
  delivered: 'تم التسليم', postponed: 'مؤجلة', failed: 'فشل', returned: 'مرتجعة',
  cancelled: 'ملغاة', received: 'مستلمة بالفرع', loaded: 'محمّلة', in_transit: 'في الطريق',
  arrived: 'وصلت', assigned_courier: 'مُسلّمة لمندوب', received_returned: 'مرتجعة مستلمة',
  written_off: 'شُطبت',
}

export function WaybillPrint({ shipment, open, onOpenChange }: WaybillProps) {
  const { printModal } = usePrintModal()
  if (!shipment) return null

  return (
    <>
      {/* منصة الطباعة المستقلة — مرئية فقط عند print */}
      <PrintStage id="waybill-print-stage">
        <WaybillContent shipment={shipment} />
      </PrintStage>

      {/* الـ Dialog التفاعلي (معاينة على الشاشة) */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[95vh] overflow-y-auto waybill-dialog" dir="rtl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>طباعة بوليصة الشحن — {shipment.shipmentNo}</DialogTitle>
          </DialogHeader>
          {/* معاينة البوليصة على الشاشة (نفس المحتوى) */}
          <div className="border border-slate-200 rounded-lg bg-white max-h-[70vh] overflow-y-auto overflow-x-auto">
            <WaybillContent shipment={shipment} />
          </div>
          {/* أزرار التحكم — تُخفى في الطباعة */}
          <div className="flex items-center justify-between gap-2 mt-2 print:hidden">
            <div className="text-xs text-slate-500">سيتم طباعة البوليصة بحجم A4 كامل دون قيود النافذة</div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button>
              <Button onClick={printModal}><Printer className="size-4" /> طباعة البوليصة</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
