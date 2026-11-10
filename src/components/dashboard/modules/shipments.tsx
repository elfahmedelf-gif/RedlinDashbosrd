'use client'

import * as React from 'react'
import useSWR from 'swr'
import { Plus, PackageSearch, Filter, X, Search, Printer, ArrowLeft, Trash2, FileSpreadsheet, CheckSquare, Square, Layers, Banknote, Link2, Truck } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { WaybillPrint } from '../waybill-print'
import { EntityFormDialog } from '../entity-dialog'
import { DataTablePagination } from '../data-table-pagination'
import { fetcher, apiPost, apiDelete } from '@/lib/api'
import { exportToCSV } from '@/lib/export'
import { fmtNum, fmtDate, fmtDateTime } from '@/lib/format'
import { useToast } from '@/hooks/use-toast'
import { useLookup } from '@/lib/lookups'
import { cn } from '@/lib/utils'
import { useCanPrices } from '../auth-provider'
import { useConfirm } from '@/components/ui/confirm-dialog'

interface PartyLite { id: string; name: string }
interface Shipment {
  id: string; shipmentNo: string | null; billNo: string | null;
  policyQty: number | null; customerId: string | null; customer: PartyLite | null;
  contractorId: string | null; contractor: PartyLite | null;
  branchId: string | null; branch: PartyLite | null;
  recipientName: string | null; destination: string | null; destinationEn: string | null;
  routeCode: string | null; loadType: string | null;
  freightCost: number | null; freightTotal: number | null; salePrice: number | null;
  customerPay: number | null; totalSuppliers: number | null;
  status: string; collectionStatus: string;
  date: string | null; date2: string | null; notes: string | null;
  ton15: number | null; ton3: number | null; m6: number | null; drop: number | null;
}

interface ShipmentsResponse { items: Shipment[]; total: number; page: number; totalPages: number }

export function ShipmentsModule() {
  const { toast } = useToast()
  // صلاحية رؤية الأسعار — تتحكم في إظهار كل المبالغ (نولون/تكلفة/تحصيل/هامش)
  const canPrices = useCanPrices()
  const { confirm: confirmDialog } = useConfirm()
  // Dynamic shipment status options from the lookup table
  const { items: statusItems } = useLookup('shipment_status')
  const STATUS_OPTIONS = statusItems.map((i) => ({ value: i.key, label: i.label, tone: i.tone }))
  const STATUS_LABEL: Record<string, { label: string; tone: string }> = Object.fromEntries(
    statusItems.map((i) => [i.key, { label: i.label, tone: i.tone || '' }]),
  )
  const [q, setQ] = React.useState('')
  const [status, setStatus] = React.useState<string>('all')
  const [destination, setDestination] = React.useState<string>('all')
  const [contractor, setContractor] = React.useState<string>('all')
  const [province, setProvince] = React.useState<string>('all')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(10) // rows-per-page selectable from the unified pagination bar
  const [debouncedQ, setDebouncedQ] = React.useState('')
  const [showFilters, setShowFilters] = React.useState(false)
  const [addOpen, setAddOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<string | null>(null)
  // bulk selection + actions
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [bulkActionOpen, setBulkActionOpen] = React.useState<null | 'status' | 'assign'>(null)
  const [bulkStatus, setBulkStatus] = React.useState('')
  const [bulkContractor, setBulkContractor] = React.useState('')
  const [bulkNotes, setBulkNotes] = React.useState('')
  // waybill print target
  const [waybillShipment, setWaybillShipment] = React.useState<any>(null)

  React.useEffect(() => { const t = setTimeout(() => { setDebouncedQ(q); setPage(1) }, 350); return () => clearTimeout(t) }, [q])

  const params = new URLSearchParams()
  if (debouncedQ) params.set('q', debouncedQ)
  if (status !== 'all') params.set('status', status)
  if (destination !== 'all') params.set('destination', destination)
  if (contractor !== 'all') params.set('contractor', contractor)
  if (province !== 'all') params.set('province', province)
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))
  const { data, error, isLoading, mutate } = useSWR<ShipmentsResponse>(`/api/shipments?${params.toString()}`, fetcher, { keepPreviousData: true, refreshInterval: 30000 })

  // Load filter options (destinations + contractors + provinces) — derive from stats endpoint
  const { data: stats } = useSWR<{ destinations: { name: string }[] }>('/api/stats', fetcher)
  const { data: contractorsRes } = useSWR<{ items: any[] }>('/api/parties?type=contractor', fetcher)
  const destinations = stats?.destinations.map((d) => d.name) ?? []
  const contractorsList = contractorsRes?.items ?? []
  // Provinces derived from route codes in shipments (typically formatted like "القاهرة 1", "الجيزة 2" etc.)
  const provinces = React.useMemo(() => {
    const set = new Set<string>()
    // Best-effort: derive from destinations + known Egyptian governorates that appear in the data
    for (const d of destinations) {
      // first word of destination as a coarse province hint
      const first = String(d).split(/\s+/)[0]
      if (first) set.add(first)
    }
    return Array.from(set).sort()
  }, [destinations])

  const hasFilters = debouncedQ || status !== 'all' || destination !== 'all' || contractor !== 'all' || province !== 'all'

  // ---- bulk selection helpers ----
  const pageItems = data?.items ?? []
  const pageIds = pageItems.map((s) => s.id)
  const allOnPageSelected = pageItems.length > 0 && pageIds.every((id) => selectedIds.has(id))
  const someSelected = pageIds.some((id) => selectedIds.has(id))
  const toggleAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allOnPageSelected) {
        for (const id of pageIds) next.delete(id)
      } else {
        for (const id of pageIds) next.add(id)
      }
      return next
    })
  }
  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const clearSelection = () => setSelectedIds(new Set())

  const runBulkStatus = async () => {
    if (!bulkStatus || selectedIds.size === 0) return
    // تأكيد قبل التغيير الجماعي للحالة — تشغيلية جوهرية (primary)
    const targetLabel = STATUS_LABEL[bulkStatus]?.label ?? bulkStatus
    const ok = await confirmDialog({
      title: 'تغيير حالة الشحنات المحددة',
      message: `سيتم تغيير حالة ${selectedIds.size} شحنة إلى «${targetLabel}». هل تريد المتابعة؟`,
      variant: 'primary',
      confirmText: 'تغيير الحالة',
    })
    if (!ok) return
    try {
      await apiPost('/api/shipments/bulk/status', { ids: Array.from(selectedIds), status: bulkStatus, notes: bulkNotes, userName: 'admin' })
      toast({ title: `تم تحديث حالة ${selectedIds.size} شحنة` })
      setBulkActionOpen(null); setBulkStatus(''); setBulkNotes(''); clearSelection(); mutate()
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  const runBulkAssign = async () => {
    if (!bulkContractor || selectedIds.size === 0) return
    try {
      await apiPost('/api/shipments/bulk/assign', { ids: Array.from(selectedIds), contractorId: bulkContractor, userName: 'admin' })
      toast({ title: `تم إسناد ${selectedIds.size} شحنة للمقاول` })
      setBulkActionOpen(null); setBulkContractor(''); clearSelection(); mutate()
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  // ---- export to CSV ----
  const exportShipments = () => {
    if (!pageItems.length) {
      toast({ title: 'لا توجد بيانات للتصدير' })
      return
    }
    const rows = pageItems.map((s) => ({
      'رقم الشحنة': s.shipmentNo, 'رقم البوليصة': s.billNo, 'العميل': s.customer?.name || s.recipientName,
      'المستلم': s.recipientName, 'الوجهة': s.destination, 'الوجهة EN': s.destinationEn,
      'كود الخط': s.routeCode, 'النوع': s.loadType, 'المقاول': s.contractor?.name,
      'الفرع': s.branch?.name, 'الحالة': STATUS_LABEL[s.status]?.label || s.status,
      'تاريخ الشحن': s.date ? fmtDate(s.date) : '',
      // المبالغ تُصدّر فقط لمن يملك صلاحية الأسعار
      ...(canPrices ? {
        'نولون العميل': s.freightTotal ?? s.freightCost, 'نولون المقاول': s.totalSuppliers ?? 0,
        'هامش الربح': (s.freightTotal ?? 0) - (s.totalSuppliers ?? 0),
      } : {}),
      'الكمية (سياسات)': s.policyQty,
    }))
    exportToCSV(rows, `shipments-${new Date().toISOString().slice(0, 10)}.csv`)
    toast({ title: `تم تصدير ${rows.length} شحنة` })
  }

  if (selected) return <ShipmentDetail id={selected} onBack={() => setSelected(null)} />

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground shrink-0" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث برقم الشحنة/العميل/الوجهة/الهاتف..." className="pr-9 min-w-0" />
          {q && <button onClick={() => setQ('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground shrink-0"><X className="size-4" /></button>}
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant={showFilters ? 'default' : 'outline'} onClick={() => setShowFilters((v) => !v)} className="flex-1 sm:flex-none">
            <Filter className="size-4" /> تصفية
          </Button>
          <Button variant="outline" onClick={exportShipments} className="flex-1 sm:flex-none" disabled={!pageItems.length}>
            <FileSpreadsheet className="size-4" /> <span className="hidden sm:inline">تصدير</span>
          </Button>
          <Button onClick={() => setAddOpen(true)} className="flex-1 sm:flex-none">
            <Plus className="size-4" /> <span className="hidden sm:inline">شحنة جديدة</span><span className="sm:hidden">جديد</span>
          </Button>
        </div>
      </div>

      {/* Bulk selection action bar */}
      {selectedIds.size > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium tnum">{selectedIds.size} شحنة محددة</span>
            <Button variant="ghost" size="sm" onClick={clearSelection} className="text-muted-foreground"><X className="size-3.5" /> إلغاء التحديد</Button>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={() => setBulkActionOpen('status')}>
              <CheckSquare className="size-3.5" /> تغيير الحالة دفعة
            </Button>
            <Button variant="outline" size="sm" onClick={() => setBulkActionOpen('assign')}>
              <Truck className="size-3.5" /> إسناد لمقاول
            </Button>
          </CardContent>
        </Card>
      )}

      {showFilters && (
        <Card>
          <CardContent className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
              <SelectTrigger><SelectValue placeholder="الحالة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={destination} onValueChange={(v) => { setDestination(v); setPage(1) }}>
              <SelectTrigger><SelectValue placeholder="الوجهة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الوجهات</SelectItem>
                {destinations.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={contractor} onValueChange={(v) => { setContractor(v); setPage(1) }}>
              <SelectTrigger><SelectValue placeholder="المقاول" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المقاولين</SelectItem>
                {contractorsList.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={province} onValueChange={(v) => { setProvince(v); setPage(1) }}>
              <SelectTrigger><SelectValue placeholder="المحافظة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المحافظات</SelectItem>
                {provinces.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            {hasFilters && <Button variant="ghost" onClick={() => { setQ(''); setStatus('all'); setDestination('all'); setContractor('all'); setProvince('all'); setPage(1) }} className="sm:col-span-2 lg:col-span-4 justify-start"><X className="size-4" /> مسح المرشحات</Button>}
          </CardContent>
        </Card>
      )}

      <div className="text-xs text-muted-foreground tnum">إجمالي النتائج: <b className="text-foreground">{fmtNum(data?.total ?? 0)}</b></div>

      {/* Mobile: card view */}
      {data && data.items.length > 0 && (
        <div className="sm:hidden space-y-2">
          {data.items.map((s) => {
            const size = s.loadType === '1.5TON' ? '1.5ط' : s.loadType === '3TON' ? '3ط' : s.loadType === '6M' ? '6م' : '-'
            const sizeTone = s.loadType === '1.5TON' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
              : s.loadType === '3TON' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300'
              : 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
            const sMeta = STATUS_LABEL[s.status] || { label: s.status, tone: '' }
            const isSel = selectedIds.has(s.id)
            return (
              <div
                key={s.id}
                className={cn('rounded-2xl border bg-card elev-sm p-3 transition-colors active:scale-[0.99] space-y-2', isSel ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40')}
              >
                {/* Title row: shipment no + status badge + checkbox */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleOne(s.id) }}
                      className={cn('shrink-0 mt-0.5 size-5 rounded-md border-2 flex items-center justify-center', isSel ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-300 dark:border-slate-600')}
                      aria-label="تحديد"
                    >
                      {isSel && <CheckSquare className="size-3.5" />}
                    </button>
                    <button onClick={() => setSelected(s.id)} className="min-w-0 flex-1 text-right">
                      <div className="font-mono text-xs font-bold truncate-1">{s.shipmentNo}</div>
                      <div className="font-semibold text-sm truncate-1 mt-0.5" title={s.customer?.name || s.recipientName || ''}>
                        {s.customer?.name || s.recipientName || '-'}
                      </div>
                      {s.billNo && <div className="text-[10px] text-muted-foreground tnum truncate-1">بوليصة: {s.billNo}</div>}
                    </button>
                  </div>
                  <Badge variant="outline" className={sMeta.tone + ' shrink-0'}>{sMeta.label}</Badge>
                </div>
                {/* Meta grid: destination + size + date + contractor */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-1 border-t border-border/60">
                  <div className="min-w-0">
                    <div className="text-[10px] text-muted-foreground/70">الوجهة</div>
                    <div className="text-xs font-medium truncate-1">{s.destination ?? '-'}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] text-muted-foreground/70">الحجم</div>
                    <Badge variant="outline" className={cn('font-bold', sizeTone)}>{size}</Badge>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] text-muted-foreground/70">المقاول</div>
                    <div className="text-xs font-medium truncate-1">{s.contractor?.name ?? '-'}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] text-muted-foreground/70">التاريخ</div>
                    <div className="text-xs font-medium tnum truncate-1">{fmtDate(s.date)}</div>
                  </div>
                  {/* النولون يُعرض فقط لمن يملك صلاحية الأسعار */}
                  {canPrices && (
                    <div className="min-w-0">
                      <div className="text-[10px] text-muted-foreground/70">نولون العميل</div>
                      <div className="text-xs font-bold tnum num-ltr">{fmtNum(s.freightTotal ?? s.freightCost)} ج.م</div>
                    </div>
                  )}
                  {canPrices && (
                    <div className="min-w-0">
                      <div className="text-[10px] text-muted-foreground/70">نولون المقاول</div>
                      <div className="text-xs font-bold tnum num-ltr">{fmtNum(s.totalSuppliers ?? 0)} ج.م</div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Desktop: table view */}
      <Card className="overflow-hidden hidden sm:block">
        <div className="w-full overflow-x-auto">
          <table className="w-full table-fixed text-sm text-right" style={{ minWidth: 1320 }}>
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="font-medium px-2 py-3 text-center w-12">
                  <button onClick={toggleAll} aria-label="تحديد الكل" className={cn('inline-flex items-center justify-center size-5 rounded-md border-2', allOnPageSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-300 dark:border-slate-600')}>
                    {allOnPageSelected && <CheckSquare className="size-3.5" />}
                  </button>
                </th>
                <th className="font-medium px-4 py-3 text-center w-28">رقم الشحنة</th>
                <th className="font-medium px-4 py-3">العميل / المستلم</th>
                <th className="font-medium px-4 py-3 w-32">الوجهة</th>
                <th className="font-medium px-4 py-3 text-center w-20">الحجم</th>
                <th className="font-medium px-4 py-3 w-28">المقاول</th>
                <th className="font-medium px-4 py-3 text-center w-28">التاريخ</th>
                <th className="font-medium px-4 py-3 text-center w-32">الحالة</th>
                {/* أعمدة المبالغ — تُعرض فقط لمن يملك صلاحية الأسعار */}
                {canPrices && <th className="font-medium px-4 py-3 text-left w-24">نولون العميل</th>}
                {canPrices && <th className="font-medium px-4 py-3 text-left w-24">نولون المقاول</th>}
                {canPrices && <th className="font-medium px-4 py-3 text-left w-24">هامش الربح</th>}
                <th className="font-medium px-4 py-3 text-center w-20">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && !data ? (
                Array.from({ length: 10 }).map((_, i) => <tr key={i}><td colSpan={canPrices ? 12 : 9}><Skeleton className="h-12 m-1" /></td></tr>)
              ) : data && data.items.length > 0 ? (
                data.items.map((s, i) => {
                  const size = s.loadType === '1.5TON' ? '1.5ط' : s.loadType === '3TON' ? '3ط' : s.loadType === '6M' ? '6م' : '-'
                  const sizeTone = s.loadType === '1.5TON' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    : s.loadType === '3TON' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300'
                    : 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                  const sMeta = STATUS_LABEL[s.status] || { label: s.status, tone: '' }
                  const margin = (s.freightTotal ?? 0) - (s.totalSuppliers ?? 0)
                  const isSel = selectedIds.has(s.id)
                  return (
                    <tr key={s.id} className={cn('border-t border-border hover:bg-muted/40', i % 2 ? 'bg-card' : 'bg-muted/15', isSel && 'bg-primary/10')}>
                      <td className="px-2 py-3 align-middle text-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleOne(s.id) }}
                          aria-label="تحديد"
                          className={cn('inline-flex items-center justify-center size-5 rounded-md border-2', isSel ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-300 dark:border-slate-600')}
                        >
                          {isSel && <CheckSquare className="size-3.5" />}
                        </button>
                      </td>
                      <td className="px-4 py-3 align-middle text-center cursor-pointer" onClick={() => setSelected(s.id)}>
                        <div className="font-mono text-xs font-bold truncate-1">{s.shipmentNo}</div>
                        {s.billNo && <div className="text-[10px] text-muted-foreground tnum truncate-1">بوليصة: {s.billNo}</div>}
                      </td>
                      <td className="px-4 py-3 align-middle cursor-pointer" onClick={() => setSelected(s.id)}>
                        <div className="font-medium truncate-1" title={s.customer?.name || s.recipientName || ''}>
                          {s.customer?.name || s.recipientName || '-'}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle cursor-pointer" onClick={() => setSelected(s.id)}>
                        <div className="font-medium truncate-1">{s.destination ?? '-'}</div>
                        {s.routeCode && <div className="text-[10px] text-muted-foreground truncate-1">كود: {s.routeCode}</div>}
                      </td>
                      <td className="px-4 py-3 align-middle text-center whitespace-nowrap cursor-pointer" onClick={() => setSelected(s.id)}>
                        <Badge variant="outline" className={cn('font-bold', sizeTone)}>{size}</Badge>
                        {s.policyQty != null && <div className="text-[10px] text-muted-foreground tnum mt-0.5">كمية: {fmtNum(s.policyQty)}</div>}
                      </td>
                      <td className="px-4 py-3 align-middle text-xs cursor-pointer" onClick={() => setSelected(s.id)}><span className="truncate-1 block">{s.contractor?.name ?? '-'}</span></td>
                      <td className="px-4 py-3 align-middle text-xs tnum text-center whitespace-nowrap cursor-pointer" onClick={() => setSelected(s.id)}>{fmtDate(s.date)}</td>
                      <td className="px-4 py-3 align-middle text-center whitespace-nowrap cursor-pointer" onClick={() => setSelected(s.id)}>
                        <Badge variant="outline" className={sMeta.tone}>{sMeta.label}</Badge>
                      </td>
                      {canPrices && (
                        <td className="px-4 py-3 align-middle text-left font-bold tnum whitespace-nowrap cursor-pointer" onClick={() => setSelected(s.id)}>
                          <span className="num-ltr">{fmtNum(s.freightTotal ?? s.freightCost)}</span>
                        </td>
                      )}
                      {canPrices && (
                        <td className="px-4 py-3 align-middle text-left tnum whitespace-nowrap cursor-pointer" onClick={() => setSelected(s.id)}>
                          <span className="num-ltr">{fmtNum(s.totalSuppliers ?? 0)}</span>
                        </td>
                      )}
                      {canPrices && (
                        <td className={cn('px-4 py-3 align-middle text-left font-bold tnum whitespace-nowrap', margin >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400')}>
                          <span className="num-ltr">{fmtNum(margin)}</span>
                        </td>
                      )}
                      <td className="px-4 py-3 align-middle text-center whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); setWaybillShipment(s) }}
                          title="طباعة بوليصة الشحن"
                        >
                          <Printer className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr><td colSpan={12} className="py-16 text-center text-muted-foreground">
                  <PackageSearch className="size-10 mx-auto mb-2 opacity-50" />
                  لا توجد شحنات مطابقة
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Mobile empty state */}
      {data && data.items.length === 0 && !isLoading && (
        <Card className="sm:hidden"><CardContent className="py-16 text-center text-muted-foreground">
          <PackageSearch className="size-10 mx-auto mb-2 opacity-50" />
          لا توجد شحنات مطابقة
        </CardContent></Card>
      )}

      {/* Pagination — unified server-side pagination bar */}
      {data && (
        <DataTablePagination
          currentPage={data.page}
          totalPages={data.totalPages}
          totalItems={data.total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1) }}
          itemLabel="شحنة"
        />
      )}

      {/* Add dialog */}
      <ShipmentCreateDialog open={addOpen} onOpenChange={setAddOpen} onCreated={() => { mutate(); toast({ title: 'تم إنشاء الشحنة بنجاح' }) }} />

      {/* Waybill print dialog */}
      <WaybillPrint
        shipment={waybillShipment}
        open={!!waybillShipment}
        onOpenChange={(v) => { if (!v) setWaybillShipment(null) }}
      />

      {/* Bulk action dialogs */}
      <Dialog open={bulkActionOpen === 'status'} onOpenChange={(v) => !v && setBulkActionOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تغيير الحالة دفعة ({selectedIds.size} شحنة)</DialogTitle>
            <DialogDescription>سيتم تحديث حالة جميع الشحنات المحددة إلى الحالة الجديدة وإضافة سجل لكل شحنة.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Select value={bulkStatus} onValueChange={setBulkStatus}>
              <SelectTrigger><SelectValue placeholder="اختر الحالة الجديدة..." /></SelectTrigger>
              <SelectContent>
                {statusItems.map((i) => <SelectItem key={i.key} value={i.key}>{i.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Textarea value={bulkNotes} onChange={(e) => setBulkNotes(e.target.value)} placeholder="ملاحظات للسجل (اختياري)..." rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkActionOpen(null)}>إلغاء</Button>
            <Button onClick={runBulkStatus} disabled={!bulkStatus}>تطبيق على {selectedIds.size} شحنة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkActionOpen === 'assign'} onOpenChange={(v) => !v && setBulkActionOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إسناد شحنات لمقاول ({selectedIds.size} شحنة)</DialogTitle>
            <DialogDescription>سيتم تحديث المقاول المسؤول عن كل الشحنات المحددة. مفيد لتجميع شحنات رحلة واحدة.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Select value={bulkContractor} onValueChange={setBulkContractor}>
              <SelectTrigger><SelectValue placeholder="اختر المقاول..." /></SelectTrigger>
              <SelectContent>
                {contractorsList.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkActionOpen(null)}>إلغاء</Button>
            <Button onClick={runBulkAssign} disabled={!bulkContractor}>إسناد {selectedIds.size} شحنة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ShipmentCreateDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const { toast } = useToast()
  const [loading, setLoading] = React.useState(false)
  const [err, setErr] = React.useState('')
  const { data: parties } = useSWR<{ items: any[] }>('/api/parties?type=customer', fetcher)
  const { data: contractors } = useSWR<{ items: any[] }>('/api/parties?type=contractor', fetcher)
  const { data: branches } = useSWR<{ items: any[] }>('/api/branches', fetcher)
  const { data: warehousesRes } = useSWR<{ items: any[] }>('/api/warehouses', fetcher)
  const { items: loadTypeItems } = useLookup('load_type')
  const { items: statusItemsForCreate } = useLookup('shipment_status')
  const STATUS_OPTIONS_CREATE = statusItemsForCreate.map((i) => ({ value: i.key, label: i.label }))
  const LOAD_TYPE_OPTIONS = loadTypeItems.map((i) => ({ value: i.key, label: i.label }))

  const [v, setV] = React.useState<any>({
    recipientName: '', destination: '', loadType: '', customerId: '', contractorId: '',
    branchId: '', warehouseId: '', date: new Date().toISOString().slice(0, 10),
    freightCost: '', freightTotal: '', notes: '', status: 'new',
  })
  React.useEffect(() => {
    if (open) {
      setV({ recipientName: '', destination: '', loadType: '', customerId: '', contractorId: '', branchId: '', warehouseId: '', date: new Date().toISOString().slice(0, 10), freightCost: '', freightTotal: '', notes: '', status: 'new' })
      setErr('')
    }
  }, [open])

  const submit = async () => {
    setLoading(true); setErr('')
    try {
      await apiPost('/api/shipments', { ...v, userName: 'admin' })
      onOpenChange(false); onCreated()
    } catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>إنشاء شحنة جديدة</DialogTitle>
          <DialogDescription>أدخل بيانات الشحنة. الحقول النجمية مطلوبة.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <div className="col-span-2">
            <label className="text-xs font-medium">العميل / المستلم *</label>
            <Select value={v.customerId} onValueChange={(val) => setV({ ...v, customerId: val === '__' ? '' : val, recipientName: parties?.items.find(p => p.id === val)?.name || '' })}>
              <SelectTrigger><SelectValue placeholder="اختر عميلاً..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__">— بدون —</SelectItem>
                {(parties?.items ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium">الوجهة (المدينة)</label>
            <Input value={v.destination} onChange={(e) => setV({ ...v, destination: e.target.value })} placeholder="القاهرة، الإسكندرية..." />
          </div>
          <div>
            <label className="text-xs font-medium">نوع الحمولة</label>
            <Select value={v.loadType} onValueChange={(val) => setV({ ...v, loadType: val === '__' ? '' : val })}>
              <SelectTrigger><SelectValue placeholder="اختر الحجم..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__">— غير محدد —</SelectItem>
                {LOAD_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium">المقاول/الناقل</label>
            <Select value={v.contractorId} onValueChange={(val) => setV({ ...v, contractorId: val === '__' ? '' : val })}>
              <SelectTrigger><SelectValue placeholder="اختر مقاولًا..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__">— بدون —</SelectItem>
                {(contractors?.items ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium">الفرع</label>
            <Select value={v.branchId} onValueChange={(val) => setV({ ...v, branchId: val === '__' ? '' : val })}>
              <SelectTrigger><SelectValue placeholder="اختر فرعًا..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__">— بدون —</SelectItem>
                {(branches?.items ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium">المخزن</label>
            <Select value={v.warehouseId} onValueChange={(val) => setV({ ...v, warehouseId: val === '__' ? '' : val })}>
              <SelectTrigger><SelectValue placeholder="اختر مخزنًا..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__">— بدون —</SelectItem>
                {(warehousesRes?.items ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium">تاريخ الشحن</label>
            <Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
          </div>
          <div>
            <label className="text-xs font-medium">الحالة</label>
            <Select value={v.status} onValueChange={(val) => setV({ ...v, status: val })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS_CREATE.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium">تكلفة النولون</label>
            <Input type="number" value={v.freightCost} onChange={(e) => setV({ ...v, freightCost: e.target.value })} placeholder="0" />
          </div>
          <div>
            <label className="text-xs font-medium">إجمالي النولون</label>
            <Input type="number" value={v.freightTotal} onChange={(e) => setV({ ...v, freightTotal: e.target.value })} placeholder="0" />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-medium">ملاحظات</label>
            <Textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} rows={2} />
          </div>
        </div>
        {err && <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={submit} disabled={loading || !v.recipientName}>{loading ? 'جاري الحفظ...' : 'حفظ الشحنة'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ShipmentDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { toast } = useToast()
  const { confirmDelete, confirm: confirmDialog } = useConfirm()
  // صلاحية رؤية الأسعار — تتحكم في إظهار المبالغ المالية في بطاقة الشحنة
  const canPrices = useCanPrices()
  const { data: shipment, mutate } = useSWR<any>(`/api/shipments/${id}`, fetcher)
  const { items: statusItems } = useLookup('shipment_status')
  const { items: collectionItems } = useLookup('collection_status')
  const [statusOpen, setStatusOpen] = React.useState(false)
  const [newStatus, setNewStatus] = React.useState('')
  const [statusNotes, setStatusNotes] = React.useState('')
  const [waybillOpen, setWaybillOpen] = React.useState(false)
  const [codOpen, setCodOpen] = React.useState(false)
  const [codCustomerAmount, setCodCustomerAmount] = React.useState('')
  const [codContractorAmount, setCodContractorAmount] = React.useState('')

  React.useEffect(() => {
    if (shipment && codOpen) {
      setCodCustomerAmount(String(shipment.freightTotal ?? 0))
      setCodContractorAmount(String(shipment.totalSuppliers ?? shipment.freightCost ?? 0))
    }
  }, [shipment, codOpen])

  if (!shipment) return <Skeleton className="h-96 rounded-xl" />

  const STATUS_LOOKUP: Record<string, { label: string; tone: string }> = Object.fromEntries(
    statusItems.map((i) => [i.key, { label: i.label, tone: i.tone || '' }]),
  )
  const COLLECTION_LOOKUP: Record<string, { label: string; tone: string }> = Object.fromEntries(
    collectionItems.map((i) => [i.key, { label: i.label, tone: i.tone || '' }]),
  )
  const sMeta = STATUS_LOOKUP[shipment.status] || { label: shipment.status, tone: '' }
  const cMeta = COLLECTION_LOOKUP[shipment.collectionStatus] || { label: shipment.collectionStatus, tone: '' }
  const margin = (Number(shipment.freightTotal ?? 0)) - (Number(shipment.totalSuppliers ?? 0))

  const changeStatus = async () => {
    if (!newStatus) return
    // تأكيد قبل تغيير الحالة — تشغيلية جوهرية (primary)
    const targetLabel = STATUS_LOOKUP[newStatus]?.label ?? newStatus
    const ok = await confirmDialog({
      title: 'تغيير حالة الشحنة',
      message: `سيتم تغيير حالة الشحنة إلى «${targetLabel}». هل تريد المتابعة؟`,
      variant: 'primary',
      confirmText: 'تغيير الحالة',
    })
    if (!ok) return
    try {
      await apiPost(`/api/shipments/${id}/status`, { status: newStatus, notes: statusNotes, userName: 'admin' })
      toast({ title: 'تم تحديث الحالة' })
      setStatusOpen(false); setNewStatus(''); setStatusNotes('')
      mutate()
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  const settleCOD = async () => {
    try {
      const res = await apiPost(`/api/shipments/${id}/settle-cod`, {
        customerAmount: Number(codCustomerAmount) || 0,
        contractorAmount: Number(codContractorAmount) || 0,
        userName: 'admin',
      })
      toast({ title: 'تمت تسوية COD', description: `قبض ${res.receiptVoucherNo ?? '—'} • صرف ${res.paymentVoucherNo ?? '—'}` })
      setCodOpen(false)
      mutate()
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  const remove = async () => {
    const ok = await confirmDelete({
      title: 'حذف الشحنة',
      message: 'هل تريد حذف هذه الشحنة؟ لا يمكن التراجع.',
    })
    if (!ok) return
    try {
      await apiDelete(`/api/shipments/${id}`)
      toast({ title: 'تم الحذف' })
      onBack()
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="size-4" /> رجوع للقائمة</Button>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setWaybillOpen(true)}><Printer className="size-4" /> طباعة بوليصة</Button>
          {/* تسوية COD تتطلب صلاحية الأسعار (تتعامل مع مبالغ) */}
          {canPrices && <Button variant="outline" size="sm" onClick={() => setCodOpen(true)}><Banknote className="size-4" /> تسوية COD</Button>}
          <Button variant="outline" size="sm" onClick={() => setStatusOpen(true)}>تغيير الحالة</Button>
          <Button variant="outline" size="sm" className="text-destructive" onClick={remove}><Trash2 className="size-4" /> حذف</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div>
              <div className="text-xs text-muted-foreground">رقم الشحنة</div>
              <div className="text-2xl font-bold font-mono">{shipment.shipmentNo}</div>
              {shipment.billNo && <div className="text-sm text-muted-foreground tnum mt-1">بوليصة: {shipment.billNo}</div>}
            </div>
            <div className="flex gap-2 flex-wrap">
              <Badge variant="outline" className={cn('font-bold', sMeta.tone)}>{sMeta.label}</Badge>
              <Badge variant="outline" className={cn('font-bold', cMeta.tone)}>{cMeta.label}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* شريط هامش الربح — يُعرض فقط لمن يملك صلاحية الأسعار */}
      {canPrices && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-xs text-muted-foreground">نولون العميل (بيع)</div>
              <div className="text-lg font-bold tnum num-ltr">{fmtNum(shipment.freightTotal ?? 0)} ج.م</div>
            </div>
            <div className="border-x border-border/60">
              <div className="text-xs text-muted-foreground">نولون المقاول (تكلفة)</div>
              <div className="text-lg font-bold tnum num-ltr">{fmtNum(shipment.totalSuppliers ?? 0)} ج.م</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">هامش الربح (صافي)</div>
              <div className={cn('text-lg font-bold tnum num-ltr', margin >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400')}>
                {fmtNum(margin)} ج.م
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4 space-y-2 text-sm">
            <h3 className="font-semibold mb-2">بيانات العميل والتسليم</h3>
            <Row label="العميل" value={shipment.customer?.name || shipment.recipientName || '-'} />
            <Row label="جهة الشحن" value={shipment.shipToParty || '-'} />
            <Row label="هاتف التوصيل" value={shipment.deliveryPhones || '-'} ltr />
            <Row label="الوجهة" value={shipment.destination || '-'} />
            <Row label="الوجهة (EN)" value={shipment.destinationEn || '-'} ltr />
            <Row label="خط السير/التكويد" value={shipment.routeCode || '-'} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-2 text-sm">
            <h3 className="font-semibold mb-2">بيانات التشغيل</h3>
            <Row label="الفرع" value={shipment.branch?.name || '-'} />
            <Row label="المخزن" value={shipment.warehouse?.name || '-'} />
            <Row label="المقاول" value={shipment.contractor?.name || '-'} />
            <Row label="نوع الحمولة" value={shipment.loadType || '-'} />
            <Row label="رقم السيارة" value={shipment.vehicleNo || '-'} ltr />
            <Row label="الكمية (سياسات)" value={fmtNum(shipment.policyQty)} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* بطاقة المبالغ المالية — تُعرض فقط لمن يملك صلاحية الأسعار */}
        {canPrices ? (
          <Card>
            <CardContent className="p-4 space-y-2 text-sm">
              <h3 className="font-semibold mb-2">المبالغ المالية</h3>
              <Row label="تكلفة النولون" value={`${fmtNum(shipment.freightCost)} ج.م`} money />
              <Row label="إجمالي النولون" value={`${fmtNum(shipment.freightTotal)} ج.م`} money bold />
              <Row label="سعر البيع" value={`${fmtNum(shipment.salePrice ?? 0)} ج.م`} money />
              <Row label="تحصيل العميل" value={`${fmtNum(shipment.customerPay)} ج.م`} money />
              <Row label="إجمالي الموردين" value={`${fmtNum(shipment.totalSuppliers)} ج.م`} money bold />
              <Row label="التعتيق" value={`${fmtNum(shipment.aging)} ج.م`} money />
              <Row label="المبيت" value={`${fmtNum(shipment.overnight)} ج.م`} money />
              <Row label="المرتجع" value={`${fmtNum(shipment.returns)} ج.م`} money />
              <Row label="التحويلة" value={`${fmtNum(shipment.transfer)} ج.م`} money />
              <Row label="أخرى / Drop" value={`${fmtNum((shipment.other ?? 0) + (shipment.drop ?? 0))} ج.م`} money />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-4 space-y-2 text-sm">
              <h3 className="font-semibold mb-2">المبالغ المالية</h3>
              <p className="text-xs text-muted-foreground">المبالغ المالية محجوبة — لا تملك صلاحية رؤية الأسعار.</p>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="p-4 space-y-2 text-sm">
            <h3 className="font-semibold mb-2">التواريخ والملاحظات</h3>
            <Row label="تاريخ الشحن" value={fmtDate(shipment.date)} />
            <Row label="تاريخ (2)" value={fmtDate(shipment.date2)} />
            <Row label="تاريخ التسليم الفعلي" value={fmtDate(shipment.actualDeliveryDate)} />
            <Row label="ملاحظات" value={shipment.notes || '-'} />
            <Row label="ملاحظة ص" value={shipment.note1 || '-'} />
          </CardContent>
        </Card>
      </div>

      {/* Linked vouchers */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold mb-3 text-sm flex items-center gap-2">
            <Link2 className="size-4 text-muted-foreground" /> السندات المرتبطة بالشحنة
          </h3>
          {(shipment.vouchers ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد سندات مرتبطة بهذه الشحنة. استخدم «تسوية COD» لتوليد سندات قبض/صرف تلقائية.</p>
          ) : (
            <div className="space-y-2">
              {(shipment.vouchers ?? []).map((v: any) => (
                <div key={v.id} className="flex items-center justify-between gap-3 text-sm border-b last:border-0 pb-2 last:pb-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={v.type === 'receipt' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'}>
                      {v.type === 'receipt' ? 'قبض' : 'صرف'}
                    </Badge>
                    <span className="font-mono text-xs font-bold">{v.voucherNo}</span>
                    <span className="text-xs text-muted-foreground truncate-1">{v.description || '-'}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* مبلغ السند — يُعرض فقط لمن يملك صلاحية الأسعار */}
                    {canPrices && <span className="tnum font-bold text-sm">{fmtNum(v.amount)} ج.م</span>}
                    <span className="text-[10px] text-muted-foreground tnum">{fmtDate(v.date)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status history */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold mb-3 text-sm flex items-center gap-2">
            <Layers className="size-4 text-muted-foreground" /> سجل تغييرات الحالة
          </h3>
          {shipment.statusHistory?.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا يوجد سجل تغييرات.</p>
          ) : (
            <div className="space-y-2">
              {(shipment.statusHistory ?? []).map((h: any, i: number) => {
                const statusKey = h.toStatus ?? h.status
                const statusLabel = STATUS_LOOKUP[statusKey]?.label || statusKey
                const statusTone = STATUS_LOOKUP[statusKey]?.tone || ''
                return (
                  <div key={h.id ?? i} className="flex items-center gap-3 text-sm border-b last:border-0 pb-2 last:pb-0 flex-wrap">
                    <Badge variant="outline" className={statusTone}>{statusLabel}</Badge>
                    {h.fromStatus && <span className="text-muted-foreground text-xs">من {STATUS_LOOKUP[h.fromStatus]?.label || h.fromStatus}</span>}
                    <span className="text-xs text-muted-foreground tnum">{fmtDateTime(h.changedAt ?? h.date)}</span>
                    <span className="text-xs text-muted-foreground">— {h.userName}</span>
                    {h.notes && <span className="text-xs text-muted-foreground">• {h.notes}</span>}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status change dialog */}
      <Dialog open={statusOpen} onOpenChange={setStatusOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>تغيير حالة الشحنة</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Select value={newStatus} onValueChange={setNewStatus}>
              <SelectTrigger><SelectValue placeholder="اختر الحالة الجديدة..." /></SelectTrigger>
              <SelectContent>
                {statusItems.map((i) => <SelectItem key={i.key} value={i.key}>{i.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Textarea value={statusNotes} onChange={(e) => setStatusNotes(e.target.value)} placeholder="ملاحظات (اختياري)..." rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusOpen(false)}>إلغاء</Button>
            <Button onClick={changeStatus}>تأكيد</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* COD settlement dialog */}
      <Dialog open={codOpen} onOpenChange={setCodOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تسوية الدفع عند الاستلام (COD)</DialogTitle>
            <DialogDescription>
              يصدر النظام سند قبض من العميل بقيمة نولون العميل وسند صرف للمقاول بقيمة نولون المقاول — مع قيود يومية تلقائية — ويُحدّث حالة التحصيل.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div>
              <label className="text-xs font-medium">سند قبض من العميل (ج.م)</label>
              <Input type="number" value={codCustomerAmount} onChange={(e) => setCodCustomerAmount(e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-0.5">قيمة نولون العميل — يصدر سند قبض للعميل ويُرحّل في الصندوق ومديونية العميل.</p>
            </div>
            <div>
              <label className="text-xs font-medium">سند صرف للمقاول (ج.م)</label>
              <Input type="number" value={codContractorAmount} onChange={(e) => setCodContractorAmount(e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-0.5">قيمة نولون المقاول — يصدر سند صرف للمقاول ويُرحّل في الصندوق ومستحقات المقاولين.</p>
            </div>
          </div>
          <div className="text-xs text-muted-foreground bg-muted/30 rounded-md p-2">
            العميل: <b>{shipment.customer?.name || shipment.recipientName || '-'}</b> — المقاول: <b>{shipment.contractor?.name || '-'}</b>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCodOpen(false)}>إلغاء</Button>
            <Button onClick={settleCOD}><Banknote className="size-4" /> تأكيد التسوية</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Waybill print */}
      <WaybillPrint shipment={shipment} open={waybillOpen} onOpenChange={setWaybillOpen} />
    </div>
  )
}

function Row({ label, value, ltr, money, bold }: { label: string; value: string; ltr?: boolean; money?: boolean; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 border-b last:border-0">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={cn('text-right', ltr && 'dir-ltr font-mono', money && 'tnum', bold && 'font-bold')} dir={ltr ? 'ltr' : undefined}>{value}</span>
    </div>
  )
}
