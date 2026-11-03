'use client'

import * as React from 'react'
import useSWR from 'swr'
import {
  Truck,
  Package,
  Banknote,
  Receipt,
  Clock,
  Moon,
  Undo2,
  ArrowRightLeft,
  Boxes,
  Users,
  MapPin,
  UserCog,
  TrendingUp,
  CalendarDays,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { fmtNum, shortDate, weekdayName } from '@/lib/format'
import { cn } from '@/lib/utils'

import { fetcher } from '@/lib/api'

interface StatsResponse {
  summary: {
    totalShipments: number
    totalUnits: number
    totalFreight: number
    totalCustomerPay: number
    totalSuppliers: number
    totalAging: number
    totalOvernight: number
    totalReturns: number
    totalTransfer: number
    totalOther: number
    totalDrop: number
    ton15Total: number
    ton3Total: number
    m6Total: number
  }
  daily: { date: string; count: number; freight: number; suppliers: number; customerPay: number }[]
  destinations: { name: string; count: number; freight: number; suppliers: number }[]
  contractors: { name: string; count: number; freight: number; suppliers: number }[]
  codings: { name: string; count: number; freight: number }[]
  customers: { name: string; count: number; freight: number; suppliers: number }[]
  dateRange: { from: string | null; to: string | null }
}

const PIE_COLORS = ['#e8902a', '#1e9e8a', '#7a5bd6', '#5eb04a', '#d9532f', '#2c8fb8', '#c98d3b']

export function OverviewTab({ from, to }: { from?: string; to?: string }) {
  const qs = new URLSearchParams()
  if (from) qs.set('from', from)
  if (to) qs.set('to', to)
  const { data, error, isLoading } = useSWR<StatsResponse>(`/api/stats?${qs.toString()}`, fetcher, {
    refreshInterval: 30000,
  })

  if (isLoading) return <OverviewSkeleton />
  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-destructive">
          تعذّر تحميل البيانات. تأكد أن قاعدة البيانات مهيأة.
        </CardContent>
      </Card>
    )
  }
  if (!data) return null

  const s = data.summary
  const avgFreightPerShipment = s.totalShipments ? s.totalFreight / s.totalShipments : 0
  const revenue = s.totalSuppliers

  // Daily chart data
  const dailyData = (data.daily ?? []).map((d) => ({
    ...d,
    day: weekdayName(d.date),
    label: shortDate(d.date),
  }))

  // Top destinations (by freight) - top 8
  const topDest = (data.destinations ?? []).slice(0, 8)
  const otherDestFreight = (data.destinations ?? []).slice(8).reduce((a, b) => a + b.freight, 0)
  const destPie = [
    ...topDest.map((d) => ({ name: d.name, value: d.freight })),
    ...(otherDestFreight > 0 ? [{ name: 'أخرى', value: otherDestFreight }] : []),
  ]

  // Unit breakdown (1.5 TON / 3 TON / 6 M)
  const unitBreakdown = [
    { name: '1.5 طن', value: s.ton15Total, color: PIE_COLORS[0] },
    { name: '3 طن', value: s.ton3Total, color: PIE_COLORS[1] },
    { name: '6 متر', value: s.m6Total, color: PIE_COLORS[2] },
  ].filter((u) => u.value > 0)

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <KpiCard
          title="إجمالي الشحنات"
          value={fmtNum(s.totalShipments)}
          icon={Package}
          tone="primary"
          subtitle={`من ${shortDate(data.dateRange.from)} إلى ${shortDate(data.dateRange.to)}`}
        />
        <KpiCard
          title="إجمالي الوحدات"
          value={fmtNum(s.totalUnits, 0)}
          icon={Boxes}
          tone="teal"
          subtitle={`1.5طن: ${fmtNum(s.ton15Total)} • 3طن: ${fmtNum(s.ton3Total)} • 6م: ${fmtNum(s.m6Total)}`}
        />
        <KpiCard
          title="إجمالي النولون"
          value={fmtNum(s.totalFreight)}
          unit="ج.م"
          icon={Receipt}
          tone="purple"
          subtitle={`متوسط ${fmtNum(avgFreightPerShipment, 0)} ج.م / شحنة`}
        />
        <KpiCard
          title="إجمالي الموردين"
          value={fmtNum(revenue)}
          unit="ج.م"
          icon={Banknote}
          tone="green"
          subtitle={`تحصيل العميل: ${fmtNum(s.totalCustomerPay)} ج.م`}
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-3">
        <MiniStat label="التغريم (تعتيق)" value={fmtNum(s.totalAging)} icon={Clock} />
        <MiniStat label="مبيت" value={fmtNum(s.totalOvernight)} icon={Moon} />
        <MiniStat label="مرتجعات" value={fmtNum(s.totalReturns)} icon={Undo2} />
        <MiniStat label="تحويلة" value={fmtNum(s.totalTransfer)} icon={ArrowRightLeft} />
        <MiniStat label="أخرى / Drop" value={fmtNum(s.totalOther + s.totalDrop)} icon={Truck} />
      </div>

      {/* Daily shipments chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">الشحنات اليومية</CardTitle>
                <CardDescription>عدد الشحنات والنولون لكل يوم</CardDescription>
              </div>
              <CalendarDays className="size-5 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full" dir="ltr">
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
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--card)',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      fontSize: 12,
                      direction: 'rtl',
                    }}
                    labelStyle={{ fontWeight: 600, color: 'var(--foreground)' }}
                    formatter={(value: any, name: any) => {
                      const isFreight = name === 'النولون'
                      return [
                        isFreight ? `${fmtNum(value)} ج.م` : `${fmtNum(value)}`,
                        name,
                      ]
                    }}
                    labelFormatter={(l: any) => {
                      const item = dailyData.find((d) => d.label === l)
                      return item ? `${l} (${item.day})` : l
                    }}
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="count"
                    name="الشحنات"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    fill="url(#gCount)"
                  />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="freight"
                    name="النولون"
                    stroke="var(--chart-2)"
                    strokeWidth={2}
                    fill="url(#gFreight)"
                  />
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
            <div className="h-44" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={unitBreakdown}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={42}
                    outerRadius={70}
                    paddingAngle={2}
                  >
                    {unitBreakdown.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'var(--card)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      fontSize: 12,
                      direction: 'rtl',
                    }}
                    formatter={(v: any) => [`${fmtNum(v)} وحدة`, '']}
                  />
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

      {/* Top destinations chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">أعلى الوجهات (النولون)</CardTitle>
                <CardDescription>إجمالي النولون حسب المدينة الوجهة</CardDescription>
              </div>
              <MapPin className="size-5 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-72" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.destinations.slice(0, 10).map((d) => ({ ...d, short: d.name }))}
                  layout="vertical"
                  margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  />
                  <YAxis
                    dataKey="short"
                    type="category"
                    width={85}
                    tick={{ fontSize: 11, fill: 'var(--foreground)' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--card)',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      fontSize: 12,
                      direction: 'rtl',
                    }}
                    formatter={(v: any, n: any) => [`${fmtNum(v)} ج.م`, n === 'freight' ? 'النولون' : 'العدد']}
                  />
                  <Bar dataKey="freight" name="النولون" fill="var(--chart-1)" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">توزيع النولون</CardTitle>
            <CardDescription>حسب الوجهة</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-44" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={destPie} dataKey="value" nameKey="name" outerRadius={70}>
                    {destPie.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'var(--card)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      fontSize: 12,
                      direction: 'rtl',
                    }}
                    formatter={(v: any) => [`${fmtNum(v)} ج.م`, '']}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Contractors + Top customers */}
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
              {(data.contractors ?? []).map((c, i) => {
                const max = data.contractors?.[0]?.count || 1
                const pct = (c.count / max) * 100
                return (
                  <div key={c.name} className="flex items-center gap-3">
                    <Badge variant="outline" className="tnum shrink-0 w-6 justify-center">{i + 1}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm truncate">{c.name}</span>
                        <span className="text-xs text-muted-foreground tnum whitespace-nowrap">
                          {fmtNum(c.count)} شحنة
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, background: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                      </div>
                    </div>
                    <span className="text-xs font-semibold tnum w-20 text-left whitespace-nowrap">
                      {fmtNum(c.freight)} ج.م
                    </span>
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
                <CardTitle className="text-base">أعلى العملاء</CardTitle>
                <CardDescription>حسب إجمالي الموردين</CardDescription>
              </div>
              <Users className="size-5 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {data.customers.slice(0, 12).map((c, i) => (
                <div key={c.name + i} className="flex items-center gap-3 py-1.5 border-b last:border-0 border-border/60">
                  <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary text-xs font-bold shrink-0 tnum">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{c.name}</div>
                    <div className="text-[11px] text-muted-foreground tnum">
                      {fmtNum(c.count)} شحنة • نولون {fmtNum(c.freight)} ج.م
                    </div>
                  </div>
                  <div className="text-left shrink-0">
                    <div className="font-bold text-sm tnum">{fmtNum(c.suppliers)}</div>
                    <div className="text-[10px] text-muted-foreground">ج.م</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function KpiCard({
  title,
  value,
  unit,
  icon: Icon,
  tone,
  subtitle,
}: {
  title: string
  value: string
  unit?: string
  icon: React.ElementType
  tone: 'primary' | 'teal' | 'purple' | 'green'
  subtitle?: string
}) {
  const tones: Record<string, string> = {
    primary: 'bg-primary/10 text-primary',
    teal: 'bg-teal-500/10 text-teal-600 dark:text-teal-300',
    purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-300',
    green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  }
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground font-medium">{title}</div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-2xl md:text-3xl font-bold tnum tracking-tight">{value}</span>
              {unit && <span className="text-xs text-muted-foreground font-medium">{unit}</span>}
            </div>
            {subtitle && <div className="mt-1 text-[11px] text-muted-foreground line-clamp-2 leading-snug">{subtitle}</div>}
          </div>
          <div className={cn('flex items-center justify-center size-10 md:size-12 rounded-xl shrink-0', tones[tone])}>
            <Icon className="size-5 md:size-6" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function MiniStat({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-2.5">
        <div className="flex items-center justify-center size-8 rounded-lg bg-secondary text-secondary-foreground shrink-0">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground leading-tight truncate">{label}</div>
          <div className="text-base font-bold tnum leading-tight">{value}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function OverviewSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Skeleton className="h-96 rounded-xl lg:col-span-2" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  )
}
