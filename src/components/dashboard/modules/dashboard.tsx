'use client'

import * as React from 'react'
import useSWR from 'swr'
import {
  Package, Banknote, Receipt, TrendingUp, TrendingDown,
  Truck, Clock, Moon, Undo2, ArrowRightLeft, Boxes,
  Users, MapPin, UserCog, CalendarDays, Wallet, AlertCircle,
} from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { fmtNum, shortDate, weekdayName, SHIPMENT_STATUS } from '@/lib/format'
import { cn } from '@/lib/utils'
import { fetcher } from '@/lib/api'

const PIE_COLORS = ['#e8902a', '#1e9e8a', '#7a5bd6', '#5eb04a', '#d9532f', '#2c8fb8', '#c98d3b']

interface StatsResponse {
  summary: {
    totalShipments: number; totalUnits: number; totalFreight: number;
    totalCustomerPay: number; totalSuppliers: number; totalSale: number;
    netFreightMargin: number; totalAging: number; totalOvernight: number;
    totalReturns: number; totalTransfer: number; totalOther: number; totalDrop: number;
    ton15Total: number; ton3Total: number; m6Total: number;
    inTransit: number; delivered: number; returned: number; delayed: number;
    statusCounts: Record<string, number>
  }
  daily: { date: string; count: number; freight: number; suppliers: number; customerPay: number }[]
  destinations: { name: string; count: number; freight: number; suppliers: number }[]
  contractors: { name: string; count: number; freight: number; suppliers: number }[]
  codings: { name: string; count: number; freight: number }[]
  dateRange: { from: string | null; to: string | null }
}

export function DashboardModule({ from, to }: { from?: string; to?: string }) {
  const qs = new URLSearchParams()
  if (from) qs.set('from', from)
  if (to) qs.set('to', to)
  const { data, error, isLoading } = useSWR<StatsResponse>(`/api/stats?${qs.toString()}`, fetcher, { refreshInterval: 30000 })

  if (isLoading) return <DashboardSkeleton />
  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-destructive">
          تعذّر تحميل البيانات: {error.message}
        </CardContent>
      </Card>
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

  return (
    <div className="space-y-4">
      {/* Primary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 md:gap-3 stagger">
        <Kpi title="إجمالي الشحنات" value={fmtNum(s.totalShipments)} icon={Package} tone="primary"
          subtitle={`من ${shortDate(data.dateRange.from)} إلى ${shortDate(data.dateRange.to)}`} />
        <Kpi title="إيرادات النولون" value={fmtNum(s.totalFreight)} unit="ج.م" icon={Receipt} tone="teal"
          subtitle={`تحصيل العميل: ${fmtNum(s.totalCustomerPay)} ج.م`} />
        <Kpi title="تكلفة النولون" value={fmtNum(s.totalSuppliers)} unit="ج.م" icon={Banknote} tone="purple"
          subtitle={`تكلفة المقاولين والموردين`} />
        <Kpi title="صافي هامش النولون" value={fmtNum(s.netFreightMargin)} unit="ج.م" icon={s.netFreightMargin >= 0 ? TrendingUp : TrendingDown} tone="green"
          subtitle={s.netFreightMargin >= 0 ? 'ربح' : 'خسارة'} />
      </div>

      {/* Status counts — horizontal compact cards (grid-cols-6 on lg, 3 on sm, 2 on mobile) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 stagger">
        <StatusCard label="قيد التنفيذ" value={s.inTransit} icon={Truck} tone="indigo" />
        <StatusCard label="مسلّمة" value={s.delivered} icon={Package} tone="emerald" />
        <StatusCard label="مرتجعة" value={s.returned} icon={Undo2} tone="rose" />
        <StatusCard label="متأخرة" value={s.delayed} icon={Clock} tone="amber" />
        <StatusCard label="إجمالي الوحدات" value={s.totalUnits} icon={Boxes} tone="teal" />
        <StatusCard label="شحنات اليوم" value={data.daily[data.daily.length - 1]?.count ?? 0} icon={CalendarDays} tone="primary" />
      </div>

      {/* Mini financial stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
        <Mini label="التعتيق" value={fmtNum(s.totalAging)} icon={Clock} />
        <Mini label="المبيت" value={fmtNum(s.totalOvernight)} icon={Moon} />
        <Mini label="المرتجعات" value={fmtNum(s.totalReturns)} icon={Undo2} />
        <Mini label="التحويلة" value={fmtNum(s.totalTransfer)} icon={ArrowRightLeft} />
        <Mini label="مصاريف أخرى" value={fmtNum(s.totalOther + s.totalDrop)} icon={Wallet} />
      </div>

      {/* Daily chart + unit breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">الاتجاه اليومي للشحنات والنولون</CardTitle>
                <CardDescription>عدد الشحنات وقيمة النولون لكل يوم</CardDescription>
              </div>
              <CalendarDays className="size-5 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-56 sm:h-64 md:h-72 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gCount" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.55} />
                      <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="gFreight" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.45} />
                      <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12, direction: 'rtl' }}
                    labelFormatter={(l: any) => { const item = dailyData.find((d) => d.label === l); return item ? `${l} (${item.day})` : l }}
                    formatter={(v: any, n: any) => [n === 'النولون' ? `${fmtNum(v)} ج.م` : `${fmtNum(v)}`, n]}
                  />
                  <Area yAxisId="left" type="monotone" dataKey="count" name="الشحنات" stroke="var(--chart-1)" strokeWidth={2} fill="url(#gCount)" />
                  <Area yAxisId="right" type="monotone" dataKey="freight" name="النولون" stroke="var(--chart-2)" strokeWidth={2} fill="url(#gFreight)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">توزيع الأحجام</CardTitle>
            <CardDescription>عدد الوحدات حسب نوع الشاحنة</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-40 sm:h-44" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={unitBreakdown} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={2}>
                    {unitBreakdown.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, direction: 'rtl' }} formatter={(v: any) => [`${fmtNum(v)} وحدة`, '']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 space-y-1.5">
              {unitBreakdown.map((u) => (
                <div key={u.name} className="flex items-center gap-2 text-sm">
                  <span className="size-3 rounded-full" style={{ background: u.color }} />
                  <span className="flex-1 text-muted-foreground">{u.name}</span>
                  <span className="font-semibold tnum">{fmtNum(u.value)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top destinations bar + status breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">أعلى الوجهات (النولون)</CardTitle>
                <CardDescription>إجمالي النولون حسب المدينة</CardDescription>
              </div>
              <MapPin className="size-5 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-56 sm:h-64 md:h-72" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topDest} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <YAxis dataKey="name" type="category" width={85} tick={{ fontSize: 11, fill: 'var(--foreground)' }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12, direction: 'rtl' }} formatter={(v: any, n: any) => [`${fmtNum(v)} ج.م`, n === 'freight' ? 'النولون' : 'العدد']} />
                  <Bar dataKey="freight" name="النولون" fill="var(--chart-1)" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">توزيع حالات الشحنات</CardTitle>
            <CardDescription>عدد الشحنات حسب الحالة</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(s.statusCounts).filter(([, v]) => v > 0).map(([status, count]) => {
                const meta = SHIPMENT_STATUS[status] || { label: status, tone: 'bg-gray-100 text-gray-700' }
                return (
                  <div key={status} className={cn('rounded-lg p-3 flex items-center justify-between', meta.tone)}>
                    <span className="text-sm font-medium">{meta.label}</span>
                    <span className="text-lg font-bold tnum">{fmtNum(count)}</span>
                  </div>
                )
              })}
              {Object.keys(s.statusCounts).length === 0 && (
                <div className="col-span-2 text-center py-8 text-muted-foreground text-sm">لا توجد شحنات</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Contractors + alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">أداء المقاولين</CardTitle>
                <CardDescription>عدد الشحنات وإجمالي النولون لكل مقاول</CardDescription>
              </div>
              <UserCog className="size-5 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {(data.contractors ?? []).slice(0, 12).map((c, i) => {
                const max = data.contractors?.[0]?.count || 1
                const pct = (c.count / max) * 100
                return (
                  <div key={c.name} className="flex items-center gap-3">
                    <Badge variant="outline" className="tnum shrink-0 w-6 justify-center">{i + 1}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm truncate">{c.name}</span>
                        <span className="text-xs text-muted-foreground tnum whitespace-nowrap">{fmtNum(c.count)} شحنة</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      </div>
                    </div>
                    <span className="text-xs font-semibold tnum w-20 text-left whitespace-nowrap">{fmtNum(c.freight)} ج.م</span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">التنبيهات والإجراءات</CardTitle>
                <CardDescription>إجراءات مقترحة</CardDescription>
              </div>
              <AlertCircle className="size-5 text-amber-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {s.delayed > 0 && (
                <Alert tone="amber" icon={Clock}>
                  <span><b className="tnum">{fmtNum(s.delayed)}</b> شحنة متأخرة عن موعد التسليم المتوقع</span>
                </Alert>
              )}
              {s.returned > 0 && (
                <Alert tone="rose" icon={Undo2}>
                  <span><b className="tnum">{fmtNum(s.returned)}</b> شحنة مرتجعة تحتاج مراجعة</span>
                </Alert>
              )}
              <Alert tone="sky" icon={Receipt}>
                <span>إجمالي النولون: <b className="tnum">{fmtNum(s.totalFreight)} ج.م</b> — تحصيل: <b className="tnum">{fmtNum(s.totalCustomerPay)} ج.م</b></span>
              </Alert>
              {s.netFreightMargin < 0 && (
                <Alert tone="rose" icon={TrendingDown}>
                  <span>هامش النولون سالب — راجع التسعير</span>
                </Alert>
              )}
              {s.delayed === 0 && s.returned === 0 && s.netFreightMargin >= 0 && (
                <Alert tone="emerald" icon={TrendingUp}>
                  <span>كل المؤشرات سليمة — لا توجد تنبيهات حرجة</span>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Kpi({ title, value, unit, icon: Icon, tone, subtitle }: { title: string; value: string; unit?: string; icon: React.ElementType; tone: string; subtitle?: string }) {
  // Tone definitions with dark: variants for full light/dark support
  const tones: Record<string, { wrap: string; icon: string; glow: string }> = {
    primary: {
      wrap: 'from-primary/15 to-primary/5 dark:from-primary/20 dark:to-primary/10',
      icon: 'bg-gradient-to-br from-primary to-primary/70 text-primary-foreground',
      glow: 'shadow-[0_8px_24px_-8px_var(--primary)]',
    },
    teal: {
      wrap: 'from-teal-500/15 to-teal-500/5 dark:from-teal-500/20 dark:to-teal-500/10',
      icon: 'bg-gradient-to-br from-teal-500 to-teal-600 text-white dark:from-teal-400 dark:to-teal-500',
      glow: 'shadow-[0_8px_24px_-8px_oklch(0.6_0.13_170)]',
    },
    purple: {
      wrap: 'from-purple-500/15 to-purple-500/5 dark:from-purple-500/20 dark:to-purple-500/10',
      icon: 'bg-gradient-to-br from-purple-500 to-purple-600 text-white dark:from-purple-400 dark:to-purple-500',
      glow: 'shadow-[0_8px_24px_-8px_oklch(0.62_0.19_295)]',
    },
    green: {
      wrap: 'from-emerald-500/15 to-emerald-500/5 dark:from-emerald-500/20 dark:to-emerald-500/10',
      icon: 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white dark:from-emerald-400 dark:to-emerald-500',
      glow: 'shadow-[0_8px_24px_-8px_oklch(0.7_0.18_145)]',
    },
  }
  const t = tones[tone] || tones.primary
  return (
    <Card className={cn('relative overflow-hidden hover-lift group min-w-0 border-border py-0 gap-0', `bg-gradient-to-br ${t.wrap}`)}>
      <CardContent className="p-3.5 sm:p-4 relative z-10">
        {/* flex justify-between items-center — right=info, left=icon (RTL) */}
        <div className="flex justify-between items-center gap-3">
          {/* ── Right side (RTL): title + bold value + subtitle ── */}
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="text-xs text-muted-foreground font-medium truncate-1">{title}</div>
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span className="kpi-value font-bold tnum tracking-tight num-ltr text-foreground">{value}</span>
              {unit && <span className="text-xs text-muted-foreground font-medium shrink-0">{unit}</span>}
            </div>
            {subtitle && <div className="text-[11px] text-muted-foreground/80 truncate-2 leading-snug">{subtitle}</div>}
          </div>
          {/* ── Left side (RTL): rounded background with icon ── */}
          <div className={cn(
            'flex items-center justify-center size-10 sm:size-11 rounded-2xl shrink-0 transition-transform group-hover:scale-105',
            t.icon, t.glow,
          )}>
            <Icon className="size-5 sm:size-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function StatusCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: React.ElementType; tone: string }) {
  const tones: Record<string, string> = {
    indigo: 'text-indigo-600 dark:text-indigo-300 bg-indigo-500/10 dark:bg-indigo-500/20',
    emerald: 'text-emerald-600 dark:text-emerald-300 bg-emerald-500/10 dark:bg-emerald-500/20',
    rose: 'text-rose-600 dark:text-rose-300 bg-rose-500/10 dark:bg-rose-500/20',
    amber: 'text-amber-600 dark:text-amber-300 bg-amber-500/10 dark:bg-amber-500/20',
    teal: 'text-teal-600 dark:text-teal-300 bg-teal-500/10 dark:bg-teal-500/20',
    primary: 'text-primary bg-primary/10 dark:bg-primary/20',
  }
  return (
    <Card className="hover-lift min-w-0 border-border py-0 gap-0">
      <CardContent className="px-3 py-2.5 flex items-center gap-2.5">
        {/* Compact icon on the right (RTL) */}
        <div className={cn('flex items-center justify-center size-8 rounded-lg shrink-0', tones[tone])}>
          <Icon className="size-4" />
        </div>
        {/* Value + label stacked compactly on the left */}
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold tnum leading-tight num-ltr text-foreground truncate-1">{fmtNum(value)}</div>
          <div className="text-[11px] text-muted-foreground leading-tight truncate-1">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function Mini({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
  return (
    <Card className="hover-lift min-w-0 py-0 gap-0">
      <CardContent className="p-2.5 sm:p-3 flex items-center gap-2 sm:gap-2.5">
        <div className="flex items-center justify-center size-7 sm:size-8 rounded-lg bg-secondary text-secondary-foreground shrink-0">
          <Icon className="size-3.5 sm:size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] sm:text-[11px] text-muted-foreground leading-tight truncate-1">{label}</div>
          <div className="text-sm sm:text-base font-bold tnum leading-tight num-ltr">{value}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function Alert({ tone, icon: Icon, children }: { tone: string; icon: React.ElementType; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    amber: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200 border-amber-200 dark:border-amber-900',
    rose: 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200 border-rose-200 dark:border-rose-900',
    sky: 'bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200 border-sky-200 dark:border-sky-900',
    emerald: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 border-emerald-200 dark:border-emerald-900',
  }
  return (
    <div className={cn('rounded-lg border px-3 py-2.5 flex items-center gap-2 text-sm', tones[tone])}>
      <Icon className="size-4 shrink-0" />
      <span className="flex-1">{children}</span>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">{[0,1,2,3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">{[0,1,2,3,4,5].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">{[0,1,2,3,4].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Skeleton className="h-72 rounded-xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  )
}
