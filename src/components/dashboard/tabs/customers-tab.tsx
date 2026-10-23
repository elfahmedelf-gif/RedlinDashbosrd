'use client'

import * as React from 'react'
import useSWR from 'swr'
import { Search, Users, ArrowUpRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtNum } from '@/lib/format'

import { fetcher } from '@/lib/api'

interface StatsResponse {
  customers: { name: string; count: number; freight: number; suppliers: number }[]
}

export function CustomersTab() {
  const { data, isLoading } = useSWR<StatsResponse>('/api/stats', fetcher)
  const [q, setQ] = React.useState('')

  const customers = React.useMemo(() => {
    if (!data) return []
    const list = [...data.customers].sort((a, b) => b.suppliers - a.suppliers)
    if (!q) return list
    const qq = q.toLowerCase()
    return list.filter((c) => c.name.toLowerCase().includes(qq))
  }, [data, q])

  const maxSuppliers = customers[0]?.suppliers ?? 1

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 md:p-4">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ابحث عن عميل..."
              className="pr-9"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {isLoading || !data
          ? Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)
          : customers.map((c, i) => (
              <Card key={c.name + i} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex items-center justify-center size-10 rounded-xl bg-primary/10 text-primary font-bold text-sm tnum shrink-0">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm leading-snug line-clamp-2" title={c.name}>
                        {c.name}
                      </div>
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="tnum">{fmtNum(c.count)} شحنة</Badge>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-secondary/60 rounded-lg p-2">
                      <div className="text-muted-foreground">النولون</div>
                      <div className="font-bold tnum">{fmtNum(c.freight)} ج.م</div>
                    </div>
                    <div className="bg-primary/10 rounded-lg p-2">
                      <div className="text-muted-foreground">الموردين</div>
                      <div className="font-bold tnum text-primary">{fmtNum(c.suppliers)} ج.م</div>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${(c.suppliers / maxSuppliers) * 100}%` }}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
      </div>

      {!isLoading && data && customers.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Users className="size-10 mx-auto mb-2 opacity-50" />
            لا يوجد عملاء مطابقون
          </CardContent>
        </Card>
      )}
    </div>
  )
}
