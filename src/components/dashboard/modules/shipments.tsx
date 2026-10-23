'use client'

import * as React from 'react'
import useSWR from 'swr'
import { Plus, PackageSearch, Filter, X, Search, Printer, ArrowLeft, Trash2 } from 'lucide-react'
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
import { EntityFormDialog } from '../entity-dialog'
import { fetcher, apiPost, apiDelete } from '@/lib/api'
import { fmtNum, fmtDate, fmtDateTime } from '@/lib/format'
import { useToast } from '@/hooks/use-toast'
import { useLookup } from '@/lib/lookups'
import { cn } from '@/lib/utils'

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
  // Dynamic shipment status options from the lookup table
  const { items: statusItems } = useLookup('shipment_status')
  const STATUS_OPTIONS = statusItems.map((i) => ({ value: i.key, label: i.label, tone: i.tone }))
  const STATUS_LABEL: Record<string, { label: string; tone: string }> = Object.fromEntries(
    statusItems.map((i) => [i.key, { label: i.label, tone: i.tone || '' }]),
  )
  const [q, setQ] = React.useState('')
  const [status, setStatus] = React.useState<string>('all')
  const [destination, setDestination] = React.useState<string>('all')
  const [page, setPage] = React.useState(1)
  const [debouncedQ, setDebouncedQ] = React.useState('')
  const [showFilters, setShowFilters] = React.useState(false)
  const [addOpen, setAddOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<string | null>(null)

  React.useEffect(() => { const t = setTimeout(() => { setDebouncedQ(q); setPage(1) }, 350); return () => clearTimeout(t) }, [q])

  const params = new URLSearchParams()
  if (debouncedQ) params.set('q', debouncedQ)
  if (status !== 'all') params.set('status', status)
  if (destination !== 'all') params.set('destination', destination)
  params.set('page', String(page))
  params.set('pageSize', '20')
  const { data, error, isLoading, mutate } = useSWR<ShipmentsResponse>(`/api/shipments?${params.toString()}`, fetcher, { keepPreviousData: true, refreshInterval: 30000 })

  // Load filter options (destinations) — derive from stats endpoint
  const { data: stats } = useSWR<{ destinations: { name: string }[] }>('/api/stats', fetcher)
  const destinations = stats?.destinations.map((d) => d.name) ?? []

  const hasFilters = debouncedQ || status !== 'all' || destination !== 'all'

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
          <Button onClick={() => setAddOpen(true)} className="flex-1 sm:flex-none">
            <Plus className="size-4" /> <span className="hidden sm:inline">شحنة جديدة</span><span className="sm:hidden">جديد</span>
          </Button>
        </div>
      </div>

      {showFilters && (
        <Card>
          <CardContent className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
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
            {hasFilters && <Button variant="ghost" onClick={() => { setQ(''); setStatus('all'); setDestination('all'); setPage(1) }} className="sm:col-span-2 justify-start"><X className="size-4" /> مسح المرشحات</Button>}
          </CardContent>
        </Card>
      )}

      <div className="text-xs text-muted-foreground tnum">إجمالي النتائج: <b className="text-foreground">{fmtNum(data?.total ?? 0)}</b>{data && ` • صفحة ${data.page} من ${data.totalPages}`}</div>

      {/* Mobile: card view */}
      {data && data.items.length > 0 && (
        <div className="sm:hidden space-y-2">
          {data.items.map((s) => {
            const size = s.loadType === '1.5TON' ? '1.5ط' : s.loadType === '3TON' ? '3ط' : s.loadType === '6M' ? '6م' : '-'
            const sizeTone = s.loadType === '1.5TON' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
              : s.loadType === '3TON' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300'
              : 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
            const sMeta = STATUS_LABEL[s.status] || { label: s.status, tone: '' }
            return (
              <div
                key={s.id}
                onClick={() => setSelected(s.id)}
                className="rounded-2xl border border-border bg-card elev-sm p-3 cursor-pointer hover:bg-muted/40 transition-colors active:scale-[0.99] space-y-2"
              >
                {/* Title row: shipment no + status badge */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs font-bold truncate-1">{s.shipmentNo}</div>
                    <div className="font-semibold text-sm truncate-1 mt-0.5" title={s.customer?.name || s.recipientName || ''}>
                      {s.customer?.name || s.recipientName || '-'}
                    </div>
                    {s.billNo && <div className="text-[10px] text-muted-foreground tnum truncate-1">بوليصة: {s.billNo}</div>}
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
                  <div className="min-w-0">
                    <div className="text-[10px] text-muted-foreground/70">النولون</div>
                    <div className="text-xs font-bold tnum num-ltr">{fmtNum(s.freightTotal ?? s.freightCost)} ج.م</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] text-muted-foreground/70">الموردين</div>
                    <div className="text-xs font-bold tnum num-ltr">{fmtNum(s.totalSuppliers ?? 0)} ج.م</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Desktop: table view */}
      <Card className="overflow-hidden hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 1000 }}>
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr className="text-right">
                <th className="font-medium px-3 py-2.5">رقم الشحنة</th>
                <th className="font-medium px-3 py-2.5">العميل / المستلم</th>
                <th className="font-medium px-3 py-2.5">الوجهة</th>
                <th className="font-medium px-3 py-2.5">الحجم</th>
                <th className="font-medium px-3 py-2.5">المقاول</th>
                <th className="font-medium px-3 py-2.5">التاريخ</th>
                <th className="font-medium px-3 py-2.5">الحالة</th>
                <th className="font-medium px-3 py-2.5 text-left">النولون</th>
                <th className="font-medium px-3 py-2.5 text-left">الموردين</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && !data ? (
                Array.from({ length: 10 }).map((_, i) => <tr key={i}><td colSpan={9}><Skeleton className="h-12 m-1" /></td></tr>)
              ) : data && data.items.length > 0 ? (
                data.items.map((s, i) => {
                  const size = s.loadType === '1.5TON' ? '1.5ط' : s.loadType === '3TON' ? '3ط' : s.loadType === '6M' ? '6م' : '-'
                  const sizeTone = s.loadType === '1.5TON' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    : s.loadType === '3TON' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300'
                    : 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                  const sMeta = STATUS_LABEL[s.status] || { label: s.status, tone: '' }
                  return (
                    <tr key={s.id} onClick={() => setSelected(s.id)} className={cn('border-t border-border hover:bg-muted/40 cursor-pointer', i % 2 ? 'bg-card' : 'bg-muted/15')}>
                      <td className="px-3 py-2.5">
                        <div className="font-mono text-xs font-bold truncate-1">{s.shipmentNo}</div>
                        {s.billNo && <div className="text-[10px] text-muted-foreground tnum truncate-1">بوليصة: {s.billNo}</div>}
                      </td>
                      <td className="px-3 py-2.5 min-w-0">
                        <div className="font-medium truncate-1 max-w-[180px]" title={s.customer?.name || s.recipientName || ''}>
                          {s.customer?.name || s.recipientName || '-'}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 min-w-0">
                        <div className="font-medium truncate-1 max-w-[140px]">{s.destination ?? '-'}</div>
                        {s.routeCode && <div className="text-[10px] text-muted-foreground truncate-1">كود: {s.routeCode}</div>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <Badge variant="outline" className={cn('font-bold', sizeTone)}>{size}</Badge>
                        {s.policyQty != null && <div className="text-[10px] text-muted-foreground tnum mt-0.5">كمية: {fmtNum(s.policyQty)}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-xs min-w-0"><span className="truncate-1 block max-w-[120px]">{s.contractor?.name ?? '-'}</span></td>
                      <td className="px-3 py-2.5 text-xs tnum whitespace-nowrap">{fmtDate(s.date)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <Badge variant="outline" className={sMeta.tone}>{sMeta.label}</Badge>
                      </td>
                      <td className="px-3 py-2.5 text-left font-bold tnum whitespace-nowrap num-ltr">{fmtNum(s.freightTotal ?? s.freightCost)}</td>
                      <td className="px-3 py-2.5 text-left tnum whitespace-nowrap num-ltr">{fmtNum(s.totalSuppliers ?? 0)}</td>
                    </tr>
                  )
                })
              ) : (
                <tr><td colSpan={9} className="py-16 text-center text-muted-foreground">
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

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>السابق</Button>
          <span className="text-xs text-muted-foreground tnum">{page} / {data.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}>التالي</Button>
        </div>
      )}

      {/* Add dialog */}
      <ShipmentCreateDialog open={addOpen} onOpenChange={setAddOpen} onCreated={() => { mutate(); toast({ title: 'تم إنشاء الشحنة بنجاح' }) }} />
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
  const { data: shipment, mutate } = useSWR<any>(`/api/shipments/${id}`, fetcher)
  const { items: statusItems } = useLookup('shipment_status')
  const { items: collectionItems } = useLookup('collection_status')
  const [statusOpen, setStatusOpen] = React.useState(false)
  const [newStatus, setNewStatus] = React.useState('')
  const [statusNotes, setStatusNotes] = React.useState('')

  if (!shipment) return <Skeleton className="h-96 rounded-xl" />

  const STATUS_LOOKUP: Record<string, { label: string; tone: string }> = Object.fromEntries(
    statusItems.map((i) => [i.key, { label: i.label, tone: i.tone || '' }]),
  )
  const COLLECTION_LOOKUP: Record<string, { label: string; tone: string }> = Object.fromEntries(
    collectionItems.map((i) => [i.key, { label: i.label, tone: i.tone || '' }]),
  )
  const sMeta = STATUS_LOOKUP[shipment.status] || { label: shipment.status, tone: '' }
  const cMeta = COLLECTION_LOOKUP[shipment.collectionStatus] || { label: shipment.collectionStatus, tone: '' }

  const changeStatus = async () => {
    if (!newStatus) return
    try {
      await apiPost(`/api/shipments/${id}/status`, { status: newStatus, notes: statusNotes, userName: 'admin' })
      toast({ title: 'تم تحديث الحالة' })
      setStatusOpen(false); setNewStatus(''); setStatusNotes('')
      mutate()
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  const remove = async () => {
    if (!confirm('هل تريد حذف هذه الشحنة؟ لا يمكن التراجع.')) return
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
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="size-4" /> طباعة بوليصة</Button>
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
            <div className="flex gap-2">
              <Badge variant="outline" className={cn('font-bold', sMeta.tone)}>{sMeta.label}</Badge>
              <Badge variant="outline" className={cn('font-bold', cMeta.tone)}>{cMeta.label}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

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

      {/* Status history */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold mb-3 text-sm">سجل تغييرات الحالة</h3>
          {shipment.statusHistory?.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا يوجد سجل تغييرات.</p>
          ) : (
            <div className="space-y-2">
              {shipment.statusHistory.map((h: any) => (
                <div key={h.id} className="flex items-center gap-3 text-sm border-b last:border-0 pb-2 last:pb-0">
                  <Badge variant="outline" className={STATUS_LOOKUP[h.toStatus]?.tone || ''}>{STATUS_LOOKUP[h.toStatus]?.label || h.toStatus}</Badge>
                  {h.fromStatus && <span className="text-muted-foreground text-xs">من {STATUS_LOOKUP[h.fromStatus]?.label || h.fromStatus}</span>}
                  <span className="text-xs text-muted-foreground tnum">{fmtDateTime(h.changedAt)}</span>
                  <span className="text-xs text-muted-foreground">— {h.userName}</span>
                  {h.notes && <span className="text-xs text-muted-foreground">• {h.notes}</span>}
                </div>
              ))}
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
