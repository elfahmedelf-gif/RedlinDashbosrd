'use client'

// ============================================================================
// وحدة لوحة المؤشرات (Dashboard) — نسخة مُعاد هيكلتها
// - مكوّنات منفصلة لكل رسم (DailyTrend / UnitBreakdown / TopDestinations /
//   ContractorPerformance / StatusBreakdown / AlertsStrip)
// - استخدام البطاقات المشتركة من ui-cards (Kpi, StatCard, Mini, Alert)
// - دعم نطاق التاريخ عبر from/to (يمررهما الأب DashboardShell)
// - احترام صلاحية الأسعار (prices.view): إخفاء المؤشرات المالية لغير المصرح
// ============================================================================

import * as React from 'react'
import useSWR from 'swr'
import {
  Package, Banknote, Receipt, TrendingUp, TrendingDown,
  Truck, Clock, Moon, Undo2, ArrowRightLeft, Boxes,
  MapPin, UserCog, CalendarDays, Wallet, AlertCircle, Calendar, X,
  PackagePlus, ClipboardCheck,
} from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { fmtNum, shortDate, weekdayName, SHIPMENT_STATUS } from '@/lib/format'
import { cn } from '@/lib/utils'
import { fetcher } from '@/lib/api'
import { useCanPrices } from '../auth-provider'
import { Kpi, StatCard, Mini, Alert } from '../ui-cards'

const PIE_COLORS = ['#e8902a', '#1e9e8a', '#7a5bd6', '#5eb04a', '#d9532f', '#2c8fb8', '#c98d3b']

type DatePreset = 'today' | '7d' | '30d' | 'all'
const PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'today', label: 'اليوم' },
  { key: '7d', label: '7 أيام' },
  { key: '30d', label: '30 يوم' },
  { key: 'all', label: 'الكل' },
]

function presetToRange(preset: DatePreset): { from: string; to: string } {
  const today = new Date()
  const todayISO = today.toISOString().slice(0, 10)
  if (preset === 'today') return { from: todayISO, to: todayISO }
  if (preset === '7d' || preset === '30d') {
    const days = preset === '7d' ? 7 : 30
    const start = new Date(today)
    start.setDate(today.getDate() - days + 1)
    return { from: start.toISOString().slice(0, 10), to: todayISO }
  }
  return { from: '', to: '' } // all
}

function detectPreset(from: string, to: string): DatePreset | null {
  if (!from && !to) return 'all'
  const today = new Date().toISOString().slice(0, 10)
  if (from === today && to === today) return 'today'
  const start7 = new Date(); start7.setDate(new Date().getDate() - 6)
  if (from === start7.toISOString().slice(0, 10) && to === today) return '7d'
  const start30 = new Date(); start30.setDate(new Date().getDate() - 29)
  if (from === start30.toISOString().slice(0, 10) && to === today) return '30d'
  return null
}

// ---------------------------------------------------------------------------
// أنواع
// ---------------------------------------------------------------------------
interface StatsResponse {
  summary: {
    totalShipments: number; totalUnits: number; totalFreight: number;
    totalCustomerPay: number; totalSuppliers: number; totalSale: number;
    netFreightMargin: number; totalAging: number; totalOvernight: number;
    totalReturns: number; totalTransfer: number; totalOther: number; totalDrop: number;
    ton15Total: number; ton3Total: number; m6Total: number;
    inTransit: number; delivered: number; returned: number; delayed: number;
    codUncollected: number;
    statusCounts: Record<string, number>
  }
  daily: { date: string; count: number; freight: number; suppliers: number; customerPay: number }[]
  destinations: { name: string; count: number; freight: number; suppliers: number }[]
  contractors: { name: string; count: number; freight: number; suppliers: number }[]
  codings: { name: string; count: number; freight: number }[]
  dateRange: { from: string | null; to: string | null }
}

const CHART_STYLE = {
  tooltip: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    fontSize: 12,
    direction: 'rtl' as const,
  },
}

// ---------------------------------------------------------------------------
// شريط فلترة التاريخ للموبايل — يظهر فقط على الشاشات الصغيرة (md:hidden)
// يتيح الوصول لنطاق التاريخ دون الحاجة لهيدر سطح المكتب
// ---------------------------------------------------------------------------
function MobileDateFilter({
  from,
  to,
  setFrom,
  setTo,
}: {
  from: string
  to: string
  setFrom: (v: string) => void
  setTo: (v: string) => void
}) {
  const activePreset = detectPreset(from, to)
  const applyPreset = (p: DatePreset) => {
    const r = presetToRange(p)
    setFrom(r.from)
    setTo(r.to)
  }
  const hasRange = !!from || !!to
  return (
    <div className="md:hidden flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
      {/* أزرار البريسيت السريعة */}
      <div className="flex items-center gap-0.5 bg-secondary/60 rounded-lg p-0.5 shrink-0">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => applyPreset(p.key)}
            className={cn(
              'text-[11px] font-medium px-2.5 py-1.5 rounded-md transition-all whitespace-nowrap',
              activePreset === p.key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title={p.label}
          >
            {p.label}
          </button>
        ))}
      </div>
      {/* نطاق مخصص */}
      <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1 px-1.5 shrink-0">
        <Calendar className="size-3.5 text-muted-foreground shrink-0" />
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="text-[11px] bg-transparent border-0 outline-none px-0.5 py-1 w-[88px]"
          aria-label="من تاريخ"
        />
        <span className="text-muted-foreground text-xs shrink-0">→</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="text-[11px] bg-transparent border-0 outline-none px-0.5 py-1 w-[88px]"
          aria-label="إلى تاريخ"
        />
      </div>
      {hasRange && activePreset !== 'all' && (
        <button
          onClick={() => { setFrom(''); setTo('') }}
          className="size-7 rounded-md hover:bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
          title="مسح"
          aria-label="مسح"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// شريط الإجراءات السريعة — 3 أزرار كبيرة في أول الرئيسية توصل المستخدم
// لأهم عمليات الشغل اليومي مباشرة (تفتح الشاشة + النافذة جاهزة للإدخال)
// ---------------------------------------------------------------------------
export type QuickAction = 'new-shipment' | 'confirm-receipt' | 'new-payment'

const QUICK_ACTIONS: { key: QuickAction; label: string; hint: string; icon: React.ElementType; classes: string; chip: string }[] = [
  {
    key: 'new-shipment',
    label: 'تسجيل شحنة جديدة',
    hint: 'اكتب رقم الديليفري واختر المقاول',
    icon: PackagePlus,
    classes: 'border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 text-primary',
    chip: 'bg-primary/15 text-primary',
  },
  {
    key: 'confirm-receipt',
    label: 'تأكيد استلام إذن',
    hint: 'ابحث برقم الديليفري واضغط علامة ✓',
    icon: ClipboardCheck,
    classes: 'border-emerald-300/60 bg-emerald-500/5 hover:bg-emerald-500/10 hover:border-emerald-500/50 text-emerald-700 dark:text-emerald-300',
    chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  },
  {
    key: 'new-payment',
    label: 'تسجيل دفعة / مصروف',
    hint: 'تعتيق · مبيت · مرتجع · دفعة للمقاول',
    icon: Wallet,
    classes: 'border-amber-300/60 bg-amber-500/5 hover:bg-amber-500/10 hover:border-amber-500/50 text-amber-700 dark:text-amber-300',
    chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
]

function QuickActionBar({ onAction, can }: { onAction: (a: QuickAction) => void; can: Record<QuickAction, boolean> }) {
  const visible = QUICK_ACTIONS.filter((a) => can[a.key])
  if (!visible.length || !onAction) return null
  return (
    <div className={cn('grid gap-2.5 stagger', visible.length === 3 ? 'sm:grid-cols-3' : visible.length === 2 ? 'sm:grid-cols-2' : 'grid-cols-1')}>
      {visible.map((a) => {
        const Icon = a.icon
        return (
          <button
            key={a.key}
            onClick={() => onAction(a.key)}
            className={cn(
              'group flex items-center gap-3 rounded-2xl border-2 p-3.5 sm:p-4 text-right transition-all min-h-[68px] hover:shadow-md hover:-translate-y-0.5 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              a.classes,
            )}
            aria-label={a.label}
          >
            <span className={cn('flex items-center justify-center size-11 rounded-xl shrink-0 transition-transform group-hover:scale-110', a.chip)}>
              <Icon className="size-5.5" />
            </span>
            <span className="flex flex-col min-w-0">
              <span className="text-sm sm:text-[15px] font-bold leading-tight">{a.label}</span>
              <span className="text-[11px] opacity-75 truncate">{a.hint}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function DashboardModule({
  from,
  to,
  setFrom,
  setTo,
  onQuickAction,
  quickCan,
}: {
  from?: string
  to?: string
  setFrom?: (v: string) => void
  setTo?: (v: string) => void
  onQuickAction?: (action: QuickAction) => void
  quickCan?: Partial<Record<QuickAction, boolean>>
}) {
  const canPrices = useCanPrices()
  const qs = new URLSearchParams()
  if (from) qs.set('from', from)
  if (to) qs.set('to', to)
  const { data, error, isLoading } = useSWR<StatsResponse>(`/api/stats?${qs.toString()}`, fetcher, { refreshInterval: 30000 })

  // شريط فلترة التاريخ للموبايل — يظهر فقط على الشاشات الصغيرة (الهيدر الكامل مخفي)
  const mobileFilter = setFrom && setTo ? (
    <MobileDateFilter from={from ?? ''} to={to ?? ''} setFrom={setFrom} setTo={setTo} />
  ) : null

  if (isLoading) return (
    <div className="space-y-4">
      {mobileFilter}
      <DashboardSkeleton />
    </div>
  )
  if (error) {
    return (
      <div className="space-y-4">
        {mobileFilter}
        <Card>
          <CardContent className="py-10 text-center text-destructive">
            تعذّر تحميل البيانات: {error.message}
          </CardContent>
        </Card>
      </div>
    )
  }
  if (!data) return null

  const s = data.summary
  const dailyData = (data.daily ?? []).map((d) => ({ ...d, day: weekdayName(d.date), label: shortDate(d.date) }))
  const topDest = (data.destinations ?? []).slice(0, 10)
  const unitBreakdown = [
    { name: '1.5 طن', value: s.ton15Total, color: PIE_COLORS[0] },
    { name: '3 طن', value: s.ton3Total, color: PIE_COLORS[1] },
    { name: '6 م', value: s.m6Total, color: PIE_COLORS[2] },
  ].filter((u) => u.value > 0)

  // شحنات اليوم — الدلاء اليومية مفتاحها ثواني epoch (منطق الخادم:
  // Math.floor(shipmentDate/1000) لكل شحنة). نجمع الدلاء التي تقع بعد
  // منتصف الليل المحلي لليوم، فتطابق "شحنات اليوم" فعلًا لا آخر يوم في القاعدة.
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const todayStartSec = Math.floor(todayStart.getTime() / 1000)
  const todayShipments = (data.daily ?? []).reduce(
    (acc, d) => (Number(d.date) >= todayStartSec ? acc + d.count : acc), 0,
  )

  return (
    <div className="space-y-4">
      {/* شريط فلترة التاريخ للموبايل */}
      {mobileFilter}
      {/* === الإجراءات السريعة — أهم 3 عمليات يومية === */}
      {onQuickAction && (
        <QuickActionBar
          onAction={onQuickAction}
          can={{
            'new-shipment': quickCan?.['new-shipment'] ?? false,
            'confirm-receipt': quickCan?.['confirm-receipt'] ?? false,
            'new-payment': quickCan?.['new-payment'] ?? false,
          }}
        />
      )}
      {/* === المؤشرات الرئيسية (KPIs) === */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 stagger">
        <Kpi title="إجمالي الشحنات" value={fmtNum(s.totalShipments)} icon={Package} tone="primary"
          subtitle={`من ${shortDate(data.dateRange.from)} إلى ${shortDate(data.dateRange.to)}`} />
        {canPrices ? (
          <>
            <Kpi title="إيرادات النولون" value={fmtNum(s.totalFreight)} unit="ج.م" icon={Receipt} tone="teal"
              subtitle={`تحصيل العميل: ${fmtNum(s.totalCustomerPay)} ج.م`} />
            <Kpi title="تكلفة النولون" value={fmtNum(s.totalSuppliers)} unit="ج.م" icon={Banknote} tone="purple"
              subtitle="تكلفة المقاولين والموردين" />
            <Kpi title="صافي هامش النولون" value={fmtNum(s.netFreightMargin)} unit="ج.م" icon={s.netFreightMargin >= 0 ? TrendingUp : TrendingDown} tone="green"
              subtitle={`${s.netFreightMargin >= 0 ? 'ربح' : 'خسارة'} — إيرادات النولون − تكلفة الموردين`} />
          </>
        ) : (
          <>
            <Kpi title="مستلمة بالفرع" value={fmtNum(s.statusCounts?.received ?? 0)} icon={Package} tone="teal" subtitle="جاهزة للتحميل" />
            <Kpi title="خرجت للتوصيل" value={fmtNum(s.statusCounts?.assigned_courier ?? 0)} icon={Truck} tone="primary" subtitle="مع المندوبين" />
            <Kpi title="مرتجعة مستلمة" value={fmtNum(s.statusCounts?.received_returned ?? 0)} icon={Undo2} tone="green" subtitle="عادت للفرع" />
          </>
        )}
      </div>

      {/* === بطاقات الحالات === */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 stagger">
        <StatCard label="قيد التنفيذ" value={s.inTransit} icon={Truck} tone="indigo" />
        <StatCard label="مسلّمة" value={s.delivered} icon={Package} tone="emerald" />
        <StatCard label="مرتجعة" value={s.returned} icon={Undo2} tone="rose" />
        <StatCard label="متأخرة" value={s.delayed} icon={Clock} tone="amber" />
        <StatCard label="COD غير محصّل" value={s.codUncollected} icon={Wallet} tone="orange" />
        <StatCard label="إجمالي الوحدات" value={s.totalUnits} icon={Boxes} tone="teal" />
        <StatCard
          label={todayShipments > 0 ? 'شحنات اليوم' : 'لا شحنات اليوم'}
          value={todayShipments}
          icon={CalendarDays}
          tone="primary"
        />
      </div>

      {/* === مؤشرات مالية مصغّرة (فقط لمن يملك صلاحية الأسعار) === */}
      {canPrices && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
          <Mini label="التعتيق" value={fmtNum(s.totalAging)} icon={Clock} />
          <Mini label="المبيت" value={fmtNum(s.totalOvernight)} icon={Moon} />
          <Mini label="المرتجعات" value={fmtNum(s.totalReturns)} icon={Undo2} />
          <Mini label="التحويلة" value={fmtNum(s.totalTransfer)} icon={ArrowRightLeft} />
          <Mini label="مصاريف أخرى" value={fmtNum(s.totalOther + s.totalDrop)} icon={Wallet} />
        </div>
      )}

      {/* === الاتجاه اليومي + توزيع الأحجام === */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <DailyTrendChart data={dailyData} canPrices={canPrices} />
        </div>
        <UnitBreakdownChart data={unitBreakdown} />
      </div>

      {/* === أعلى الوجهات + توزيع الحالات === */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopDestinationsChart data={topDest} canPrices={canPrices} />
        <StatusBreakdown statusCounts={s.statusCounts} />
      </div>

      {/* === أداء المقاولين + التنبيهات === */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ContractorPerformance contractors={data.contractors ?? []} canPrices={canPrices} />
        <AlertsStrip summary={s} canPrices={canPrices} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// رسم الاتجاه اليومي (Area) — عدد الشحنات + قيمة النولون (للأسعار فقط)
// ---------------------------------------------------------------------------
function DailyTrendChart({ data, canPrices }: { data: any[]; canPrices: boolean }) {
  return (
    <Card className="h-full">
      <CardContent className="p-4 pt-3 h-full flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <div className="min-w-0">
            <div className="text-base font-semibold">الاتجاه اليومي للشحنات{canPrices ? ' والنولون' : ''}</div>
            <div className="text-xs text-muted-foreground">عدد الشحنات{canPrices ? ' وقيمة النولون' : ''} لكل يوم</div>
          </div>
          <CalendarDays className="size-5 text-muted-foreground shrink-0" />
        </div>
        <div className="flex-1 h-56 sm:h-64 md:h-72 w-full" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gCount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.55} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.05} />
                </linearGradient>
                {canPrices && (
                  <linearGradient id="gFreight" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0.05} />
                  </linearGradient>
                )}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
              {canPrices && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />}
              <Tooltip
                contentStyle={CHART_STYLE.tooltip}
                labelFormatter={(l: any) => { const item = data.find((d) => d.label === l); return item ? `${l} (${item.day})` : l }}
                formatter={(v: any, n: any) => [n === 'النولون' ? `${fmtNum(v)} ج.م` : `${fmtNum(v)}`, n]}
              />
              <Area yAxisId="left" type="monotone" dataKey="count" name="الشحنات" stroke="var(--chart-1)" strokeWidth={2} fill="url(#gCount)" />
              {canPrices && <Area yAxisId="right" type="monotone" dataKey="freight" name="النولون" stroke="var(--chart-2)" strokeWidth={2} fill="url(#gFreight)" />}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// توزيع الأحجام (Pie) — 1.5 طن / 3 طن / 6 م
// ---------------------------------------------------------------------------
function UnitBreakdownChart({ data }: { data: { name: string; value: number; color: string }[] }) {
  return (
    <Card className="h-full">
      <CardContent className="p-4 pt-3 h-full flex flex-col">
        <div className="mb-2">
          <div className="text-base font-semibold">توزيع الأحجام</div>
          <div className="text-xs text-muted-foreground">عدد الوحدات حسب نوع الشاحنة</div>
        </div>
        {data.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">لا توجد بيانات</div>
        ) : (
          <>
            <div className="h-40 sm:h-44" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={2}>
                    {data.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={CHART_STYLE.tooltip} formatter={(v: any) => [`${fmtNum(v)} وحدة`, '']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 space-y-1.5">
              {data.map((u) => (
                <div key={u.name} className="flex items-center gap-2 text-sm">
                  <span className="size-3 rounded-full" style={{ background: u.color }} />
                  <span className="flex-1 text-muted-foreground">{u.name}</span>
                  <span className="font-semibold tnum">{fmtNum(u.value)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// أعلى الوجهات (Bar) — حسب النولون (للأسعار) أو العدد (لغير المصرح)
// ---------------------------------------------------------------------------
function TopDestinationsChart({ data, canPrices }: { data: any[]; canPrices: boolean }) {
  if (canPrices) {
    return (
      <Card className="h-full">
        <CardContent className="p-4 pt-3 h-full flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-base font-semibold">أعلى الوجهات (النولون)</div>
              <div className="text-xs text-muted-foreground">إجمالي النولون حسب المدينة</div>
            </div>
            <MapPin className="size-5 text-muted-foreground shrink-0" />
          </div>
          <div className="flex-1 h-56 sm:h-64 md:h-72" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <YAxis dataKey="name" type="category" width={85} tick={{ fontSize: 11, fill: 'var(--foreground)' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={CHART_STYLE.tooltip} formatter={(v: any, n: any) => [`${fmtNum(v)} ج.م`, n === 'freight' ? 'النولون' : 'العدد']} />
                <Bar dataKey="freight" name="النولون" fill="var(--chart-1)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    )
  }
  // بديل لغير المصرح لهم برؤية الأسعار: رسم العدد بدل النولون
  return (
    <Card className="h-full">
      <CardContent className="p-4 pt-3 h-full flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-base font-semibold">أعلى الوجهات (عدد الشحنات)</div>
            <div className="text-xs text-muted-foreground">عدد الشحنات حسب المدينة</div>
          </div>
          <MapPin className="size-5 text-muted-foreground shrink-0" />
        </div>
        <div className="flex-1 h-56 sm:h-64 md:h-72" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
              <YAxis dataKey="name" type="category" width={85} tick={{ fontSize: 11, fill: 'var(--foreground)' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={CHART_STYLE.tooltip} formatter={(v: any) => [`${fmtNum(v)} شحنة`, 'العدد']} />
              <Bar dataKey="count" name="العدد" fill="var(--chart-1)" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// توزيع حالات الشحنات (شبكة بطاقات ملوّنة)
// ---------------------------------------------------------------------------
function StatusBreakdown({ statusCounts }: { statusCounts: Record<string, number> }) {
  const entries = Object.entries(statusCounts).filter(([, v]) => v > 0)
  return (
    <Card className="h-full">
      <CardContent className="p-4 pt-3 h-full flex flex-col">
        <div className="mb-2">
          <div className="text-base font-semibold">توزيع حالات الشحنات</div>
          <div className="text-xs text-muted-foreground">عدد الشحنات حسب الحالة</div>
        </div>
        {entries.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">لا توجد شحنات</div>
        ) : (
          <div className="grid grid-cols-2 gap-2 flex-1 content-start">
            {entries.map(([status, count]) => {
              const meta = SHIPMENT_STATUS[status] || { label: status, tone: 'bg-gray-100 text-gray-700' }
              return (
                <div key={status} className={cn('rounded-lg p-3 flex items-center justify-between', meta.tone)}>
                  <span className="text-sm font-medium">{meta.label}</span>
                  <span className="text-lg font-bold tnum">{fmtNum(count)}</span>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// أداء المقاولين (قائمة + شريط تقدّم) — النولون فقط لمن يملك الأسعار
// ---------------------------------------------------------------------------
function ContractorPerformance({ contractors, canPrices }: { contractors: any[]; canPrices: boolean }) {
  return (
    <Card className="h-full">
      <CardContent className="p-4 pt-3 h-full flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <div className="min-w-0">
            <div className="text-base font-semibold">أداء المقاولين</div>
            <div className="text-xs text-muted-foreground">عدد الشحنات{canPrices ? ' وإجمالي النولون' : ''} لكل مقاول</div>
          </div>
          <UserCog className="size-5 text-muted-foreground shrink-0" />
        </div>
        {contractors.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">لا يوجد مقاولون</div>
        ) : (
          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
            {contractors.slice(0, 12).map((c, i) => {
              const max = contractors[0]?.count || 1
              const pct = (c.count / max) * 100
              return (
                <div key={`${c.name}-${i}`} className="flex items-center gap-3">
                  <Badge variant="outline" className="tnum shrink-0 w-6 justify-center">{i + 1}</Badge>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm truncate" title={c.name}>{c.name}</span>
                      <span className="text-xs text-muted-foreground tnum whitespace-nowrap">{fmtNum(c.count)} شحنة</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    </div>
                  </div>
                  {canPrices && <span className="text-xs font-semibold tnum w-20 text-left whitespace-nowrap">{fmtNum(c.freight)} ج.م</span>}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// شريط التنبيهات — متأخرة + مرتجعة + (للأسعار فقط) إجمالي النولون
// ---------------------------------------------------------------------------
function AlertsStrip({ summary, canPrices }: { summary: any; canPrices: boolean }) {
  const s = summary
  const alerts: { tone: 'amber' | 'rose' | 'sky' | 'emerald'; icon: React.ElementType; content: React.ReactNode }[] = []
  if (s.delayed > 0) {
    alerts.push({
      tone: 'amber', icon: Clock,
      content: <span><b className="tnum">{fmtNum(s.delayed)}</b> شحنة متأخرة عن موعد التسليم المتوقع</span>,
    })
  }
  if (s.returned > 0) {
    alerts.push({
      tone: 'rose', icon: Undo2,
      content: <span><b className="tnum">{fmtNum(s.returned)}</b> شحنة مرتجعة تحتاج مراجعة</span>,
    })
  }
  if (canPrices) {
    alerts.push({
      tone: 'sky', icon: Receipt,
      content: <span>إجمالي النولون: <b className="tnum">{fmtNum(s.totalFreight)} ج.م</b> — تحصيل: <b className="tnum">{fmtNum(s.totalCustomerPay)} ج.م</b></span>,
    })
    if (s.netFreightMargin < 0) {
      alerts.push({
        tone: 'rose', icon: TrendingDown,
        content: <span>هامش النولون سالب — راجع التسعير</span>,
      })
    }
  } else {
    alerts.push({
      tone: 'sky', icon: Package,
      content: <span>توجد <b className="tnum">{fmtNum(s.totalShipments)}</b> شحنة في النظام — تابع التفاصيل في وحدة الشحنات</span>,
    })
  }
  // إذا كل المؤشرات سليمة
  const allClear = s.delayed === 0 && s.returned === 0 && (!canPrices || s.netFreightMargin >= 0)
  if (allClear) {
    alerts.push({
      tone: 'emerald', icon: TrendingUp,
      content: <span>كل المؤشرات سليمة — لا توجد تنبيهات حرجة</span>,
    })
  }
  return (
    <Card className="h-full">
      <CardContent className="p-4 pt-3 h-full flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <div className="min-w-0">
            <div className="text-base font-semibold">التنبيهات والإجراءات</div>
            <div className="text-xs text-muted-foreground">إجراءات مقترحة</div>
          </div>
          <AlertCircle className="size-5 text-amber-500 shrink-0" />
        </div>
        <div className="space-y-2 flex-1">
          {alerts.map((a, i) => (
            <Alert key={i} tone={a.tone} icon={a.icon}>{a.content}</Alert>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// الهيكل العظمي أثناء التحميل
// ---------------------------------------------------------------------------
function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">{[0, 1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Skeleton className="h-72 rounded-xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  )
}
