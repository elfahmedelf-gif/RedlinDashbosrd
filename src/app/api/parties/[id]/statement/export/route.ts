// ============================================================================
// تصدير Excel (.xlsx) — كشف حساب الطرف (عميل/مقاول/مورد)
// GET /api/parties/[id]/statement/export?from=&to=
// نفس بيانات كشف الحساب المعروض تمامًا (مصدر واحد: getPartyStatement) —
// ملف RTL عربي منسّق جاهز للإرسال المباشر عبر واتساب.
// ============================================================================
import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { ApiError } from '@/lib/server/http'
import { requireUser } from '@/lib/server/session'
import { matchPermission } from '@/lib/permissions'
import { ensureSeeded } from '@/lib/server/seed'
import { getPartyStatement } from '@/lib/server/statement'

export const dynamic = 'force-dynamic'

// ألوان موحدة بصيغة ARGB — مطابقة لتصدير التقرير الشهري
const COLOR_DARK = 'FF0F172A'
const COLOR_GRAY = 'FF64748B'
const COLOR_GREEN = 'FF047857'
const COLOR_RED = 'FFB91C1C'
const FILL_HEADER = 'FFF1F5F9'
const FILL_ALT = 'FFFAFAFA'
const BORDER_GRAY = 'FF94A3B8'

const font = (spec: Partial<ExcelJS.Font>): ExcelJS.Font => spec as ExcelJS.Font
const borders = (spec: Partial<ExcelJS.Borders>): ExcelJS.Borders => spec as ExcelJS.Borders

const THIN = borders({
  top: { style: 'thin', color: { argb: BORDER_GRAY } },
  bottom: { style: 'thin', color: { argb: BORDER_GRAY } },
  left: { style: 'thin', color: { argb: BORDER_GRAY } },
  right: { style: 'thin', color: { argb: BORDER_GRAY } },
})
const TOTAL_BORDER = borders({
  top: { style: 'double', color: { argb: COLOR_DARK } },
  bottom: { style: 'thin', color: { argb: BORDER_GRAY } },
  left: { style: 'thin', color: { argb: BORDER_GRAY } },
  right: { style: 'thin', color: { argb: BORDER_GRAY } },
})

const dateStr = (d: Date | string) => {
  const dt = d instanceof Date ? d : new Date(d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
const numText = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const CELL_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: FILL_HEADER } }
const CELL_CENTER = { horizontal: 'center' as const, vertical: 'middle' as const }

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureSeeded()
    // كشف الحساب يكشف مبالغًا — يُسمح لمن يملك عرض الأطراف أو صلاحية تصدير/طباعة الكشوف
    const u = await requireUser(req)
    if (!matchPermission(u.permissions, 'parties.view') && !matchPermission(u.permissions, 'reports.export')) {
      throw new ApiError(403, 'غير مصرح — هذه العملية تتطلب صلاحية "parties.view" أو "reports.export"')
    }
    const { id } = await params
    const q = new URL(req.url).searchParams
    const from = q.get('from')
    const to = q.get('to')

    const data = await getPartyStatement(id, from, to)
    const { party, period, opening, items, totals } = data

    const wb = new ExcelJS.Workbook()
    wb.creator = 'نظام الإدارة المتكامل'
    wb.created = new Date()
    const ws = wb.addWorksheet('كشف الحساب')
    ws.views = [{ rightToLeft: true }]

    // أعمدة A..G — تاريخ / قيد / البيان / الحساب / مدين / دائن / الرصيد
    ws.columns = [{ width: 12 }, { width: 14 }, { width: 42 }, { width: 18 }, { width: 13 }, { width: 13 }, { width: 14 }]

    // ── العنوان الرئيسي (صف 1) ──
    ws.mergeCells('A1:G1')
    const c1 = ws.getCell('A1')
    c1.value = 'كشف حساب — حركة الطرف على دفتر الأستاذ'
    c1.font = font({ bold: true, size: 16, color: { argb: COLOR_DARK } })
    c1.alignment = CELL_CENTER
    ws.getRow(1).height = 28

    // ── سطر الطرف والفترة (صف 2) ──
    ws.mergeCells('A2:G2')
    const c2 = ws.getCell('A2')
    const roleLabel = party.isContractor ? 'مقاول' : party.isSupplier ? 'مورد' : party.isCustomer ? 'عميل' : 'طرف'
    const periodLabel = period.from || period.to ? `من ${period.from ?? 'البداية'} إلى ${period.to ?? 'اليوم'}` : 'كل الفترات'
    c2.value = `${party.name}${party.code ? ` — كود: ${party.code}` : ''} (${roleLabel}) — الفترة: ${periodLabel}`
    c2.font = font({ bold: true, size: 12, color: { argb: COLOR_DARK } })
    c2.alignment = CELL_CENTER
    ws.getRow(2).height = 20

    // ── سطر الإنشاء والعملة (صف 3) ──
    ws.mergeCells('A3:G3')
    const c3 = ws.getCell('A3')
    c3.value = `تاريخ التصدير: ${dateStr(new Date())} — العملة: ج.م`
    c3.font = font({ size: 10, color: { argb: COLOR_GRAY } })
    c3.alignment = CELL_CENTER

    // ── صندوق الملخص (صف 5): افتتاحي / مدين / دائن / ختامي ──
    const summaryRow = 5
    const summary = [
      { label: 'الرصيد الافتتاحي', value: opening },
      { label: 'إجمالي المدين', value: totals.totalDebit },
      { label: 'إجمالي الدائن', value: totals.totalCredit },
      { label: 'الرصيد الختامي', value: totals.closing },
    ]
    const summaryCells = ['A5', 'B5', 'C5', 'D5']
    summaryCells.forEach((cell, i) => {
      const labelCell = ws.getCell(cell)
      labelCell.value = `${summary[i].label}: ${numText(summary[i].value)} ج.م`
      labelCell.font = font({ bold: true, size: 11, color: { argb: summary[i].value < 0 ? COLOR_RED : summary[i].value > 0 ? COLOR_GREEN : COLOR_DARK } })
      labelCell.alignment = { horizontal: 'right' as const, vertical: 'middle' as const }
      labelCell.fill = CELL_FILL
      labelCell.border = THIN
    })
    ws.getRow(summaryRow).height = 22

    // ── رأس الجدول (صف 7) ──
    const headerRowIndex = 7
    const headers = ['التاريخ', 'القيد', 'البيان', 'الحساب', 'مدين', 'دائن', 'الرصيد']
    const headerRow = ws.getRow(headerRowIndex)
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1)
      cell.value = h
      cell.font = font({ bold: true, size: 11, color: { argb: COLOR_DARK } })
      cell.fill = CELL_FILL
      cell.alignment = CELL_CENTER
      cell.border = THIN
    })
    headerRow.height = 22

    // ── صفوف الحركات ──
    items.forEach((it, idx) => {
      const r = headerRowIndex + 1 + idx
      const row = ws.getRow(r)
      const alt = idx % 2 === 1
      const vals: ExcelJS.CellValue[] = [
        dateStr(it.date),
        it.entryNo,
        `${it.description ?? ''}${it.shipment?.shipmentNo ? ` — شحنة ${it.shipment.shipmentNo}` : ''}${it.reference && it.reference !== it.entryNo ? ` (${it.reference})` : ''}`,
        it.account.name,
        it.debit || null,
        it.credit || null,
        it.balance,
      ]
      vals.forEach((v, i) => {
        const cell = row.getCell(i + 1)
        cell.value = v
        cell.border = THIN
        if (alt) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_ALT } }
        if (i >= 4) {
          cell.numFmt = '#,##0.00'
          cell.alignment = { horizontal: 'center' as const, vertical: 'middle' as const }
          const isSignedCol = i === 6
          const n = Number(v ?? 0)
          if (isSignedCol && n !== 0) cell.font = font({ size: 11, color: { argb: n > 0 ? COLOR_GREEN : COLOR_RED } })
        }
      })
    })

    // ── صف الإجمالي النهائي ──
    const totalRowIdx = headerRowIndex + 1 + items.length
    const totalRow = ws.getRow(totalRowIdx)
    totalRow.getCell(1).value = 'الإجمالي'
    totalRow.getCell(1).font = font({ bold: true, size: 12, color: { argb: COLOR_DARK } })
    totalRow.getCell(3).value = `مدين ${numText(totals.totalDebit)} — دائن ${numText(totals.totalCredit)}`
    totalRow.getCell(3).font = font({ size: 11, color: { argb: COLOR_GRAY } })
    totalRow.getCell(5).value = totals.totalDebit
    totalRow.getCell(5).numFmt = '#,##0.00'
    totalRow.getCell(6).value = totals.totalCredit
    totalRow.getCell(6).numFmt = '#,##0.00'
    totalRow.getCell(7).value = totals.closing
    totalRow.getCell(7).numFmt = '#,##0.00'
    totalRow.getCell(7).font = font({ bold: true, size: 12, color: { argb: totals.closing < 0 ? COLOR_RED : totals.closing > 0 ? COLOR_GREEN : COLOR_DARK } })
    for (let i = 1; i <= 7; i++) {
      const cell = totalRow.getCell(i)
      cell.border = TOTAL_BORDER
      cell.fill = CELL_FILL
    }
    totalRow.height = 24

    // ملاحظة ختامية
    ws.mergeCells(`A${totalRowIdx + 2}:G${totalRowIdx + 2}`)
    const noteCell = ws.getCell(`A${totalRowIdx + 2}`)
    noteCell.value = 'رصيد موجب = مستحق للشركة (مدين) · رصيد سالب = مستحق على الشركة (دائن) — مشتق من القيود المرحّلة الفعلية.'
    noteCell.font = font({ italic: true, size: 10, color: { argb: COLOR_GRAY } })

    const buf = await wb.xlsx.writeBuffer()
    const safeName = (party.name || 'party').replace(/[\r\n\\/:*?"<>|]/g, '-').slice(0, 40)
    const periodSuffix = period.from || period.to ? `-${period.from ?? 'start'}_${period.to ?? 'today'}` : '-all'
    return new NextResponse(buf as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="statement-${encodeURIComponent(safeName)}${periodSuffix}.xlsx"; filename*=UTF-8''${encodeURIComponent(`كشف حساب - ${party.name}${periodSuffix}.xlsx`)}`,
      },
    })
  } catch (e: any) {
    const status = e instanceof ApiError ? e.status : 500
    if (status >= 500) console.error('[statement-export-error]', e)
    return NextResponse.json({ error: e?.message ?? 'خطأ غير متوقع في الخادم' }, { status })
  }
}
