'use client'

import * as React from 'react'
import useSWR from 'swr'
import { Plus, Pencil, Trash2, ArrowLeft, Phone, MapPin, FileText } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EntityFormDialog, type Field } from '../entity-dialog'
import { DataTable } from '../data-table'
import { fetcher, apiPost, apiDelete } from '@/lib/api'
import { fmtNum } from '@/lib/format'
import { useToast } from '@/hooks/use-toast'
import type { ModuleKey } from '../sidebar'

interface Party {
  id: string; code: string | null; name: string; nameEn: string | null;
  isCustomer: boolean; isContractor: boolean; isSupplier: boolean;
  phone: string | null; phones: string | null; email: string | null;
  address: string | null; city: string | null; region: string | null;
  taxNumber: string | null; paymentTerms: string | null; creditLimit: number | null;
  openingBalance: number; openingBalanceType: string | null;
  branchId: string | null; branch: { id: string; name: string } | null;
  notes: string | null; active: boolean;
  _count: { shipments: number }
  _sum: { freightTotal: number; totalSuppliers: number; customerPay: number }
}

export function PartiesModule({ type, title }: { type: 'customer' | 'contractor' | 'supplier'; title: string }) {
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Party | null>(null)
  const { data, isLoading, mutate } = useSWR<{ items: Party[] }>(`/api/parties?type=${type}`, fetcher, { refreshInterval: 30000 })
  const { data: branches } = useSWR<{ items: any[] }>('/api/branches', fetcher)

  const onEdit = (p: Party) => { setEditing(p); setOpen(true) }
  const onAdd = () => { setEditing(null); setOpen(true) }

  const handleDelete = async (id: string) => {
    if (!confirm('حذف هذا الطرف؟')) return
    try { await apiDelete(`/api/parties/${id}`); mutate(); toast({ title: 'تم الحذف' }) }
    catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  const fields: Field[] = [
    { name: 'code', label: 'الكود', type: 'text' },
    { name: 'name', label: 'الاسم *', type: 'text', span: 2 },
    { name: 'nameEn', label: 'الاسم (EN)', type: 'text', span: 2 },
    { name: 'phone', label: 'الهاتف', type: 'tel' },
    { name: 'phones', label: 'هواتف إضافية', type: 'tel' },
    { name: 'email', label: 'البريد', type: 'email' },
    { name: 'taxNumber', label: 'الرقم الضريبي', type: 'text' },
    { name: 'address', label: 'العنوان', type: 'text', span: 2 },
    { name: 'city', label: 'المدينة', type: 'text' },
    { name: 'region', label: 'المنطقة', type: 'text' },
    { name: 'creditLimit', label: 'حد الائتمان', type: 'number' },
    { name: 'openingBalance', label: 'الرصيد الافتتاحي', type: 'number' },
    { name: 'openingBalanceType', label: 'نوع الرصيد', type: 'select', options: [{ value: 'debit', label: 'مدين' }, { value: 'credit', label: 'دائن' }] },
    { name: 'paymentTerms', label: 'شروط السداد', type: 'text' },
    { name: 'branchId', label: 'الفرع المسؤول', type: 'select', options: (branches?.items ?? []).map((b) => ({ value: b.id, label: b.name })) },
    { name: 'notes', label: 'ملاحظات', type: 'textarea', span: 2 },
  ]

  const submit = async (vals: any) => {
    const payload = { ...vals, [`is${type.charAt(0).toUpperCase() + type.slice(1)}`]: true, userName: 'admin' }
    if (editing) {
      // For edit, use PATCH
      const r = await fetch(`/api/parties/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'فشل') }
      toast({ title: 'تم التحديث' })
    } else {
      await apiPost('/api/parties', payload)
      toast({ title: 'تم الإضافة' })
    }
    mutate()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground tnum">
          {data?.items.length ?? 0} {title}
        </div>
        <Button onClick={onAdd} size="sm" className="shrink-0"><Plus className="size-4" /> <span className="hidden sm:inline">إضافة جديد</span><span className="sm:hidden">جديد</span></Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : data && data.items.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">لا يوجد {title} بعد</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data?.items.map((p) => (
            <Card key={p.id} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm leading-tight line-clamp-2">{p.name}</div>
                    {p.code && <div className="text-[11px] text-muted-foreground tnum mt-0.5">كود: {p.code}</div>}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => onEdit(p)}><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDelete(p.id)}><Trash2 className="size-4" /></Button>
                  </div>
                </div>
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {p.phone && <div className="flex items-center gap-1.5" dir="ltr"><Phone className="size-3" /> {p.phone}</div>}
                  {p.city && <div className="flex items-center gap-1.5"><MapPin className="size-3" /> {p.city}{p.region ? ` - ${p.region}` : ''}</div>}
                  {p.branch && <div className="flex items-center gap-1.5"><FileText className="size-3" /> {p.branch.name}</div>}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-secondary/60 rounded-lg p-2">
                    <div className="text-muted-foreground">الشحنات</div>
                    <div className="font-bold tnum">{fmtNum(p._count.shipments)}</div>
                  </div>
                  <div className="bg-primary/10 rounded-lg p-2">
                    <div className="text-muted-foreground">إجمالي التعامل</div>
                    <div className="font-bold tnum text-primary">{fmtNum(p._sum.totalSuppliers)} ج.م</div>
                  </div>
                </div>
                {(p.isCustomer && p.isContractor) || (p.isCustomer && p.isSupplier) || (p.isContractor && p.isSupplier) ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.isCustomer && <Badge variant="outline" className="text-[10px]">عميل</Badge>}
                    {p.isContractor && <Badge variant="outline" className="text-[10px]">مقاول</Badge>}
                    {p.isSupplier && <Badge variant="outline" className="text-[10px]">مورد</Badge>}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <EntityFormDialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? `تعديل: ${editing.name}` : `إضافة ${title}`}
        fields={fields}
        initial={editing ?? {}}
        onSubmit={submit}
      />
    </div>
  )
}
