'use client'

import * as React from 'react'
import useSWR from 'swr'
import {
  Search,
  ChevronRight,
  ChevronLeft,
  PackageSearch,
  Filter,
  X,
  Loader2,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtNum, fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Shipment {
  id: string
  rowIdx: number
  code2: string | null
  customerName: string
  delivery: string | null
  destination: string | null
  destinationEn: string | null
  policyQty: number | null
  ton15: number | null
  ton3: number | null
  m6: number | null
  drop: number | null
  date: string | null
  date2: string | null
  contractor: string | null
  coding: string | null
  freight: number | null
  freightTotal: number | null
  customerPay: number | null
  aging: number | null
  overnight: number | null
  returns: number | null
  transfer: number | null
  other: number | null
  totalSuppliers: number | null
  notes: string | null
}

interface ShipmentsResponse {
  items: Shipment[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface FreightFilters {
  destinations: string[]
  destinationEn: string[]
  contractors: string[]
  codings: string[]
}

interface ShipmentsTabProps {
  initialFilters?: FreightFilters
}

export function ShipmentsTab({ initialFilters }: ShipmentsTabProps) {
  const [q, setQ] = React.useState('')
  const [destination, setDestination] = React.useState<string>('all')
  const [contractor, setContractor] = React.useState<string>('all')
  const [coding, setCoding] = React.useState<string>('all')
  const [page, setPage] = React.useState(1)
  const [showFilters, setShowFilters] = React.useState(false)
  const pageSize = 20
  const [debouncedQ, setDebouncedQ] = React.useState('')

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q)
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [q])

  const params = new URLSearchParams()
  if (debouncedQ) params.set('q', debouncedQ)
  if (destination !== 'all') params.set('destination', destination)
  if (contractor !== 'all') params.set('contractor', contractor)
  if (coding !== 'all') params.set('coding', coding)
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))

  const { data, error, isLoading, isValidating } = useSWR<ShipmentsResponse>(
    `/api/shipments?${params.toString()}`,
    fetcher,
    { keepPreviousData: true, refreshInterval: 30000 },
  )

  const hasFilters =
    debouncedQ || destination !== 'all' || contractor !== 'all' || coding !== 'all'

  const clearFilters = () => {
    setQ('')
    setDestination('all')
    setContractor('all')
    setCoding('all')
    setPage(1)
  }

  const filterOptions = initialFilters ?? {
    destinations: [],
    destinationEn: [],
    contractors: [],
    codings: [],
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 md:p-4">
          <div className="flex flex-col md:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ابحث باسم العميل، الوجهة، المقاول، الكود..."
                className="pr-9"
              />
              {q && (
                <button
                  onClick={() => setQ('')}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            <Button
              variant={showFilters ? 'default' : 'outline'}
              onClick={() => setShowFilters((v) => !v)}
              className="shrink-0"
            >
              <Filter className="size-4" />
              تصفية
              {hasFilters && (
                <Badge variant="secondary" className="ml-1 tnum">
                  {[debouncedQ, destination !== 'all', contractor !== 'all', coding !== 'all'].filter(Boolean).length}
                </Badge>
              )}
            </Button>
          </div>

          {showFilters && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 pt-3 border-t border-border">
              <Select value={destination} onValueChange={(v) => { setDestination(v); setPage(1) }}>
                <SelectTrigger><SelectValue placeholder="الوجهة" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الوجهات</SelectItem>
                  {filterOptions.destinations.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={contractor} onValueChange={(v) => { setContractor(v); setPage(1) }}>
                <SelectTrigger><SelectValue placeholder="المقاول" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المقاولين</SelectItem>
                  {filterOptions.contractors.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={coding} onValueChange={(v) => { setCoding(v); setPage(1) }}>
                <SelectTrigger><SelectValue placeholder="الكود (تكويد)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الأكواد</SelectItem>
                  {filterOptions.codings.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasFilters && (
                <Button variant="ghost" onClick={clearFilters} className="sm:col-span-3 justify-start">
                  <X className="size-4" /> مسح كل المرشحات
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results summary */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          {isValidating && <Loader2 className="size-3.5 animate-spin" />}
          <span className="tnum">
            إجمالي النتائج: <span className="font-bold text-foreground">{fmtNum(data?.total ?? 0)}</span>
          </span>
        </div>
        {data && (
          <span className="tnum">
            صفحة {fmtNum(data.page)} من {fmtNum(data.totalPages)}
          </span>
        )}
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        {error ? (
          <CardContent className="py-10 text-center text-destructive">
            تعذّر تحميل الشحنات. حاول مرة أخرى.
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr className="text-right">
                  <Th className="w-16">م</Th>
                  <Th>العميل</Th>
                  <Th className="w-32">الوجهة</Th>
                  <Th className="w-20">الحجم</Th>
                  <Th className="w-24">التكويد</Th>
                  <Th className="w-28">المقاول</Th>
                  <Th className="w-24">التاريخ</Th>
                  <Th className="w-24 text-left">النولون</Th>
                  <Th className="w-24 text-left">الموردين</Th>
                </tr>
              </thead>
              <tbody>
                {isLoading && !data ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={9}><Skeleton className="h-12 m-1" /></td>
                    </tr>
                  ))
                ) : data && data.items.length > 0 ? (
                  data.items.map((s, i) => {
                    const size = (s.ton15 ? '1.5ط' : '') || (s.ton3 ? '3ط' : '') || (s.m6 ? '6م' : '') || '-'
                    const sizeTone = s.ton15
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                      : s.ton3
                      ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300'
                      : 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                    return (
                      <tr
                        key={s.id}
                        className={cn('border-t border-border hover:bg-muted/40 transition-colors', i % 2 ? 'bg-card' : 'bg-muted/15')}
                      >
                        <Td>
                          <span className="text-xs text-muted-foreground tnum">{s.rowIdx}</span>
                          {s.code2 && (
                            <div className="text-[10px] text-muted-foreground tnum">#{s.code2}</div>
                          )}
                        </Td>
                        <Td>
                          <div className="font-medium truncate max-w-[260px]" title={s.customerName}>
                            {s.customerName}
                          </div>
                          {s.delivery && (
                            <div className="text-[11px] text-muted-foreground truncate max-w-[260px]" dir="ltr" title={s.delivery}>
                              {s.delivery}
                            </div>
                          )}
                          {s.notes && (
                            <div className="text-[11px] text-amber-600 dark:text-amber-400 truncate max-w-[260px]">📝 {s.notes}</div>
                          )}
                        </Td>
                        <Td>
                          <div className="font-medium">{s.destination ?? '-'}</div>
                          {s.destinationEn && (
                            <div className="text-[11px] text-muted-foreground" dir="ltr">{s.destinationEn}</div>
                          )}
                        </Td>
                        <Td>
                          <Badge variant="outline" className={cn('font-bold', sizeTone)}>
                            {size}
                          </Badge>
                          {s.policyQty != null && (
                            <div className="text-[10px] text-muted-foreground tnum mt-0.5">كمية: {fmtNum(s.policyQty)}</div>
                          )}
                        </Td>
                        <Td><span className="text-xs">{s.coding ?? '-'}</span></Td>
                        <Td><span className="text-xs font-medium">{s.contractor ?? '-'}</span></Td>
                        <Td>
                          <div className="text-xs tnum">{fmtDate(s.date)}</div>
                          {s.date2 && s.date2 !== s.date && (
                            <div className="text-[10px] text-muted-foreground tnum">ت.تسليم: {fmtDate(s.date2)}</div>
                          )}
                        </Td>
                        <Td className="text-left font-bold tnum">{fmtNum(s.freightTotal ?? s.freight)}</Td>
                        <Td className="text-left">
                          <span className="font-bold tnum">{fmtNum(s.totalSuppliers ?? 0)}</span>
                          {(s.customerPay ?? 0) > 0 && (
                            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 tnum">
                              +{fmtNum(s.customerPay)} تحصيل
                            </div>
                          )}
                        </Td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={9} className="py-16 text-center text-muted-foreground">
                      <PackageSearch className="size-10 mx-auto mb-2 opacity-50" />
                      <div>لا توجد شحنات مطابقة للبحث</div>
                      {hasFilters && (
                        <Button variant="link" onClick={clearFilters} className="mt-2">مسح المرشحات</Button>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronRight className="size-4" /> السابق
          </Button>
          <div className="flex items-center gap-1.5">
            {buildPages(page, data.totalPages).map((p, i) =>
              p === '...' ? (
                <span key={i} className="px-2 text-muted-foreground">…</span>
              ) : (
                <Button
                  key={i}
                  variant={p === page ? 'default' : 'outline'}
                  size="sm"
                  className="size-8 p-0 tnum"
                  onClick={() => setPage(p as number)}
                >
                  {p}
                </Button>
              ),
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= data.totalPages}
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
          >
            التالي <ChevronLeft className="size-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

function buildPages(current: number, total: number): (number | '...')[] {
  const out: (number | '...')[] = []
  const add = (n: number | '...') => out.push(n)
  if (total <= 7) {
    for (let i = 1; i <= total; i++) add(i)
    return out
  }
  add(1)
  if (current > 3) add('...')
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) add(i)
  if (current < total - 2) add('...')
  add(total)
  return out
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn('font-medium px-3 py-2.5 whitespace-nowrap', className)}>{children}</th>
}
function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('px-3 py-2.5 align-top', className)}>{children}</td>
}
