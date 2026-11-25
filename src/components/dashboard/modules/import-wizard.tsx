'use client'

// ============================================================================
// معالج استيراد الشحنات — تدفق حقيقي من أربع خطوات:
// 1) المصدر: لصق CSV/TSV/صفوف منسوخة من Excel، أو رفع ملف .csv/.txt (تحليل محلي)،
//    أو رفع ملف Excel .xlsx (تحليل على الخادم — يدعم قالب النظام بالقوائم المنسدلة)
//    + تحميل قالب الاستيراد الرسمي بمنسدلات معبّأة ببيانات النظام
// 2) الربط: تعيين أعمدة المصدر إلى حقول النظام مع تعيين تلقائي بالتلميحات
// 3) المعاينة: /api/import/preview — تحقق حقيقي من الخادم (مستلم/وجهة/أطراف)
// 4) التنفيذ: /api/import/commit — إنشاء الشحنات + سجل استيراد + تدقيق
// بطاقة جانبية: سجل الاستيرادات من /api/import/logs (تتطلب import.manage)
// ============================================================================

import * as React from 'react'
import useSWR from 'swr'
import {
  Upload, Table2, Check, ArrowRight, Loader2, AlertTriangle,
  History, Play, RotateCcw, Info, FileSpreadsheet, Download,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { fetcher, getToken } from '@/lib/api'
import { apiPostSync as apiPost } from '@/lib/sync'
import { downloadFile } from '@/lib/download'
import { fmtNum, fmtDateTime } from '@/lib/format'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '../auth-provider'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// الأنواع وحقول النظام الهدف
// ---------------------------------------------------------------------------
type Step = 'source' | 'mapping' | 'preview' | 'commit'

const STEP_DEFS: { key: Step; label: string }[] = [
  { key: 'source', label: 'المصدر' },
  { key: 'mapping', label: 'الربط' },
  { key: 'preview', label: 'المعاينة' },
  { key: 'commit', label: 'التنفيذ' },
]

const NONE = '__none__'

interface ParsedTable {
  headers: string[]
  rows: Record<string, string>[]
  delimiterLabel: string
}

interface PreviewResponse {
  total: number
  valid: number
  errorCount: number
  errors: { row: number; reason: string }[]
  sample: Record<string, unknown>[]
  detectedColumns: string[]
}

interface CommitResponse {
  imported: number
  skipped: number
  errors: number
  total: number
  logId: string
  errorDetails: string[]
}

interface ImportLogItem {
  id: string
  fileName: string | null
  sheetName: string | null
  totalRows: number
  importedRows: number
  skippedRows: number
  errors: string | null
  status: string
  date: string
  userName: string | null
}

const TARGET_FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: 'recipientName', label: 'اسم المستلم', required: true },
  { key: 'destination', label: 'الوجهة', required: true },
  { key: 'destinationEn', label: 'الوجهة (EN)' },
  { key: 'shipPart', label: 'رقم أمر الشحن' },
  { key: 'branchName', label: 'الفرع' },
  { key: 'customerName', label: 'العميل' },
  { key: 'contractorName', label: 'المقاول' },
  { key: 'deliveryPhones', label: 'هاتف التوصيل' },
  { key: 'routeCode', label: 'خط السير' },
  { key: 'deliveryNumber', label: 'رقم الديليفري' },
  { key: 'freightCost', label: 'التكويد (تكلفة النولون)' },
  { key: 'freightTotal', label: 'إجمالي النولون' },
  { key: 'policyQty', label: 'كمية السياسات' },
  { key: 'truckCount', label: 'عدد الشاحنات' },
  { key: 'ton15', label: 'شاحنات 1.5 طن' },
  { key: 'ton3', label: 'شاحنات 3 طن' },
  { key: 'm6', label: 'شاحنات 6 متر' },
  { key: 'worker', label: 'العامل' },
  { key: 'date', label: 'تاريخ الشحن' },
]

// تلميحات التعيين التلقائي — يفوز أول تطابق نصي في الترتيب (اسم العمود يحتوي التلميح)
const FIELD_HINTS: { key: string; hints: string[] }[] = [
  { key: 'recipientName', hints: ['المستلم', 'المرسل إليه', 'المرسل اليه'] },
  { key: 'destination', hints: ['الوجهة', 'المدينة'] },
  { key: 'destinationEn', hints: ['Destination 2', 'destination2', 'وجهة انجلي', 'الوجهة الإنجليزية', 'English'] },
  { key: 'shipPart', hints: ['Ship Part', 'ShipPart', 'ship part', 'شيب بارت', 'أمر الشحن'] },
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

const LOG_STATUS_META: Record<string, { label: string; cls: string }> = {
  completed: { label: 'مكتمل', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-transparent' },
  partial: { label: 'جزئي', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-transparent' },
  failed: { label: 'فشل', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 border-transparent' },
}

// ---------------------------------------------------------------------------
// محلل نصي محلي صغير — يكتشف الفاصل (Tab/فاصلة/فاصلة منقوطة) ويقص دعم الاقتباس
// ---------------------------------------------------------------------------
const DELIMITERS: { d: string; label: string }[] = [
  { d: '\t', label: 'جدولة (نسخ من Excel)' },
  { d: ',', label: 'فاصلة (,)' },
  { d: ';', label: 'فاصلة منقوطة (;)' },
]

function detectDelimiter(firstLine: string): { d: string; label: string } {
  let best = DELIMITERS[0]
  let bestCount = 0
  for (const c of DELIMITERS) {
    const n = firstLine.split(c.d).length - 1
    if (n > bestCount) { bestCount = n; best = c }
  }
  return best
}

function splitLine(line: string, delim: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === delim && !inQuotes) {
      cells.push(cur.trim()); cur = ''
    } else cur += ch
  }
  cells.push(cur.trim())
  return cells
}

function parseTable(text: string): ParsedTable {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const delim = detectDelimiter(lines[0] ?? '')
  if (!lines.length) return { headers: [], rows: [], delimiterLabel: delim.label }

  const seen = new Map<string, number>()
  const headers = splitLine(lines[0], delim.d).map((h, i) => {
    let name = h || `عمود ${i + 1}`
    const dup = seen.get(name) ?? 0
    seen.set(name, dup + 1)
    if (dup > 0) name = `${name} (${dup + 1})`
    return name
  })
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line, delim.d)
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = cells[i] ?? '' })
    return obj
  })
  return { headers, rows, delimiterLabel: delim.label }
}

function guessMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  const used = new Set<string>()
  for (const { key, hints } of FIELD_HINTS) {
    for (const hint of hints) {
      const hit = headers.find((h) => !used.has(h) && h.includes(hint))
      if (hit) { mapping[key] = hit; used.add(hit); break }
    }
  }
  return mapping
}

/** تحويل صفوف المصدر إلى كائنات بحقول النظام (يستخدمها الالتزام + المعاينة الجانبية) */
function applyMapping(rows: Record<string, string>[], mapping: Record<string, string>): Record<string, unknown>[] {
  const fields = Object.entries(mapping).filter(([, col]) => !!col) as [string, string][]
  return rows.map((r, i) => {
    const out: Record<string, unknown> = { _row: i + 1 }
    for (const [field, col] of fields) out[field] = r[col] ?? ''
    return out
  })
}

// ---------------------------------------------------------------------------
// شريط الخطوات
// ---------------------------------------------------------------------------
function Stepper({ current }: { current: number }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs">
      {STEP_DEFS.map((s, i) => {
        const isActive = i === current
        const isDone = i < current
        return (
          <React.Fragment key={s.key}>
            <div className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium',
              isActive
                ? 'bg-primary text-primary-foreground'
                : isDone
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : 'bg-secondary text-muted-foreground',
            )}>
              {isDone ? <Check className="size-3" /> : <span className="size-1.5 rounded-full bg-current" />}
              <span>{i + 1}. {s.label}</span>
            </div>
            {i < STEP_DEFS.length - 1 && <ArrowRight className="size-3 text-muted-foreground rotate-180" />}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// المكوّن الرئيسي
// ---------------------------------------------------------------------------
export function ImportModule() {
  const { toast } = useToast()
  const { has } = useAuth()
  const canImport = has('import.manage')

  const [step, setStep] = React.useState<Step>('source')
  const [raw, setRaw] = React.useState('')
  const [parsed, setParsed] = React.useState<ParsedTable | null>(null)
  const [fileName, setFileName] = React.useState('لصق مباشر')
  const [mapping, setMapping] = React.useState<Record<string, string>>({})
  const [preview, setPreview] = React.useState<PreviewResponse | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const [committing, setCommitting] = React.useState(false)
  const [result, setResult] = React.useState<CommitResponse | null>(null)
  const [fileLoading, setFileLoading] = React.useState(false)
  const [xlsxLoading, setXlsxLoading] = React.useState(false)
  const [tplLoading, setTplLoading] = React.useState(false)

  // سجل الاستيرادات — يُجلب فقط لمن يملك صلاحية الاستيراد
  const { data: logsData, isLoading: logsLoading, mutate: mutateLogs } = useSWR<{ items: ImportLogItem[]; total: number }>(
    canImport ? '/api/import/logs' : null, fetcher,
  )

  const requiredMapped = !!mapping['recipientName'] && !!mapping['destination']
  const permTitle = canImport ? undefined : 'يتطلب صلاحية استيراد البيانات (import.manage)'

  // عينة أول 5 صفوف بعد تطبيق الربط (محليًا دون اتصال بالخادم)
  const mappedFields = TARGET_FIELDS.filter((f) => !!mapping[f.key])
  const mappedSample = React.useMemo(() => {
    if (!parsed) return [] as Record<string, string>[]
    const fields = TARGET_FIELDS.filter((f) => !!mapping[f.key])
    return parsed.rows.slice(0, 5).map((r) => {
      const out: Record<string, string> = {}
      for (const f of fields) out[f.key] = r[mapping[f.key]] ?? ''
      return out
    })
  }, [parsed, mapping])

  // ── الخطوة 1: تحليل النص الملصق/الملف ──
  const runParse = (text: string, name?: string) => {
    const t = text.trim()
    if (!t) {
      setParsed(null)
      toast({ title: 'لا توجد بيانات', description: 'الصق صفوفًا من Excel أو CSV أو ارفع ملفًا أولًا.', variant: 'destructive' })
      return
    }
    const p = parseTable(t)
    if (!p.headers.length || !p.rows.length) {
      setParsed(null)
      toast({ title: 'تعذّر التحليل', description: 'لم يُرصد صفوف صالحة — تأكد أن الصف الأول يحتوي عناوين الأعمدة.', variant: 'destructive' })
      return
    }
    setParsed(p)
    setMapping(guessMapping(p.headers))
    setPreview(null)
    setResult(null)
    if (name) setFileName(name)
    toast({ title: `تم رصد ${fmtNum(p.rows.length)} صف و${fmtNum(p.headers.length)} عمود`, description: `الفاصل المكتشف: ${p.delimiterLabel}` })
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileLoading(true)
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      setRaw(text)
      runParse(text, file.name)
      setFileLoading(false)
    }
    reader.onerror = () => {
      setFileLoading(false)
      toast({ title: 'تعذّرت قراءة الملف', description: 'تأكد أن الملف نصي بامتداد csv أو txt.', variant: 'destructive' })
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // ── رفع ملف Excel (.xlsx) — يُحلَّل على الخادم ويُربط تلقائيًا ثم ينتقل للربط مباشرة ──
  const handleExcelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (!canImport) return
    setXlsxLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/shipments/import/parse', {
        method: 'POST',
        headers: { 'x-session-token': getToken() },
        body: fd,
        cache: 'no-store',
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? `فشل التحليل (${res.status})`)
      const p: ParsedTable = {
        headers: data.headers ?? [],
        rows: data.rows ?? [],
        delimiterLabel: data.delimiterLabel ?? 'ملف Excel',
      }
      setParsed(p)
      setMapping(data.mapping ?? guessMapping(p.headers))
      setPreview(null)
      setResult(null)
      setRaw('')
      if (data.fileName) setFileName(String(data.fileName))
      toast({
        title: `تم رصد ${fmtNum(p.rows.length)} صف و${fmtNum(p.headers.length)} عمود من شيت «${data.sheetName ?? ''}»`,
        description: `${data.skippedExamples ? `تُخطى ${data.skippedExamples} صف مثال · ` : ''}الربط تم تلقائيًا — راجعه في الخطوة التالية`,
      })
      setStep('mapping')
    } catch (err: unknown) {
      toast({ title: 'تعذّر قراءة ملف Excel', description: err instanceof Error ? err.message : 'خطأ غير متوقع', variant: 'destructive' })
    } finally {
      setXlsxLoading(false)
    }
  }

  // ── تحميل قالب الاستيراد الرسمي — قوائم منسدلة معبّأة ببيانات النظام ──
  const downloadTemplate = async () => {
    if (tplLoading) return
    setTplLoading(true)
    try {
      await downloadFile('/api/shipments/import-template', 'قالب استيراد الشحنات.xlsx')
      toast({ title: 'تم تحميل القالب', description: 'افتحه واملأ الصفوف — المنسدلات معبّأة ببيانات النظام الحقيقي' })
    } catch (err: unknown) {
      toast({ title: 'تعذّر تحميل القالب', description: err instanceof Error ? err.message : 'خطأ غير متوقع', variant: 'destructive' })
    } finally {
      setTplLoading(false)
    }
  }

  // ── الخطوة 3: معاينة حقيقية من الخادم ──
  const doPreview = async () => {
    if (!parsed) return
    setPreviewing(true)
    try {
      const r: PreviewResponse = await apiPost('/api/import/preview', { rows: parsed.rows, mapping, fileName })
      setPreview(r)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'خطأ غير متوقع'
      toast({ title: 'تعذّر تشغيل المعاينة', description: msg, variant: 'destructive' })
    } finally {
      setPreviewing(false)
    }
  }

  // ── الانتقال من الربط إلى المعاينة (يشغّل المعاينة فورًا) ──
  const goPreview = () => {
    setStep('preview')
    void doPreview()
  }

  // ── الخطوة 4: تنفيذ الاستيراد الفعلي ──
  const doCommit = async () => {
    if (!parsed) return
    setCommitting(true)
    try {
      const r: CommitResponse = await apiPost('/api/import/commit', {
        rows: applyMapping(parsed.rows, mapping),
        mapping,
        fileName,
      })
      setResult(r)
      void mutateLogs()
      toast({
        title: `تم استيراد ${fmtNum(r.imported)} شحنة`,
        description: r.skipped > 0 ? `تخطي ${fmtNum(r.skipped)} صف — راجع التفاصيل أدناه` : 'تم تسجيل العملية في سجل الاستيرادات',
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'خطأ غير متوقع'
      toast({ title: 'فشل تنفيذ الاستيراد', description: msg, variant: 'destructive' })
    } finally {
      setCommitting(false)
    }
  }

  const changeMapping = (key: string, col: string) => {
    setMapping((m) => {
      const next = { ...m }
      if (col === NONE) delete next[key]
      else next[key] = col
      return next
    })
    // أي تغيير في الربط يُلغي معاينة الخادم السابقة
    setPreview(null)
    setResult(null)
  }

  const resetAll = () => {
    setStep('source')
    setRaw('')
    setParsed(null)
    setMapping({})
    setPreview(null)
    setResult(null)
    setFileName('لصق مباشر')
  }

  const stepIndex = STEP_DEFS.findIndex((s) => s.key === step)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
      {/* ===== العمود الرئيسي: المعالج ===== */}
      <div className="lg:col-span-2 space-y-4 min-w-0">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center size-12 rounded-xl bg-primary/10 text-primary shrink-0"><Upload className="size-6" /></div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold">معالج استيراد الشحنات (Excel/CSV)</div>
                <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  حمّل قالب Excel رسميًا بمنسدلات معبّأة ببيانات النظام، أو ارفع ملف .xlsx/.csv مباشرة، أو الصق صفوفًا منسوخة — ثم اربط الأعمدة، وعاين التحقق من الخادم، ونفّذ الاستيراد مع تسجيل العملية.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {!canImport && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 px-3 py-2.5 text-sm">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>عرض فقط — تنفيذ الاستيراد يتطلب صلاحية استيراد البيانات (import.manage). تواصل مع مدير النظام لمنحك الصلاحية.</span>
          </div>
        )}

        <Stepper current={stepIndex} />

        {/* ─── الخطوة 1: المصدر ─── */}
        {step === 'source' && (
          <>
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                <div className="space-y-1.5 flex-1 min-w-0">
                  <label className="text-xs font-medium" htmlFor="import-source-name">اسم المصدر (يظهر في سجل الاستيرادات)</label>
                  <Input id="import-source-name" value={fileName} onChange={(e) => setFileName(e.target.value)} disabled={!canImport} className="h-9 text-xs" />
                </div>
              </div>
              {/* أزرار المصدر: قالب Excel / رفع Excel / رفع CSV — البوابة الرسمية للبيانات */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Button
                  variant="default"
                  onClick={downloadTemplate}
                  disabled={!canImport || tplLoading}
                  className="min-h-[44px] w-full"
                  title={permTitle}
                >
                  {tplLoading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                  <span>{tplLoading ? 'جاري التحميل...' : 'تحميل قالب Excel'}</span>
                </Button>
                <label className={cn(
                  'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-md text-sm font-medium border border-input bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors cursor-pointer',
                  (!canImport || xlsxLoading) && 'opacity-60 pointer-events-none',
                )} title={permTitle}>
                  <input type="file" accept=".xlsx,.xlsm" className="sr-only" onChange={handleExcelFile} disabled={!canImport || xlsxLoading} />
                  {xlsxLoading ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
                  {xlsxLoading ? 'جاري التحليل...' : 'رفع ملف Excel (.xlsx)'}
                </label>
                <label className={cn(
                  'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-md text-sm font-medium border border-input bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors cursor-pointer',
                  !canImport && 'opacity-60 pointer-events-none',
                )} title={permTitle}>
                  <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={handleFile} disabled={!canImport} />
                  {fileLoading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                  {fileLoading ? 'جاري القراءة...' : 'رفع ملف CSV/TXT'}
                </label>
              </div>
              <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/20 text-foreground/80 px-3 py-2 text-xs">
                <Info className="size-3.5 shrink-0 mt-0.5 text-primary" />
                <span>
                  <b>القالب الرسمي</b> يحتوي قوائم منسدلة (▼) معبّأة تلقائيًا بالعملاء والمقاولين والفروع والوجهات والعمال الموجودين في النظام — Excel يرفض أي قيمة خارجها، فتصل البيانات نظيفة 100%. صفوف المثال تتخطى تلقائيًا عند الرفع.
                </span>
              </div>
              <Textarea
                dir="rtl"
                rows={10}
                value={raw}
                disabled={!canImport}
                onChange={(e) => { setRaw(e.target.value); setParsed(null) }}
                placeholder={'الصق الصفوف هنا — الصف الأول عناوين الأعمدة.\nمثال:\nالمستلم\tالوجهة\tالنولون\tالتكويد\tالتاريخ\nأحمد\tالمنصورة\t120\t80\t2026-02-10'}
                className="font-mono text-xs min-h-[180px] bg-muted/30"
              />
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                {parsed ? (
                  <div className="flex items-start gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200 px-3 py-2 text-xs flex-1">
                    <Info className="size-3.5 shrink-0 mt-0.5" />
                    <span>
                      تم رصد <b className="tnum">{fmtNum(parsed.rows.length)}</b> صف و<b className="tnum">{fmtNum(parsed.headers.length)}</b> عمود — الفاصل: {parsed.delimiterLabel}
                    </span>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground flex-1">يُحلَّل النص محليًا: يُكتشف الفاصل تلقائيًا (Tab/فاصلة/فاصلة منقوطة) والصف الأول يُعتبر عناوين الأعمدة.</div>
                )}
                <Button onClick={() => runParse(raw)} disabled={!canImport || !raw.trim()} className="min-h-[40px] shrink-0" title={permTitle}>
                  <Table2 className="size-4" /> تحليل الصفوف
                </Button>
              </div>
            </CardContent>
          </Card>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
            <Button variant="outline" onClick={resetAll} className="min-h-[40px]">مسح الكل</Button>
            <Button onClick={() => setStep('mapping')} disabled={!canImport || !parsed || parsed.rows.length === 0} className="min-h-[40px]" title={permTitle}>
              التالي: ربط الأعمدة <ArrowRight className="size-4 rotate-180" />
            </Button>
          </div>
          </>
        )}

        {/* ─── الخطوة 2: الربط ─── */}
        {step === 'mapping' && parsed && (
          <>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div>
                  <div className="text-sm font-semibold">ربط أعمدة المصدر بحقول النظام</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    التعيين مبدئي تلقائي ويمكنك تعديله — الحقول المطلوبة بعلامة <span className="text-destructive font-bold">*</span> — المصدر: {fmtNum(parsed.rows.length)} صف و{fmtNum(parsed.headers.length)} عمود.
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {TARGET_FIELDS.map((f) => (
                    <div key={f.key} className="flex items-center gap-2 min-w-0">
                      <label className="text-xs font-medium w-32 sm:w-44 shrink-0 truncate" title={f.label}>
                        {f.label}{f.required && <span className="text-destructive"> *</span>}
                      </label>
                      <Select value={mapping[f.key] ?? NONE} onValueChange={(v) => changeMapping(f.key, v)} disabled={!canImport}>
                        <SelectTrigger className="flex-1 min-w-0 h-9 text-xs" title={permTitle}><SelectValue placeholder="اختر عمودًا" /></SelectTrigger>
                        <SelectContent className="max-h-64">
                          <SelectItem value={NONE}>— تجاهل —</SelectItem>
                          {parsed.headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                {!requiredMapped && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200 px-3 py-2 text-xs">
                    <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                    <span>الحقول المطلوبة «اسم المستلم» و«الوجهة» يجب ربطهما قبل المتابعة.</span>
                  </div>
                )}
              </CardContent>
            </Card>
            {mappedFields.length > 0 && mappedSample.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <div className="text-sm font-semibold mb-2">معاينة الربط — أول {fmtNum(mappedSample.length)} صفوف بعد التحويل</div>
                  <div className="overflow-x-auto border border-border rounded-lg max-h-72 overflow-y-auto scrollbar-thin">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 sticky top-0">
                        <tr>
                          {mappedFields.map((f) => (
                            <th key={f.key} className="px-2 py-1.5 text-right font-medium whitespace-nowrap">
                              {f.label}{f.required && <span className="text-destructive"> *</span>}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {mappedSample.map((row, i) => (
                          <tr key={i} className="border-t border-border">
                            {mappedFields.map((f) => (
                              <td key={f.key} className="px-2 py-1.5 max-w-[140px] truncate text-muted-foreground" title={String(row[f.key] ?? '')}>
                                {row[f.key] || '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
              <Button variant="outline" onClick={() => setStep('source')} className="min-h-[40px]">رجوع للمصدر</Button>
              <Button onClick={goPreview} disabled={!canImport || !requiredMapped} className="min-h-[40px]" title={permTitle}>
                التالي: المعاينة <ArrowRight className="size-4 rotate-180" />
              </Button>
            </div>
          </>
        )}

        {/* ─── الخطوة 3: المعاينة من الخادم ─── */}
        {step === 'preview' && parsed && (
          <>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <div className="text-sm font-semibold">معاينة من الخادم</div>
                    <div className="text-xs text-muted-foreground mt-0.5">تحقق حقيقي: المستلم والوجهة مطلوبان، ويُتحقق من وجود الفرع/العميل/المقاول (العميل غير الموجود يُنشأ تلقائيًا عند الاعتماد).</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void doPreview()} disabled={!canImport || previewing} className="min-h-[40px]" title={permTitle}>
                    {previewing ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} إعادة المعاينة
                  </Button>
                </div>

                {previewing && (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-8">
                    <Loader2 className="size-4 animate-spin" /> جاري التحقق من {fmtNum(parsed.rows.length)} صف على الخادم...
                  </div>
                )}

                {!previewing && !preview && (
                  <div className="text-xs text-muted-foreground py-6 text-center">لم تُشغَّل المعاينة بعد — اضغط «إعادة المعاينة».</div>
                )}

                {preview && !previewing && (
                  <>
                    <div className="grid grid-cols-3 gap-2.5">
                      <div className="rounded-lg bg-secondary/60 p-3 text-center">
                        <div className="text-xl font-bold tnum">{fmtNum(preview.total)}</div>
                        <div className="text-[11px] text-muted-foreground">إجمالي الصفوف</div>
                      </div>
                      <div className="rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 p-3 text-center">
                        <div className="text-xl font-bold tnum">{fmtNum(preview.valid)}</div>
                        <div className="text-[11px]">صالح للاستيراد</div>
                      </div>
                      <div className="rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 p-3 text-center">
                        <div className="text-xl font-bold tnum">{fmtNum(preview.errorCount)}</div>
                        <div className="text-[11px]">أخطاء</div>
                      </div>
                    </div>
                    {preview.errors.length > 0 && (
                      <div className="border border-border rounded-lg overflow-hidden">
                        <div className="text-xs font-medium px-3 py-2 border-b border-border bg-muted/40">أول {fmtNum(Math.min(10, preview.errors.length))} خطأ من {fmtNum(preview.errorCount)}</div>
                        <ul className="divide-y divide-border text-xs max-h-56 overflow-y-auto scrollbar-thin">
                          {preview.errors.slice(0, 10).map((er, i) => (
                            <li key={i} className="px-3 py-2 flex items-start gap-2">
                              <Badge variant="outline" className="tnum shrink-0">صف {fmtNum(er.row)}</Badge>
                              <span className="text-destructive leading-relaxed">{er.reason}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {preview.valid === 0 && (
                      <div className="flex items-start gap-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 px-3 py-2 text-xs">
                        <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                        <span>لا توجد صفوف صالحة للاستيراد — عد إلى الربط وصلح تعيين «اسم المستلم» و«الوجهة» على الأقل.</span>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
              <Button variant="outline" onClick={() => setStep('mapping')} className="min-h-[40px]">رجوع للربط</Button>
              <Button onClick={() => setStep('commit')} disabled={!canImport || !preview || preview.valid === 0} className="min-h-[40px]" title={permTitle}>
                التالي: التنفيذ <ArrowRight className="size-4 rotate-180" />
              </Button>
            </div>
          </>
        )}

        {/* ─── الخطوة 4: التنفيذ ─── */}
        {step === 'commit' && parsed && (
          <>
            {!result ? (
              <Card>
                <CardContent className="p-6 text-center space-y-4">
                  <div className="text-sm leading-relaxed max-w-md mx-auto">
                    سيتم إنشاء شحنات جديدة بحالة «جديدة» من <b className="tnum">{fmtNum(preview?.valid ?? parsed.rows.length)}</b> صف صالح، وتسجيل العملية في سجل الاستيرادات والتدقيق. العملية لا تُتراجع تلقائيًا.
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2">
                    <Button variant="outline" onClick={() => setStep('preview')} disabled={committing} className="min-h-[40px]">رجوع للمعاينة</Button>
                    <Button onClick={() => void doCommit()} disabled={!canImport || committing} className="min-h-[40px]" title={permTitle}>
                      {committing ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                      {committing ? 'جاري التنفيذ...' : 'تنفيذ الاستيراد'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-center gap-3 justify-center">
                    <div className="flex items-center justify-center size-12 rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300 shrink-0"><Check className="size-6" /></div>
                    <div className="text-lg font-semibold">اكتمل تنفيذ الاستيراد</div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
                    <div className="bg-secondary/60 rounded-lg p-3"><div className="text-2xl font-bold tnum">{fmtNum(result.total)}</div><div className="text-xs text-muted-foreground">إجمالي الصفوف</div></div>
                    <div className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 rounded-lg p-3"><div className="text-2xl font-bold tnum">{fmtNum(result.imported)}</div><div className="text-xs">مستورد</div></div>
                    <div className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 rounded-lg p-3"><div className="text-2xl font-bold tnum">{fmtNum(result.skipped)}</div><div className="text-xs">متخطى</div></div>
                    <div className="bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 rounded-lg p-3"><div className="text-2xl font-bold tnum">{fmtNum(result.errors)}</div><div className="text-xs">أخطاء</div></div>
                  </div>
                  {result.errorDetails.length > 0 && (
                    <div className="border border-border rounded-lg overflow-hidden">
                      <div className="text-xs font-medium px-3 py-2 border-b border-border bg-muted/40">تفاصيل الأخطاء (أول {fmtNum(Math.min(5, result.errorDetails.length))})</div>
                      <div className="max-h-40 overflow-y-auto scrollbar-thin p-3 space-y-1 text-xs">
                        {result.errorDetails.slice(0, 5).map((d, i) => <div key={i} className="text-destructive leading-relaxed">{d}</div>)}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-center gap-2">
                    <Button variant="outline" onClick={resetAll} className="min-h-[40px]"><RotateCcw className="size-4" /> استيراد جديد</Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {/* ===== البطاقة الجانبية: سجل الاستيرادات ===== */}
      <Card className="min-w-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><History className="size-4 text-muted-foreground" /> سجل الاستيرادات</CardTitle>
          <CardDescription>الصفوف: مستورد / تخطي / إجمالي</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!canImport ? (
            <div className="m-3 flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 px-3 py-2.5 text-xs">
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
              <span>يتطلب صلاحية استيراد البيانات</span>
            </div>
          ) : logsLoading && !logsData ? (
            <Skeleton className="h-40 m-3 rounded-lg" />
          ) : (logsData?.items ?? []).length === 0 ? (
            <div className="py-10 px-4 text-center text-sm text-muted-foreground">لا عمليات استيراد بعد — نفّذ أول استيراد لتظهر هنا.</div>
          ) : (
            <div className="max-h-96 overflow-y-auto overflow-x-auto scrollbar-thin">
              <table className="w-full text-xs min-w-[460px]">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    <th className="px-2 py-2 text-right font-medium">الملف</th>
                    <th className="px-2 py-2 text-right font-medium">الحالة</th>
                    <th className="px-2 py-2 text-right font-medium">الصفوف</th>
                    <th className="px-2 py-2 text-right font-medium">المستخدم</th>
                    <th className="px-2 py-2 text-right font-medium">التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {(logsData?.items ?? []).map((l) => {
                    const meta = LOG_STATUS_META[l.status] ?? { label: l.status, cls: 'bg-secondary text-muted-foreground border-transparent' }
                    return (
                      <tr key={l.id} className="border-t border-border">
                        <td className="px-2 py-2 max-w-[130px] truncate font-medium" title={l.fileName ?? ''}>{l.fileName ?? '-'}</td>
                        <td className="px-2 py-2"><Badge className={meta.cls}>{meta.label}</Badge></td>
                        <td className="px-2 py-2 tnum whitespace-nowrap">{fmtNum(l.importedRows)} / {fmtNum(l.skippedRows)} / {fmtNum(l.totalRows)}</td>
                        <td className="px-2 py-2 max-w-[80px] truncate" title={l.userName ?? ''}>{l.userName ?? '-'}</td>
                        <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">{fmtDateTime(l.date)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
