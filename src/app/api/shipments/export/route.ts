// ============================================================================
// تصدير الشحنات Excel احترافي — GET /api/shipments/export
// نفس فلاتر وواجهة /api/shipments تمامًا (مصدر واحد: listShipments) —
// لكن الملف يُولَّد على الخادم بتنسيق كامل:
//   شريط عنوان + وصف الفلاتر + صندوق إجماليات + رأس ملوّن + صفوف مخططة
//   + شارات حالة ملوّنة + تنسيق أرقام + صف إجمالي + تثبيت رأس + فلترة أعمدة
// الأعمدة تُصدَّر فقط بما يسمح به نظام الصلاحيات (shipcols.* + prices/extras)
// ============================================================================
import ExcelJS from 'exceljs'
import { ApiError } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { db } from '@/lib/db'
import { listShipments } from '@/lib/server/queries'
import { shipmentFieldVisibility } from '@/lib/server/prices'
import { matchPermission } from '@/lib/permissions'
import { shipmentStatusLabel } from '@/lib/shipment-catalog'
import {
  XL, XTHIN, XTOTAL, XCENTER, xfont, xfill, xlsDateStr,
  MONEY_FMT, QTY_FMT, SHIPMENT_STATUS_STYLE, xlsxResponse,
} from '@/lib/server/excel'

export const dynamic = 'force-dynamic'

const MAX_ROWS = 5000
const PAGE = 500

/** رقم مالي نظيف — يرد فارغًا للقيم الفارغة/الصفرية بدل إغراق الملف بأصفار */
const money = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n !== 0 ? Math.round(n * 100) / 100 : null
}

export async function GET(req: Request) {
  try {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.export')
    const inQ = new URL(req.url).searchParams

    // ── جلب كل النتائج المطابقة بنفس الفلاتر (دفعات 500 حتى 5000 صف) ──
    const outQ = new URLSearchParams(inQ.toString())
    outQ.delete('page'); outQ.delete('pageSize')
    const all: any[] = []
    let total = 0
    let totals: any = null
    let totalPages = 1
    for (let p = 1; p <= Math.ceil(MAX_ROWS / PAGE); p++) {
      outQ.set('page', String(p)); outQ.set('pageSize', String(PAGE))
      const res = await listShipments(outQ, user)
      total = res.total
      totalPages = res.totalPages ?? 1
      if (p === 1) totals = res.totals ?? null
      all.push(...res.items)
      if (!res.items?.length || p >= totalPages || all.length >= MAX_ROWS) break
    }
    const capped = total > MAX_ROWS
    if (!all.length) throw new ApiError(400, 'لا توجد شحنات مطابقة للفلاتر الحالية — وسّع الفلاتر ثم أعد المحاولة')

    // ── الصلاحيات: أعمدة الجدول (shipcols.*) + فئات المبالغ/البنود ──
    const perms = user.permissions ?? []
    const has = (k: string) => matchPermission(perms, k)
    const col = {
      shipmentNo: has('shipcols.shipmentNo'),
      customer: has('shipcols.customer'),
      destination: has('shipcols.destination'),
      pieces: has('shipcols.pieces'),
      loadType: has('shipcols.loadType'),
      contractor: has('shipcols.contractor'),
      date: has('shipcols.date'),
      status: has('shipcols.status'),
    }
    const vis = shipmentFieldVisibility(user)

    // ── تعريف الأعمدة — العمود يظهر فقط لو مصرّح به ──
    type Col = { header: string; width: number; kind: 'text' | 'money' | 'qty' | 'date' | 'status'; val: (s: any) => ExcelJS.CellValue }
    const defs: Col[] = []
    const C = (header: string, width: number, kind: Col['kind'], visible: boolean, val: Col['val']) => {
      if (visible) defs.push({ header, width, kind, val })
    }
    C('رقم الشحنة', 14, 'text', col.shipmentNo, (s) => s.shipmentNo ?? '')
    C('رقم الديليفري', 14, 'text', true, (s) => s.deliveryNumber ?? '')
    C('رقم البوليصة', 12, 'text', col.shipmentNo, (s) => s.billNo ?? '')
    C('Ship Part', 12, 'text', col.shipmentNo, (s) => s.shipPart ?? '')
    C('العميل', 18, 'text', col.customer, (s) => s.customer?.name ?? '')
    C('المستلم', 18, 'text', col.customer, (s) => s.recipientName ?? '')
    C('الوجهة', 14, 'text', col.destination, (s) => s.destination ?? '')
    C('الوجهة EN', 14, 'text', col.destination, (s) => s.destinationEn ?? '')
    C('كود الخط', 10, 'text', col.destination, (s) => s.routeCode ?? '')
    C('الكمية (قطع)', 10, 'qty', col.pieces, (s) => money(s.policyQty))
    C('عدد الشاحنات', 11, 'qty', true, (s) => money(s.truckCount ?? (((s.ton15 ?? 0) + (s.ton3 ?? 0) + (s.m6 ?? 0)) || null)))
    C('شاحنات 1.5 طن', 11, 'qty', col.loadType && vis.canPrices, (s) => money(s.ton15))
    C('شاحنات 3 طن', 11, 'qty', col.loadType && vis.canPrices, (s) => money(s.ton3))
    C('شاحنات 6م', 11, 'qty', col.loadType && vis.canPrices, (s) => money(s.m6))
    C('النوع', 10, 'text', col.loadType, (s) => s.loadType ?? '')
    C('المقاول', 18, 'text', col.contractor, (s) => s.contractor?.name ?? '')
    C('الفرع', 12, 'text', true, (s) => s.branch?.name ?? '')
    C('تاريخ الشحن', 12, 'date', col.date, (s) => (s.date ? xlsDateStr(s.date) : ''))
    C('الحالة', 22, 'status', col.status, (s) => shipmentStatusLabel(s.status))
    C('نولون العميل', 13, 'money', vis.freight, (s) => money(s.freightTotal ?? s.freightCost))
    C('نولون المقاول', 13, 'money', vis.suppliers, (s) => money(s.totalSuppliers))
    C('هامش الربح', 12, 'money', vis.margin, (s) => money(s.margin))
    C('تعتيق', 10, 'money', vis.aging, (s) => money(s.aging))
    C('مبيت', 10, 'money', vis.overnight, (s) => money(s.overnight))
    C('تحويلة', 10, 'money', vis.transfer, (s) => money(s.transfer))
    C('دروب', 10, 'money', vis.drop, (s) => money(s.drop))
    C('الإجمالي النقلة', 14, 'money', vis.grand, (s) => money(s.grand))
    if (!defs.length) throw new ApiError(403, 'لا توجد أعمدة مصرّح بها للتصدير — اطلب صلاحيات الأعمدة من المدير')

    // ── بناء الملف ──
    const wb = new ExcelJS.Workbook()
    wb.creator = 'نظام الإدارة المتكامل'
    wb.created = new Date()
    const ws = wb.addWorksheet('الشحنات')
    ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 6 }]
    defs.forEach((d) => { ws.columns = [...(ws.columns ?? []), { width: d.width }] })
    const lastCol = defs.length

    // صف 1: شريط العنوان
    ws.mergeCells(1, 1, 1, lastCol)
    const title = ws.getCell(1, 1)
    title.value = 'تقرير الشحنات — نظام الإدارة المتكامل'
    title.font = xfont({ bold: true, size: 16, color: { argb: XL.WHITE } })
    title.fill = xfill(XL.DARK)
    title.alignment = XCENTER
    ws.getRow(1).height = 32

    // صف 2: وصف الفلاتر + عدد الصفوف
    const filterParts: string[] = []
    const statusParam = inQ.get('status')
    if (statusParam && statusParam !== 'all') filterParts.push(`الحالة: ${shipmentStatusLabel(statusParam)}`)
    const destParam = inQ.get('destination')
    if (destParam && destParam !== 'all') filterParts.push(`الوجهة: ${destParam}`)
    const contractorParam = inQ.get('contractor')
    if (contractorParam && contractorParam !== 'all') {
      const c = await db.party.findUnique({ where: { id: contractorParam }, select: { name: true } })
      if (c) filterParts.push(`المقاول: ${c.name}`)
    }
    const dateParam = inQ.get('date')
    const fromParam = inQ.get('from')
    const toParam = inQ.get('to')
    if (dateParam) filterParts.push(`يوم: ${dateParam}`)
    else if (fromParam || toParam) filterParts.push(`الفترة: ${fromParam || 'البداية'} ← ${toParam || 'اليوم'}`)
    if (inQ.get('stopped') === '1') filterParts.push('المتوقفة فقط (بتقف تاني يوم)')
    const searchParam = (inQ.get('q') ?? '').trim()
    if (searchParam) filterParts.push(`بحث: «${searchParam}»`)
    ws.mergeCells(2, 1, 2, lastCol)
    const sub = ws.getCell(2, 1)
    sub.value = `${filterParts.length ? 'الفلاتر: ' + filterParts.join(' · ') : 'كل الشحنات (بدون فلاتر)'} — عدد الصفوف: ${all.length.toLocaleString('en-US')}${capped ? ` من ${total.toLocaleString('en-US')} (الحد الأقصى للتصدير ${MAX_ROWS.toLocaleString('en-US')})` : ''}`
    sub.font = xfont({ bold: true, size: 11, color: { argb: XL.DARK } })
    sub.alignment = XCENTER
    sub.fill = xfill(XL.FILL_HEAD)
    ws.getRow(2).height = 24

    // صف 3: بيانات الإنشاء
    ws.mergeCells(3, 1, 3, lastCol)
    const meta = ws.getCell(3, 1)
    meta.value = `تاريخ التصدير: ${xlsDateStr(new Date())} — المستخدم: ${user.username} — العملة: ج.م`
    meta.font = xfont({ size: 10, color: { argb: XL.GRAY } })
    meta.alignment = XCENTER

    // صف 4: صندوق الملخص — من إحصاءات الخادم على كل النتائج المطابقة (نفس أرقام الشاشة)
    const kpis = [
      { label: 'عدد الشحنات', v: total },
      { label: 'القطع', v: totals?.pieces },
      { label: 'نولون العملاء', v: totals?.freight },
      { label: 'نولون المقاولين', v: totals?.suppliers },
      { label: 'هامش الربح', v: totals?.margin },
      { label: 'الإجمالي النقلة', v: totals?.grand },
    ].filter((k) => k.v !== null && k.v !== undefined)
    kpis.forEach((k, i) => {
      const cell = ws.getCell(4, Math.min(i + 1, lastCol))
      const isMoney = i >= 2
      const n = Number(k.v)
      cell.value = `${k.label}: ${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
      cell.font = xfont({ bold: true, size: 10, color: { argb: isMoney ? (n < 0 ? XL.RED : XL.GREEN) : XL.DARK } })
      cell.fill = xfill(XL.FILL_HEAD)
      cell.border = XTHIN
      cell.alignment = XCENTER
    })
    ws.getRow(4).height = 22

    // صف 5: فارغ فاصل — صف 6: رأس الجدول
    const headerRowIndex = 6
    const headerRow = ws.getRow(headerRowIndex)
    defs.forEach((d, i) => {
      const cell = headerRow.getCell(i + 1)
      cell.value = d.header
      cell.font = xfont({ bold: true, size: 11, color: { argb: XL.WHITE } })
      cell.fill = xfill(XL.SLATE_HEADER)
      cell.alignment = XCENTER
      cell.border = XTHIN
    })
    headerRow.height = 26

    // ── صفوف البيانات ──
    const marginColIdx = defs.findIndex((d) => d.header === 'هامش الربح') + 1
    all.forEach((s, idx) => {
      const row = ws.getRow(headerRowIndex + 1 + idx)
      const alt = idx % 2 === 1
      defs.forEach((d, i) => {
        const cell = row.getCell(i + 1)
        cell.value = d.val(s)
        cell.border = XTHIN
        if (alt) cell.fill = xfill(XL.FILL_ALT)
        switch (d.kind) {
          case 'money':
            cell.numFmt = MONEY_FMT
            cell.alignment = XCENTER
            if (i + 1 === marginColIdx && Number(cell.value ?? 0) !== 0) {
              cell.font = xfont({ size: 10, bold: true, color: { argb: Number(cell.value) > 0 ? XL.GREEN : XL.RED } })
            }
            break
          case 'qty':
            cell.numFmt = QTY_FMT
            cell.alignment = XCENTER
            break
          case 'date':
            cell.alignment = XCENTER
            break
          case 'status': {
            const st = SHIPMENT_STATUS_STYLE[s.status]
            if (st) {
              cell.fill = xfill(st.fill)
              cell.font = xfont({ size: 10, bold: true, color: { argb: st.text } })
            }
            cell.alignment = XCENTER
            break
          }
          default:
            cell.font = xfont({ size: 10, color: { argb: XL.DARK } })
        }
      })
    })

    // ── صف الإجمالي ──
    const totalRowIndex = headerRowIndex + 1 + all.length
    const totalRow = ws.getRow(totalRowIndex)
    const sumCols = defs.map((d, i) => ({ d, i: i + 1 })).filter(({ d }) => d.kind === 'money' || d.kind === 'qty')
    const sums = new Map<number, number>()
    for (const s of all) {
      for (const { d, i } of sumCols) {
        const n = Number(d.val(s))
        if (Number.isFinite(n) && n !== 0) sums.set(i, (sums.get(i) ?? 0) + n)
      }
    }
    totalRow.getCell(1).value = `الإجمالي — ${all.length.toLocaleString('en-US')} شحنة`
    totalRow.getCell(1).font = xfont({ bold: true, size: 12, color: { argb: XL.DARK } })
    for (const { i } of sumCols) {
      const cell = totalRow.getCell(i)
      cell.value = Math.round((sums.get(i) ?? 0) * 100) / 100
      cell.numFmt = defs[i - 1].kind === 'money' ? MONEY_FMT : QTY_FMT
      cell.alignment = XCENTER
      cell.font = xfont({ bold: true, size: 11, color: { argb: XL.DARK } })
    }
    for (let i = 1; i <= lastCol; i++) {
      const cell = totalRow.getCell(i)
      cell.border = XTOTAL
      cell.fill = xfill(XL.FILL_HEAD)
    }
    totalRow.height = 26

    // ملاحظة ختامية
    ws.mergeCells(totalRowIndex + 2, 1, totalRowIndex + 2, lastCol)
    const note = ws.getCell(totalRowIndex + 2, 1)
    note.value = 'تم إنشاء هذا الملف آليًا من نظام الإدارة المتكامل — يحتوي فقط الأعمدة المصرّح بها وفق صلاحيات المستخدم، وألوان الحالة مطابقة لشارات الشاشة.'
    note.font = xfont({ italic: true, size: 9, color: { argb: XL.GRAY } })
    note.alignment = XCENTER

    // فلترة أعمدة فوق نطاق البيانات + رأس مجمد
    ws.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex + all.length, column: lastCol },
    }

    const buf = await wb.xlsx.writeBuffer()
    return xlsxResponse(buf, `shipments-${xlsDateStr(new Date())}`, `تقرير الشحنات ${xlsDateStr(new Date())}`)
  } catch (e: any) {
    const status = e instanceof ApiError ? e.status : 500
    if (status >= 500) console.error('[shipments-export-error]', e)
    return Response.json({ error: e?.message ?? 'خطأ غير متوقع في الخادم' }, { status })
  }
}
