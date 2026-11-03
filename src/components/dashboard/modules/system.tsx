'use client'

// ============================================================================
// وحدات النظام: المستخدمون + الصلاحيات والأدوار + الإعدادات + سجل التدقيق
// ============================================================================

import * as React from 'react'
import useSWR from 'swr'
import {
  Plus, Pencil, Trash2, UserCircle, Shield, Settings as SettingsIcon, History,
  Check, Save, KeyRound, ShieldCheck, ShieldOff, LogIn, LogOut,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { DataTable } from '../data-table'
import { fetcher, apiPost, apiPatch, apiDelete } from '@/lib/api'
import { fmtNum, fmtDateTime } from '@/lib/format'
import { PERMISSION_CATALOG, PERMISSION_GROUPS, expandPermissions } from '@/lib/permissions'
import { useAuth } from '../auth-provider'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

const ROLE_TONES: Record<string, string> = {
  admin: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  finance_manager: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  branch_manager: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  operations: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  viewer: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
}

// ============================================================================
// === Users ===
// ============================================================================
export function UsersModule() {
  const { toast } = useToast()
  const { user: me } = useAuth()
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<any>(null)
  const [deleting, setDeleting] = React.useState<any>(null)
  const { data, isLoading, mutate } = useSWR<{ items: any[] }>('/api/users', fetcher, { refreshInterval: 30000 })
  const { data: rolesData } = useSWR<{ items: any[] }>('/api/roles', fetcher)
  const { data: branches } = useSWR<{ items: any[] }>('/api/branches', fetcher)

  const users = data?.items ?? []
  const activeCount = users.filter((u) => u.active).length

  const emptyForm = { username: '', name: '', email: '', phone: '', branchId: '', roleId: '', active: true, password: '' }
  const [v, setV] = React.useState<any>(emptyForm)
  const [err, setErr] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setErr('')
      if (editing) {
        setV({
          username: editing.username, name: editing.name, email: editing.email || '',
          phone: editing.phone || '', branchId: editing.branchId || '', roleId: editing.roleId || '',
          active: !!editing.active, password: '',
        })
      } else {
        setV(emptyForm)
      }
    }
  }, [open, editing])

  const submit = async () => {
    setSaving(true); setErr('')
    try {
      const payload: any = {
        username: v.username?.trim(), name: v.name?.trim(), email: v.email || null, phone: v.phone || null,
        branchId: v.branchId || null, roleId: v.roleId || null, active: v.active,
        userName: me?.username || 'admin',
      }
      if (editing) {
        if (v.password) payload.password = v.password
        await apiPatch(`/api/users/${editing.id}`, payload)
        toast({ title: 'تم تحديث المستخدم', description: v.password ? 'تم تغيير كلمة المرور أيضًا' : undefined })
      } else {
        payload.password = v.password
        await apiPost('/api/users', payload)
        toast({ title: 'تمت إضافة المستخدم' })
      }
      setOpen(false); mutate()
    } catch (e: any) { setErr(e.message) } finally { setSaving(false) }
  }

  const toggleActive = async (u: any) => {
    try {
      await apiPatch(`/api/users/${u.id}`, { active: !u.active, userName: me?.username || 'admin' })
      mutate()
      toast({ title: !u.active ? `تم تنشيط حساب ${u.name}` : `تم إيقاف حساب ${u.name}` })
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  const delUser = async (u: any) => {
    if (u.id === me?.userId) { toast({ title: 'لا يمكن حذف حسابك الحالي', variant: 'destructive' }); return }
    try { await apiDelete(`/api/users/${u.id}`); mutate(); toast({ title: 'تم حذف المستخدم' }) }
    catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <UserCircle className="size-5 text-muted-foreground" />
          <Badge variant="secondary" className="tnum">{fmtNum(users.length)} مستخدم</Badge>
          <Badge variant="outline" className="tnum bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900">{fmtNum(activeCount)} نشط</Badge>
          <Badge variant="outline" className="tnum">{fmtNum(rolesData?.items.length ?? 0)} دور</Badge>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true) }} size="sm">
          <Plus className="size-4" /> مستخدم جديد
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {users.map((u) => (
            <Card key={u.id} className={cn(!u.active && 'opacity-70')}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div className={cn(
                      'flex items-center justify-center size-10 rounded-xl font-bold text-sm shrink-0',
                      u.active ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground',
                    )}>{u.name?.charAt(0) || '?'}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate flex items-center gap-1.5">
                        {u.name}
                        {u.id === me?.userId && <Badge variant="outline" className="text-[9px] px-1 py-0">أنت</Badge>}
                      </div>
                      <div className="text-[11px] text-muted-foreground tnum" dir="ltr">@{u.username}</div>
                    </div>
                  </div>
                  <Switch
                    checked={!!u.active}
                    onCheckedChange={() => toggleActive(u)}
                    aria-label={u.active ? 'إيقاف الحساب' : 'تنشيط الحساب'}
                    disabled={u.username === 'admin'}
                    className="shrink-0"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {u.role ? (
                    <Badge variant="outline" className={cn('text-[10px]', ROLE_TONES[u.role.name] || '')}>
                      <Shield className="size-2.5 ml-1" />{u.role.label || u.role.name}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">بدون دور</Badge>
                  )}
                  {u.branch && <Badge variant="secondary" className="text-[10px]">{u.branch?.name || ''}</Badge>}
                  {u.lastLoginAt && (
                    <span className="text-[10px] text-muted-foreground tnum mr-auto">آخر دخول: {fmtDateTime(u.lastLoginAt)}</span>
                  )}
                </div>
                <div className="flex gap-1 pt-1 border-t border-border/60">
                  <Button variant="ghost" size="sm" className="flex-1" onClick={() => { setEditing(u); setOpen(true) }}>
                    <Pencil className="size-3.5" /> تعديل
                  </Button>
                  <Button
                    variant="ghost" size="sm" className="text-destructive flex-1"
                    disabled={u.username === 'admin' || u.id === me?.userId}
                    onClick={() => setDeleting(u)}
                  >
                    <Trash2 className="size-3.5" /> حذف
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* dialog إضافة/تعديل */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'تعديل مستخدم' : 'مستخدم جديد'}</DialogTitle>
            <DialogDescription>
              {editing ? 'عدّل بيانات الحساب — اترك كلمة المرور فارغة للإبقاء عليها.' : 'أنشئ حسابًا جديدًا وحدد دوره وصلاحياته.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div><label className="text-xs font-medium">اسم المستخدم *</label><Input value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} dir="ltr" disabled={!!editing} /></div>
            <div><label className="text-xs font-medium">الاسم الكامل *</label><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
            <div>
              <label className="text-xs font-medium flex items-center gap-1">
                {editing ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور *'}
                <KeyRound className="size-3 text-muted-foreground" />
              </label>
              <Input type="password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} dir="ltr" placeholder="••••" />
            </div>
            <div><label className="text-xs font-medium">الدور *</label>
              <Select value={v.roleId} onValueChange={(val) => setV({ ...v, roleId: val === '__' ? '' : val })}>
                <SelectTrigger><SelectValue placeholder="اختر الدور..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__">— بدون دور —</SelectItem>
                  {(rolesData?.items ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{r.label || r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><label className="text-xs font-medium">البريد</label><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} dir="ltr" /></div>
            <div><label className="text-xs font-medium">الهاتف</label><Input type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} dir="ltr" /></div>
            <div><label className="text-xs font-medium">الفرع</label>
              <Select value={v.branchId} onValueChange={(val) => setV({ ...v, branchId: val === '__' ? '' : val })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent><SelectItem value="__">—</SelectItem>{(branches?.items ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><label className="text-xs font-medium">الحالة</label>
              <Select value={v.active ? '1' : '0'} onValueChange={(val) => setV({ ...v, active: val === '1' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="1">نشط</SelectItem><SelectItem value="0">موقوف</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          {err && <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit} disabled={saving}>{saving ? 'جاري...' : editing ? 'تحديث' : 'إضافة'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأكيد الحذف */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المستخدم؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف حساب «{deleting?.name}» (@{deleting?.username}) نهائيًا من النظام.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={delUser} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ============================================================================
// === Roles & Permissions ===
// ============================================================================
function PermissionMatrix({ selected, onChange, disabled }: { selected: string[]; onChange: (perms: string[]) => void; disabled?: boolean }) {
  const set = new Set(selected)
  const toggle = (key: string) => {
    if (disabled) return
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(Array.from(next))
  }
  const toggleGroup = (group: string) => {
    if (disabled) return
    const keys = PERMISSION_CATALOG.filter((p) => p.group === group).map((p) => p.key)
    const allOn = keys.every((k) => set.has(k))
    const next = new Set(set)
    keys.forEach((k) => (allOn ? next.delete(k) : next.add(k)))
    onChange(Array.from(next))
  }

  return (
    <div className="space-y-3 max-h-[50vh] overflow-y-auto pl-1 scrollbar-thin">
      {PERMISSION_GROUPS.map((group) => {
        const defs = PERMISSION_CATALOG.filter((p) => p.group === group)
        const onCount = defs.filter((d) => set.has(d.key)).length
        const allOn = onCount === defs.length
        return (
          <div key={group} className="rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between gap-2 bg-muted/50 px-3 py-2">
              <div
                onClick={() => toggleGroup(group)}
                role="button"
                tabIndex={disabled ? -1 : 0}
                onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleGroup(group) } }}
                className={cn('flex items-center gap-2 text-xs font-bold hover:text-primary transition-colors cursor-pointer', disabled && 'opacity-60 cursor-not-allowed')}
              >
                <Checkbox checked={allOn} disabled={disabled} onCheckedChange={() => toggleGroup(group)} aria-label={`تحديد كل صلاحيات ${group}`} />
                <span>{group}</span>
              </div>
              <Badge variant="secondary" className="text-[10px] tnum">{onCount}/{defs.length}</Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 p-2.5">
              {defs.map((d) => (
                <label key={d.key} className={cn('flex items-center gap-2 py-1 px-1.5 rounded-lg text-xs cursor-pointer hover:bg-muted/60', disabled && 'opacity-60 cursor-not-allowed')}>
                  <Checkbox checked={set.has(d.key)} disabled={disabled} onCheckedChange={() => toggle(d.key)} />
                  <span className="flex-1 leading-tight">{d.label}</span>
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function RolesModule() {
  const { toast } = useToast()
  const { user: me } = useAuth()
  const { data, isLoading, mutate } = useSWR<{ items: any[] }>('/api/roles', fetcher)
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<any>(null)
  const [deleting, setDeleting] = React.useState<any>(null)
  const [v, setV] = React.useState<any>({ label: '', name: '', permissions: [] })
  const [err, setErr] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const roles = data?.items ?? []

  React.useEffect(() => {
    if (open) {
      setErr('')
      if (editing) {
        const rawPerms: string[] = Array.isArray(editing.permissions) ? editing.permissions : []
        // توسيع الأنماط (مثل accounting.*) إلى مفاتيح صريحة + الاحتفاظ بأي صلاحيات غير معروفة حتى لا تفقد
        const expanded = expandPermissions(rawPerms)
        const extra = rawPerms.filter((p) => p !== '*' && !p.endsWith('.*') && !PERMISSION_CATALOG.some((d) => d.key === p))
        setV({ label: editing.label || editing.name, name: editing.name, permissions: [...Array.from(expanded), ...extra] })
      } else {
        setV({ label: '', name: '', permissions: ['dashboard.view'] })
      }
    }
  }, [open, editing])

  const openEdit = (r: any) => {
    if (r.name === 'admin') {
      toast({ title: 'دور مدير النظام', description: 'يملك كل الصلاحيات ولا يمكن تعديله' })
      return
    }
    setEditing(r); setOpen(true)
  }

  const submit = async () => {
    setSaving(true); setErr('')
    try {
      const payload = { label: v.label?.trim() || v.name, name: v.name?.trim(), permissions: v.permissions, userName: me?.username || 'admin' }
      if (editing) {
        await apiPatch(`/api/roles/${editing.id}`, payload)
        toast({ title: 'تم تحديث الدور', description: `${v.permissions.length} صلاحية محفوظة` })
      } else {
        await apiPost('/api/roles', payload)
        toast({ title: 'تمت إضافة الدور', description: `${v.permissions.length} صلاحية` })
      }
      setOpen(false); mutate()
    } catch (e: any) { setErr(e.message) } finally { setSaving(false) }
  }

  const delRole = async () => {
    if (!deleting) return
    try { await apiDelete(`/api/roles/${deleting.id}`); mutate(); toast({ title: 'تم حذف الدور' }) }
    catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
    setDeleting(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Shield className="size-5 text-muted-foreground" />
          <Badge variant="secondary" className="tnum">{fmtNum(roles.length)} دور</Badge>
          <Badge variant="outline" className="tnum">{fmtNum(PERMISSION_CATALOG.length)} صلاحية في النظام</Badge>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true) }} size="sm">
          <Plus className="size-4" /> دور جديد
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {roles.map((r) => {
            const isAdmin = r.name === 'admin'
            const effective = isAdmin ? new Set(PERMISSION_CATALOG.map((p) => p.key)) : expandPermissions(r.permissions)
            return (
              <Card key={r.id} className={cn(isAdmin && 'border-emerald-300 dark:border-emerald-800')}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={cn('flex items-center justify-center size-10 rounded-xl shrink-0', isAdmin ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-primary/10 text-primary')}>
                        {isAdmin ? <ShieldCheck className="size-5" /> : <Shield className="size-5" />}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate">{r.label || r.name}</div>
                        <div className="text-[11px] text-muted-foreground tnum" dir="ltr">@{r.name}</div>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(r)} className={cn(isAdmin && 'opacity-40')} aria-label="تعديل الدور">
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive" disabled={isAdmin || (r._count?.users ?? 0) > 0} onClick={() => setDeleting(r)} aria-label="حذف الدور">
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="text-[10px] tnum">
                      {isAdmin ? 'كل الصلاحيات' : `${effective.size} صلاحية`}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] tnum">{fmtNum(r._count?.users ?? 0)} مستخدم</Badge>
                    {!isAdmin && effective.size === 0 && (
                      <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300"><ShieldOff className="size-2.5 ml-1" />بدون صلاحيات</Badge>
                    )}
                  </div>
                  {!isAdmin && effective.size > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1 border-t border-border/60">
                      {Array.from(effective).slice(0, 4).map((key) => {
                        const def = PERMISSION_CATALOG.find((p) => p.key === key)
                        return <Badge key={key} variant="secondary" className="text-[9px] font-normal">{def?.label ?? key}</Badge>
                      })}
                      {effective.size > 4 && <Badge variant="secondary" className="text-[9px]">+{effective.size - 4}</Badge>}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* dialog إضافة/تعديل دور */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `تعديل دور: ${editing.label || editing.name}` : 'دور جديد'}</DialogTitle>
            <DialogDescription>حدد صلاحيات هذا الدور — تُطبق فورًا على جميع المستخدمين المرتبطين به.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-1">
            <div><label className="text-xs font-medium">اسم العرض *</label><Input value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} placeholder="مثال: محاسب" /></div>
            <div><label className="text-xs font-medium">المعرف (إنجليزي) *</label><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} dir="ltr" disabled={!!editing} placeholder="accountant" /></div>
          </div>
          <div className="text-xs text-muted-foreground flex items-center justify-between">
            <span>مصفوفة الصلاحيات</span>
            <Badge variant="secondary" className="tnum">{v.permissions.length} محددة</Badge>
          </div>
          <PermissionMatrix selected={v.permissions} onChange={(perms) => setV({ ...v, permissions: perms })} />
          {err && <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit} disabled={saving}>{saving ? 'جاري...' : editing ? 'حفظ التعديلات' : 'إضافة الدور'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأكيد الحذف */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الدور؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف دور «{deleting?.label || deleting?.name}» — لا يمكن الحذف إذا كان مرتبطًا بمستخدمين.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={delRole} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ============================================================================
// === Settings ===
// ============================================================================
export function SettingsModule() {
  const { toast } = useToast()
  const { user: me } = useAuth()
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
      await apiPatch('/api/settings', { updates, userName: me?.username || 'admin' })
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

// ============================================================================
// === Audit Log ===
// ============================================================================
export function AuditModule() {
  const [q, setQ] = React.useState('')
  const [entity, setEntity] = React.useState<string>('all')
  const { data, isLoading } = useSWR<{ items: any[]; total: number }>(`/api/audit?entity=${entity !== 'all' ? entity : ''}&q=${encodeURIComponent(q)}`, fetcher, { refreshInterval: 15000 })

  const entityLabels: Record<string, string> = {
    shipment: 'شحنة', party: 'طرف', journal_entry: 'قيد', voucher: 'إذن/سند',
    branch: 'فرع', warehouse: 'مخزن', item: 'صنف', inventory_movement: 'حركة مخزون',
    freight_price: 'سعر نولون', account: 'حساب', user: 'مستخدم', role: 'دور/صلاحيات', setting: 'إعداد',
  }
  const actionTones: Record<string, string> = {
    create: 'bg-emerald-100 text-emerald-700', update: 'bg-amber-100 text-amber-700',
    delete: 'bg-rose-100 text-rose-700', post: 'bg-sky-100 text-sky-700', import: 'bg-purple-100 text-purple-700',
    login: 'bg-teal-100 text-teal-700', logout: 'bg-slate-200 text-slate-600',
  }
  const actionLabels: Record<string, string> = {
    create: 'إضافة', update: 'تعديل', delete: 'حذف', post: 'ترحيل', import: 'استيراد',
    approve: 'اعتماد', cancel: 'إلغاء', login: 'تسجيل دخول', logout: 'تسجيل خروج',
  }

  const cols = [
    { key: 'date', header: 'التاريخ', hideInCard: true, align: 'center' as const, width: 'w-44', render: (a: any) => <span className="text-xs tnum text-muted-foreground whitespace-nowrap">{fmtDateTime(a.date)}</span> },
    { key: 'user', header: 'المستخدم', hideInCard: true, width: 'w-28', render: (a: any) => <span className="text-xs font-medium">{a.userName || 'النظام'}</span> },
    { key: 'action', header: 'العملية', primary: true, align: 'center' as const, width: 'w-28', render: (a: any) => <Badge variant="outline" className={actionTones[a.action] || ''}>{actionLabels[a.action] || a.action}</Badge> },
    { key: 'entity', header: 'الكيان', align: 'center' as const, width: 'w-32', render: (a: any) => <span className="text-xs">{entityLabels[a.entity] || a.entity}</span> },
    { key: 'notes', header: 'ملاحظات', render: (a: any) => <span className="text-xs truncate-1 block">{a.notes || '-'}</span> },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <History className="size-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground tnum">{fmtNum(data?.total ?? 0)} عملية</span>
          <Badge variant="outline" className="text-[10px] gap-1"><LogIn className="size-2.5" /><LogOut className="size-2.5" /> دخول/خروج مسجل</Badge>
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
        <DataTable rows={data?.items ?? []} columns={cols} loading={isLoading} getRowKey={(a: any) => a.id} minW={800} searchFn={() => true} />
      </CardContent></Card>
      <div className="text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3 border border-amber-200 dark:border-amber-900">
        🔒 سجل التدقيق غير قابل للتعديل أو الحذف — يُحفظ تلقائيًا مع كل عملية (إضافة/تعديل/حذف/دخول/خروج) مع اسم المستخدم المنفذ.
      </div>
    </div>
  )
}
