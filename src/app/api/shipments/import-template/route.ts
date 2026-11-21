// ============================================================================
// قالب استيراد الشحنات Excel — GET /api/shipments/import-template
// ملف .xlsx احترافي من 3 شيتات:
//   1) «الشحنات»  — شيت الإدخال: رأس ملوّن + تلميحات + صفوف مثال + قوائم منسدلة
//      (Data Validation) معبّأة مسبقًا ببيانات النظام الحقيقية — لا يقبل قيمًا خارجها
//   2) «التعليمات» — خطوات الاستيراد + دليل الألوان + التحذيرات
//   3) «القوائم»   — مصادر القوائم المنسدلة (العملاء/المقاولون/الفروع/الوجهات/العمال)
// الأعمدة مطابقة تمامًا لحقول /api/import/commit — القالب يُرفع فورًا في المعالج.
// ============================================================================
import ExcelJS from 'exceljs'
import { ApiError } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { db } from '@/lib/db'
import {
  XL, XTHIN, XCENTER, xfont, xfill, xlsDateStr, xlsxResponse,
} from '@/lib/server/excel'

export const dynamic = 'force-dynamic'

const DATA_START = 8      // أول صف إدخال (بعد المثالين)
const DATA_END = 507      // آخر صف إدخال (500 صف جاهز بقوائم منسدلة)
const LISTS_SHEET = 'القوائم'

/** تعريف أعمدة القالب — بالترتيب نفسه المطابق لحقول الاستيراد على الخادم */
const COLS: { header: string; width: number; hint: string; required?: boolean; dropdown?: 'customers' | 'contractors' | 'branches' | 'destinations' | 'workers'; kind?: 'qty' | 'money' }[] = [
  { header: 'رقم الديليفري', width: 14, hint: 'اختياري — فريد في النظام' },
  { header: 'تاريخ الشحن', width: 12, hint: 'YYYY-MM-DD — اختياري' },
  { header: 'اسم المستلم', width: 18, hint: 'إلزامي', required: true },
  { header: 'هاتف المستلم', width: 14, hint: 'أرقام' },
  { header: 'العميل', width: 20, hint: 'اختر من القائمة', dropdown: 'customers' },
  { header: 'المقاول', width: 20, hint: 'اختر من القائمة', dropdown: 'contractors' },
  { header: 'الفرع', width: 14, hint: 'اختر من القائمة', dropdown: 'branches' },
  { header: 'الوجهة', width: 14, hint: 'إلزامي — اختر من القائمة', required: true, dropdown: 'destinations' },
  { header: 'الوجهة (EN)', width: 14, hint: 'بالإنجليزية' },
  { header: 'كود الخط', width: 10, hint: '' },
  { header: 'Ship Part', width: 12, hint: 'أمر الشحن عند العميل' },
  { header: 'العامل', width: 14, hint: 'اختر من القائمة', dropdown: 'workers' },
  { header: 'عدد القطع', width: 10, hint: 'أرقام', kind: 'qty' },
  { header: 'عدد الشاحنات', width: 12, hint: 'أرقام', kind: 'qty' },
  { header: 'شاحنات 1.5 طن', width: 11, hint: 'أرقام', kind: 'qty' },
  { header: 'شاحنات 3 طن', width: 11, hint: 'أرقام', kind: 'qty' },
  { header: 'شاحنات 6م', width: 11, hint: 'أرقام', kind: 'qty' },
  { header: 'نولون العميل', width: 13, hint: 'أرقام — يُحصَّل من العميل', kind: 'money' },
  { header: 'التكويد (نولون المقاول)', width: 16, hint: 'أرقام — تكلفة المقاول', kind: 'money' },
]

/** نص رأس العمود مع علامات الإلزامي (★) والمنسدل (▼) */
const headerText = (c: typeof COLS[number]) =>
  `${c.required ? '★ ' : ''}${c.dropdown ? '▼ ' : ''}${c.header}`

export async function GET(req: Request) {
  try {
    await ensureSeeded()
    await requirePerm(req, 'import.manage')

    // ── بيانات النظام الحقيقية — مصادر القوائم المنسدلة ──
    const [customers, contractors, branches, destinationRows, workerRows] = await Promise.all([
      db.party.findMany({ where: { isCustomer: true, active: true }, select: { name: true }, orderBy: { name: 'asc' } }),
      db.party.findMany({ where: { isContractor: true, active: true }, select: { name: true }, orderBy: { name: 'asc' } }),
      db.branch.findMany({ where: { active: true }, select: { name: true }, orderBy: { name: 'asc' } }),
      db.shipment.findMany({ where: { destination: { not: null } }, select: { destination: true }, distinct: ['destination'], take: 500 }),
      db.shipment.findMany({ where: { worker: { not: null } }, select: { worker: true }, distinct: ['worker'], take: 300 }),
    ])
    const lists = {
      customers: customers.map((x) => x.name),
      contractors: contractors.map((x) => x.name),
      branches: branches.map((x) => x.name),
      destinations: destinationRows.map((x) => x.destination).filter((v): v is string => !!v),
      workers: workerRows.map((x) => x.worker).filter((v): v is string => !!v),
    }

    const wb = new ExcelJS.Workbook()
    wb.creator = 'نظام الإدارة المتكامل'
    wb.created = new Date()

    // ══════════════════ شيت 1: «الشحنات» — شيت الإدخال ══════════════════
    const ws = wb.addWorksheet('الشحنات')
    ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 5 }]
    COLS.forEach((c) => { ws.columns = [...(ws.columns ?? []), { width: c.width }] })
    const lastCol = COLS.length

    // صف 1: شريط العنوان
    ws.mergeCells(1, 1, 1, lastCol)
    const title = ws.getCell(1, 1)
    title.value = 'شيت استيراد الشحنات — نظام الإدارة المتكامل'
    title.font = xfont({ bold: true, size: 16, color: { argb: XL.WHITE } })
    title.fill = xfill(XL.DARK)
    title.alignment = XCENTER
    ws.getRow(1).height = 32

    // صف 2: التعليمات السريعة
    ws.mergeCells(2, 1, 2, lastCol)
    const sub = ws.getCell(2, 1)
    sub.value = '★ = عمود إلزامي · ▼ = قائمة منسدلة معبّأة ببيانات النظام (اختر منها فقط) · ابدأ الإدخال من الصف 8 بعد حذف صفّي المثال'
    sub.font = xfont({ bold: true, size: 10, color: { argb: XL.AMBER } })
    sub.alignment = XCENTER
    sub.fill = xfill(XL.AMBER_LIGHT)
    ws.getRow(2).height = 24

    // صف 3: بيانات القالب
    ws.mergeCells(3, 1, 3, lastCol)
    const meta = ws.getCell(3, 1)
    meta.value = `تاريخ إنشاء القالب: ${xlsDateStr(new Date())} — القوائم المتاحة: ${lists.customers.length} عميل · ${lists.contractors.length} مقاول · ${lists.branches.length} فرع · ${lists.destinations.length} وجهة · ${lists.workers.length} عامل`
    meta.font = xfont({ size: 9, color: { argb: XL.GRAY } })
    meta.alignment = XCENTER

    // صف 4: رأس الجدول الملوّن (إلزامي كهرماني / منسدل زمردي / عادي سلايت)
    const headerRow = ws.getRow(4)
    COLS.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1)
      cell.value = headerText(c)
      cell.font = xfont({ bold: true, size: 10, color: { argb: c.required ? XL.AMBER : c.dropdown ? XL.GREEN : XL.WHITE } })
      cell.fill = xfill(c.required ? XL.AMBER_LIGHT : c.dropdown ? XL.GREEN_LIGHT : XL.SLATE_HEADER)
      cell.alignment = { ...XCENTER, wrapText: true }
      cell.border = XTHIN
    })
    headerRow.height = 34

    // صف 5: صف التلميحات
    const hintRow = ws.getRow(5)
    COLS.forEach((c, i) => {
      const cell = hintRow.getCell(i + 1)
      cell.value = c.hint || '—'
      cell.font = xfont({ italic: true, size: 8, color: { argb: XL.GRAY } })
      cell.alignment = XCENTER
      cell.fill = xfill(XL.FILL_HEAD)
      cell.border = XTHIN
    })
    hintRow.height = 18

    // صفوف 6-7: مثالان مظللان — يُتخطيان عند الاستيراد (يبدآن بـ «مثال»)
    const today = xlsDateStr(new Date())
    const pick = (arr: string[], i = 0) => arr[i] ?? '—'
    const examples = [
      ['1001', today, 'مثال — أحمد محمد', '01000000000', pick(lists.customers), pick(lists.contractors), pick(lists.branches), pick(lists.destinations), '', '', 'SP-100', pick(lists.workers), '5', '1', '1', '', '', '1500', '900'],
      ['1002', today, 'مثال — سعيد علي', '01100000000', pick(lists.customers), pick(lists.contractors), pick(lists.branches), pick(lists.destinations), '', '', 'SP-101', pick(lists.workers), '3', '1', '', '1', '', '1200', '800'],
    ]
    examples.forEach((ex, ei) => {
      const row = ws.getRow(6 + ei)
      COLS.forEach((_, i) => {
        const cell = row.getCell(i + 1)
        cell.value = ex[i] ?? ''
        cell.font = xfont({ italic: true, size: 10, color: { argb: XL.GRAY } })
        cell.fill = xfill(XL.AMBER_EX)
        cell.border = XTHIN
        cell.alignment = XCENTER
      })
    })

    // ── القوائم المنسدلة (Data Validation) — معبّأة ببيانات النظام، ترفض أي قيمة خارجها ──
    const listLetter = { customers: 'A', contractors: 'B', branches: 'C', destinations: 'D', workers: 'E' } as const
    for (let ci = 0; ci < COLS.length; ci++) {
      const c = COLS[ci]
      if (!c.dropdown) continue
      const values = lists[c.dropdown]
      if (!values.length) continue // لا قائمة فارغة — التحقق يُضاف فقط لما فيه بيانات
      const formula = `='${LISTS_SHEET}'!$${listLetter[c.dropdown]}$2:$${listLetter[c.dropdown]}$${values.length + 1}`
      for (let r = DATA_START; r <= DATA_END; r++) {
        ws.getCell(r, ci + 1).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [formula],
          showErrorMessage: true,
          errorStyle: 'stop',
          errorTitle: 'قيمة غير صالحة',
          error: 'اختر من القائمة المنسدلة فقط — القوائم معبّأة ببيانات النظام الحقيقية، ولا تُقبل قيم خارجها.',
          showInputMessage: true,
          promptTitle: 'قائمة من بيانات النظام',
          prompt: 'اضغط السهم ▼ لاختيار قيمة — لتحديث القوائم حمّل قالبًا جديدًا.',
        }
      }
    }

    // تنسيق أرقام أعمدة الكميات والمبالغ على نطاق الإدخال
    for (let ci = 0; ci < COLS.length; ci++) {
      const c = COLS[ci]
      if (!c.kind) continue
      for (let r = 6; r <= DATA_END; r++) {
        ws.getCell(r, ci + 1).numFmt = c.kind === 'money' ? '#,##0.00' : '#,##0'
      }
    }

    // ══════════════════ شيت 2: «التعليمات» ══════════════════
    const wi = wb.addWorksheet('التعليمات')
    wi.views = [{ rightToLeft: true }]
    wi.columns = [{ width: 3 }, { width: 100 }, { width: 3 }]

    wi.mergeCells('B1:B1')
    const wt = wi.getCell('B1')
    wt.value = 'تعليمات استيراد الشحنات من هذا القالب'
    wt.font = xfont({ bold: true, size: 15, color: { argb: XL.WHITE } })
    wt.fill = xfill(XL.DARK)
    wt.alignment = XCENTER
    wi.getRow(1).height = 30

    const steps: { text: string; tone?: string }[] = [
      { text: '1) حمّل هذا القالب من معالج الاستيراد — القوائم المنسدلة (▼) تكون معبّأة تلقائيًا ببيانات النظام وقت التحميل: العملاء، المقاولون، الفروع، الوجهات، العمال.' },
      { text: '2) املأ صفوف الشحنات في شيت «الشحنات» بدءًا من الصف 8 — كل صف = شحنة واحدة.', tone: XL.AMBER_LIGHT },
      { text: '3) احذف صفّي المثال المظللين بالأصفر قبل الاستيراد (أو عدّل بياناتهما). الصفوف التي تبدأ بكلمة «مثال» تتخطى تلقائيًا.', tone: XL.AMBER_EX },
      { text: '4) الأعمدة المميزة بـ ★ إلزامية: اسم المستلم والوجهة. باقي الأعمدة تُترك فارغة إن لم تتوفر بيانات.' },
      { text: '5) الأعمدة المميزة بـ ▼ قوائم منسدلة — Excel يرفض أي قيمة خارج القائمة؛ إن احتجت عميل/وجهة جديدة أضفها أولًا في النظام ثم حمّل قالبًا جديدًا. العميل غير الموجود يُنشأ تلقائيًا عند الاستيراد إذا كُتب نصًا حرًا.' , tone: XL.GREEN_LIGHT },
      { text: '6) التاريخ بصيغة YYYY-MM-DD أو خلية تاريخ حقيقية — والأرقام في أعمدة الأرقام فقط (بدون نص أو رموز).' },
      { text: '7) رقم الديليفري فريد في النظام — الأرقام المكررة تتخطى تلقائيًا مع تقرير واضح بعد الاستيراد.' },
      { text: '8) احفظ الملف ثم ارفعه من زر «رفع ملف Excel» في معالج الاستيراد — يُرصد الجدول ويُربط بالحقول تلقائيًا، ثم معاينة وتنفيذ مثل أي استيراد.', tone: XL.GREEN_LIGHT },
      { text: 'تنبيه: لا تُعدّل أسماء الشيتات ولا تحذف رأس الجدول ولا تغيّر ترتيب الأعمدة — المعالج يقرأ شيت «الشحنات» تحديدًا.', tone: XL.RED_LIGHT },
    ]
    let r = 3
    for (const s of steps) {
      wi.mergeCells(`B${r}:B${r}`)
      const cell = wi.getCell(`B${r}`)
      cell.value = s.text
      cell.font = xfont({ size: 10.5, color: { argb: XL.DARK } })
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: 'right' }
      if (s.tone) cell.fill = xfill(s.tone)
      cell.border = XTHIN
      wi.getRow(r).height = s.text.length > 120 ? 44 : 30
      r += 1
    }

    // دليل الألوان
    r += 1
    const legend = wi.getCell(`B${r}`)
    legend.value = 'دليل الألوان:'
    legend.font = xfont({ bold: true, size: 11, color: { argb: XL.DARK } })
    r += 1
    const legendItems = [
      { label: '★ رأس كهرماني = عمود إلزامي', fill: XL.AMBER_LIGHT, color: XL.AMBER },
      { label: '▼ رأس زمردي = قائمة منسدلة من بيانات النظام', fill: XL.GREEN_LIGHT, color: XL.GREEN },
      { label: 'صف أصفر = مثال للتوضيح — يُحذف قبل الاستيراد', fill: XL.AMBER_EX, color: XL.GRAY },
    ]
    for (const li of legendItems) {
      const cell = wi.getCell(`B${r}`)
      cell.value = li.label
      cell.font = xfont({ size: 10, color: { argb: li.color } })
      cell.fill = xfill(li.fill)
      cell.border = XTHIN
      wi.getRow(r).height = 20
      r += 1
    }

    // ══════════════════ شيت 3: «القوائم» — مصادر المنسدلات ══════════════════
    const wl = wb.addWorksheet(LISTS_SHEET)
    wl.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }]
    wl.columns = [{ width: 28 }, { width: 28 }, { width: 22 }, { width: 22 }, { width: 20 }]

    const listDefs: { header: string; values: string[]; fill: string; color: string }[] = [
      { header: 'العملاء', values: lists.customers, fill: XL.GREEN_LIGHT, color: XL.GREEN },
      { header: 'المقاولون', values: lists.contractors, fill: XL.AMBER_LIGHT, color: XL.AMBER },
      { header: 'الفروع', values: lists.branches, fill: 'FFE0F2FE', color: 'FF0369A1' },
      { header: 'الوجهات', values: lists.destinations, fill: 'FFCCFBF1', color: 'FF0F766E' },
      { header: 'العمال', values: lists.workers, fill: 'FFEDE9FE', color: 'FF6D28D9' },
    ]
    listDefs.forEach((ld, i) => {
      const h = wl.getRow(1).getCell(i + 1)
      h.value = `${ld.header} (${ld.values.length})`
      h.font = xfont({ bold: true, size: 10, color: { argb: ld.color } })
      h.fill = xfill(ld.fill)
      h.alignment = XCENTER
      h.border = XTHIN
      for (let j = 0; j < ld.values.length; j++) {
        const cell = wl.getRow(j + 2).getCell(i + 1)
        cell.value = ld.values[j]
        cell.font = xfont({ size: 10, color: { argb: XL.DARK } })
        if (j % 2 === 1) cell.fill = xfill(XL.FILL_ALT)
      }
      if (!ld.values.length) wl.getRow(2).getCell(i + 1).value = '(لا توجد بيانات بعد — ستُعبّأ تلقائيًا لاحقًا)'
    })
    const lh = wl.getRow(1)
    lh.height = 22

    const buf = await wb.xlsx.writeBuffer()
    return xlsxResponse(buf, 'shipment-import-template', `قالب استيراد الشحنات ${xlsDateStr(new Date())}`)
  } catch (e: any) {
    const status = e instanceof ApiError ? e.status : 500
    if (status >= 500) console.error('[import-template-error]', e)
    return Response.json({ error: e?.message ?? 'خطأ غير متوقع في الخادم' }, { status })
  }
}
