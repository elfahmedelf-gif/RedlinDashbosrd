// ============================================================================
// تصدير Excel (.xlsx) — التقرير الشهري الموحد لحساب المقاول
// GET /api/reports/contractor-monthly/export?contractorId=&year=&month=
// نفس منطق البيانات في /api/reports/[type] (contractor-monthly) تمامًا —
// ملف منسّق جاهز للإرسال المباشر عبر واتساب
// ملاحظة: لا نستخدم handle() لأنه يغلّف الاستجابة JSON — هنا نعيد ملفًا ثنائيًا
// مع أخطاء بنفس الشكل { error: string } الذي ينتجه handle()
// ============================================================================
import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { ApiError } from '@/lib/server/http'
import { requireUser } from '@/lib/server/session'
import { matchPermission } from '@/lib/permissions'
import { ensureSeeded } from '@/lib/server/seed'
import { report } from '@/lib/server/queries'

export const dynamic = 'force-dynamic'

// تسميات أنواع الحركات — مطابقة تمامًا لخريطة MONTHLY_KIND_META في واجهة التقارير
const KIND_LABELS: Record<string, string> = {
  work: 'قيمة شغل شحنة',
  extra_taateeq: 'بند إضافي — تعتيق',
  extra_mabeit: 'بند إضافي — مبيت (معتمد)',
  extra_return: 'بند إضافي — مرتجعات (معتمد)',
  payment: 'دفعة/عهدة صرفت',
  reversal: 'قيد عكسي',
  other: 'حركة أخرى',
}

// شكل بيانات التقرير الشهري كما يعيده report('contractor-monthly')
interface MonthlyExportData {
  contractor: { id: string; code: string | null; name: string }
  period: { year: number; month: number; label: string }
  opening: number
  items: {
    id: string
    date: Date | string
    entryNo: string
    kind: string
    label: string
    refNo: string | null
    notes: string | null
    shipment: { id: string; shipmentNo: string | null; deliveryNumber: string | null; destination: string | null } | null
    amount: number
    balance: number
  }[]
  totals: { work: number; taateeq: number; mabeit: number; return: number; extrasTotal: number; payments: number; other: number; reversal: number; net: number }
}

// ألوان موحدة بصيغة ARGB — أخضر للموجب (مستحقات) وأحمر للسالب (مسحوبات)
const COLOR_DARK = 'FF0F172A'   // رمادي داكن (عناوين)
const COLOR_GRAY = 'FF64748B'   // رمادي (مراجع وملاحظات)
const COLOR_GREEN = 'FF047857'  // أخضر (موجب — في صالح المقاول)
const COLOR_RED = 'FFB91C1C'    // أحمر (سالب — مسحوبات)
const FILL_HEADER = 'FFF1F5F9'  // تعبئة الرؤوس الخفيفة
const FILL_ALT = 'FFFAFAFA'     // تعبئة الصفوف المتناوبة
const BORDER_GRAY = 'FF94A3B8'  // لون الحدود

// أدوات تنسيق — أنواع exceljs صارمة في التعريفات لكنها تقبل أنماطًا جزئية وقت التشغيل
const font = (spec: Partial<ExcelJS.Font>): ExcelJS.Font => spec as ExcelJS.Font
const borders = (spec: Partial<ExcelJS.Borders>): ExcelJS.Borders => spec as ExcelJS.Borders

const THIN = borders({
  top: { style: 'thin', color: { argb: BORDER_GRAY } },
  bottom: { style: 'thin', color: { argb: BORDER_GRAY } },
  left: { style: 'thin', color: { argb: BORDER_GRAY } },
  right: { style: 'thin', color: { argb: BORDER_GRAY } },
})

// حدود صف الإجمالي — خط مزدوج أعلى الجدول
const TOTAL_BORDER = borders({
  top: { style: 'double', color: { argb: COLOR_DARK } },
  bottom: { style: 'thin', color: { argb: BORDER_GRAY } },
  left: { style: 'thin', color: { argb: BORDER_GRAY } },
  right: { style: 'thin', color: { argb: BORDER_GRAY } },
})

/** تنسيق التاريخ YYYY-MM-DD (التاريخ كائن Date قادم مباشرة من طبقة الاستعلام) */
const dateStr = (d: Date | string) => {
  const dt = d instanceof Date ? d : new Date(d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/** تنسيق رقم للنص المدمج — بلا كسور زائدة */
const numText = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

const CELL_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: FILL_HEADER } }
const CELL_CENTER = { horizontal: 'center' as const, vertical: 'middle' as const }

export async function GET(req: Request) {
  try {
    await ensureSeeded()
    // التقرير يكشف أسعارًا ومبالغًا — يُسمح لمن يملك صلاحية تصدير التقارير أو رؤية الأسعار
    const user = await requireUser(req)
    if (!matchPermission(user.permissions, 'reports.export') && !matchPermission(user.permissions, 'prices.view')) {
      throw new ApiError(403, 'غير مصرح — هذه العملية تتطلب صلاحية "reports.export" أو "prices.view"')
    }

    const q = new URL(req.url).searchParams
    const contractorId = q.get('contractorId')
    if (!contractorId) throw new ApiError(400, 'حدد المقاول (contractorId)')
    const year = Number(q.get('year'))
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new ApiError(400, 'حدد السنة صحيحة (year) — من 2000 إلى 2100')
    const month = Number(q.get('month'))
    if (!Number.isInteger(month) || month < 1 || month > 12) throw new ApiError(400, 'حدد الشهر صحيحًا (month) — من 1 إلى 12')

    // نفس منطق البيانات تمامًا كما في التقرير المعروض على الشاشة
    const data = (await report('contractor-monthly', q, user)) as unknown as MonthlyExportData
    const { contractor, period, opening, items, totals } = data

    const wb = new ExcelJS.Workbook()
    wb.creator = 'نظام الإدارة المتكامل'
    wb.created = new Date()
    const ws = wb.addWorksheet('التقرير الشهري')
    ws.views = [{ rightToLeft: true }]

    // أعمدة A..H — عرض يدوي: تاريخ / قيد / بيان / مرجع / دليفري / وجهة / مبلغ / رصيد
    ws.columns = [
      { width: 12 }, { width: 14 }, { width: 30 }, { width: 16 },
      { width: 24 }, { width: 18 }, { width: 12 }, { width: 14 },
    ]

    // ── العنوان الرئيسي (صف 1) ──
    ws.mergeCells('A1:H1')
    const c1 = ws.getCell('A1')
    c1.value = 'التقرير الشهري الموحد — حساب مقاول'
    c1.font = font({ bold: true, size: 16, color: { argb: COLOR_DARK } })
    c1.alignment = CELL_CENTER
    ws.getRow(1).height = 28

    // ── سطر المقاول والشهر (صف 2) ──
    ws.mergeCells('A2:H2')
    const c2 = ws.getCell('A2')
    c2.value = `${contractor.name}${contractor.code ? ` — كود: ${contractor.code}` : ''} — شهر ${period.label}`
    c2.font = font({ bold: true, size: 12, color: { argb: COLOR_DARK } })
    c2.alignment = CELL_CENTER

    // ── سطر تاريخ الإنشاء والعملة (صف 3) ──
    ws.mergeCells('A3:H3')
    const c3 = ws.getCell('A3')
    c3.value = `تاريخ الإنشاء: ${new Date().toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' })} — العملة: جنيه مصري`
    c3.font = font({ size: 9, color: { argb: COLOR_GRAY } })
    c3.alignment = CELL_CENTER

    // ── صندوق الملخص (صفا 5-6) — أزواج مدمجة للنطاقات العريضة ──
    const summary: { from: number; to: number; label: string; value: number; signed?: boolean }[] = [
      { from: 1, to: 2, label: 'رصيد ما قبل الشهر', value: opening },
      { from: 3, to: 4, label: 'قيمة الشغل', value: totals.work },
      { from: 5, to: 6, label: 'بنود معتمدة', value: totals.extrasTotal },
      { from: 7, to: 7, label: 'المسحوبات', value: -totals.payments },
      { from: 8, to: 8, label: 'الصافي', value: totals.net, signed: true },
    ]
    for (const s of summary) {
      if (s.to > s.from) ws.mergeCells(5, s.from, 5, s.to)
      for (let c = s.from; c <= s.to; c++) {
        // النمط يُطبق على كل خلايا النطاق حتى تظهر الحدود كاملة بعد الدمج
        const lc = ws.getCell(5, c)
        lc.font = font({ bold: true, size: 10, color: { argb: COLOR_DARK } })
        lc.fill = CELL_FILL
        lc.alignment = CELL_CENTER
        lc.border = THIN
        const vc = ws.getCell(6, c)
        vc.numFmt = '#,##0.00'
        vc.font = font({ bold: true, size: 11, color: { argb: s.signed ? (s.value >= 0 ? COLOR_GREEN : COLOR_RED) : COLOR_DARK } })
        vc.alignment = CELL_CENTER
        vc.border = THIN
      }
      ws.getCell(5, s.from).value = s.label
      ws.getCell(6, s.from).value = s.value
    }

    // ── رأس جدول الحركات (صف 8) ──
    const HEADERS = ['التاريخ', 'القيد', 'البيان', 'المرجع', 'الديليفري', 'الوجهة', 'المبلغ', 'الرصيد']
    const headerRow = ws.getRow(8)
    headerRow.height = 20
    HEADERS.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1)
      cell.value = h
      cell.font = font({ bold: true, size: 10, color: { argb: COLOR_DARK } })
      cell.fill = CELL_FILL
      cell.alignment = CELL_CENTER
      cell.border = THIN
    })

    // ── صفوف الحركات (من صف 9) ──
    const dataStart = 9
    if (!items.length) {
      ws.mergeCells(dataStart, 1, dataStart, 8)
      const cell = ws.getCell(dataStart, 1)
      cell.value = 'لا توجد حركات في هذا الشهر'
      cell.font = font({ size: 11, italic: true, color: { argb: COLOR_GRAY } })
      cell.alignment = CELL_CENTER
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const r = dataStart + i
      // تعبئة متناوبة للصفوف الزوجية لتحسين القراءة
      const altFill = i % 2 === 1 ? { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: FILL_ALT } } : undefined
      const cells: { value: ExcelJS.CellValue; font: ExcelJS.Font; numFmt?: string }[] = [
        { value: dateStr(it.date), font: font({ size: 10, color: { argb: COLOR_DARK } }) },
        { value: it.entryNo, font: font({ size: 10, color: { argb: COLOR_DARK } }) },
        // البيان: نوع الحركة + المرجع بين قوسين (مطابق لعرض الطباعة)
        { value: `${KIND_LABELS[it.kind] ?? KIND_LABELS.other}${it.refNo ? ` (${it.refNo})` : ''}`, font: font({ size: 10, color: { argb: COLOR_DARK } }) },
        { value: it.refNo ?? '—', font: font({ size: 10, color: { argb: COLOR_GRAY } }) },
        { value: it.shipment?.deliveryNumber ?? it.shipment?.shipmentNo ?? '—', font: font({ size: 10, color: { argb: COLOR_DARK } }) },
        { value: it.shipment?.destination ?? '—', font: font({ size: 10, color: { argb: COLOR_GRAY } }) },
        { value: it.amount, numFmt: '#,##0.00', font: font({ size: 10, color: { argb: it.amount < 0 ? COLOR_RED : COLOR_DARK } }) },
        { value: it.balance, numFmt: '#,##0.00', font: font({ size: 10, bold: true, color: { argb: COLOR_DARK } }) },
      ]
      for (let j = 0; j < cells.length; j++) {
        const cc = cells[j]
        const cell = ws.getCell(r, j + 1)
        cell.value = cc.value
        cell.font = cc.font
        if (cc.numFmt) cell.numFmt = cc.numFmt
        // عمود البيان يُحاذى لليمين (نص عربي) — البقية في المنتصف
        cell.alignment = { horizontal: j === 2 ? 'right' : 'center', vertical: 'middle' }
        cell.border = THIN
        if (altFill) cell.fill = altFill
      }
    }

    // ── صف الإجمالي النهائي ──
    const totalRowNum = dataStart + Math.max(items.length, 1)
    const grandTotal = Math.round((totals.work + totals.extrasTotal - totals.payments) * 100) / 100
    ws.mergeCells(totalRowNum, 1, totalRowNum, 6)
    for (let c = 1; c <= 6; c++) {
      const cell = ws.getCell(totalRowNum, c)
      cell.font = font({ bold: true, size: 10, color: { argb: COLOR_DARK } })
      cell.fill = CELL_FILL
      cell.alignment = { horizontal: 'right', vertical: 'middle' }
      cell.border = TOTAL_BORDER
    }
    ws.getCell(totalRowNum, 1).value = `الإجمالي النهائي — شغل ${numText(totals.work)} + بنود ${numText(totals.extrasTotal)} − مسحوبات ${numText(totals.payments)}`
    const gCell = ws.getCell(totalRowNum, 7)
    gCell.value = grandTotal
    gCell.numFmt = '#,##0.00'
    gCell.font = font({ bold: true, size: 10, color: { argb: COLOR_DARK } })
    gCell.fill = CELL_FILL
    gCell.alignment = CELL_CENTER
    gCell.border = TOTAL_BORDER
    const hCell = ws.getCell(totalRowNum, 8)
    hCell.value = totals.net
    hCell.numFmt = '#,##0.00'
    hCell.font = font({ bold: true, size: 10, color: { argb: totals.net >= 0 ? COLOR_GREEN : COLOR_RED } })
    hCell.fill = CELL_FILL
    hCell.alignment = CELL_CENTER
    hCell.border = TOTAL_BORDER

    // ── سطر الإيضاح الختامي ──
    const noteRowNum = totalRowNum + 1
    ws.mergeCells(noteRowNum, 1, noteRowNum, 8)
    const noteCell = ws.getCell(noteRowNum, 1)
    noteCell.value = 'المبالغ الموجبة في صالح المقاول (مستحقات له) — السالبة مسحوبات/عهد صرفت له. البنود الإضافية المعروضة معتمدة فقط من الشركة. جميع المبالغ بالجنيه المصري.'
    noteCell.font = font({ size: 9, italic: true, color: { argb: COLOR_GRAY } })
    noteCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    ws.getRow(noteRowNum).height = 28

    // ── إخراج الملف — اسم عربي بترميز UTF-8 مع بديل ASCII ──
    const buf = await wb.xlsx.writeBuffer()
    const fileName = `contractor-monthly-${contractor.name}-${year}-${String(month).padStart(2, '0')}.xlsx`
    return new Response(buf as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="monthly-report.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    // نفس شكل أخطاء handle() — { error: string } مع الحالة المناسبة
    const status = e instanceof ApiError ? e.status : 500
    if (status >= 500) console.error('[contractor-monthly-export]', e)
    return NextResponse.json({ error: e?.message ?? 'خطأ غير متوقع في الخادم' }, { status })
  }
}
