'use client'

import * as React from 'react'
import useSWR from 'swr'
import { Plus, Pencil, Trash2, Building2, Phone, MapPin } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EntityFormDialog, type Field } from '../entity-dialog'
import { fetcher } from '@/lib/api'
import { apiPostSync as apiPost, apiPatchSync as apiPatch, apiDeleteSync as apiDelete } from '@/lib/sync'
import { fmtNum } from '@/lib/format'
import { useToast } from '@/hooks/use-toast'
import { useConfirm } from '@/components/ui/confirm-dialog'

export function BranchesModule() {
  const { toast } = useToast()
  const { confirmDelete } = useConfirm()
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<any>(null)
  const { data, isLoading, mutate } = useSWR<{ items: any[] }>('/api/branches', fetcher, { refreshInterval: 30000 })

  const onEdit = (b: any) => { setEditing(b); setOpen(true) }
  const onAdd = () => { setEditing(null); setOpen(true) }
  const del = async (id: string) => {
    const ok = await confirmDelete({
      title: 'حذف الفرع',
      message: 'هل تريد حذف هذا الفرع؟ لا يمكن التراجع.',
    })
    if (!ok) return
    try { await apiDelete(`/api/branches/${id}`); mutate(); toast({ title: 'تم الحذف' }) }
    catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }
  const submit = async (vals: any) => {
    const payload = { ...vals, userName: 'admin' }
    if (editing) {
      await apiPatch(`/api/branches/${editing.id}`, payload)
      toast({ title: 'تم التحديث' })
    } else {
      await apiPost('/api/branches', payload)
      toast({ title: 'تمت الإضافة' })
    }
    mutate()
  }

  const fields: Field[] = [
    { name: 'code', label: 'كود الفرع', type: 'text' },
    { name: 'name', label: 'اسم الفرع *', type: 'text' },
    { name: 'nameEn', label: 'الاسم (EN)', type: 'text' },
    { name: 'manager', label: 'المسؤول', type: 'text' },
    { name: 'phone', label: 'الهاتف', type: 'tel' },
    { name: 'region', label: 'منطقة التغطية', type: 'text' },
    { name: 'address', label: 'العنوان', type: 'text', span: 2 },
    { name: 'balance', label: 'الرصيد الافتتاحي', type: 'number' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <div className="text-sm text-muted-foreground tnum">{data?.items.length ?? 0} فرع</div>
        <Button onClick={onAdd} size="sm" className="shrink-0"><Plus className="size-4" /> <span className="hidden sm:inline">فرع جديد</span><span className="sm:hidden">جديد</span></Button>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data?.items.map((b) => (
            <Card key={b.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="flex items-center justify-center size-10 rounded-xl bg-primary/10 text-primary"><Building2 className="size-5" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">{b.name}</div>
                      {b.code && <div className="text-[11px] text-muted-foreground tnum">{b.code}</div>}
                    </div>
                  </div>
                  <div className="flex gap-1 print:hidden">
                    <Button variant="ghost" size="sm" onClick={() => onEdit(b)}><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => del(b.id)}><Trash2 className="size-4" /></Button>
                  </div>
                </div>
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {b.manager && <div>المسؤول: {b.manager}</div>}
                  {b.phone && <div dir="ltr" className="flex items-center gap-1"><Phone className="size-3" /> {b.phone}</div>}
                  {b.region && <div className="flex items-center gap-1"><MapPin className="size-3" /> {b.region}</div>}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-secondary/60 rounded-lg p-1.5 text-center"><div className="text-muted-foreground">مخازن</div><div className="font-bold tnum">{fmtNum(b._count?.warehouses ?? 0)}</div></div>
                  <div className="bg-secondary/60 rounded-lg p-1.5 text-center"><div className="text-muted-foreground">شحنات</div><div className="font-bold tnum">{fmtNum(b._count?.shipments ?? 0)}</div></div>
                  <div className="bg-secondary/60 rounded-lg p-1.5 text-center"><div className="text-muted-foreground">أطراف</div><div className="font-bold tnum">{fmtNum(b._count?.parties ?? 0)}</div></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <EntityFormDialog open={open} onOpenChange={setOpen} title={editing ? 'تعديل فرع' : 'إضافة فرع'} fields={fields} initial={editing ?? {}} onSubmit={submit} />
    </div>
  )
}

export function WarehousesModule() {
  const { toast } = useToast()
  const { confirmDelete } = useConfirm()
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<any>(null)
  const { data, isLoading, mutate } = useSWR<{ items: any[] }>('/api/warehouses', fetcher, { refreshInterval: 30000 })
  const { data: branches } = useSWR<{ items: any[] }>('/api/branches', fetcher)

  const onEdit = (b: any) => { setEditing(b); setOpen(true) }
  const onAdd = () => { setEditing(null); setOpen(true) }
  const del = async (id: string) => {
    const ok = await confirmDelete({
      title: 'حذف المخزن',
      message: 'هل تريد حذف هذا المخزن؟ لا يمكن التراجع.',
    })
    if (!ok) return
    try { await apiDelete(`/api/warehouses/${id}`); mutate(); toast({ title: 'تم الحذف' }) }
    catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }
  const submit = async (vals: any) => {
    const payload = { ...vals, userName: 'admin' }
    if (editing) {
      await apiPatch(`/api/warehouses/${editing.id}`, payload)
      toast({ title: 'تم التحديث' })
    } else {
      await apiPost('/api/warehouses', payload)
      toast({ title: 'تمت الإضافة' })
    }
    mutate()
  }

  const fields: Field[] = [
    { name: 'code', label: 'كود المخزن', type: 'text' },
    { name: 'name', label: 'اسم المخزن *', type: 'text' },
    { name: 'branchId', label: 'الفرع *', type: 'select', options: (branches?.items ?? []).map((b) => ({ value: b.id, label: b.name })) },
    { name: 'manager', label: 'المسؤول', type: 'text' },
    { name: 'balance', label: 'الرصيد', type: 'number' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <div className="text-sm text-muted-foreground tnum">{data?.items.length ?? 0} مخزن</div>
        <Button onClick={onAdd} size="sm" className="shrink-0"><Plus className="size-4" /> <span className="hidden sm:inline">مخزن جديد</span><span className="sm:hidden">جديد</span></Button>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data?.items.map((w) => (
            <Card key={w.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{w.name}</div>
                    <div className="text-[11px] text-muted-foreground">{w.branch?.name || '-'}</div>
                  </div>
                  <div className="flex gap-1 print:hidden">
                    <Button variant="ghost" size="sm" onClick={() => onEdit(w)}><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => del(w.id)}><Trash2 className="size-4" /></Button>
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                  {w.code && <div>كود: {w.code}</div>}
                  {w.manager && <div>المسؤول: {w.manager}</div>}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-secondary/60 rounded-lg p-1.5 text-center"><div className="text-muted-foreground">أصناف</div><div className="font-bold tnum">{fmtNum(w._count?.items ?? 0)}</div></div>
                  <div className="bg-secondary/60 rounded-lg p-1.5 text-center"><div className="text-muted-foreground">حركات</div><div className="font-bold tnum">{fmtNum(w._count?.movements ?? 0)}</div></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <EntityFormDialog open={open} onOpenChange={setOpen} title={editing ? 'تعديل مخزن' : 'إضافة مخزن'} fields={fields} initial={editing ?? {}} onSubmit={submit} />
    </div>
  )
}
