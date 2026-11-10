'use client'

import * as React from 'react'
import useSWR from 'swr'
import { FileBarChart, FileSpreadsheet, Printer, Truck, Banknote, Users, Boxes, BookOpen, MapPin, Undo2, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { DataTable } from '../data-table'
import { fetcher, apiPost } from '@/lib/api'
import { exportToCSV, exportToExcel } from '@/lib/export'
import { fmtNum, fmtDate, fmtDateTime, ACCOUNT_TYPE, SHIPMENT_STATUS, MOVEMENT_TYPE } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuth, useCanPrices } from '../auth-provider'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useToast } from '@/hooks/use-toast'

type ReportType = 'shipments' | 'freight-margin' | 'contractor-dues' | 'customer-debts' | 'trial-balance' | 'inventory-movements' | 'low-stock' | 'pending-returns'

// تقارير تكشف أسعارًا — تتطلب صلاحية prices.view (يُفرض أيضًا على الخادم)
const PRICE_REPORTS = new Set<ReportType>(['shipments', 'freight-margin', 'contractor-dues', 'customer-debts'])

const REPORTS: { type: ReportType; title: string; desc: string; icon: React.ElementType; tone: string }[] = [
  { type: 'pending-returns', title: 'المرتجعات لم تُستلم', desc: 'مرتجعات لا تزال مع المندوبين — تتبع العهدة', icon: Undo2, tone: 'bg-amber-100 text-amber-700' },
  { type: 'shipments', title: 'سجل الشحنات', desc: 'كل الشحنات بالتفصيل حسب الفرع والمنطقة', icon: Truck, tone: 'bg-amber-100 text-amber-700' },
  { type: 'freight-margin', title: 'هامش النولون', desc: 'مقارنة سعر البيع بالتكلفة وصافي الربح', icon: Banknote, tone: 'bg-emerald-100 text-emerald-700' },
  { type: 'contractor-dues', title: 'مستحقات المقاولين', desc: 'مستحقات المقاولين والمدفوع والمتبقي', icon: Users, tone: 'bg-sky-100 text-sky-700' },
  { type: 'customer-debts', title: 'ديون العملاء', desc: 'مديونيات العملاء ومحصّل منها', icon: Banknote, tone: 'bg-rose-100 text-rose-700' },
  { type: 'trial-balance', title: 'ميزان المراجعة', desc: 'أرصدة الحسابات مدين/دائن', icon: BookOpen, tone: 'bg-purple-100 text-purple-700' },
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
  const { data, isLoading, mutate } = useSWR<{ items: any[]; byCourier?: any[]; total?: number }>(active ? `/api/reports/${active}?${qs.toString()}` : null, fetcher)

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

  if (active && data) {
    const activeReport = REPORTS.find((r) => r.type === active)
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
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

        {/* عرض مخصص لتقرير المرتجعات لم تُستلم — مع بطاقة مسؤولية السائقين */}
        {active === 'pending-returns' ? (
          <PendingReturnsReport
            items={data.items}
            byCourier={data.byCourier ?? []}
            total={data.total ?? 0}
            loading={isLoading}
            onMarkReceived={markReceived}
            canExecute={has('vouchers.execute')}
          />
        ) : (
          <ReportTable type={active} items={data.items} loading={isLoading} />
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

function ReportTable({ type, items, loading }: { type: ReportType; items: any[]; loading: boolean }) {
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
      { key: 'total', header: 'الإجمالي', align: 'left' as const, hideInCard: true, width: 'w-28', render: (c: any) => <span className="tnum">{fmtNum(c.totalSuppliers)}</span> },
      { key: 'paid', header: 'مدفوع', align: 'left' as const, width: 'w-28', render: (c: any) => <span className="tnum text-emerald-600">{fmtNum(c.paid)}</span> },
      { key: 'due', header: 'مستحق', align: 'left' as const, width: 'w-28', render: (c: any) => <span className={cn('tnum font-bold', c.due > 0 ? 'text-rose-600' : '')}>{fmtNum(c.due)}</span> },
    ]
    return <DataTable rows={items} columns={cols} getRowKey={(c) => c.id} minW={800} searchFn={(c, q) => (c.name || '').toLowerCase().includes(q)} searchPlaceholder="بحث..." />
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
