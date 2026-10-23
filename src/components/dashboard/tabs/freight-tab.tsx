'use client'

import * as React from 'react'
import useSWR from 'swr'
import { Search, Receipt } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { fmtNum } from '@/lib/format'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface FreightRate {
  id: string
  regionEn: string | null
  regionAr: string | null
  distanceKm: string | null
  cost: number | null
  sellPrice: number | null
  sellPrice2: number | null
}

interface Response {
  rates: FreightRate[]
  filters: any
}

export function FreightTab() {
  const { data, isLoading } = useSWR<Response>('/api/freight-rates', fetcher)
  const [q, setQ] = React.useState('')

  const rates = React.useMemo(() => {
    if (!data) return []
    const list = [...data.rates]
    if (!q) return list
    const qq = q.toLowerCase()
    return list.filter(
      (r) =>
        (r.regionAr ?? '').toLowerCase().includes(qq) ||
        (r.regionEn ?? '').toLowerCase().includes(qq),
    )
  }, [data, q])

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 md:p-4">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ابحث باسم المنطقة (عربي / إنجليزي)..."
              className="pr-9"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {isLoading || !data ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground sticky top-0">
                  <tr className="text-right">
                    <th className="font-medium px-3 py-2.5">#</th>
                    <th className="font-medium px-3 py-2.5">المنطقة (عربي)</th>
                    <th className="font-medium px-3 py-2.5">Region (EN)</th>
                    <th className="font-medium px-3 py-2.5 text-left">التكلفة</th>
                    <th className="font-medium px-3 py-2.5 text-left">سعر البيع</th>
                    <th className="font-medium px-3 py-2.5 text-left">سعر 2</th>
                    <th className="font-medium px-3 py-2.5 text-left">هامش</th>
                  </tr>
                </thead>
                <tbody>
                  {rates.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-muted-foreground">
                        <Receipt className="size-10 mx-auto mb-2 opacity-50" />
                        لا توجد نتائج مطابقة
                      </td>
                    </tr>
                  ) : (
                    rates.map((r, i) => {
                      const margin =
                        r.sellPrice != null && r.cost != null && r.cost > 0
                          ? ((r.sellPrice - r.cost) / r.cost) * 100
                          : null
                      return (
                        <tr key={r.id} className="border-t border-border hover:bg-muted/40">
                          <td className="px-3 py-2.5 text-xs text-muted-foreground tnum">{i + 1}</td>
                          <td className="px-3 py-2.5 font-medium">{r.regionAr ?? '-'}</td>
                          <td className="px-3 py-2.5 text-muted-foreground" dir="ltr">{r.regionEn ?? '-'}</td>
                          <td className="px-3 py-2.5 text-left tnum">{r.cost != null ? fmtNum(r.cost) : '-'}</td>
                          <td className="px-3 py-2.5 text-left font-bold tnum">
                            {r.sellPrice != null ? fmtNum(r.sellPrice) : '-'}
                          </td>
                          <td className="px-3 py-2.5 text-left tnum">
                            {r.sellPrice2 != null ? fmtNum(r.sellPrice2) : '-'}
                          </td>
                          <td className="px-3 py-2.5 text-left">
                            {margin != null ? (
                              <Badge
                                variant="outline"
                                className={margin >= 30 ? 'text-emerald-600' : 'text-amber-600'}
                              >
                                {margin.toFixed(1)}%
                              </Badge>
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        إجمالي السجلات: {fmtNum(rates.length)} منطقة • التكلفة والأسعار بالجنيه المصري
      </p>
    </div>
  )
}
