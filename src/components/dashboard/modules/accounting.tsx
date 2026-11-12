'use client'

// ============================================================================
// وحدات المحاسبة — شجرة الحسابات (AccountsModule) + دفتر اليومية (JournalModule)
// الحسابات: إضافة/تعديل (الاسم) + تفعيل/إيقاف + حذف — عبر PATCH و DELETE على
// /api/accounts مع إظهار أخطاء الخادم العربية (409: حساب له حركات...)
// اليومية: ترحيل/حذف للمسودات، إلغاء (void)، عكس القيود المرحّلة بالقيد العكسي،
// وترحيل جماعي لقيود تسليم الشحنات غير المرحّلة (backfill) — بفرض الصلاحية.
// ============================================================================

import * as React from 'react'
import useSWR from 'swr'
import { Plus, Trash2, BookOpen, FileText, Check, Undo2, Ban, UploadCloud, SquarePen, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { EntityFormDialog, type Field } from '../entity-dialog'
import { DataTable } from '../data-table'
import { fetcher, apiPost, apiPatch, apiDelete, getToken } from '@/lib/api'
import { fmtNum, fmtDate, ACCOUNT_TYPE } from '@/lib/format'
import { useAuth } from '../auth-provider'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// === Chart of Accounts ===
export function AccountsModule() {
  const { toast } = useToast()
  const { has } = useAuth()
  const { confirmDelete } = useConfirm()
  const canManage = has('accounting.journal')
  const [open, setOpen] = React.useState(false)
  // حوار تعديل الحساب (الاسم العربي/الإنجليزي — الكود والحساب الأب ثابتان على الخادم)
  const [editAcc, setEditAcc] = React.useState<any>(null)
  const [ev, setEv] = React.useState({ name: '', nameEn: '' })
  const [eSaving, setESaving] = React.useState(false)
  const { data, isLoading, mutate } = useSWR<{ items: any[] }>('/api/accounts', fetcher, { refreshInterval: 30000 })

  // build tree
  const tree = React.useMemo(() => {
    if (!data) return []
    const byParent = new Map<string, any[]>()
    for (const a of data.items) {
      const pid = a.parentId || 'root'
      if (!byParent.has(pid)) byParent.set(pid, [])
      byParent.get(pid)!.push(a)
    }
    const build = (pid: string, depth: number): any[] => {
      const children = byParent.get(pid) || []
      return children.flatMap((c) => [{ ...c, depth }, ...build(c.id, depth + 1)])
    }
    return build('root', 0)
  }, [data])

  const fields: Field[] = [
    { name: 'code', label: 'كود الحساب *', type: 'text' },
    { name: 'name', label: 'اسم الحساب *', type: 'text' },
    { name: 'nameEn', label: 'الاسم (EN)', type: 'text' },
    { name: 'type', label: 'النوع *', type: 'select', options: Object.entries(ACCOUNT_TYPE).map(([v, m]) => ({ value: v, label: m.label })) },
    { name: 'parentId', label: 'الحساب الأب', type: 'select', options: (data?.items ?? []).map((a) => ({ value: a.id, label: `${a.code} - ${a.name}` })) },
    { name: 'isDetail', label: 'حساب تفصيلي (يقبل قيودًا)', type: 'switch' },
  ]
  const submit = async (vals: any) => {
    await apiPost('/api/accounts', { ...vals, isDetail: vals.isDetail !== false })
    toast({ title: 'تمت الإضافة' }); mutate()
  }

  // ---- تعديل حساب ----
  const openEdit = (a: any) => {
    setEditAcc(a)
    setEv({ name: a.name ?? '', nameEn: a.nameEn ?? '' })
  }

  const editSubmit = async () => {
    if (!editAcc) return
    if (!ev.name.trim()) { toast({ title: 'خطأ', description: 'اسم الحساب مطلوب', variant: 'destructive' }); return }
    setESaving(true)
    try {
      await apiPatch('/api/accounts', { id: editAcc.id, name: ev.name.trim(), nameEn: ev.nameEn.trim() || null })
      toast({ title: 'تم تعديل الحساب', description: `${editAcc.code} — ${ev.name.trim()}` })
      setEditAcc(null)
      mutate()
    } catch (e: any) {
      toast({ title: 'خطأ', description: e.message, variant: 'destructive' })
    } finally {
      setESaving(false)
    }
  }

  // ---- تفعيل/إيقاف — الخادم يمنع إيقاف حساب له حركات أو أذونات مرتبطة (409) ----
  const toggleActive = async (a: any, active: boolean) => {
    try {
      await apiPatch('/api/accounts', { id: a.id, active })
      toast({ title: active ? 'تم تفعيل الحساب' : 'تم إيقاف الحساب', description: a.name })
      mutate()
    } catch (e: any) {
      toast({ title: 'غير مسموح', description: e.message, variant: 'destructive' })
    }
  }

  // ---- حذف حساب — الخادم يسمح فقط للحسابات بلا حركات/بلا أبناء/بلا أذونات مرتبطة ----
  const delAccount = async (a: any) => {
    const ok = await confirmDelete({
      title: 'حذف الحساب',
      message: `حذف الحساب "${a.name}"؟ يُسمح بالحذف فقط للحسابات بلا حركات محاسبية وبلا حسابات فرعية وبلا أذونات مرتبطة.`,
    })
    if (!ok) return
    try {
      // DELETE /api/accounts يتطلب {id} في جسم الطلب — apiDelete لا يرسل جسمًا، نستخدم fetch مباشرة
      const token = getToken()
      const res = await fetch('/api/accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'x-session-token': token } : {}) },
        body: JSON.stringify({ id: a.id }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(d?.error ?? `فشل الطلب (${res.status})`)
      toast({ title: 'تم حذف الحساب', description: a.name })
      mutate()
    } catch (e: any) {
      toast({ title: 'خطأ', description: e.message, variant: 'destructive' })
    }
  }

  const columns = [
    { key: 'code', header: 'الكود', align: 'center' as const, width: 'w-24', hideInCard: true, render: (a: any) => <span className="font-mono text-xs">{a.code}</span> },
    { key: 'name', header: 'اسم الحساب', primary: true, render: (a: any) => (
      <span style={{ paddingRight: `${a.depth * 16}px` }} className={cn('text-sm flex items-center gap-1.5 min-w-0', a.isDetail ? 'font-medium' : 'font-bold text-primary', !a.active && 'opacity-50')}>
        <span className="truncate-1 min-w-0">{a.name}</span>
        {!a.active && (
          <Badge variant="outline" className="text-[10px] shrink-0 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            موقوف
          </Badge>
        )}
      </span>
    ) },
    { key: 'type', header: 'النوع', align: 'center' as const, width: 'w-32', render: (a: any) => {
      const t = ACCOUNT_TYPE[a.type] || { label: a.type, tone: '' }
      return <Badge variant="outline" className={t.tone}>{t.label}</Badge>
    } },
    { key: 'debit', header: 'مدين', align: 'left' as const, width: 'w-28', render: (a: any) => <span className="tnum">{fmtNum(a.debit)}</span> },
    { key: 'credit', header: 'دائن', align: 'left' as const, width: 'w-28', render: (a: any) => <span className="tnum">{fmtNum(a.credit)}</span> },
    { key: 'balance', header: 'الرصيد', align: 'left' as const, width: 'w-28', render: (a: any) => <span className="tnum font-bold">{fmtNum(a.balance)}</span> },
    // إدارة الحسابات — بصلاحية accounting.journal (الخادم يفرضها أيضًا)
    ...(canManage ? [{
      key: 'actions', header: 'إجراءات', align: 'center' as const, width: 'w-36',
      render: (a: any) => (
        <div className="flex items-center justify-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => openEdit(a)} title="تعديل الحساب" aria-label={`تعديل الحساب ${a.name}`}>
            <SquarePen className="size-3.5" />
          </Button>
          <Switch
            checked={!!a.active}
            onCheckedChange={(c) => toggleActive(a, c)}
            aria-label={a.active ? `إيقاف الحساب ${a.name}` : `تفعيل الحساب ${a.name}`}
            title={a.active ? 'إيقاف الحساب' : 'تفعيل الحساب'}
          />
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => delAccount(a)} title="حذف الحساب" aria-label={`حذف الحساب ${a.name}`}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ),
    }] : []),
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="size-5 text-muted-foreground shrink-0" />
          <span className="text-sm text-muted-foreground tnum">{data?.items.length ?? 0} حساب</span>
        </div>
        {canManage && (
          <Button onClick={() => setOpen(true)} size="sm" className="shrink-0"><Plus className="size-4" /> <span className="hidden sm:inline">حساب جديد</span><span className="sm:hidden">جديد</span></Button>
        )}
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">شجرة الحسابات</CardTitle><CardDescription>مع أرصدة من القيود المرحّلة</CardDescription></CardHeader>
        <CardContent className="p-0">
          <DataTable rows={tree} columns={columns} loading={isLoading} getRowKey={(a: any) => a.id} minW={canManage ? 920 : 800} searchFn={(a, q) => (a.name || '').toLowerCase().includes(q) || (a.code || '').toLowerCase().includes(q)} searchPlaceholder="بحث بالاسم أو الكود..." />
        </CardContent>
      </Card>
      <EntityFormDialog open={open} onOpenChange={setOpen} title="إضافة حساب" fields={fields} initial={{}} onSubmit={submit} />

      {/* حوار تعديل الحساب — الاسم العربي/الإنجليزي فقط */}
      <Dialog open={!!editAcc} onOpenChange={(o) => !o && setEditAcc(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>تعديل الحساب{editAcc?.code ? ` — ${editAcc.code}` : ''}</DialogTitle>
            <DialogDescription>تعديل الاسم العربي/الإنجليزي فقط — الكود والحساب الأب ثابتان لحماية شجرة الحسابات والأرصدة.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-1">
            <div>
              <label className="text-xs font-medium">اسم الحساب *</label>
              <Input value={ev.name} onChange={(e) => setEv({ ...ev, name: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium">الاسم (EN)</label>
              <Input value={ev.nameEn} onChange={(e) => setEv({ ...ev, nameEn: e.target.value })} dir="ltr" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditAcc(null)}>إلغاء</Button>
            <Button onClick={editSubmit} disabled={eSaving || !ev.name.trim()}>
              {eSaving ? 'جاري...' : 'حفظ التعديل'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// === Journal Entries ===
export function JournalModule() {
  const { toast } = useToast()
  const { has } = useAuth()
  const { confirmDelete, confirm: confirmDialog } = useConfirm()
  const canManage = has('accounting.journal')
  const [open, setOpen] = React.useState(false)
  const [statusFilter, setStatusFilter] = React.useState<string>('all')
  const { data, isLoading, mutate } = useSWR<{ items: any[] }>(`/api/journal?status=${statusFilter !== 'all' ? statusFilter : ''}`, fetcher, { refreshInterval: 30000 })
  const { data: accounts } = useSWR<{ items: any[] }>('/api/accounts', fetcher)
  const { data: parties } = useSWR<{ items: any[] }>('/api/parties', fetcher)
  const { data: branches } = useSWR<{ items: any[] }>('/api/branches', fetcher)

  const [lines, setLines] = React.useState<any[]>([{ accountId: '', debit: '', credit: '', description: '', partyId: '' }, { accountId: '', debit: '', credit: '', description: '', partyId: '' }])
  const [header, setHeader] = React.useState<any>({ date: new Date().toISOString().slice(0, 10), description: '', reference: '', branchId: '', autoPost: false })
  const [err, setErr] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  React.useEffect(() => {
    if (open) {
      setLines([{ accountId: '', debit: '', credit: '', description: '', partyId: '' }, { accountId: '', debit: '', credit: '', description: '', partyId: '' }])
      setHeader({ date: new Date().toISOString().slice(0, 10), description: '', reference: '', branchId: '', autoPost: false })
      setErr('')
    }
  }, [open])

  const detailAccounts = (accounts?.items ?? []).filter((a) => a.isDetail)

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.001 && lines.length >= 2

  const setLine = (i: number, k: string, v: any) => setLines((arr) => arr.map((l, idx) => idx === i ? { ...l, [k]: v } : l))
  const addLine = () => setLines((arr) => [...arr, { accountId: '', debit: '', credit: '', description: '', partyId: '' }])
  const removeLine = (i: number) => setLines((arr) => arr.filter((_, idx) => idx !== i))

  const submit = async () => {
    setLoading(true); setErr('')
    try {
      if (!isBalanced) throw new Error(`القيد غير متوازن — المدين ${totalDebit} ≠ الدائن ${totalCredit}`)
      await apiPost('/api/journal', {
        ...header,
        date: header.date,
        lines: lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, description: l.description, partyId: l.partyId || null })),
      })
      toast({ title: 'تم إنشاء القيد' }); setOpen(false); mutate()
    } catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }

  const post = async (id: string) => {
    try {
      await apiPost(`/api/journal/${id}/post`, {})
      toast({ title: 'تم ترحيل القيد' }); mutate()
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  const del = async (id: string) => {
    const ok = await confirmDelete({
      title: 'حذف القيد',
      message: 'حذف القيد؟ (لا يمكن حذف قيد مرحّل)',
    })
    if (!ok) return
    try { await apiDelete(`/api/journal/${id}`); mutate(); toast({ title: 'تم الحذف' }) }
    catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  // عكس قيد مرحّل — يُنشئ قيدًا عكسيًا كاملًا (تبديل المدين والدائن) ويُفك ربطه بالأذونات
  // الخادم يمنع العكس مرتين (409: تم عكس هذا القيد مسبقًا)
  const reverse = async (e: any) => {
    const ok = await confirmDialog({
      title: `عكس القيد ${e.entryNo}`,
      message: 'سيُنشأ قيد عكسي يعكس أثر هذا القيد المرحّل بالكامل (تبديل المدين والدائن). لا يمكن عكس القيد مرتين. هل تريد المتابعة؟',
      variant: 'warning',
      confirmText: 'عكس',
    })
    if (!ok) return
    try {
      const res: any = await apiPost(`/api/journal/${e.id}/reverse`, {})
      toast({ title: 'تم إنشاء القيد العكسي', description: res?.reversalNo ? `رقم القيد العكسي: ${res.reversalNo}` : undefined })
      mutate()
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' })
    }
  }

  // إلغاء قيد مسودة (void) — يبقى في السجل بعلامة «ملغي» دون حذفه
  const voidEntry = async (e: any) => {
    const ok = await confirmDialog({
      title: `إلغاء القيد ${e.entryNo}`,
      message: 'سيتم إلغاء القيد المسودة دون حذفه من السجل (يبقى بعلامة «ملغي»). هل تريد المتابعة؟',
      variant: 'warning',
      confirmText: 'إلغاء القيد',
    })
    if (!ok) return
    try {
      await apiPost(`/api/journal/${e.id}`, { reason: 'إلغاء من واجهة دفتر اليومية' })
      toast({ title: 'تم إلغاء القيد' })
      mutate()
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' })
    }
  }

  // ترحيل جماعي (أداة تصحيح): قيود تسليم لكل الشحنات المسلّمة التي لا يوجد لها قيد
  const [backfilling, setBackfilling] = React.useState(false)
  const backfillShipments = async () => {
    const ok = await confirmDialog({
      title: 'ترحيل قيود الشحنات غير المرحّلة',
      message: 'سيُنشئ النظام قيود تسليم لكل الشحنات المسلّمة التي لا يوجد لها قيد بعد، داخل معاملة واحدة مع التدقيق. هل تريد المتابعة؟',
      variant: 'primary',
      confirmText: 'ترحيل',
    })
    if (!ok) return
    setBackfilling(true)
    try {
      const res: any = await apiPost('/api/journal/backfill-shipments', {})
      toast({ title: 'تم الترحيل', description: `تم ترحيل ${res?.posted ?? 0} من ${res?.processed ?? 0}` })
      mutate()
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' })
    } finally {
      setBackfilling(false)
    }
  }

  const columns = [
    { key: 'no', header: 'رقم القيد', primary: true, align: 'center' as const, width: 'w-24', render: (e: any) => <span className="font-mono text-xs font-bold">{e.entryNo}</span> },
    { key: 'date', header: 'التاريخ', hideInCard: true, align: 'center' as const, width: 'w-32', render: (e: any) => <span className="text-xs tnum">{fmtDate(e.date)}</span> },
    {
      key: 'desc', header: 'البيان', hideInCard: true,
      render: (e: any) => (
        <div className="min-w-0">
          <div className="text-sm font-medium truncate-1">{e.description || '-'}</div>
          {e.reference && <div className="text-[10px] text-muted-foreground">مرجع: {e.reference}</div>}
          {/* سطور القيد — مع شارة الشحنة المرتبطة إن وُجدت */}
          {(e.lines ?? []).length > 0 && (
            <div className="mt-1 space-y-0.5 max-h-20 overflow-y-auto no-scrollbar">
              {(e.lines ?? []).map((l: any) => (
                <div key={l.id} className="flex items-center gap-1.5 text-[10px] text-muted-foreground min-w-0">
                  <span className="truncate-1 min-w-0">{[l.account?.code, l.description || l.account?.name].filter(Boolean).join(' · ')}</span>
                  {l.shipmentNo && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 bg-muted/50 text-muted-foreground font-normal">
                      شحنة: {l.shipmentNo}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ),
    },
    { key: 'branch', header: 'الفرع', hideInCard: true, width: 'w-32', render: (e: any) => <span className="text-xs">{e.branch?.name || '-'}</span> },
    { key: 'lines', header: 'السطور', hideInCard: true, align: 'center' as const, width: 'w-20', render: (e: any) => <Badge variant="outline" className="tnum">{e.lines?.length ?? 0}</Badge> },
    { key: 'debit', header: 'مدين', align: 'left' as const, width: 'w-28', render: (e: any) => <span className="tnum font-bold">{fmtNum(e.totalDebit)}</span> },
    { key: 'credit', header: 'دائن', align: 'left' as const, width: 'w-28', render: (e: any) => <span className="tnum font-bold">{fmtNum(e.totalCredit)}</span> },
    {
      key: 'status', header: 'الحالة', align: 'center' as const, width: 'w-24',
      render: (e: any) => (
        <div className="flex flex-col items-center gap-1">
          <Badge variant="outline" className={
            e.status === 'posted'
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
              : e.status === 'void'
                ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
          }>
            {e.status === 'posted' ? 'مرحّل' : e.status === 'void' ? 'ملغي' : 'مسودة'}
          </Badge>
          {e.status === 'posted' && !!e.reversalOfId && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">مُعكوس</Badge>
          )}
        </div>
      ),
    },
    {
      key: 'actions', header: 'إجراءات', align: 'center' as const, width: 'w-28', hideInCard: false,
      render: (e: any) => {
        // عمليات القيود تتطلب صلاحية accounting.journal (الخادم يفرضها أيضًا)
        if (!canManage) return <span className="text-muted-foreground text-xs">—</span>
        return (
          <div className="flex items-center justify-center gap-0.5">
            {e.status === 'draft' && (
              <>
                <Button variant="ghost" size="sm" onClick={() => post(e.id)} title="ترحيل القيد" aria-label={`ترحيل القيد ${e.entryNo}`}>
                  <Check className="size-3.5 text-emerald-600" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => voidEntry(e)} title="إلغاء القيد (يبقى في السجل)" aria-label={`إلغاء القيد ${e.entryNo}`}>
                  <Ban className="size-3.5 text-amber-600" />
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => del(e.id)} title="حذف القيد" aria-label={`حذف القيد ${e.entryNo}`}>
                  <Trash2 className="size-3.5" />
                </Button>
              </>
            )}
            {e.status === 'posted' && !e.reversalOfId && (
              <Button variant="ghost" size="sm" onClick={() => reverse(e)} title="عكس القيد" aria-label={`عكس القيد ${e.entryNo}`}>
                <Undo2 className="size-3.5 text-primary" />
              </Button>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap print:hidden">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileText className="size-5 text-muted-foreground shrink-0" />
          <span className="text-sm text-muted-foreground tnum shrink-0">{data?.items.length ?? 0} قيد</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32 sm:w-36 h-8 min-w-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل القيود</SelectItem>
              <SelectItem value="draft">مسودات فقط</SelectItem>
              <SelectItem value="posted">مرحّلة فقط</SelectItem>
              <SelectItem value="void">الملغية فقط</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canManage && (
            <Button variant="outline" size="sm" onClick={backfillShipments} disabled={backfilling} className="shrink-0">
              {backfilling ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
              <span className="hidden lg:inline">ترحيل قيود الشحنات غير المرحّلة</span>
              <span className="lg:hidden">ترحيل الشحنات</span>
            </Button>
          )}
          {canManage && (
            <Button onClick={() => setOpen(true)} size="sm" className="shrink-0"><Plus className="size-4" /> <span className="hidden sm:inline">قيد جديد</span><span className="sm:hidden">جديد</span></Button>
          )}
        </div>
      </div>

      <DataTable
        rows={data?.items ?? []}
        columns={columns}
        loading={isLoading}
        getRowKey={(e: any) => e.id}
        minW={1100}
        searchFn={(e, q) =>
          (e.entryNo || '').toLowerCase().includes(q) ||
          (e.description || '').toLowerCase().includes(q) ||
          (e.reference || '').toLowerCase().includes(q) ||
          (e.lines ?? []).some((l: any) => (l.shipmentNo || '').toLowerCase().includes(q))
        }
        searchPlaceholder="بحث برقم القيد/البيان/الشحنة..."
      />

      {/* Create journal entry dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>قيد يومية جديد</DialogTitle>
            <DialogDescription>القيد المزدوج — يجب أن يكون المدين = الدائن. يُحفظ كمسودة ما لم تفعّل «ترحيل مباشر».</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 py-2">
            <div><label className="text-xs font-medium">التاريخ</label><Input type="date" value={header.date} onChange={(e) => setHeader({ ...header, date: e.target.value })} /></div>
            <div><label className="text-xs font-medium">مرجع</label><Input value={header.reference} onChange={(e) => setHeader({ ...header, reference: e.target.value })} /></div>
            <div><label className="text-xs font-medium">الفرع</label>
              <Select value={header.branchId} onValueChange={(val) => setHeader({ ...header, branchId: val === '__' ? '' : val })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent><SelectItem value="__">—</SelectItem>{(branches?.items ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-3"><label className="text-xs font-medium">البيان</label><Input value={header.description} onChange={(e) => setHeader({ ...header, description: e.target.value })} placeholder="بيان القيد..." /></div>
            <div className="sm:col-span-3 flex items-center gap-2 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2.5">
              <Switch id="autopost" checked={!!header.autoPost} onCheckedChange={(c) => setHeader({ ...header, autoPost: c })} />
              <label htmlFor="autopost" className="text-xs cursor-pointer">
                <span className="font-bold">ترحيل مباشر</span>
                <span className="text-muted-foreground block text-[10px] mt-0.5">عند التفعيل، يُرحّل القيد فورًا بعد الحفظ (لا يمكن تعديله بعدها — استخدم قيدًا عكسيًا).</span>
              </label>
            </div>
          </div>
          {/* Lines */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 640 }}>
                <thead className="bg-muted/40 text-xs">
                  <tr className="text-right">
                    <th className="font-medium px-2 py-2">الحساب</th>
                    <th className="font-medium px-2 py-2">الطرف</th>
                    <th className="font-medium px-2 py-2 text-left">مدين</th>
                    <th className="font-medium px-2 py-2 text-left">دائن</th>
                    <th className="font-medium px-2 py-2">بيان</th>
                    <th className="font-medium px-2 py-2 w-10"></th>
                  </tr>
                </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-1">
                      <Select value={l.accountId} onValueChange={(v) => setLine(i, 'accountId', v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="اختر حسابًا..." /></SelectTrigger>
                        <SelectContent>
                          {detailAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} - {a.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-1">
                      <Select value={l.partyId} onValueChange={(v) => setLine(i, 'partyId', v === '__' ? '' : v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__">—</SelectItem>
                          {(parties?.items ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-1"><Input type="number" className="h-8 text-left tnum" value={l.debit} onChange={(e) => setLine(i, 'debit', e.target.value)} /></td>
                    <td className="p-1"><Input type="number" className="h-8 text-left tnum" value={l.credit} onChange={(e) => setLine(i, 'credit', e.target.value)} /></td>
                    <td className="p-1"><Input className="h-8 text-xs" value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} /></td>
                    <td className="p-1 text-center">{lines.length > 2 && <button onClick={() => removeLine(i)} className="text-destructive" aria-label="حذف السطر"><Trash2 className="size-3.5" /></button>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/30 border-t">
                <tr className="text-sm font-bold">
                  <td colSpan={2} className="px-2 py-2 text-right"><Button variant="ghost" size="sm" onClick={addLine} className="text-primary"><Plus className="size-3.5" /> سطر جديد</Button></td>
                  <td className="px-2 py-2 text-left tnum">{fmtNum(totalDebit)}</td>
                  <td className="px-2 py-2 text-left tnum">{fmtNum(totalCredit)}</td>
                  <td colSpan={2} className="px-2 py-2">
                    <Badge variant="outline" className={isBalanced ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}>
                      {isBalanced ? 'متوازن' : `الفرق: ${fmtNum(Math.abs(totalDebit - totalCredit))}`}
                    </Badge>
                  </td>
                </tr>
              </tfoot>
            </table>
            </div>
          </div>
          {err && <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit} disabled={loading || !isBalanced}>{loading ? 'جاري...' : 'حفظ القيد'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
