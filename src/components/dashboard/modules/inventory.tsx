'use client'

import * as React from 'react'
import useSWR from 'swr'
import { Plus, Pencil, Trash2, Boxes, AlertTriangle, ArrowRightLeft } from 'lucide-react'
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
import { EntityFormDialog, type Field } from '../entity-dialog'
import { DataTable } from '../data-table'
import { fetcher, apiPost, apiPatch, apiDelete } from '@/lib/api'
import { fmtNum, fmtDate, MOVEMENT_TYPE } from '@/lib/format'
import { useLookup } from '@/lib/lookups'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

export function InventoryModule() {
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<any>(null)
  const [lowOnly, setLowOnly] = React.useState(false)
  const { data, isLoading, mutate } = useSWR<{ items: any[] }>(`/api/items?lowStock=${lowOnly ? '1' : '0'}`, fetcher, { refreshInterval: 30000 })
  const { data: warehouses } = useSWR<{ items: any[] }>('/api/warehouses', fetcher)

  const fields: Field[] = [
    { name: 'code', label: 'كود/باركود', type: 'text' },
    { name: 'name', label: 'اسم الصنف *', type: 'text', span: 2 },
    { name: 'nameEn', label: 'الاسم (EN)', type: 'text', span: 2 },
    { name: 'unit', label: 'وحدة القياس', type: 'text' },
    { name: 'reorderLevel', label: 'حد إعادة الطلب', type: 'number' },
    { name: 'cost', label: 'التكلفة', type: 'number' },
    { name: 'price', label: 'سعر البيع', type: 'number' },
    { name: 'warehouseId', label: 'المخزن الافتراضي', type: 'select', options: (warehouses?.items ?? []).map((w) => ({ value: w.id, label: w.name })) },
    { name: 'notes', label: 'ملاحظات', type: 'textarea', span: 2 },
  ]

  const submit = async (vals: any) => {
    const payload = { ...vals, userName: 'admin' }
    if (editing) {
      await apiPatch(`/api/items/${editing.id}`, payload)
      toast({ title: 'تم التحديث' })
    } else {
      await apiPost('/api/items', payload)
      toast({ title: 'تمت الإضافة' })
    }
    mutate()
  }

  const del = async (id: string) => {
    if (!confirm('حذف الصنف؟')) return
    try { await apiDelete(`/api/items/${id}`); mutate(); toast({ title: 'تم الحذف' }) }
    catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="text-sm text-muted-foreground tnum">{data?.items.length ?? 0} صنف</div>
          <Button variant={lowOnly ? 'default' : 'outline'} size="sm" onClick={() => setLowOnly((v) => !v)}>
            <AlertTriangle className="size-4" /> {lowOnly ? 'كل الأصناف' : 'منخفض المخزون فقط'}
          </Button>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true) }} size="sm"><Plus className="size-4" /> صنف جديد</Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : data && data.items.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <Boxes className="size-10 mx-auto mb-2 opacity-50" />
          {lowOnly ? 'لا أصناف منخفضة المخزون' : 'لا توجد أصناف بعد'}
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {data?.items.map((it) => (
            <Card key={it.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="flex items-center justify-center size-10 rounded-lg bg-primary/10 text-primary"><Boxes className="size-5" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm leading-tight truncate">{it.name}</div>
                      {it.code && <div className="text-[11px] text-muted-foreground tnum">{it.code}</div>}
                    </div>
                  </div>
                  <div className="flex gap-0.5">
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(it); setOpen(true) }}><Pencil className="size-3.5" /></Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => del(it.id)}><Trash2 className="size-3.5" /></Button>
                  </div>
                </div>
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">الرصيد</span>
                    <span className={cn('font-bold tnum', it.isLowStock && 'text-rose-600')}>
                      {fmtNum(it.balance)} {it.unit || ''}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">حد الطلب</span>
                    <span className="tnum">{fmtNum(it.reorderLevel ?? 0)} {it.unit || ''}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">التكلفة</span>
                    <span className="tnum">{fmtNum(it.cost)} ج.م</span>
                  </div>
                  {it.isLowStock && (
                    <Badge variant="outline" className="bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                      <AlertTriangle className="size-3 ml-1" /> مخزون منخفض
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <EntityFormDialog open={open} onOpenChange={setOpen} title={editing ? 'تعديل صنف' : 'إضافة صنف'} fields={fields} initial={editing ?? {}} onSubmit={submit} />
    </div>
  )
}

export function MovementsModule() {
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const { data, isLoading, mutate } = useSWR<{ items: any[] }>('/api/movements', fetcher, { refreshInterval: 30000 })
  const { data: items } = useSWR<{ items: any[] }>('/api/items', fetcher)
  const { data: warehouses } = useSWR<{ items: any[] }>('/api/warehouses', fetcher)
  // Dynamic movement type labels (with fallback to the hardcoded constant)
  const { items: movementTypeItems } = useLookup('movement_type')
  const MOVE_LABEL: Record<string, { label: string; tone: string }> = Object.fromEntries(
    movementTypeItems.map((i) => [i.key, { label: i.label, tone: i.tone || '' }]),
  )

  const [v, setV] = React.useState<any>({ type: 'receipt', itemId: '', warehouseId: '', toWarehouseId: '', quantity: 1, unitCost: '', notes: '' })
  React.useEffect(() => { if (open) setV({ type: 'receipt', itemId: '', warehouseId: '', toWarehouseId: '', quantity: 1, unitCost: '', notes: '' }) }, [open])
  const [loading, setLoading] = React.useState(false)
  const [err, setErr] = React.useState('')

  const submit = async () => {
    setLoading(true); setErr('')
    try {
      await apiPost('/api/movements', { ...v, quantity: Number(v.quantity), unitCost: v.unitCost ? Number(v.unitCost) : null, userName: 'admin' })
      toast({ title: 'تم تسجيل الحركة' }); setOpen(false); mutate()
    } catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }

  const columns = [
    { key: 'date', header: 'التاريخ', align: 'center' as const, width: 'w-32', hideInCard: true, render: (m: any) => <span className="text-xs tnum">{fmtDate(m.date)}</span> },
    { key: 'type', header: 'النوع', primary: true, align: 'center' as const, width: 'w-36', render: (m: any) => {
      const lookup = MOVE_LABEL[m.type]
      const fallback = MOVEMENT_TYPE[m.type]
      const label = lookup?.label || fallback?.label || m.type
      const tone = lookup?.tone || fallback?.tone || ''
      return <Badge variant="outline" className={tone}>{label}</Badge>
    } },
    { key: 'item', header: 'الصنف', primary: true, render: (m: any) => <div className="min-w-0"><div className="font-medium text-sm truncate-1">{m.item?.name}</div>{m.item?.code && <div className="text-[10px] text-muted-foreground tnum">{m.item.code}</div>}</div> },
    { key: 'warehouse', header: 'المخزن', hideInCard: true, width: 'w-32', render: (m: any) => <span className="text-xs">{m.warehouse?.name || '-'}</span> },
    { key: 'qty', header: 'الكمية', align: 'left' as const, width: 'w-28', render: (m: any) => {
      return <span className={cn('tnum font-bold whitespace-nowrap', m.quantity < 0 ? 'text-rose-600' : 'text-emerald-600')}>{m.quantity > 0 ? '+' : ''}{fmtNum(m.quantity)} {m.item?.unit || ''}</span>
    } },
    { key: 'cost', header: 'التكلفة', align: 'left' as const, width: 'w-28', render: (m: any) => <span className="tnum">{m.totalCost ? fmtNum(m.totalCost) + ' ج.م' : '-'}</span> },
    { key: 'notes', header: 'ملاحظات', render: (m: any) => <span className="text-xs text-muted-foreground truncate-1 block">{m.notes || '-'}</span> },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground tnum">{data?.items.length ?? 0} حركة</div>
        <Button onClick={() => setOpen(true)} size="sm" className="shrink-0"><Plus className="size-4" /> <span className="hidden sm:inline">حركة جديدة</span><span className="sm:hidden">حركة</span></Button>
      </div>
      <DataTable rows={data?.items ?? []} columns={columns} loading={isLoading} getRowKey={(m: any) => m.id} minW={900} searchFn={(m, q) => (m.item?.name || '').toLowerCase().includes(q)} searchPlaceholder="بحث بالصنف..." />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تسجيل حركة مخزون</DialogTitle>
            <DialogDescription>الحركات تؤثر على الرصيد مباشرة. لا يسمح برصيد سالب (إلا بصلاحية).</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2">
              <label className="text-xs font-medium">نوع الحركة *</label>
              <Select value={v.type} onValueChange={(val) => setV({ ...v, type: val })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {movementTypeItems
                    .filter((i) => MOVEMENT_TYPE[i.key]) // only show types with valid sign logic
                    .map((i) => <SelectItem key={i.key} value={i.key}>{i.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium">الصنف *</label>
              <Select value={v.itemId} onValueChange={(val) => setV({ ...v, itemId: val })}>
                <SelectTrigger><SelectValue placeholder="اختر صنفًا..." /></SelectTrigger>
                <SelectContent>
                  {(items?.items ?? []).map((it) => <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium">المخزن *</label>
              <Select value={v.warehouseId} onValueChange={(val) => setV({ ...v, warehouseId: val })}>
                <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                <SelectContent>
                  {(warehouses?.items ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {v.type === 'transfer' && (
              <div>
                <label className="text-xs font-medium">مخزن الاستلام *</label>
                <Select value={v.toWarehouseId} onValueChange={(val) => setV({ ...v, toWarehouseId: val })}>
                  <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                  <SelectContent>
                    {(warehouses?.items ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <label className="text-xs font-medium">الكمية *</label>
              <Input type="number" value={v.quantity} onChange={(e) => setV({ ...v, quantity: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium">تكلفة الوحدة</label>
              <Input type="number" value={v.unitCost} onChange={(e) => setV({ ...v, unitCost: e.target.value })} />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium">ملاحظات</label>
              <Textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} rows={2} />
            </div>
          </div>
          {err && <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit} disabled={loading || !v.itemId || !v.warehouseId}>{loading ? 'جاري...' : 'تسجيل'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function FreightModule() {
  const { toast } = useToast()
  const [editing, setEditing] = React.useState<any>(null)
  const [open, setOpen] = React.useState(false)
  const { data, isLoading, mutate } = useSWR<{ items: any[] }>('/api/freight', fetcher, { refreshInterval: 30000 })

  const [v, setV] = React.useState<any>({ regionAr: '', regionEn: '', routeName: '', cost: '', sellPrice: '', sellPrice2: '', notes: '' })
  React.useEffect(() => {
    if (open) {
      setV(editing ? { regionAr: editing.regionAr || '', regionEn: editing.regionEn || '', routeName: editing.routeName || '', cost: editing.cost || '', sellPrice: editing.sellPrice || '', sellPrice2: editing.sellPrice2 || '', notes: editing.notes || '' } : { regionAr: '', regionEn: '', routeName: '', cost: '', sellPrice: '', sellPrice2: '', notes: '' })
    }
  }, [open, editing])

  const submit = async () => {
    const payload = { ...v, cost: v.cost ? Number(v.cost) : null, sellPrice: v.sellPrice ? Number(v.sellPrice) : null, sellPrice2: v.sellPrice2 ? Number(v.sellPrice2) : null, userName: 'admin' }
    try {
      if (editing) {
        await apiPatch(`/api/freight/${editing.id}`, payload)
        toast({ title: 'تم التحديث' })
      } else {
        await apiPost('/api/freight', payload)
        toast({ title: 'تمت الإضافة' })
      }
      setOpen(false); mutate()
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  const del = async (id: string) => {
    if (!confirm('حذف هذا السعر؟')) return
    try { await apiDelete(`/api/freight/${id}`); mutate(); toast({ title: 'تم الحذف' }) }
    catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  const columns = [
    { key: 'idx', header: '#', align: 'center' as const, width: 'w-12', hideInCard: true, render: (_: any, i: number) => <span className="text-xs text-muted-foreground tnum">{i + 1}</span> },
    { key: 'regionAr', header: 'المنطقة (عربي)', primary: true, render: (r: any) => <span className="font-medium truncate-1 block">{r.regionAr || '-'}</span> },
    { key: 'regionEn', header: 'Region (EN)', hideInCard: true, width: 'w-32', render: (r: any) => <span className="text-xs text-muted-foreground" dir="ltr">{r.regionEn || '-'}</span> },
    { key: 'route', header: 'خط السير', hideInCard: true, width: 'w-32', render: (r: any) => <span className="text-xs">{r.routeName || '-'}</span> },
    { key: 'cost', header: 'التكلفة', align: 'left' as const, width: 'w-28', render: (r: any) => <span className="tnum">{r.cost != null ? fmtNum(r.cost) : '-'}</span> },
    { key: 'sell', header: 'سعر البيع', align: 'left' as const, width: 'w-28', render: (r: any) => <span className="tnum font-bold">{r.sellPrice != null ? fmtNum(r.sellPrice) : '-'}</span> },
    { key: 'margin', header: 'الهامش', align: 'center' as const, width: 'w-24', render: (r: any) => {
      if (r.sellPrice == null || r.cost == null || !r.cost) return '-'
      const pct = ((r.sellPrice - r.cost) / r.cost) * 100
      return <Badge variant="outline" className={pct >= 30 ? 'text-emerald-600' : 'text-amber-600'}>{pct.toFixed(1)}%</Badge>
    } },
    { key: 'actions', header: 'إجراءات', align: 'center' as const, width: 'w-24', render: (r: any) => (
      <div className="flex gap-1 justify-center">
        <Button variant="ghost" size="sm" onClick={() => { setEditing(r); setOpen(true) }}><Pencil className="size-3.5" /></Button>
        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => del(r.id)}><Trash2 className="size-3.5" /></Button>
      </div>
    ) },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground tnum">{data?.items.length ?? 0} سعر</div>
        <Button onClick={() => { setEditing(null); setOpen(true) }} size="sm" className="shrink-0"><Plus className="size-4" /> <span className="hidden sm:inline">سعر جديد</span><span className="sm:hidden">سعر</span></Button>
      </div>
      <DataTable rows={data?.items ?? []} columns={columns} loading={isLoading} getRowKey={(r: any) => r.id} minW={900} searchFn={(r, q) => (r.regionAr || '').toLowerCase().includes(q) || (r.regionEn || '').toLowerCase().includes(q)} searchPlaceholder="بحث بالمنطقة..." />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'تعديل سعر' : 'إضافة سعر نولون'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div><label className="text-xs font-medium">المنطقة (عربي)</label><Input value={v.regionAr} onChange={(e) => setV({ ...v, regionAr: e.target.value })} /></div>
            <div><label className="text-xs font-medium">Region (EN)</label><Input value={v.regionEn} onChange={(e) => setV({ ...v, regionEn: e.target.value })} dir="ltr" /></div>
            <div className="col-span-2"><label className="text-xs font-medium">خط السير</label><Input value={v.routeName} onChange={(e) => setV({ ...v, routeName: e.target.value })} /></div>
            <div><label className="text-xs font-medium">التكلفة</label><Input type="number" value={v.cost} onChange={(e) => setV({ ...v, cost: e.target.value })} /></div>
            <div><label className="text-xs font-medium">سعر البيع</label><Input type="number" value={v.sellPrice} onChange={(e) => setV({ ...v, sellPrice: e.target.value })} /></div>
            <div><label className="text-xs font-medium">سعر 2 (اختياري)</label><Input type="number" value={v.sellPrice2} onChange={(e) => setV({ ...v, sellPrice2: e.target.value })} /></div>
            <div className="col-span-2"><label className="text-xs font-medium">ملاحظات</label><Input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit}>{editing ? 'تحديث' : 'إضافة'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
