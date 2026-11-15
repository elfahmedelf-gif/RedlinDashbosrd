'use client'

import * as React from 'react'
import useSWR from 'swr'
import { Plus, Pencil, Trash2, ArrowLeft, Phone, MapPin, FileText, FileSpreadsheet, Wallet } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EntityFormDialog, type Field } from '../entity-dialog'
import { DataTablePagination } from '../data-table-pagination'
import { fetcher, apiPost, apiPatch, apiDelete } from '@/lib/api'
import { exportToCSV } from '@/lib/export'
import { fmtNum } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { useCanPrices } from '../auth-provider'
import { PartyStatementDialog } from '../party-statement'
import { PartyFinancialProfile } from '../party-financial-profile'
import { useConfirm } from '@/components/ui/confirm-dialog'
import type { ModuleKey } from '../sidebar'

interface Party {
  id: string; code: string | null; name: string; nameEn: string | null;
  isCustomer: boolean; isContractor: boolean; isSupplier: boolean;
  phone: string | null; phones: string | null; email: string | null;
  address: string | null; city: string | null; region: string | null;
  taxNumber: string | null; paymentTerms: string | null; creditLimit: number | null;
  openingBalance: number; openingBalanceType: string | null;
  /** الرصيد الحالي من دفتر الأستاذ (افتتاحي + مدين − دائن) — يُصفَّر للخادم لغير أهلية الأسعار */
  currentBalance: number;
  branchId: string | null; branch: { id: string; name: string } | null;
  notes: string | null; active: boolean;
  _count: { shipments: number }
  _sum: { freightTotal: number; totalSuppliers: number; customerPay: number }
}

export function PartiesModule({ type, title }: { type: 'customer' | 'contractor' | 'supplier'; title: string }) {
  const { toast } = useToast()
  const { confirmDelete } = useConfirm()
  // إجمالي التعامل يُعرض فقط لمن يملك صلاحية الأسعار
  const canPrices = useCanPrices()
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Party | null>(null)
  // نافذة كشف حساب الطرف
  const [stmtOpen, setStmtOpen] = React.useState(false)
  const [stmtParty, setStmtParty] = React.useState<Party | null>(null)
  // نافذة الملف المالي الشامل للطرف
  const [profOpen, setProfOpen] = React.useState(false)
  const [profParty, setProfParty] = React.useState<Party | null>(null)
  // Client-side pagination for the card grid
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(10)
  const { data, isLoading, mutate } = useSWR<{ items: Party[] }>(`/api/parties?type=${type}`, fetcher, { refreshInterval: 30000 })
  const { data: branches } = useSWR<{ items: any[] }>('/api/branches', fetcher)

  const partyItems = data?.items ?? []
  const totalParties = partyItems.length
  const totalPages = Math.max(1, Math.ceil(totalParties / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageItems = partyItems.slice((safePage - 1) * pageSize, safePage * pageSize)

  // Reset to page 1 when switching between customer/contractor/supplier
  React.useEffect(() => { setPage(1) }, [type])
  React.useEffect(() => { if (page > totalPages) setPage(totalPages) }, [page, totalPages])

  const handlePageSizeChange = React.useCallback((n: number) => {
    setPageSize(n)
    setPage(1)
  }, [])

  const onEdit = (p: Party) => { setEditing(p); setOpen(true) }
  const onAdd = () => { setEditing(null); setOpen(true) }
  const onStatement = (p: Party) => { setStmtParty(p); setStmtOpen(true) }
  const onProfile = (p: Party) => { setProfParty(p); setProfOpen(true) }

  const handleDelete = async (id: string) => {
    const ok = await confirmDelete({
      title: 'حذف الطرف',
      message: 'هل تريد حذف هذا الطرف؟ لا يمكن التراجع.',
    })
    if (!ok) return
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
    // اسم المستخدم يُستخرج من الجلسة على الخادم — لا حاجة لإرساله في الحمولة
    const payload = { ...vals, [`is${type.charAt(0).toUpperCase() + type.slice(1)}`]: true }
    if (editing) {
      // For edit, use PATCH
      await apiPatch(`/api/parties/${editing.id}`, payload)
      toast({ title: 'تم التحديث' })
    } else {
      await apiPost('/api/parties', payload)
      toast({ title: 'تم الإضافة' })
    }
    mutate()
  }

  const exportParties = () => {
    if (!data?.items?.length) { toast({ title: 'لا توجد بيانات للتصدير' }); return }
    const rows = data.items.map((p: Party) => ({
      'الكود': p.code ?? '', 'الاسم': p.name, 'الاسم EN': p.nameEn ?? '',
      'الهاتف': p.phone ?? '', 'المدينة': p.city ?? '', 'المنطقة': p.region ?? '',
      'الفرع': p.branch?.name ?? '',
      // حقول مالية تُصدّر فقط لمن يملك صلاحية الأسعار
      ...(canPrices ? {
        'حد الائتمان': p.creditLimit ?? '',
        'الرصيد الافتتاحي': p.openingBalance ?? 0,
        'إجمالي التعامل': p._sum.totalSuppliers ?? 0,
        'تحصيل العميل': p._sum.customerPay ?? 0,
      } : {}),
      'عدد الشحنات': p._count.shipments,
    }))
    exportToCSV(rows, `${type}-${new Date().toISOString().slice(0, 10)}.csv`)
    toast({ title: `تم تصدير ${rows.length} ${title}` })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <div className="text-sm text-muted-foreground tnum">
          {totalParties} {title}
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" onClick={exportParties} size="sm" disabled={!data?.items?.length}>
            <FileSpreadsheet className="size-4" /> <span className="hidden sm:inline">تصدير</span>
          </Button>
          <Button onClick={onAdd} size="sm"><Plus className="size-4" /> <span className="hidden sm:inline">إضافة جديد</span><span className="sm:hidden">جديد</span></Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : data && data.items.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">لا يوجد {title} بعد</CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {pageItems.map((p) => (
            <Card key={p.id} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm leading-tight line-clamp-2">{p.name}</div>
                    {p.code && <div className="text-[11px] text-muted-foreground tnum mt-0.5">كود: {p.code}</div>}
                  </div>
                  <div className="flex gap-1 print:hidden">
                    {/* الملف المالي الشامل + كشف الحساب — مستندات مالية بالكامل فلا تُعرض لغير أهلية الأسعار */}
                    {canPrices && (
                      <Button variant="ghost" size="sm" title="الملف المالي الشامل" aria-label="الملف المالي الشامل" onClick={() => onProfile(p)}><Wallet className="size-4" /></Button>
                    )}
                    {canPrices && (
                      <Button variant="ghost" size="sm" title="كشف حساب" aria-label="كشف حساب" onClick={() => onStatement(p)}><FileText className="size-4" /></Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => onEdit(p)}><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDelete(p.id)}><Trash2 className="size-4" /></Button>
                  </div>
                </div>
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {p.phone && <div className="flex items-center gap-1.5" dir="ltr"><Phone className="size-3" /> {p.phone}</div>}
                  {p.city && <div className="flex items-center gap-1.5"><MapPin className="size-3" /> {p.city}{p.region ? ` - ${p.region}` : ''}</div>}
                  {p.branch && <div className="flex items-center gap-1.5"><FileText className="size-3" /> {p.branch.name}</div>}
                </div>
                <div className={cn('mt-3 grid gap-2 text-xs', canPrices ? 'grid-cols-3' : 'grid-cols-2')}>
                  <div className="bg-secondary/60 rounded-lg p-2">
                    <div className="text-muted-foreground">الشحنات</div>
                    <div className="font-bold tnum">{fmtNum(p._count.shipments)}</div>
                  </div>
                  {/* الإجمالي والرصيد — يُعرضان فقط لمن يملك صلاحية الأسعار */}
                  {canPrices ? (
                    <>
                      <div className="bg-primary/10 rounded-lg p-2">
                        <div className="text-muted-foreground">إجمالي التعامل</div>
                        <div className="font-bold tnum text-primary">{fmtNum(p._sum.totalSuppliers)} ج.م</div>
                      </div>
                      <div className="bg-secondary/60 rounded-lg p-2">
                        <div className="text-muted-foreground">الرصيد الحالي</div>
                        <div className={cn('font-bold tnum', p.currentBalance < 0 ? 'text-rose-600 dark:text-rose-400' : p.currentBalance > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground')}>
                          {fmtNum(p.currentBalance)} ج.م
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="bg-secondary/60 rounded-lg p-2">
                      <div className="text-muted-foreground">الرمز</div>
                      <div className="font-bold tnum">{p.code ?? '—'}</div>
                    </div>
                  )}
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
          {/* Unified pagination bar below the cards grid */}
          <div className="rounded-2xl border border-border bg-card elev-sm overflow-hidden print:hidden">
            <DataTablePagination
              currentPage={safePage}
              totalPages={totalPages}
              totalItems={totalParties}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={handlePageSizeChange}
              itemLabel="طرف"
              className="border-t-0"
            />
          </div>
        </>
      )}

      <EntityFormDialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? `تعديل: ${editing.name}` : `إضافة ${title}`}
        fields={fields}
        initial={editing ?? {}}
        onSubmit={submit}
      />

      {/* كشف حساب الطرف — يفتح من زر البطاقة */}
      <PartyStatementDialog
        partyId={stmtParty?.id ?? null}
        partyName={stmtParty?.name}
        open={stmtOpen}
        onOpenChange={setStmtOpen}
      />

      {/* الملف المالي الشامل للطرف — يفتح من زر البطاقة */}
      <PartyFinancialProfile
        partyId={profParty?.id ?? null}
        partyName={profParty?.name}
        open={profOpen}
        onOpenChange={setProfOpen}
      />
    </div>
  )
}
