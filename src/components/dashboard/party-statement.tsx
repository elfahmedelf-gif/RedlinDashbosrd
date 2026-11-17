'use client'

// ============================================================================
// كشف حساب الطرف — نافذة عرض كل الحركات المالية المرحّلة للطرف (عميل/مقاول/مورد)
// البيانات من الخادم: GET /api/parties/{id}/statement?from&to (صلاحية parties.view)
// - رصيد تراكمي (Running Balance) بعد كل حركة + ملخص افتتاحي/مدين/دائن/ختامي
// - فلترة بالفترة (من/إلى — اختياريان)
// - رصيد سالب (دائن) بلون أحمر — رصيد موجب (مدين) بلون أخضر
// - طباعة A4 رسمية عبر PrintStage + PrintHeader/PrintFooter (نفس نظام السندات
//   والبوليصات) كي لا يُقص الجدول بقيود ارتفاع الـ Dialog عند الطباعة
// ============================================================================

import * as React from 'react'
import useSWR from 'swr'
import { Printer, FileText, AlertCircle, FileSpreadsheet } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { fetcher, getToken } from '@/lib/api'
import { fmtMoney, fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from './auth-provider'
import { PrintHeader, PrintFooter } from './print-layout'
import { PrintStage, usePrintModal } from './print-stage'

interface StatementParty {
  id: string
  code: string | null
  name: string
  nameEn: string | null
  isCustomer: boolean
  isContractor: boolean
  isSupplier: boolean
  phone: string | null
  branch: { id: string; name: string } | null
  openingBalance: number
  openingBalanceType: string | null
}

interface StatementItem {
  id: string
  date: string
  entryNo: string
  description: string
  reference: string | null
  sourceType: string
  account: { id: string; code: string; name: string }
  shipment: { id: string; shipmentNo: string } | null
  debit: number
  credit: number
  balance: number
}

interface StatementData {
  party: StatementParty
  period: { from: string | null; to: string | null }
  opening: number
  items: StatementItem[]
  totals: { totalDebit: number; totalCredit: number; closing: number }
}

export interface PartyStatementDialogProps {
  /** معرف الطرف — null يعني لا تحميل */
  partyId: string | null
  /** اسم احتياطي يظهر في العنوان قبل وصول البيانات */
  partyName?: string
  open: boolean
  onOpenChange: (o: boolean) => void
}

/** شارات مصدر الحركة */
const SOURCE_TYPES: Record<string, { label: string; tone: string }> = {
  op_voucher: { label: 'سند تشغيلي', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  shipment_delivery: { label: 'قيد تسليم', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  extra_cost: { label: 'بند إضافي', tone: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  journal_reversal: { label: 'قيد عكسي', tone: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  manual: { label: 'قيد يدوي', tone: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
}

/** أعمدة الجدول — start = يمين في RTL، end = يسار (للأعمدة الرقمية) */
const COLUMNS: { label: string; align: 'start' | 'end' }[] = [
  { label: 'التاريخ', align: 'start' },
  { label: 'رقم القيد', align: 'start' },
  { label: 'البيان', align: 'start' },
  { label: 'الحساب', align: 'start' },
  { label: 'الشحنة', align: 'start' },
  { label: 'مدين', align: 'end' },
  { label: 'دائن', align: 'end' },
  { label: 'الرصيد', align: 'end' },
]

/** لون الرصيد حسب الإشارة: سالب = دائن (على الشركة) — موجب = مدين (للشركة) */
function balanceTone(v: number): string {
  if (v < 0) return 'text-rose-600 dark:text-rose-400'
  if (v > 0) return 'text-emerald-700 dark:text-emerald-400'
  return 'text-muted-foreground'
}

/** نفس التلوين لألوان الطباعة الورقية الثابتة (خلفية بيضاء) */
function printBalanceTone(v: number): string {
  if (v < 0) return 'text-rose-700'
  if (v > 0) return 'text-emerald-700'
  return 'text-slate-900'
}

function SourceBadge({ type }: { type: string }) {
  const s = SOURCE_TYPES[type]
  if (!s) return null
  return <span className={cn('inline-block text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap', s.tone)}>{s.label}</span>
}

function SummaryTile({ label, value, signed }: { label: string; value: number; signed?: boolean }) {
  return (
    <div className="bg-secondary/60 rounded-lg p-2.5 text-center min-w-0">
      <div className="text-[11px] text-muted-foreground leading-tight">{label}</div>
      <div className={cn('font-bold tnum text-sm mt-1 leading-tight', signed ? balanceTone(value) : '')}>
        {fmtMoney(value, 2)} <span className="text-[10px] font-normal text-muted-foreground">ج.م</span>
      </div>
    </div>
  )
}

function PrintSummaryTile({ label, value, signed }: { label: string; value: number; signed?: boolean }) {
  return (
    <div className="border border-slate-300 rounded p-2 text-center bg-slate-50">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={cn('font-bold tnum text-sm', signed ? printBalanceTone(value) : 'text-slate-900')}>
        {fmtMoney(value, 2)} ج.م
      </div>
    </div>
  )
}

/** محتوى الطباعة A4 — يُرسم داخل PrintStage (بوابة على body) وليس داخل الـ Dialog */
function StatementPrintContent({ data, periodLabel, user }: { data: StatementData; periodLabel: string; user?: string }) {
  const { party, items, totals } = data
  return (
    <div className="p-6">
      <PrintHeader
        title="كشف حساب"
        subtitle={`${party.name}${party.code ? ` — كود: ${party.code}` : ''} — الفترة: ${periodLabel}`}
        branch={party.branch?.name}
        user={user}
      />

      {/* الملخص المالي */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <PrintSummaryTile label="الرصيد الافتتاحي" value={data.opening} signed />
        <PrintSummaryTile label="إجمالي المدين" value={totals.totalDebit} />
        <PrintSummaryTile label="إجمالي الدائن" value={totals.totalCredit} />
        <PrintSummaryTile label="الرصيد الختامي" value={totals.closing} signed />
      </div>

      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-slate-100">
            {COLUMNS.map((c) => (
              <th key={c.label} className={cn('px-2 py-1.5 font-bold whitespace-nowrap', c.align === 'end' ? 'text-left' : 'text-right')}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan={COLUMNS.length} className="px-2 py-4 text-center text-slate-500">لا توجد حركات في هذه الفترة</td></tr>
          ) : items.map((it) => (
            <tr key={it.id}>
              <td className="px-2 py-1.5 whitespace-nowrap">{fmtDate(it.date)}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">{it.entryNo}</td>
              <td className="px-2 py-1.5">
                {it.description}
                {SOURCE_TYPES[it.sourceType] && <span className="text-[9px] text-slate-500"> — {SOURCE_TYPES[it.sourceType].label}</span>}
                {it.reference ? <span className="text-[9px] text-slate-500"> ({it.reference})</span> : null}
              </td>
              <td className="px-2 py-1.5">{it.account.name} <span className="text-slate-500">{it.account.code}</span></td>
              <td className="px-2 py-1.5 whitespace-nowrap">{it.shipment?.shipmentNo ?? '—'}</td>
              <td className="px-2 py-1.5 whitespace-nowrap text-left tnum">{it.debit ? fmtMoney(it.debit, 2) : '—'}</td>
              <td className="px-2 py-1.5 whitespace-nowrap text-left tnum">{it.credit ? fmtMoney(it.credit, 2) : '—'}</td>
              <td className={cn('px-2 py-1.5 whitespace-nowrap text-left tnum font-bold', printBalanceTone(it.balance))}>{fmtMoney(it.balance, 2)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-slate-100 font-bold">
            <td colSpan={5} className="px-2 py-1.5 text-right">الإجمالي ({items.length} حركة)</td>
            <td className="px-2 py-1.5 text-left tnum">{fmtMoney(totals.totalDebit, 2)}</td>
            <td className="px-2 py-1.5 text-left tnum">{fmtMoney(totals.totalCredit, 2)}</td>
            <td className={cn('px-2 py-1.5 text-left tnum', printBalanceTone(totals.closing))}>{fmtMoney(totals.closing, 2)}</td>
          </tr>
        </tfoot>
      </table>

      <div className="text-[10px] text-slate-500 mt-2 leading-snug">
        رصيد موجب = مستحق للشركة (مدين) · رصيد سالب = مستحق على الشركة (دائن). جميع المبالغ بالجنيه المصري.
      </div>

      <PrintFooter note="هذا الكشف صادر آليًا من نظام الإدارة المتكامل — يُعتمد بعد المراجعة والتوقيع." />
    </div>
  )
}

export function PartyStatementDialog({ partyId, partyName, open, onOpenChange }: PartyStatementDialogProps) {
  const { toast } = useToast()
  const { user } = useAuth()
  const { printModal } = usePrintModal()
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')

  // تصفير المدى عند كل فتح — يبدأ الكشف من «كل الفترات»
  React.useEffect(() => {
    if (open) { setFrom(''); setTo('') }
  }, [open, partyId])

  const qs = new URLSearchParams()
  if (from) qs.set('from', from)
  if (to) qs.set('to', to)
  const { data, isLoading, error } = useSWR<StatementData>(
    open && partyId ? `/api/parties/${partyId}/statement?${qs.toString()}` : null,
    fetcher,
  )

  // خطأ التحميل — إشعار فوري + حالة داخلية
  React.useEffect(() => {
    if (error) {
      toast({ title: 'تعذر تحميل كشف الحساب', description: error instanceof Error ? error.message : 'حاول مرة أخرى', variant: 'destructive' })
    }
  }, [error, toast])

  const party = data?.party
  const items = data?.items ?? []
  const periodLabel = (from || to) ? `من ${from || 'البداية'} إلى ${to || 'اليوم'}` : 'كل الفترات'

  // تصدير كشف الحساب Excel (.xlsx) — نفس بيانات الشاشة من الخادم مباشرة (RTL منسّق)
  const exportXlsx = async () => {
    if (!data) return
    try {
      const expQs = new URLSearchParams()
      if (from) expQs.set('from', from)
      if (to) expQs.set('to', to)
      const res = await fetch(`/api/parties/${partyId}/statement/export?${expQs.toString()}`, { headers: { 'x-session-token': getToken() } })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error ?? 'فشل التصدير')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `كشف حساب - ${party?.name ?? partyName ?? ''}${from || to ? ` (${from || 'start'}_${to || 'today'})` : ''}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast({ title: 'تم تصدير كشف الحساب بنجاح' })
    } catch (e: any) {
      toast({ title: 'تعذر تصدير Excel', description: e?.message ?? '', variant: 'destructive' })
    }
  }

  return (
    <>
      {/* منصة الطباعة A4 — خارج الـ Dialog كي لا يُقص الجدول في الورق */}
      {data && (
        <PrintStage id="party-statement-print-stage">
          <StatementPrintContent data={data} periodLabel={periodLabel} user={user?.username} />
        </PrintStage>
      )}

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[95vw] sm:max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 min-w-0">
              <FileText className="size-4 text-primary shrink-0" />
              <span className="truncate min-w-0">كشف حساب — {data?.party.name ?? partyName ?? ''}</span>
            </DialogTitle>
            <DialogDescription>كل الحركات المالية المرحّلة للطرف مرتبة زمنيًا مع الرصيد التراكمي بعد كل حركة.</DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="space-y-3 py-1">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
              </div>
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
            </div>
          ) : error || !data || !party ? (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-3">
              <AlertCircle className="size-4 shrink-0" />
              تعذر تحميل كشف الحساب — تحقق من الاتصال وأعد المحاولة.
            </div>
          ) : (
            <div className="space-y-3">
              {/* بيانات الطرف + نوعه */}
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="font-semibold text-sm">{party.name}</span>
                {party.code && <span className="text-muted-foreground tnum">كود: {party.code}</span>}
                {party.isCustomer && <Badge variant="outline" className="text-[10px]">عميل</Badge>}
                {party.isContractor && <Badge variant="outline" className="text-[10px]">مقاول</Badge>}
                {party.isSupplier && <Badge variant="outline" className="text-[10px]">مورد</Badge>}
                {party.branch && <span className="text-muted-foreground">الفرع: {party.branch.name}</span>}
              </div>

              {/* الفترة + أدوات الطباعة (مخفية عند الطباعة) */}
              <div className="flex items-center justify-between gap-2 flex-wrap print:hidden">
                <div className="text-xs text-muted-foreground">الفترة: {periodLabel}</div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-32 h-8 text-xs" aria-label="من تاريخ" />
                  <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-32 h-8 text-xs" aria-label="إلى تاريخ" />
                  <Button variant="outline" size="sm" onClick={exportXlsx} disabled={!items.length} className="h-8">
                    <FileSpreadsheet className="size-4" /> Excel
                  </Button>
                  <Button variant="outline" size="sm" onClick={printModal}><Printer className="size-4" /> طباعة</Button>
                </div>
              </div>

              {/* الملخص المالي */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <SummaryTile label="الرصيد الافتتاحي" value={data.opening} signed />
                <SummaryTile label="إجمالي المدين" value={data.totals.totalDebit} />
                <SummaryTile label="إجمالي الدائن" value={data.totals.totalCredit} />
                <SummaryTile label="الرصيد الختامي" value={data.totals.closing} signed />
              </div>
              <div className="text-[10px] text-muted-foreground leading-snug">
                رصيد موجب = مستحق للشركة (مدين) · رصيد سالب = مستحق على الشركة (دائن).
              </div>

              {/* جدول الحركات */}
              {items.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground bg-secondary/60 rounded-lg py-8">لا توجد حركات في هذه الفترة</div>
              ) : (
                <div className="rounded-xl border overflow-auto max-h-[45vh]">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        {COLUMNS.map((c) => (
                          <th key={c.label} className={cn('sticky top-0 bg-muted z-10 font-medium px-2 py-2 whitespace-nowrap', c.align === 'end' ? 'text-left' : 'text-right')}>{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.id} className="border-t border-border hover:bg-muted/40">
                          <td className="px-2 py-2 whitespace-nowrap">{fmtDate(it.date)}</td>
                          <td className="px-2 py-2 whitespace-nowrap tnum">{it.entryNo}</td>
                          <td className="px-2 py-2 min-w-[180px]">
                            <div className="truncate max-w-[240px]" title={it.description}>{it.description}</div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <SourceBadge type={it.sourceType} />
                              {it.reference && <span className="text-[10px] text-muted-foreground">مرجع: {it.reference}</span>}
                            </div>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            <div>{it.account.name}</div>
                            <div className="text-[10px] text-muted-foreground tnum">{it.account.code}</div>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap tnum">{it.shipment?.shipmentNo ?? '—'}</td>
                          <td className="px-2 py-2 whitespace-nowrap tnum text-left">{it.debit ? fmtMoney(it.debit, 2) : '—'}</td>
                          <td className="px-2 py-2 whitespace-nowrap tnum text-left">{it.credit ? fmtMoney(it.credit, 2) : '—'}</td>
                          <td className={cn('px-2 py-2 whitespace-nowrap tnum text-left font-bold', balanceTone(it.balance))}>{fmtMoney(it.balance, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border bg-muted/60 font-bold">
                        <td colSpan={5} className="px-2 py-2 text-right">الإجمالي ({items.length} حركة)</td>
                        <td className="px-2 py-2 tnum text-left">{fmtMoney(data.totals.totalDebit, 2)}</td>
                        <td className="px-2 py-2 tnum text-left">{fmtMoney(data.totals.totalCredit, 2)}</td>
                        <td className={cn('px-2 py-2 tnum text-left', balanceTone(data.totals.closing))}>{fmtMoney(data.totals.closing, 2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
