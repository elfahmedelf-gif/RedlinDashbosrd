'use client'

import * as React from 'react'
import useSWR from 'swr'
import { FileBarChart, FileSpreadsheet, Printer, Truck, Banknote, Users, Boxes, BookOpen, MapPin, Undo2, AlertCircle, Layers, CalendarDays, Sheet, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { DataTable } from '../data-table'
import { fetcher, getToken } from '@/lib/api'
import { apiPostSync as apiPost } from '@/lib/sync'
import { exportToCSV, exportToExcel } from '@/lib/export'
import { fmtNum, fmtDate, fmtDateTime, ACCOUNT_TYPE, SHIPMENT_STATUS, MOVEMENT_TYPE } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuth, useCanPrices } from '../auth-provider'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useToast } from '@/hooks/use-toast'
import { PrintHeader, PrintFooter } from '../print-layout'
import { PrintStage, usePrintModal } from '../print-stage'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// تقرير التقرير الشهري للمقاول — خاص بواجهته (يدير بياناته بنفسه)
type ReportType = 'shipments' | 'freight-margin' | 'contractor-dues' | 'customer-debts' | 'trial-balance' | 'income-statement' | 'inventory-movements' | 'low-stock' | 'pending-returns' | 'contractor-monthly'

// تقارير تكشف أسعارًا — تتطلب صلاحية prices.view (يُفرض أيضًا على الخادم)
const PRICE_REPORTS = new Set<ReportType>(['shipments', 'freight-margin', 'contractor-dues', 'customer-debts', 'contractor-monthly'])

const REPORTS: { type: ReportType; title: string; desc: string; icon: React.ElementType; tone: string }[] = [
  { type: 'pending-returns', title: 'المرتجعات لم تُستلم', desc: 'مرتجعات لا تزال مع المندوبين — تتبع العهدة', icon: Undo2, tone: 'bg-amber-100 text-amber-700' },
  { type: 'shipments', title: 'سجل الشحنات', desc: 'كل الشحنات بالتفصيل حسب الفرع والمنطقة', icon: Truck, tone: 'bg-amber-100 text-amber-700' },
  { type: 'freight-margin', title: 'هامش النولون', desc: 'مقارنة سعر البيع بالتكلفة وصافي الربح', icon: Banknote, tone: 'bg-emerald-100 text-emerald-700' },
  { type: 'contractor-dues', title: 'مستحقات المقاولين', desc: 'مستحقات المقاولين والمدفوع والمتبقي + البنود الإضافية المعتمدة', icon: Users, tone: 'bg-sky-100 text-sky-700' },
  { type: 'contractor-monthly', title: 'التقرير الشهري للمقاول', desc: 'كشف شهري موحد لكل مقاول: شغل + بنود معتمدة + مسحوبات + الصافي — للطباعة', icon: CalendarDays, tone: 'bg-emerald-100 text-emerald-700' },
  { type: 'customer-debts', title: 'ديون العملاء', desc: 'مديونيات العملاء ومحصّل منها', icon: Banknote, tone: 'bg-rose-100 text-rose-700' },
  { type: 'trial-balance', title: 'ميزان المراجعة', desc: 'أرصدة الحسابات مدين/دائن — مع فلترة بفترة زمنية', icon: BookOpen, tone: 'bg-purple-100 text-purple-700' },
  { type: 'income-statement', title: 'قائمة الدخل', desc: 'الإيرادات والمصروفات وصافي الربح من دفتر الأستاذ', icon: TrendingUp, tone: 'bg-emerald-100 text-emerald-700' },
  { type: 'inventory-movements', title: 'حركة المخزون', desc: 'كل حركات الإضافة والصرف والتحويل', icon: Boxes, tone: 'bg-indigo-100 text-indigo-700' },
  { type: 'low-stock', title: 'الأصناف منخفضة المخزون', desc: 'أصناف وصلت تحت حد إعادة الطلب', icon: Boxes, tone: 'bg-orange-100 text-orange-700' },
]

export function ReportsModule() {
  const { has } = useAuth()
  const canPrices = useCanPrices()
  const { toast } = useToast()
  const { confirm: confirmDialog } = useConfirm()
  const [active, setActive] = React.useState<ReportType | null>(null)
  const [from, setFrom] = React.useState(''); const [to, setTo] = React.useState('')
  const qs = new URLSearchParams()
  if (from) qs.set('from', from)
  if (to) qs.set('to', to)
  // التقرير الشهري للمقاول يدير بياناته بنفسه ( contractor + شهر )
  const { data, isLoading, mutate } = useSWR<{ items: any[]; byCourier?: any[]; total?: number; totals?: any }>(
    active && active !== 'contractor-monthly' ? `/api/reports/${active}?${qs.toString()}` : null,
    fetcher,
  )

  const exportCSV = () => {
    if (!data?.items?.length) return
    // Flatten nested objects for CSV
    const rows = data.items.map((row: any) => {
      const flat: Record<string, any> = {}
      for (const k of Object.keys(row)) {
        const v = row[k]
        if (v == null) flat[k] = ''
        else if (typeof v === 'object') flat[k] = JSON.stringify(v)
        else flat[k] = v
      }
      return flat
    })
    exportToCSV(rows, `${active}-${new Date().toISOString().slice(0, 10)}.csv`)
  }
  const exportXls = () => {
    if (!data?.items?.length) return
    const rows = data.items.map((row: any) => {
      const flat: Record<string, any> = {}
      for (const k of Object.keys(row)) {
        const v = row[k]
        if (v == null) flat[k] = ''
        else if (typeof v === 'object') flat[k] = JSON.stringify(v)
        else flat[k] = v
      }
      return flat
    })
    exportToExcel(rows, `${active}-${new Date().toISOString().slice(0, 10)}.xls`)
  }

  // إجراء "تم التسليم" من تقرير المرتجعات — ينشئ إذن استلام مرتجعات تلقائيًا
  const markReceived = async (voucherId: string, voucherNo?: string) => {
    const ok = await confirmDialog({
      title: 'تأكيد تسليم المرتجع',
      message: `تأكيد تسليم مرتجع ${voucherNo ?? ''}؟ سيُنشأ إذن استلام مرتجعات تلقائيًا.`,
      variant: 'primary',
      confirmText: 'تم التسليم',
    })
    if (!ok) return
    try {
      const res: any = await apiPost(`/api/vouchers/${voucherId}/mark-received`, { userName: 'admin' })
      const summary = res?.succeeded != null && res?.total != null
        ? `تم تسليم ${res.succeeded}/${res.total} شحنة${res.failed ? ` — ${res.failed} فشل` : ''}`
        : 'تم التسليم'
      toast({ title: 'تم التسليم', description: summary })
      mutate()
    } catch (e: any) {
      toast({ title: 'خطأ', description: e.message, variant: 'destructive' })
    }
  }

  // تصفية التقارير حسب الصلاحية — تقارير الأسعار تُخفى عن غير المصرح لهم
  const visibleReports = REPORTS.filter((r) => !PRICE_REPORTS.has(r.type) || canPrices)

  if (active && (active === 'contractor-monthly' || active === 'income-statement' || data)) {
    const activeReport = REPORTS.find((r) => r.type === active)
    // التقرير الشهري للمقاول — لوحة خاصة كاملة (مقاول + شهر + طباعة رسمية)
    if (active === 'contractor-monthly') {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap print:hidden">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setActive(null)}>← رجوع للتقارير</Button>
              <h3 className="text-base font-semibold">{activeReport?.title}</h3>
            </div>
          </div>
          <ContractorMonthlyReport />
        </div>
      )
    }
    // قائمة الدخل — بنية خاصة (إيرادات/مصروفات/صافي الربح) وليست جدول items
    if (active === 'income-statement') {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap print:hidden">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setActive(null)}>← رجوع للتقارير</Button>
              <h3 className="text-base font-semibold">{activeReport?.title}</h3>
            </div>
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="size-4" /> طباعة</Button>
          </div>
          <IncomeStatementView data={data} loading={isLoading} />
        </div>
      )
    }
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap print:hidden">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setActive(null)}>← رجوع للتقارير</Button>
            <h3 className="text-base font-semibold">{activeReport?.title}</h3>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36 h-8 text-xs" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36 h-8 text-xs" />
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="size-4" /> طباعة</Button>
            <Button variant="outline" size="sm" onClick={exportCSV}><FileSpreadsheet className="size-4" /> CSV</Button>
            <Button variant="outline" size="sm" onClick={exportXls}><FileSpreadsheet className="size-4" /> Excel</Button>
          </div>
        </div>

        {/* عنوان التقرير في الطباعة (يظهر فقط عند الطباعة) */}
        <div className="hidden print:block text-center mb-2">
          <h2 className="text-lg font-bold">{activeReport?.title}</h2>
          {(from || to) && <div className="text-xs text-slate-600 mt-1">من {from || 'البداية'} إلى {to || 'اليوم'}</div>}
        </div>

        {/* عرض مخصص لتقرير المرتجعات لم تُستلم — مع بطاقة مسؤولية السائقين */}
        {active === 'pending-returns' ? (
          <PendingReturnsReport
            items={data?.items ?? []}
            byCourier={data?.byCourier ?? []}
            total={data?.total ?? 0}
            loading={isLoading}
            onMarkReceived={markReceived}
            canExecute={has('vouchers.execute')}
          />
        ) : (
          <ReportTable type={active} items={data?.items ?? []} totals={data?.totals} loading={isLoading} />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {visibleReports.map((r) => (
          <Card key={r.type} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setActive(r.type)}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className={cn('flex items-center justify-center size-11 rounded-xl', r.tone)}><r.icon className="size-5" /></div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm leading-tight">{r.title}</div>
                  <div className="text-xs text-muted-foreground mt-1 leading-snug">{r.desc}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {!canPrices && (
          <Card className="border-dashed bg-muted/30">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center size-11 rounded-xl bg-amber-100 text-amber-700"><AlertCircle className="size-5" /></div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm leading-tight">تقارير الأسعار محجوبة</div>
                  <div className="text-xs text-muted-foreground mt-1 leading-snug">
                    تقارير هامش النولون/مستحقات المقاولين/ديون العملاء تتطلب صلاحية «رؤية الأسعار».
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// تقرير المرتجعات لم تُستلم — مع بطاقة مسؤولية كل سائق وزر "تم التسليم"
// ---------------------------------------------------------------------------
function PendingReturnsReport({
  items,
  byCourier,
  total,
  loading,
  onMarkReceived,
  canExecute,
}: {
  items: any[]
  byCourier: any[]
  total: number
  loading: boolean
  onMarkReceived: (voucherId: string, voucherNo?: string) => void
  canExecute: boolean
}) {
  if (loading) return <Skeleton className="h-96 rounded-xl" />
  if (!items.length) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Undo2 className="size-10 mx-auto mb-2 text-muted-foreground/60" />
          <div className="text-sm font-medium">لا توجد مرتجعات معلقة</div>
          <div className="text-xs text-muted-foreground mt-1">كل المرتجعات المسجلة تم استلامها بالفرع.</div>
        </CardContent>
      </Card>
    )
  }
  return (
    <div className="space-y-4">
      {/* بطاقة المسؤولية حسب المندوب */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" />
            مسؤولية المندوبين ({byCourier.length})
          </CardTitle>
          <CardDescription>عدد المرتجعات غير المستلمة لكل مندوب + أقدم مدة بقاء</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {byCourier.map((c, i) => (
              <div key={c.courierId || i} className={cn(
                'border rounded-lg p-3',
                c.oldestDays > 7
                  ? 'border-rose-300 bg-rose-50 dark:bg-rose-950/30'
                  : c.oldestDays > 3
                    ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/30'
                    : 'border-border bg-muted/30'
              )}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm truncate">{c.courierName}</span>
                  <Badge variant="outline" className={cn('text-[11px] tnum',
                    c.oldestDays > 7 ? 'bg-rose-100 text-rose-700' :
                    c.oldestDays > 3 ? 'bg-amber-100 text-amber-700' :
                    'bg-slate-100 text-slate-700')}>
                    {c.oldestDays} يوم
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  <b className="text-foreground tnum">{c.count}</b> مرتجع لم يُستلم بعد
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* جدول التفاصيل */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Undo2 className="size-4 text-muted-foreground" />
            المرتجعات لم تُستلم ({total})
          </CardTitle>
          <CardDescription>كل شحنة بحالة «مرتجعة» لا تزال مع المندوب — اضغط «تم التسليم» لتسجيل استلامها</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={items}
            columns={[
              { key: 'no', header: 'رقم الشحنة', primary: true, align: 'center' as const, width: 'w-28', render: (s: any) => <span className="font-mono text-xs font-bold">{s.shipmentNo ?? '—'}</span> },
              { key: 'recipient', header: 'المستلم', width: 'w-40', render: (s: any) => <span className="text-xs truncate-1 block">{s.recipientName ?? '—'}</span> },
              { key: 'dest', header: 'الوجهة', hideInCard: true, width: 'w-32', render: (s: any) => <span className="text-xs truncate-1 block">{s.destination ?? '—'}</span> },
              { key: 'customer', header: 'العميل', hideInCard: true, width: 'w-32', render: (s: any) => <span className="text-xs truncate-1 block">{s.customerName ?? '—'}</span> },
              { key: 'courier', header: 'المندوب', width: 'w-32', render: (s: any) => <span className="text-xs font-medium truncate-1 block">{s.courierName ?? 'غير محدد'}</span> },
              { key: 'voucher', header: 'إذن المرتجع', align: 'center' as const, hideInCard: true, width: 'w-28', render: (s: any) => <span className="font-mono text-xs">{s.returnVoucherNo ?? '—'}</span> },
              {
                key: 'days', header: 'المدة', align: 'center' as const, width: 'w-24',
                render: (s: any) => (
                  <Badge variant="outline" className={cn('text-[11px] tnum',
                    (s.daysOutstanding ?? 0) > 7 ? 'bg-rose-100 text-rose-700' :
                    (s.daysOutstanding ?? 0) > 3 ? 'bg-amber-100 text-amber-700' :
                    'bg-slate-100 text-slate-700')}>
                    {s.daysOutstanding ?? '—'} يوم
                  </Badge>
                ),
              },
              {
                key: 'actions', header: 'إجراءات', align: 'center' as const, width: 'w-32',
                render: (s: any) => (
                  canExecute && s.returnVoucherId ? (
                    <Button size="sm" variant="default" onClick={(e) => { e.stopPropagation(); onMarkReceived(s.returnVoucherId, s.returnVoucherNo) }}>
                      <Undo2 className="size-3.5" /> تم التسليم
                    </Button>
                  ) : <span className="text-xs text-muted-foreground">—</span>
                ),
              },
            ]}
            getRowKey={(s) => s.shipmentId}
            minW={1100}
            searchFn={(s, q) => (s.shipmentNo || '').toLowerCase().includes(q) || (s.courierName || '').toLowerCase().includes(q) || (s.recipientName || '').toLowerCase().includes(q)}
            searchPlaceholder="بحث برقم الشحنة/المندوب..."
          />
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// قائمة الدخل — الإيرادات (حسابات 4xxx) والمصروفات (حسابات 5xxx) وصافي الربح
// مستمدة من دفتر الأستاذ (القيود المرحّلة فقط) — شكل خاص غير جدولي
// ---------------------------------------------------------------------------
function IncomeStatementView({ data, loading }: { data?: any; loading: boolean }) {
  if (loading) return <Skeleton className="h-96 rounded-xl" />
  const revenue = data?.revenue ?? []
  const expenses = data?.expenses ?? []
  const totalRevenue = data?.totalRevenue ?? 0
  const totalExpenses = data?.totalExpenses ?? 0
  const netProfit = data?.netProfit ?? 0
  const row = (x: any, sign: 'credit' | 'debit') => (
    <div key={x.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-border/60 last:border-0">
      <span className="text-sm flex items-center gap-2 min-w-0">
        <span className="font-mono text-xs text-muted-foreground">{x.code}</span>
        <span className="truncate-1">{x.name}</span>
      </span>
      <span className="tnum font-medium shrink-0">{fmtNum(x.amount)}</span>
    </div>
  )
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="size-4 text-emerald-600" /> الإيرادات</CardTitle>
            <CardDescription>حسابات الإيرادات من القيود المرحّلة (سلسلة 4)</CardDescription>
          </CardHeader>
          <CardContent>
            {revenue.length ? revenue.map((x: any) => row(x, 'credit')) : <div className="text-sm text-muted-foreground py-3">لا توجد إيرادات مسجلة</div>}
            <div className="flex items-center justify-between pt-2 mt-1 border-t-2 border-border font-bold text-sm">
              <span>إجمالي الإيرادات</span><span className="tnum">{fmtNum(totalRevenue)}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="size-4 text-rose-600 rotate-180" /> المصروفات</CardTitle>
            <CardDescription>حسابات المصروفات من القيود المرحّلة (سلسلة 5)</CardDescription>
          </CardHeader>
          <CardContent>
            {expenses.length ? expenses.map((x: any) => row(x, 'debit')) : <div className="text-sm text-muted-foreground py-3">لا توجد مصروفات مسجلة</div>}
            <div className="flex items-center justify-between pt-2 mt-1 border-t-2 border-border font-bold text-sm">
              <span>إجمالي المصروفات</span><span className="tnum">{fmtNum(totalExpenses)}</span>
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-2">
          <span className="text-sm font-bold">صافي الربح (الإيرادات − المصروفات)</span>
          <Badge variant="outline" className={cn('text-sm tnum px-3 py-1', netProfit >= 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300')}>
            {fmtNum(netProfit)} ج.م
          </Badge>
        </CardContent>
      </Card>
    </div>
  )
}

function ReportTable({ type, items, totals, loading }: { type: ReportType; items: any[]; totals?: any; loading: boolean }) {
  if (loading) return <Skeleton className="h-96 rounded-xl" />
  if (!items.length) return <Card><CardContent className="py-12 text-center text-muted-foreground">لا توجد بيانات في هذا التقرير</CardContent></Card>

  if (type === 'shipments') {
    const cols = [
      { key: 'no', header: 'رقم', primary: true, align: 'center' as const, width: 'w-24', render: (s: any) => <span className="font-mono text-xs">{s.shipmentNo}</span> },
      { key: 'date', header: 'التاريخ', hideInCard: true, align: 'center' as const, width: 'w-32', render: (s: any) => <span className="text-xs tnum">{fmtDate(s.date)}</span> },
      { key: 'cust', header: 'العميل', primary: true, render: (s: any) => <span className="text-sm truncate-1 block">{s.customer?.name || s.recipientName || '-'}</span> },
      { key: 'dest', header: 'الوجهة', hideInCard: true, width: 'w-32', render: (s: any) => <span className="truncate-1 block">{s.destination || '-'}</span> },
      { key: 'contractor', header: 'المقاول', hideInCard: true, width: 'w-32', render: (s: any) => <span className="text-xs truncate-1 block">{s.contractor?.name || '-'}</span> },
      { key: 'status', header: 'الحالة', align: 'center' as const, width: 'w-36', render: (s: any) => <Badge variant="outline" className={SHIPMENT_STATUS[s.status]?.tone}>{SHIPMENT_STATUS[s.status]?.label}</Badge> },
      { key: 'freight', header: 'نولون العميل', align: 'left' as const, width: 'w-28', render: (s: any) => <span className="tnum font-bold">{fmtNum(s.freightTotal)}</span> },
      { key: 'sup', header: 'نولون المقاول', align: 'left' as const, hideInCard: true, width: 'w-28', render: (s: any) => <span className="tnum">{fmtNum(s.totalSuppliers)}</span> },
    ]
    return <DataTable rows={items} columns={cols} getRowKey={(s) => s.id} minW={1050} searchFn={(s, q) => (s.shipmentNo || '').toLowerCase().includes(q) || (s.recipientName || '').toLowerCase().includes(q)} searchPlaceholder="بحث..." />
  }
  if (type === 'freight-margin') {
    const cols = [
      { key: 'no', header: 'رقم', primary: true, align: 'center' as const, width: 'w-24', render: (s: any) => <span className="font-mono text-xs">{s.shipmentNo}</span> },
      { key: 'dest', header: 'الوجهة', primary: true, render: (s: any) => <span className="truncate-1 block">{s.destination || '-'}</span> },
      { key: 'route', header: 'خط السير', hideInCard: true, align: 'center' as const, width: 'w-32', render: (s: any) => <span className="text-xs">{s.routeCode || '-'}</span> },
      { key: 'contractor', header: 'المقاول', hideInCard: true, width: 'w-32', render: (s: any) => <span className="text-xs truncate-1 block">{s.contractor?.name || '-'}</span> },
      { key: 'cost', header: 'التكلفة', align: 'left' as const, width: 'w-28', render: (s: any) => <span className="tnum">{fmtNum(s.freightCost)}</span> },
      { key: 'sell', header: 'البيع', align: 'left' as const, width: 'w-28', render: (s: any) => <span className="tnum">{fmtNum(s.salePrice ?? s.freightTotal)}</span> },
      { key: 'margin', header: 'الهامش', align: 'left' as const, width: 'w-28', render: (s: any) => <span className={cn('tnum font-bold', (s.margin ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{fmtNum(s.margin)}</span> },
    ]
    return <DataTable rows={items} columns={cols} getRowKey={(s) => s.id} minW={900} searchFn={(s, q) => (s.destination || '').toLowerCase().includes(q)} searchPlaceholder="بحث بالوجهة..." />
  }
  if (type === 'contractor-dues') {
    const cols = [
      { key: 'name', header: 'المقاول', primary: true, render: (c: any) => <span className="font-medium truncate-1 block">{c.name}</span> },
      { key: 'count', header: 'الشحنات', align: 'center' as const, width: 'w-24', render: (c: any) => <Badge variant="outline" className="tnum">{fmtNum(c.shipments)}</Badge> },
      { key: 'freight', header: 'النولون', align: 'left' as const, hideInCard: true, width: 'w-28', render: (c: any) => <span className="tnum">{fmtNum(c.freight)}</span> },
      { key: 'total', header: 'قيمة الشغل', align: 'left' as const, hideInCard: true, width: 'w-28', render: (c: any) => <span className="tnum">{fmtNum(c.totalSuppliers)}</span> },
      { key: 'extras', header: 'بنود معتمدة', align: 'left' as const, hideInCard: true, width: 'w-24', render: (c: any) => <span className="tnum">{fmtNum(c.extrasApproved ?? 0)}</span> },
      { key: 'earned', header: 'الشغل المعتمد (دفتر)', align: 'left' as const, hideInCard: true, width: 'w-32', render: (c: any) => <span className="tnum">{fmtNum(c.earned)}</span> },
      { key: 'paid', header: 'مدفوع', align: 'left' as const, width: 'w-28', render: (c: any) => <span className="tnum text-emerald-600">{fmtNum(c.paid)}</span> },
      { key: 'due', header: 'المستحق', align: 'left' as const, width: 'w-28', render: (c: any) => <span className={cn('tnum font-bold', c.due > 0 ? 'text-rose-600' : '')}>{fmtNum(c.due)}</span> },
    ]
    return (
      <div className="space-y-3">
        {totals && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs rounded-xl border border-border bg-muted/40 px-3 py-2">
            <span className="font-bold">الإجماليات:</span>
            <span className="tnum">الشغل المعتمد: <b>{fmtNum(totals.earned)}</b></span>
            <span className="tnum text-emerald-700 dark:text-emerald-400">مدفوع: <b>{fmtNum(totals.paid)}</b></span>
            <span className="tnum text-rose-700 dark:text-rose-400">المستحق: <b>{fmtNum(totals.due)}</b></span>
            <span className="tnum text-muted-foreground">بنود معتمدة: <b>{fmtNum(totals.extrasApproved)}</b> • معلقة: <b>{fmtNum(totals.extrasPending)}</b></span>
            <span className="text-[10px] text-muted-foreground">(مطابق لمتابعة الإدارة وميزان المراجعة 2102)</span>
          </div>
        )}
        <DataTable rows={items} columns={cols} getRowKey={(c) => c.id} minW={800} searchFn={(c, q) => (c.name || '').toLowerCase().includes(q)} searchPlaceholder="بحث..." />
      </div>
    )
  }
  if (type === 'customer-debts') {
    const cols = [
      { key: 'name', header: 'العميل', primary: true, render: (c: any) => <span className="font-medium truncate-1 block">{c.name}</span> },
      { key: 'count', header: 'الشحنات', align: 'center' as const, width: 'w-24', render: (c: any) => <Badge variant="outline" className="tnum">{fmtNum(c.shipments)}</Badge> },
      { key: 'total', header: 'الإجمالي', align: 'left' as const, hideInCard: true, width: 'w-28', render: (c: any) => <span className="tnum">{fmtNum(c.total)}</span> },
      { key: 'paid', header: 'محصّل', align: 'left' as const, width: 'w-28', render: (c: any) => <span className="tnum text-emerald-600">{fmtNum(c.paid)}</span> },
      { key: 'due', header: 'مديونية', align: 'left' as const, width: 'w-28', render: (c: any) => <span className={cn('tnum font-bold', c.due > 0 ? 'text-rose-600' : '')}>{fmtNum(c.due)}</span> },
    ]
    return <DataTable rows={items} columns={cols} getRowKey={(c) => c.id} minW={750} searchFn={(c, q) => (c.name || '').toLowerCase().includes(q)} searchPlaceholder="بحث..." />
  }
  if (type === 'trial-balance') {
    const cols = [
      { key: 'code', header: 'الكود', hideInCard: true, align: 'center' as const, width: 'w-24', render: (a: any) => <span className="font-mono text-xs">{a.code}</span> },
      { key: 'name', header: 'الحساب', primary: true, render: (a: any) => <span className="font-medium truncate-1 block">{a.name}</span> },
      { key: 'type', header: 'النوع', align: 'center' as const, width: 'w-32', render: (a: any) => <Badge variant="outline" className={ACCOUNT_TYPE[a.type]?.tone}>{ACCOUNT_TYPE[a.type]?.label}</Badge> },
      { key: 'debit', header: 'مدين', align: 'left' as const, width: 'w-28', render: (a: any) => <span className="tnum">{fmtNum(a.debit)}</span> },
      { key: 'credit', header: 'دائن', align: 'left' as const, width: 'w-28', render: (a: any) => <span className="tnum">{fmtNum(a.credit)}</span> },
      { key: 'bal', header: 'الرصيد', align: 'left' as const, width: 'w-28', render: (a: any) => <span className="tnum font-bold">{fmtNum(a.balance)}</span> },
    ]
    const totalDebit = items.reduce((s, a) => s + (a.debit || 0), 0)
    const totalCredit = items.reduce((s, a) => s + (a.credit || 0), 0)
    return (
      <div className="space-y-2">
        <DataTable rows={items} columns={cols} getRowKey={(a) => a.id} minW={800} searchFn={(a, q) => (a.name || '').toLowerCase().includes(q) || (a.code || '').toLowerCase().includes(q)} searchPlaceholder="بحث..." />
        <div className="flex items-center justify-end gap-4 text-sm">
          <span>إجمالي المدين: <b className="tnum">{fmtNum(totalDebit)}</b></span>
          <span>إجمالي الدائن: <b className="tnum">{fmtNum(totalCredit)}</b></span>
          <Badge variant="outline" className={Math.abs(totalDebit - totalCredit) < 0.001 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}>
            {Math.abs(totalDebit - totalCredit) < 0.001 ? 'متوازن' : 'غير متوازن'}
          </Badge>
        </div>
      </div>
    )
  }
  if (type === 'inventory-movements') {
    const cols = [
      { key: 'date', header: 'التاريخ', hideInCard: true, align: 'center' as const, width: 'w-32', render: (m: any) => <span className="text-xs tnum">{fmtDate(m.date)}</span> },
      { key: 'type', header: 'النوع', primary: true, align: 'center' as const, width: 'w-36', render: (m: any) => <Badge variant="outline" className={MOVEMENT_TYPE[m.type]?.tone}>{MOVEMENT_TYPE[m.type]?.label}</Badge> },
      { key: 'item', header: 'الصنف', primary: true, render: (m: any) => <span className="text-sm truncate-1 block">{m.item?.name}</span> },
      { key: 'wh', header: 'المخزن', hideInCard: true, width: 'w-32', render: (m: any) => <span className="text-xs">{m.warehouse?.name}</span> },
      { key: 'qty', header: 'الكمية', align: 'left' as const, width: 'w-28', render: (m: any) => <span className={cn('tnum font-bold whitespace-nowrap', m.quantity < 0 ? 'text-rose-600' : 'text-emerald-600')}>{m.quantity > 0 ? '+' : ''}{fmtNum(m.quantity)}</span> },
    ]
    return <DataTable rows={items} columns={cols} getRowKey={(m) => m.id} minW={750} searchFn={(m, q) => (m.item?.name || '').toLowerCase().includes(q)} searchPlaceholder="بحث..." />
  }
  if (type === 'low-stock') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((it) => (
          <Card key={it.id}>
            <CardContent className="p-4">
              <div className="font-semibold text-sm">{it.name}</div>
              <div className="text-xs text-muted-foreground mt-1">المخزن: {it.warehouse?.name || '-'}</div>
              <div className="flex items-center justify-between mt-3">
                <Badge variant="outline" className="bg-rose-50 text-rose-700">رصيد: {fmtNum(it.balance)} {it.unit || ''}</Badge>
                <span className="text-xs text-muted-foreground">حد الطلب: {fmtNum(it.reorderLevel ?? 0)}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }
  return null
}

// ---------------------------------------------------------------------------
// التقرير الشهري الموحد للمقاول — كشف كامل: شغل + بنود معتمدة + مسحوبات
// مستمد من دفتر الأستاذ (2102) مرتب زمنيًا مع رصيد تراكمي + إجمالي نهائي
// + طباعة A4 رسمية عبر PrintStage (نظام الطباعة الموحد)
// ---------------------------------------------------------------------------
const MONTHLY_KIND_META: Record<string, { label: string; tone: string }> = {
  work: { label: 'قيمة شغل شحنة', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  extra_taateeq: { label: 'بند إضافي — تعتيق', tone: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  extra_mabeet: { label: 'بند إضافي — مبيت (معتمد)', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  extra_return: { label: 'بند إضافي — مرتجعات (معتمد)', tone: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  payment: { label: 'دفعة/عهدة صرفت', tone: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  reversal: { label: 'قيد عكسي', tone: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' },
  other: { label: 'حركة أخرى', tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
}

interface MonthlyData {
  contractor: { id: string; code: string | null; name: string }
  period: { year: number; month: number; label: string }
  opening: number
  items: {
    id: string
    date: string
    entryNo: string
    kind: string
    label: string
    refNo: string | null
    notes: string | null
    shipment: { id: string; shipmentNo: string | null; deliveryNumber: string | null; destination: string | null } | null
    amount: number
    balance: number
  }[]
  totals: { work: number; taateeq: number; mabeet: number; return: number; extrasTotal: number; payments: number; other: number; reversal: number; net: number }
}

function ContractorMonthlyReport() {
  const { toast } = useToast()
  const user = useAuth()
  const { printModal } = usePrintModal()
  const nowD = new Date()
  const defaultMonth = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}`
  const [contractorId, setContractorId] = React.useState('')
  const [month, setMonth] = React.useState(defaultMonth)
  const [generated, setGenerated] = React.useState<{ c: string; m: string } | null>(null)

  const { data: contractorsData } = useSWR<{ items: { id: string; name: string; code: string | null }[] }>('/api/parties?type=contractor', fetcher)
  const contractors = contractorsData?.items ?? []

  const { data, isLoading, error } = useSWR<MonthlyData>(
    generated && generated.c ? `/api/reports/contractor-monthly?contractorId=${generated.c}&year=${generated.m.split('-')[0]}&month=${Number(generated.m.split('-')[1])}` : null,
    fetcher,
  )

  React.useEffect(() => {
    if (error) toast({ title: 'تعذر توليد التقرير', description: error instanceof Error ? error.message : 'حاول مرة أخرى', variant: 'destructive' })
  }, [error, toast])

  const generate = () => {
    if (!contractorId) {
      toast({ title: 'حدد المقاول أولًا', variant: 'destructive' })
      return
    }
    setGenerated({ c: contractorId, m: month })
  }

  const items = data?.items ?? []
  const totals = data?.totals
  const kindMeta = (k: string) => MONTHLY_KIND_META[k] ?? MONTHLY_KIND_META.other
  const balanceTone = (v: number) => (v > 0 ? 'text-emerald-700 dark:text-emerald-400' : v < 0 ? 'text-rose-700 dark:text-rose-400' : 'text-muted-foreground')

  const exportCSV = () => {
    if (!items.length) return
    const rows = items.map((it) => ({
      'التاريخ': String(it.date).slice(0, 10),
      'القيد': it.entryNo,
      'البيان': kindMeta(it.kind).label,
      'المرجع': it.refNo ?? '',
      'الديليفري': it.shipment?.deliveryNumber ?? it.shipment?.shipmentNo ?? '',
      'الوجهة': it.shipment?.destination ?? '',
      'المبلغ': it.amount,
      'الرصيد': it.balance,
    }))
    exportToCSV(rows, `contractor-monthly-${data?.contractor.name}-${month}.csv`)
    toast({ title: `تم تصدير ${rows.length} حركة` })
  }

  // تصدير Excel منسّق (.xlsx) — نفس بيانات التقرير عبر واجهة التصدير المخصصة
  const exportXlsx = async () => {
    if (!data || !generated) return
    try {
      const res = await fetch(`/api/reports/contractor-monthly/export?contractorId=${generated.c}&year=${generated.m.split('-')[0]}&month=${Number(generated.m.split('-')[1])}`, { headers: { 'x-session-token': getToken() } })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error ?? 'فشل التصدير')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `التقرير الشهري - ${data.contractor.name} - ${month}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast({ title: 'تم تصدير ملف Excel بنجاح' })
    } catch (e: any) {
      toast({ title: 'تعذر تصدير Excel', description: e?.message ?? '', variant: 'destructive' })
    }
  }

  // ── محتوى الطباعة A4 ──
  const printContent = data ? (
    <div className="p-6">
      <PrintHeader
        title="التقرير الشهري الموحد — حساب مقاول"
        subtitle={`${data.contractor.name}${data.contractor.code ? ` — كود: ${data.contractor.code}` : ''} — شهر ${data.period.label}`}
        user={user.user?.username}
      />
      <div className="grid grid-cols-5 gap-2 mb-3">
        {[
          { label: 'رصيد ما قبل الشهر', value: data.opening },
          { label: 'قيمة الشغل', value: totals?.work ?? 0 },
          { label: 'بنود معتمدة', value: totals?.extrasTotal ?? 0 },
          { label: 'المسحوبات', value: -(totals?.payments ?? 0) },
          { label: 'الصافي (له عند الشركة)', value: totals?.net ?? 0, signed: true },
        ].map((t) => (
          <div key={t.label} className="border border-slate-300 rounded p-2 text-center bg-slate-50">
            <div className="text-[10px] text-slate-500 leading-tight">{t.label}</div>
            <div className={cn('font-bold tnum text-sm mt-1', t.signed ? (t.value >= 0 ? 'text-emerald-700' : 'text-rose-700') : 'text-slate-900')}>{fmtNum(t.value, 2)}</div>
          </div>
        ))}
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-slate-100">
            <th className="px-2 py-1.5 text-right font-bold">التاريخ</th>
            <th className="px-2 py-1.5 text-right font-bold">القيد</th>
            <th className="px-2 py-1.5 text-right font-bold">البيان</th>
            <th className="px-2 py-1.5 text-right font-bold">المرجع</th>
            <th className="px-2 py-1.5 text-right font-bold">الديليفري</th>
            <th className="px-2 py-1.5 text-left font-bold">المبلغ</th>
            <th className="px-2 py-1.5 text-left font-bold">الرصيد</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan={7} className="px-2 py-4 text-center text-slate-500">لا توجد حركات في هذا الشهر</td></tr>
          ) : items.map((it) => (
            <tr key={it.id} className="print-avoid-break">
              <td className="px-2 py-1.5 whitespace-nowrap">{fmtDate(it.date)}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">{it.entryNo}</td>
              <td className="px-2 py-1.5">
                {kindMeta(it.kind).label}
                {it.refNo && <span className="text-[9px] text-slate-500"> ({it.refNo})</span>}
                {it.notes && it.notes !== it.label ? <div className="text-[9px] text-slate-500 truncate-1 max-w-[220px]">{it.notes}</div> : null}
              </td>
              <td className="px-2 py-1.5 whitespace-nowrap">{it.refNo ?? '—'}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">{it.shipment ? `${it.shipment.deliveryNumber ?? it.shipment.shipmentNo ?? '—'}${it.shipment.destination ? ` — ${it.shipment.destination}` : ''}` : '—'}</td>
              <td className={cn('px-2 py-1.5 text-left tnum whitespace-nowrap', it.amount < 0 ? 'text-rose-700' : 'text-emerald-700')}>{fmtNum(it.amount, 2)}</td>
              <td className={cn('px-2 py-1.5 text-left tnum font-bold whitespace-nowrap', balanceTone(it.balance))}>{fmtNum(it.balance, 2)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-slate-100 font-bold">
            <td colSpan={5} className="px-2 py-1.5 text-right">الإجمالي النهائي — شغل {fmtNum(totals?.work ?? 0)} + بنود {fmtNum(totals?.extrasTotal ?? 0)} − مسحوبات {fmtNum(totals?.payments ?? 0)}</td>
            <td className="px-2 py-1.5 text-left tnum">{fmtNum((totals?.work ?? 0) + (totals?.extrasTotal ?? 0) - (totals?.payments ?? 0), 2)}</td>
            <td className={cn('px-2 py-1.5 text-left tnum', balanceTone(totals?.net ?? 0))}>{fmtNum(totals?.net ?? 0, 2)}</td>
          </tr>
        </tfoot>
      </table>
      <div className="text-[10px] text-slate-500 mt-2 leading-snug">
        المبالغ الموجبة في صالح المقاول (مستحقات له) — السالبة مسحوبات/عهد صرفت له.
        البنود الإضافية (مبيت/مرتجعات) المعروضة معتمدة فقط من الشركة. جميع المبالغ بالجنيه المصري.
      </div>
      <PrintFooter note="هذا الكشف صادر آليًا من نظام الإدارة المتكامل — يُعتمد بعد المراجعة والتوقيع." />
    </div>
  ) : null

  return (
    <div className="space-y-4">
      {/* أدوات الاختيار */}
      <Card className="print:hidden">
        <CardContent className="p-4 flex items-end gap-2 flex-wrap">
          <div className="space-y-1.5 min-w-[200px] flex-1 max-w-xs">
            <label className="text-xs text-muted-foreground">المقاول</label>
            <Select value={contractorId} onValueChange={setContractorId}>
              <SelectTrigger className="w-full" aria-label="اختر المقاول"><SelectValue placeholder="اختر المقاول..." /></SelectTrigger>
              <SelectContent>
                {contractors.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.code ? ` — ${c.code}` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">الشهر</label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value || defaultMonth)} className="w-40" />
          </div>
          <Button onClick={generate} disabled={isLoading || !contractorId}>
            <CalendarDays className="size-4" /> توليد التقرير
          </Button>
          {data && items.length > 0 && (
            <>
              <Button variant="outline" onClick={printModal}><Printer className="size-4" /> طباعة</Button>
              <Button variant="outline" onClick={exportXlsx} disabled={!items.length}><Sheet className="size-4" /> Excel</Button>
              <Button variant="outline" onClick={exportCSV}><FileSpreadsheet className="size-4" /> CSV</Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* منصة الطباعة */}
      {printContent && <PrintStage id="contractor-monthly-print-stage">{printContent}</PrintStage>}

      {/* عرض التقرير */}
      {!generated ? (
        <Card className="border-dashed bg-muted/30 print:hidden">
          <CardContent className="py-12 text-center text-muted-foreground">
            <CalendarDays className="size-10 mx-auto mb-2 text-muted-foreground/60" />
            <div className="text-sm font-medium">اختر المقاول والشهر ثم اضغط «توليد التقرير»</div>
            <div className="text-xs text-muted-foreground mt-1">سيعرض كل حركات الشهر: قيمة الشغل + البنود الإضافية المعتمدة + المسحوبات + الصافي النهائي.</div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : data ? (
        <Card>
          <CardContent className="p-4 space-y-3">
            {/* رأس التقرير على الشاشة */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <div className="font-bold text-base">{data.contractor.name}{data.contractor.code ? <span className="text-muted-foreground text-xs"> — {data.contractor.code}</span> : null}</div>
                <div className="text-xs text-muted-foreground">شهر {data.period.label} — {items.length} حركة</div>
              </div>
              <Badge variant="outline" className="tnum">رصيد ما قبل الشهر: {fmtNum(data.opening, 2)} ج.م</Badge>
            </div>

            {/* ملخص الإجماليات */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <div className="bg-secondary/60 rounded-lg p-2.5 text-center"><div className="text-[11px] text-muted-foreground">قيمة الشغل</div><div className="font-bold tnum text-sm mt-1 num-ltr">{fmtNum(totals?.work ?? 0)}</div></div>
              <div className="bg-secondary/60 rounded-lg p-2.5 text-center"><div className="text-[11px] text-muted-foreground">بنود معتمدة</div><div className="font-bold tnum text-sm mt-1 num-ltr">{fmtNum(totals?.extrasTotal ?? 0)}</div></div>
              <div className="bg-secondary/60 rounded-lg p-2.5 text-center"><div className="text-[11px] text-muted-foreground">مسحوبات</div><div className="font-bold tnum text-sm mt-1 num-ltr text-rose-600">{fmtNum(totals?.payments ?? 0)}</div></div>
              <div className="bg-secondary/60 rounded-lg p-2.5 text-center"><div className="text-[11px] text-muted-foreground">تعتيق / مبيت / مرتجعات</div><div className="font-bold tnum text-[11px] mt-1 num-ltr">{fmtNum(totals?.taateeq ?? 0)} / {fmtNum(totals?.mabeet ?? 0)} / {fmtNum(totals?.return ?? 0)}</div></div>
              <div className={cn('rounded-lg p-2.5 text-center', (totals?.net ?? 0) >= 0 ? 'bg-emerald-500/10' : 'bg-rose-500/10')}><div className="text-[11px] text-muted-foreground">الإجمالي النهائي (له)</div><div className={cn('font-bold tnum text-sm mt-1 num-ltr', balanceTone(totals?.net ?? 0))}>{fmtNum(totals?.net ?? 0)}</div></div>
            </div>

            {/* الحركات مرتبة زمنيًا */}
            {items.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground bg-secondary/60 rounded-lg py-8">لا توجد حركات في هذا الشهر</div>
            ) : (
              <div className="rounded-xl border overflow-auto max-h-[55vh]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/60">
                      <th className="px-2 py-2 text-right font-medium whitespace-nowrap">التاريخ</th>
                      <th className="px-2 py-2 text-right font-medium whitespace-nowrap">البيان</th>
                      <th className="px-2 py-2 text-right font-medium whitespace-nowrap">الديليفري / الوجهة</th>
                      <th className="px-2 py-2 text-left font-medium whitespace-nowrap">المبلغ</th>
                      <th className="px-2 py-2 text-left font-medium whitespace-nowrap">الرصيد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => {
                      const meta = kindMeta(it.kind)
                      return (
                        <tr key={it.id} className="border-t border-border hover:bg-muted/40">
                          <td className="px-2 py-2 whitespace-nowrap tnum">{fmtDate(it.date)}</td>
                          <td className="px-2 py-2">
                            <span className={cn('inline-block text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap mb-0.5', meta.tone)}>{meta.label}</span>
                            <div className="text-[10px] text-muted-foreground">{it.refNo ?? it.entryNo}</div>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            {it.shipment ? (
                              <div>
                                <div className="font-mono text-[11px]">{it.shipment.deliveryNumber ?? it.shipment.shipmentNo ?? '—'}</div>
                                <div className="text-[10px] text-muted-foreground">{it.shipment.destination ?? ''}</div>
                              </div>
                            ) : '—'}
                          </td>
                          <td className={cn('px-2 py-2 whitespace-nowrap tnum text-left', it.amount < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400')}>{fmtNum(it.amount, 2)}</td>
                          <td className={cn('px-2 py-2 whitespace-nowrap tnum text-left font-bold', balanceTone(it.balance))}>{fmtNum(it.balance, 2)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="text-[10px] text-muted-foreground leading-snug">
              موجب = مستحق للمقاول · سالب = مسحوبات/عهد — المشتق من القيود المحاسبية المرحّلة (حساب مقاولو النقل 2102) لضمان تطابق الكشف مع كشف الحساب والأرصدة.
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
