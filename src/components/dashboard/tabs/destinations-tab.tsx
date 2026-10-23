'use client'

import * as React from 'react'
import useSWR from 'swr'
import { MapPin, ArrowUpRight, TrendingUp } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtNum } from '@/lib/format'

import { fetcher } from '@/lib/api'

interface StatsResponse {
  destinations: { name: string; count: number; freight: number; suppliers: number }[]
}

export function DestinationsTab() {
  const { data, isLoading } = useSWR<StatsResponse>('/api/stats', fetcher)
  const destinations = React.useMemo(() => {
    if (!data) return []
    return [...data.destinations].sort((a, b) => b.freight - a.freight)
  }, [data])

  const maxFreight = destinations[0]?.freight ?? 1
  const totalCount = destinations.reduce((a, b) => a + b.count, 0)
  const totalFreight = destinations.reduce((a, b) => a + b.freight, 0)

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">عدد الوجهات</div>
            <div className="mt-1 text-2xl font-bold tnum">{fmtNum(destinations.length)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">إجمالي الشحنات</div>
            <div className="mt-1 text-2xl font-bold tnum">{fmtNum(totalCount)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">إجمالي النولون</div>
            <div className="mt-1 text-2xl font-bold tnum">{fmtNum(totalFreight)}</div>
            <div className="text-[11px] text-muted-foreground">ج.م</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">متوسط النولون</div>
            <div className="mt-1 text-2xl font-bold tnum">
              {fmtNum(totalCount ? totalFreight / totalCount : 0)}
            </div>
            <div className="text-[11px] text-muted-foreground">ج.م / شحنة</div>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">الوجهات الأعلى نشاطاً</CardTitle>
              <CardDescription>عدد الشحنات لكل مدينة</CardDescription>
            </div>
            <TrendingUp className="size-5 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-80" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={destinations.slice(0, 12)} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
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
                  formatter={(v: any, n: any) => [v, n === 'count' ? 'الشحنات' : 'النولون']}
                />
                <Bar dataKey="count" name="الشحنات" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Detailed list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">جدول الوجهات التفصيلي</CardTitle>
          <CardDescription>الوجهات مرتبة حسب النولون</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground sticky top-0">
                  <tr className="text-right">
                    <th className="font-medium px-3 py-2.5">#</th>
                    <th className="font-medium px-3 py-2.5">الوجهة</th>
                    <th className="font-medium px-3 py-2.5 text-center">عدد الشحنات</th>
                    <th className="font-medium px-3 py-2.5 text-left">النولون</th>
                    <th className="font-medium px-3 py-2.5 text-left">الموردين</th>
                    <th className="font-medium px-3 py-2.5">الحصة</th>
                  </tr>
                </thead>
                <tbody>
                  {destinations.map((d, i) => (
                    <tr key={d.name} className="border-t border-border hover:bg-muted/40">
                      <td className="px-3 py-2.5 text-xs text-muted-foreground tnum">{i + 1}</td>
                      <td className="px-3 py-2.5 font-medium">
                        <div className="flex items-center gap-2">
                          <MapPin className="size-3.5 text-muted-foreground" />
                          {d.name}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center tnum">
                        <Badge variant="outline" className="tnum">{fmtNum(d.count)}</Badge>
                      </td>
                      <td className="px-3 py-2.5 text-left font-bold tnum">{fmtNum(d.freight)}</td>
                      <td className="px-3 py-2.5 text-left tnum">{fmtNum(d.suppliers)}</td>
                      <td className="px-3 py-2.5">
                        <div className="h-1.5 rounded-full bg-secondary overflow-hidden w-28">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${(d.freight / maxFreight) * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
