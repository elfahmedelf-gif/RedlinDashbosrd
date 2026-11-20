// ============================================================================
// تحليل ملف Excel المرفوع — POST /api/shipments/import/parse (multipart)
// يقرأ شيت «الشحنات» من قالب النظام (أو أي شيت بيانات)، يرصد صف العناوين
// تلقائيًا، يحوّل الخلايا إلى صفوف نصية، ويقترح ربط الأعمدة بالحقول.
// المخرجات متوافقة تمامًا مع معالج الاستيراد الحالي (ParsedTable + mapping)
// فتستمر المعاينة والتنفيذ عبر /api/import/preview + /api/import/commit.
// ============================================================================
import ExcelJS from 'exceljs'
import { ApiError } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { xlsDateStr } from '@/lib/server/excel'

export const dynamic = 'force-dynamic'

const MAX_ROWS = 2000
const LISTS_SHEET = 'القوائم'

/** تطبيع نص العنوان — يزيل علامات القالب (★/▼) والمسافات الزائدة */
const norm = (s: string) => s.replace(/[★▼]/g, '').replace(/\(منسدل\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

/** خريطة مطابقة تامة لعناوين قالب النظام (بعد التطبيع) */
const EXACT_MAP: Record<string, string> = {
  'رقم الديليفري': 'deliveryNumber',
  'تاريخ الشحن': 'date',
  'اسم المستلم': 'recipientName',
  'هاتف المستلم': 'deliveryPhones',
  'العميل': 'customerName',
  'المقاول': 'contractorName',
  'الفرع': 'branchName',
  'الوجهة': 'destination',
  'الوجهة (en)': 'destinationEn',
  'كود الخط': 'routeCode',
  'ship part': 'shipPart',
  'العامل': 'worker',
  'عدد القطع': 'policyQty',
  'عدد الشاحنات': 'truckCount',
  'شاحنات 1.5 طن': 'ton15',
  'شاحنات 3 طن': 'ton3',
  'شاحنات 6م': 'm6',
  'نولون العميل': 'freightTotal',
  'التكويد (نولون المقاول)': 'freightCost',
}

/** تلميحات الربط للأشيتات الخارجية — نفس ترتيب معالج الاستيراد (أول تطابق يفوز) */
const FIELD_HINTS: { key: string; hints: string[] }[] = [
  { key: 'recipientName', hints: ['المستلم', 'المرسل إليه', 'المرسل اليه'] },
  { key: 'destination', hints: ['الوجهة', 'المدينة'] },
  { key: 'destinationEn', hints: ['Destination 2', 'destination2', 'وجهة انجلي', 'الوجهة الإنجليزية', 'English'] },
  { key: 'shipPart', hints: ['Ship Part', 'ShipPart', 'شيب بارت', 'أمر الشحن'] },
  { key: 'freightTotal', hints: ['النولون', 'نولون'] },
  { key: 'freightCost', hints: ['التكويد', 'تكلفة'] },
  { key: 'date', hints: ['التاريخ', 'تاريخ'] },
  { key: 'branchName', hints: ['الفرع'] },
  { key: 'customerName', hints: ['اسم العميل', 'العميل', 'المانح'] },
  { key: 'contractorName', hints: ['المقاول', 'المورد'] },
  { key: 'deliveryPhones', hints: ['هاتف', 'تليفون', 'موبايل', 'جوال'] },
  { key: 'deliveryNumber', hints: ['Delivery', 'ديليفري', 'الديليفري'] },
  { key: 'routeCode', hints: ['خط السير', 'كود الخط'] },
  { key: 'policyQty', hints: ['policy', 'السياسات', 'القطع'] },
  { key: 'truckCount', hints: ['Truck', 'عدد الشاحنات', 'الشاحنات'] },
  { key: 'ton15', hints: ['1.5', '1,5'] },
  { key: 'ton3', hints: ['3 طن', '3TON', '3 TON'] },
  { key: 'm6', hints: ['6 متر', '6 م', '6M', '6 M'] },
  { key: 'worker', hints: ['Worker', 'عامل'] },
]

/** تحويل قيمة الخلية إلى نص نظيف (تاريخ/رقم/صيغة/نص غني/رابط) */
function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return ''
  if (v instanceof Date) return xlsDateStr(v)
  if (typeof v === 'object') {
    const o = v as Record<string, any>
    if (o.result !== undefined) return cellText(o.result as ExcelJS.CellValue)
    if (Array.isArray(o.richText)) return o.richText.map((t: any) => String(t?.text ?? '')).join('')
    if (o.text !== undefined) return String(o.text)
    return ''
  }
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
  return String(v).trim()
}

/**
 * صفوف «الشرح» — تلميحات القالب وصفوف المثال لا تُستورد أبدًا:
 * الصف يُعد صف شرح فقط إذا كان كل خلاياه غير الفارغة نصوص شرح
 * (مستحيل أن تكون بيانات شحنة حقيقية — المستلم/الوجهة أسماء فعلية)
 */
const META_STARTS = ['اختر من القائمة', 'إلزامي', 'أرقام', 'اختياري', 'مثال', 'أمر الشحن', 'تلميح', 'بالإنجليزية', 'YYYY-MM-DD', 'صف مثال']
const isMetaCell = (v: string) => META_STARTS.some((p) => v.startsWith(p)) || v === '—'
const isMetaRow = (rec: Record<string, string>) => {
  const vals = Object.values(rec).filter(Boolean)
  return vals.length > 0 && vals.every(isMetaCell)
}

/** اختيار شيت البيانات: «الشحنات» أولًا ثم أول شيت ليس قوائم/تعليمات */
function pickSheet(wb: ExcelJS.Workbook): ExcelJS.Worksheet {
  const byName = (name: string) => wb.worksheets.find((w) => w.name.trim() === name)
  const direct = byName('الشحنات') ?? byName('شيت الشحنات') ?? byName('Sheet1')
  if (direct) return direct
  const skip = new Set([LISTS_SHEET, 'التعليمات', 'Lists', 'Instructions', 'تعليمات'])
  return wb.worksheets.find((w) => !skip.has(w.name.trim())) ?? wb.worksheets[0]
}

/** رصد صف العناوين: أول صف في أول 15 صفًا يشبه رأس جدول شحنات (أعلى تطابق) */
function findHeaderRow(ws: ExcelJS.Worksheet): number {
  const TOKENS = ['المستلم', 'الوجهة', 'العميل', 'المقاول', 'الفرع', 'ديليفري', 'تاريخ', 'نولون', 'التكويد', 'الشاحنات', 'القطع', '1.5', '3 طن', '6م', '6 متر', 'ship part', 'worker', 'عامل', 'هاتف']
  let bestRow = -1
  let bestScore = 0
  const maxScan = Math.min(15, ws.rowCount || 15)
  for (let r = 1; r <= maxScan; r++) {
    const row = ws.getRow(r)
    const cells: string[] = []
    row.eachCell({ includeEmpty: false }, (cell) => cells.push(norm(cellText(cell.value))))
    if (!cells.length) continue
    const joined = cells.join(' | ')
    const score = TOKENS.reduce((acc, t) => acc + (joined.includes(norm(t)) ? 1 : 0), 0)
    if (score > bestScore) { bestScore = score; bestRow = r }
    if (bestScore >= 6) break
  }
  if (bestRow === -1 || bestScore < 2) {
    throw new ApiError(422, 'لم يُرصد صف عناوين واضح في الملف — استخدم قالب النظام أو تأكد أن الصف الأول/الرابع يحتوي عناوين الأعمدة (اسم المستلم، الوجهة، العميل...)')
  }
  return bestRow
}

/** بناء صفوف العناوين + اقتراح الربط (مطابقة تامة أولًا ثم تلميحات) */
function buildMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  const claimed = new Set<string>()
  for (const h of headers) {
    const field = EXACT_MAP[norm(h)]
    if (field && !claimed.has(h)) { mapping[field] = h; claimed.add(h) }
  }
  for (const { key, hints } of FIELD_HINTS) {
    if (mapping[key]) continue
    for (const h of headers) {
      if (claimed.has(h)) continue
      const nh = norm(h)
      if (hints.some((hint) => nh.includes(norm(hint)))) { mapping[key] = h; claimed.add(h); break }
    }
  }
  return mapping
}

export async function POST(req: Request) {
  try {
    await ensureSeeded()
    await requirePerm(req, 'import.manage')

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) throw new ApiError(400, 'لم يُرفق ملف — أرفق ملف .xlsx')
    const name = (file as File).name || 'ملف Excel'
    const lower = name.toLowerCase()
    if (lower.endsWith('.xls')) throw new ApiError(422, 'صيغة .xls القديمة غير مدعومة — افتح الملف واحفظه بصيغة .xlsx ثم أعد الرفع')
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xlsm')) throw new ApiError(422, 'الصيغة غير مدعومة — أرفق ملف .xlsx (قالب النظام أو أي ملف Excel أعمدته واضحة)')

    const buf = Buffer.from(await file.arrayBuffer())
    const wb = new ExcelJS.Workbook()
    try {
      await wb.xlsx.load(buf as unknown as ArrayBuffer)
    } catch {
      throw new ApiError(422, 'تعذّرت قراءة الملف — تأكد أنه ملف Excel صالح (.xlsx) غير محمي بكلمة مرور')
    }
    if (!wb.worksheets.length) throw new ApiError(422, 'الملف لا يحتوي أي شيتات')

    const ws = pickSheet(wb)
    const headerRowIdx = findHeaderRow(ws)
    const headerRow = ws.getRow(headerRowIdx)

    // عناوين الأعمدة من صف الرصد
    const headers: string[] = []
    const seen = new Map<string, number>()
    const maxCol = Math.max(headerRow.cellCount, 1)
    for (let c = 1; c <= maxCol; c++) {
      const raw = cellText(headerRow.getCell(c).value)
      let h = raw || `عمود ${c}`
      if (seen.has(h)) { seen.set(h, seen.get(h)! + 1); h = `${h} (${seen.get(h)})` }
      else seen.set(h, 1)
      headers.push(h)
    }

    // استخراج الصفوف — تخطي الفارغ وصفوف المثال وحدّ 2000 صف
    const rows: Record<string, string>[] = []
    let skippedExamples = 0
    let truncated = false
    for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const rec: Record<string, string> = {}
      let nonEmpty = 0
      for (let c = 1; c <= headers.length; c++) {
        const v = cellText(row.getCell(c).value)
        if (v) nonEmpty += 1
        rec[headers[c - 1]] = v
      }
      if (!nonEmpty) continue
      const joined = Object.values(rec).join(' ').toLowerCase()
      if (joined.includes('مثال') || isMetaRow(rec)) { skippedExamples += 1; continue }
      if (rows.length >= MAX_ROWS) { truncated = true; break }
      rows.push(rec)
    }
    if (!rows.length) {
      throw new ApiError(422, skippedExamples > 0
        ? 'الملف لا يحتوي صفوف بيانات — فقط صفوف المثال موجودة. احذف المثال واكتب الشحنات ثم أعد الرفع'
        : 'الملف لا يحتوي صفوف بيانات بعد رأس الجدول')
    }

    const mapping = buildMapping(headers)
    if (!mapping['recipientName'] || !mapping['destination']) {
      throw new ApiError(422, 'تعذّر ربط العمودين الإلزاميين «اسم المستلم» و«الوجهة» — أعد تسمية الأعمدة أو اربطها يدويًا في المعالج')
    }

    return Response.json({
      headers,
      rows,
      mapping,
      delimiterLabel: `ملف Excel — شيت «${ws.name}»`,
      sheetName: ws.name,
      fileName: name,
      skippedExamples,
      truncated,
      headerRow: headerRowIdx,
    })
  } catch (e: any) {
    const status = e instanceof ApiError ? e.status : 500
    if (status >= 500) console.error('[import-parse-error]', e)
    return Response.json({ error: e?.message ?? 'خطأ غير متوقع في الخادم' }, { status })
  }
}
