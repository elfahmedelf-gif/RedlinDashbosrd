'use client'

import * as React from 'react'
import useSWR from 'swr'
import { Plus, Pencil, Trash2, UserCircle, Shield, Settings as SettingsIcon, History, Check, Save } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { DataTable } from '../data-table'
import { fetcher, apiPost, apiPatch, apiDelete } from '@/lib/api'
import { fmtNum, fmtDateTime, ROLE_LABELS } from '@/lib/format'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// === Users ===
export function UsersModule() {
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<any>(null)
  const { data, isLoading, mutate } = useSWR<{ items: any[] }>('/api/users', fetcher, { refreshInterval: 30000 })
  const { data: rolesData } = useSWR<{ items: any[] }>('/api/roles', fetcher)
  const { data: branches } = useSWR<{ items: any[] }>('/api/branches', fetcher)

  const [v, setV] = React.useState<any>({ username: '', name: '', email: '', phone: '', branchId: '', roleIds: [], active: true })
  React.useEffect(() => {
    if (open) {
      if (editing) {
        setV({ username: editing.username, name: editing.name, email: editing.email || '', phone: editing.phone || '', branchId: editing.branchId || '', roleIds: (editing.roles || []).map((r: any) => r.roleId), active: editing.active })
      } else {
        setV({ username: '', name: '', email: '', phone: '', branchId: '', roleIds: [], active: true })
      }
    }
  }, [open, editing])

  const submit = async () => {
    if (!v.username || !v.name) { toast({ title: 'الاسم واسم المستخدم مطلوبان', variant: 'destructive' }); return }
    try {
      if (editing) {
        await apiPatch(`/api/users/${editing.id}`, { ...v, userName: 'admin' })
        toast({ title: 'تم التحديث' })
      } else {
        await apiPost('/api/users', { ...v, userName: 'admin' })
        toast({ title: 'تمت الإضافة' })
      }
      setOpen(false); mutate()
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  const del = async (id: string) => {
    if (!confirm('حذف المستخدم؟')) return
    try { await apiDelete(`/api/users/${id}`); mutate(); toast({ title: 'تم الحذف' }) }
    catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserCircle className="size-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground tnum">{data?.items.length ?? 0} مستخدم</span>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true) }} size="sm"><Plus className="size-4" /> مستخدم جديد</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {isLoading ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)
        : data?.items.map((u) => (
          <Card key={u.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="flex items-center justify-center size-10 rounded-xl bg-primary/10 text-primary font-bold text-sm">{u.name?.charAt(0) || '?'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{u.name}</div>
                    <div className="text-[11px] text-muted-foreground tnum">@{u.username}</div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => { setEditing(u); setOpen(true) }}><Pencil className="size-3.5" /></Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => del(u.id)}><Trash2 className="size-3.5" /></Button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {u.roles?.map((r: any) => <Badge key={r.roleId} variant="outline" className="text-[10px]">{ROLE_LABELS[r.role.name] || r.role.name}</Badge>)}
                {!u.roles?.length && <Badge variant="outline" className="text-[10px] text-muted-foreground">بدون دور</Badge>}
              </div>
              {u.branch && <div className="mt-2 text-xs text-muted-foreground">الفرع: {u.branch.name}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'تعديل مستخدم' : 'مستخدم جديد'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div><label className="text-xs font-medium">اسم المستخدم *</label><Input value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} /></div>
            <div><label className="text-xs font-medium">الاسم الكامل *</label><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
            <div><label className="text-xs font-medium">البريد</label><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} dir="ltr" /></div>
            <div><label className="text-xs font-medium">الهاتف</label><Input type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} dir="ltr" /></div>
            <div><label className="text-xs font-medium">الفرع</label>
              <Select value={v.branchId} onValueChange={(val) => setV({ ...v, branchId: val === '__' ? '' : val })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent><SelectItem value="__">—</SelectItem>{(branches?.items ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><label className="text-xs font-medium">نشط</label>
              <Select value={v.active ? '1' : '0'} onValueChange={(val) => setV({ ...v, active: val === '1' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="1">نعم</SelectItem><SelectItem value="0">لا</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium">الأدوار</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {(rolesData?.items ?? []).map((r) => {
                  const checked = v.roleIds.includes(r.id)
                  return (
                    <button key={r.id} type="button" onClick={() => setV({ ...v, roleIds: checked ? v.roleIds.filter((id: string) => id !== r.id) : [...v.roleIds, r.id] })}
                      className={cn('flex items-center gap-2 p-2 rounded-lg border text-xs text-right', checked ? 'border-primary bg-primary/5' : 'border-border')}>
                      <span className={cn('size-4 rounded flex items-center justify-center shrink-0', checked ? 'bg-primary text-primary-foreground' : 'bg-secondary')}>{checked && <Check className="size-3" />}</span>
                      <span className="flex-1">{ROLE_LABELS[r.name] || r.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
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

// === Roles ===
export function RolesModule() {
  const { data } = useSWR<{ items: any[] }>('/api/roles', fetcher)
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="size-5 text-muted-foreground" />
        <span className="text-sm text-muted-foreground tnum">{data?.items.length ?? 0} دور</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {data?.items.map((r) => (
          <Card key={r.id}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center size-10 rounded-xl bg-primary/10 text-primary"><Shield className="size-5" /></div>
                <div>
                  <div className="font-semibold text-sm">{r.label}</div>
                  <div className="text-[11px] text-muted-foreground tnum">@{r.name}</div>
                </div>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">{fmtNum(r._count?.users ?? 0)} مستخدم</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// === Settings ===
export function SettingsModule() {
  const { toast } = useToast()
  const { data, isLoading, mutate } = useSWR<{ items: any[] }>('/api/settings', fetcher)
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (data && Object.keys(drafts).length === 0) {
      const d: Record<string, string> = {}
      for (const s of data.items) d[s.key] = s.value || ''
      setDrafts(d)
    }
  }, [data])

  const grouped = React.useMemo(() => {
    if (!data) return [] as [string, any[]][]
    const m = new Map<string, any[]>()
    for (const s of data.items) {
      const cat = s.category || 'general'
      if (!m.has(cat)) m.set(cat, [])
      m.get(cat)!.push(s)
    }
    return Array.from(m.entries())
  }, [data])

  const save = async () => {
    setSaving(true)
    try {
      const updates = data!.items.map((s) => ({ key: s.key, value: drafts[s.key] ?? '', label: s.label, category: s.category }))
      await apiPatch('/api/settings', { updates, userName: 'admin' })
      toast({ title: 'تم حفظ الإعدادات' })
      mutate()
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
    finally { setSaving(false) }
  }

  const catLabels: Record<string, string> = {
    general: 'عام', import: 'تعريفات أعمدة الاستيراد', accounting: 'محاسبي', inventory: 'المخزون',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><SettingsIcon className="size-5 text-muted-foreground" /><span className="text-sm text-muted-foreground">إعدادات النظام</span></div>
        <Button onClick={save} disabled={saving || isLoading} size="sm"><Save className="size-4" /> {saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
      </div>
      {isLoading ? <Skeleton className="h-96" /> : (
        <div className="space-y-4">
          {grouped.map(([cat, items]) => (
            <Card key={cat}>
              <CardHeader className="pb-2"><CardTitle className="text-sm">{catLabels[cat] || cat}</CardTitle><CardDescription>{fmtNum(items.length)} إعداد</CardDescription></CardHeader>
              <CardContent className="space-y-2.5">
                {items.map((s) => (
                  <div key={s.key} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{s.label}</div>
                      <div className="text-[10px] text-muted-foreground tnum">{s.key}</div>
                    </div>
                    {s.key === 'inventory_valuation' ? (
                      <Select value={drafts[s.key] || ''} onValueChange={(val) => setDrafts((d) => ({ ...d, [s.key]: val }))}>
                        <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="weighted_average">متوسط مرجح</SelectItem>
                          <SelectItem value="fifo">الوارد أولًا يصرف أولًا (FIFO)</SelectItem>
                          <SelectItem value="lifo">الوارد أخيرًا يصرف أولًا (LIFO)</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input value={drafts[s.key] || ''} onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))} className="w-64" dir={s.key.includes('label') || s.key === 'company_name' ? undefined : 'ltr'} />
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// === Audit Log ===
export function AuditModule() {
  const [q, setQ] = React.useState('')
  const [entity, setEntity] = React.useState<string>('all')
  const { data, isLoading } = useSWR<{ items: any[]; total: number }>(`/api/audit?entity=${entity !== 'all' ? entity : ''}&q=${encodeURIComponent(q)}`, fetcher, { refreshInterval: 15000 })

  const entityLabels: Record<string, string> = {
    shipment: 'شحنة', party: 'طرف', journal_entry: 'قيد', voucher: 'سند',
    branch: 'فرع', warehouse: 'مخزن', item: 'صنف', inventory_movement: 'حركة مخزون',
    freight_price: 'سعر نولون', account: 'حساب', user: 'مستخدم', setting: 'إعداد',
  }
  const actionTones: Record<string, string> = {
    create: 'bg-emerald-100 text-emerald-700', update: 'bg-amber-100 text-amber-700',
    delete: 'bg-rose-100 text-rose-700', post: 'bg-sky-100 text-sky-700', import: 'bg-purple-100 text-purple-700',
  }
  const actionLabels: Record<string, string> = { create: 'إضافة', update: 'تعديل', delete: 'حذف', post: 'ترحيل', import: 'استيراد', approve: 'اعتماد', cancel: 'إلغاء' }

  const cols = [
    { key: 'date', header: 'التاريخ', hideInCard: true, render: (a: any) => <span className="text-xs tnum text-muted-foreground">{fmtDateTime(a.date)}</span> },
    { key: 'user', header: 'المستخدم', hideInCard: true, render: (a: any) => <span className="text-xs font-medium">{a.userName || 'النظام'}</span> },
    { key: 'action', header: 'العملية', primary: true, render: (a: any) => <Badge variant="outline" className={actionTones[a.action] || ''}>{actionLabels[a.action] || a.action}</Badge> },
    { key: 'entity', header: 'الكيان', render: (a: any) => <span className="text-xs">{entityLabels[a.entity] || a.entity}</span> },
    { key: 'notes', header: 'ملاحظات', render: (a: any) => <span className="text-xs truncate-1">{a.notes || '-'}</span> },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <History className="size-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground tnum">{data?.total ?? 0} عملية</span>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Input placeholder="بحث..." value={q} onChange={(e) => setQ(e.target.value)} className="h-8 flex-1 sm:flex-none sm:w-48 min-w-0" />
          <Select value={entity} onValueChange={setEntity}>
            <SelectTrigger className="h-8 flex-1 sm:flex-none sm:w-40 min-w-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الكيانات</SelectItem>
              {Object.entries(entityLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Card><CardContent className="p-0">
        <DataTable rows={data?.items ?? []} columns={cols} loading={isLoading} getRowKey={(a: any) => a.id} minW={700} searchFn={() => true} />
      </CardContent></Card>
      <div className="text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3 border border-amber-200 dark:border-amber-900">
        🔒 سجل التدقيق غير قابل للتعديل أو الحذف — يُحفظ تلقائيًا مع كل عملية. القيم قبل/بعد مخزنة كـ JSON.
      </div>
    </div>
  )
}
