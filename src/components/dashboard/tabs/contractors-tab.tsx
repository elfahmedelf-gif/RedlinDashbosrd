'use client'

import * as React from 'react'
import useSWR from 'swr'
import { UserCog, Phone } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtNum } from '@/lib/format'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface StatsResponse {
  contractors: { name: string; count: number; freight: number; suppliers: number }[]
}

const CONTRACTOR_COLORS = [
  'bg-amber-500',
  'bg-teal-500',
  'bg-purple-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-sky-500',
  'bg-orange-500',
  'bg-indigo-500',
  'bg-pink-500',
  'bg-lime-500',
  'bg-cyan-500',
  'bg-fuchsia-500',
]

export function ContractorsTab() {
  const { data, isLoading } = useSWR<StatsResponse>('/api/stats', fetcher)
  const contractors = React.useMemo(() => {
    if (!data) return []
    return [...data.contractors].sort((a, b) => b.count - a.count)
  }, [data])

  const totalCount = contractors.reduce((a, b) => a + b.count, 0)
  const totalFreight = contractors.reduce((a, b) => a + b.freight, 0)
  const totalSuppliers = contractors.reduce((a, b) => a + b.suppliers, 0)
  const maxCount = contractors[0]?.count ?? 1

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">عدد المقاولين</div>
            <div className="mt-1 text-2xl font-bold tnum">{fmtNum(contractors.length)}</div>
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
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {isLoading || !data
          ? Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)
          : contractors.map((c, i) => {
              const color = CONTRACTOR_COLORS[i % CONTRACTOR_COLORS.length]
              const sharePct = totalCount ? (c.count / totalCount) * 100 : 0
              const avgFreight = c.count ? c.freight / c.count : 0
              return (
                <Card key={c.name} className="overflow-hidden">
                  <CardHeader className="pb-2 pt-4">
                    <div className="flex items-center gap-3">
                      <div className={`flex items-center justify-center size-10 rounded-xl text-white ${color}`}>
                        <UserCog className="size-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-sm leading-tight truncate" title={c.name}>{c.name}</CardTitle>
                        <CardDescription className="text-[11px]">المقاول رقم {i + 1}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-1">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-secondary/60 rounded-lg p-2">
                        <div className="text-muted-foreground">الشحنات</div>
                        <div className="font-bold tnum">{fmtNum(c.count)}</div>
                      </div>
                      <div className="bg-secondary/60 rounded-lg p-2">
                        <div className="text-muted-foreground">النولون</div>
                        <div className="font-bold tnum">{fmtNum(c.freight)}</div>
                      </div>
                      <div className="bg-primary/10 rounded-lg p-2">
                        <div className="text-muted-foreground">الموردين</div>
                        <div className="font-bold tnum text-primary">{fmtNum(c.suppliers)}</div>
                      </div>
                      <div className="bg-secondary/60 rounded-lg p-2">
                        <div className="text-muted-foreground">متوسط/شحنة</div>
                        <div className="font-bold tnum">{fmtNum(avgFreight)}</div>
                      </div>
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                        <span>الحصة من إجمالي الشحنات</span>
                        <span className="tnum">{sharePct.toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div
                          className={`h-full rounded-full ${color}`}
                          style={{ width: `${(c.count / maxCount) * 100}%` }}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
      </div>
    </div>
  )
}
