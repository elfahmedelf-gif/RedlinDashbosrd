'use client'

// ============================================================================
// وحدة المصروفات العمومية والتشغيلية — مصروفات المكتب اليومية
// (لابتوب/أدوات مكتب/بوفية/مشتريات...إلخ) مستقلة عن حساب المقاول.
// قيد مزدوج تلقائي عند الحفظ: مدين حساب المصروف / دائن الصندوق أو البنك.
// صلاحيات: opex.view (عرض) / opex.manage (إضافة/تعديل/حذف)
// ============================================================================

import * as React from 'react'
import useSWR from 'swr'
import {
  Plus, Pencil, Trash2, Search, RefreshCw, FileSpreadsheet, ReceiptText,
  Wallet, ShoppingBag, Building2, Info, Landmark,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Kpi } from '../ui-cards'
import { DataTable } from '../data-table'
import { fetcher } from '@/lib/api'
import { apiPostSync as apiPost, apiPatchSync as apiPatch, apiDeleteSync as apiDelete } from '@/lib/sync'
import { exportToCSV } from '@/lib/export'
import { fmtNum, fmtDate } from '@/lib/format'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '../auth-provider'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'

// تاريخ اليوم المحلي (بدل UTC) — يمنع انحراف اليوم السابق بعد منتصف الليل
function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const CATEGORY_OPTIONS = [
  { value: 'general', label: 'مصروفات عمومية وإدارية', code: '5105' },
  { value: 'operating', label: 'مصروفات تشغيلية', code: '5104' },
  { value: 'other', label: 'مصروفات أخرى', code: '5104' },
]

// أنواع المصروف الجاهزة — اختيار سريع يعبّي البيان تلقائيًا (مطابق لأمثلة المكتب اليومية)
const EXPENSE_TYPES: { label: string; note: string; category?: string }[] = [
  { label: 'كمبيوتر/لابتوب', note: 'شراء لابتوب/كمبيوتر للمكتب', category: 'general' },
  { label: 'أدوات مكتبية', note: 'أدوات ومستلزمات مكتبية', category: 'general' },
  { label: 'بوفية/ضيافة', note: 'طلبات بوفية وضيافة', category: 'operating' },
  { label: 'مشتريات عامة', note: 'مشتريات عامة للمكتب', category: 'operating' },
  { label: 'صيانة/إصلاح', note: 'صيانة وإصلاح', category: 'operating' },
  { label: 'كهرباء/إنترنت', note: 'فواتير كهرباء/إنترنت', category: 'general' },
  { label: 'أخرى', note: '', category: 'other' },
]

function categoryLabel(c: string): string {
  return CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? 'مصروف'
}

function categoryTone(c: string): string {
  switch (c) {
    case 'general': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
    case 'operating': return 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200'
    default: return 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200'
  }
}

interface OpexRow {
  id: string
  ref: string
  date: string
  amount: number
  category: string
  categoryLabel: string
  vendor: string | null
  notes: string | null
  accountId: string
  account: { id: string; code: string; name: string } | null
  payAccountId: string | null
  payAccount: { id: string; code: string; name: string } | null
  branchId: string | null
  branch: { id: string; name: string } | null
  journalEntry: { id: string; entryNo: string; status: string } | null
}

interface OpexResponse {
  items: OpexRow[]
  total: number
  page: number
  totalPages: number
  summary: {
    total: number
    totalAmount: number
    byCategory: { category: string; label: string; count: number; amount: number }[]
  }
}

interface AccountsResponse {
  expenseAccounts: { id: string; code: string; name: string }[]
  payAccounts: { id: string; code: string; name: string }[]
  branches: { id: string; name: string }[]
}

function emptyForm(): any {
  return {
    date: localDateStr(),
    category: 'general',
    accountId: '',
    payAccountId: '',
    vendor: '',
    amount: '',
    notes: '',
    branchId: '',
  }
}

export function OperatingExpensesModule() {
  const { toast } = useToast()
  const { has } = useAuth()
  const { confirmDelete } = useConfirm()
  const canManage = has('opex.manage')

  const [q, setQ] = React.useState('')
  const [debouncedQ, setDebouncedQ] = React.useState('')
  const [category, setCategory] = React.useState<string>('all')
  const [accountId, setAccountId] = React.useState<string>('all')
  const [branchId, setBranchId] = React.useState<string>('all')
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')

  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<OpexRow | null>(null)
  const [form, setForm] = React.useState<any>(emptyForm())
  const [saving, setSaving] = React.useState(false)
  const [err, setErr] = React.useState('')

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 350)
    return () => clearTimeout(t)
  }, [q])

  const params = new URLSearchParams()
  if (debouncedQ) params.set('q', debouncedQ)
  if (category !== 'all') params.set('category', category)
  if (accountId !== 'all') params.set('accountId', accountId)
  if (branchId !== 'all') params.set('branchId', branchId)
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  params.set('pageSize', '50')

  const { data, isLoading, mutate } = useSWR<OpexResponse>(`/api/operating-expenses?${params.toString()}`, fetcher, { refreshInterval: 30000 })
  const { data: accs } = useSWR<AccountsResponse>('/api/operating-expenses/accounts', fetcher)

  const expenseAccounts = accs?.expenseAccounts ?? []
  const payAccounts = accs?.payAccounts ?? []
  const branches = accs?.branches ?? []

  const summary = data?.summary
  const items = data?.items ?? []

  const openAdd = () => {
    setEditing(null)
    const f = emptyForm()
    // افتراضي: حساب 5105 (عمومية) + الصندوق 1101 للدفع
    const defaultExpense = expenseAccounts.find((a) => a.code === '5105') ?? expenseAccounts[0]
    const defaultPay = payAccounts.find((a) => a.code === '1101') ?? payAccounts[0]
    if (defaultExpense) f.accountId = defaultExpense.id
    if (defaultPay) f.payAccountId = defaultPay.id
    setForm(f)
    setErr('')
    setOpen(true)
  }

  const openEdit = (row: OpexRow) => {
    setEditing(row)
    setForm({
      date: row.date ? row.date.slice(0, 10) : localDateStr(),
      category: row.category,
      accountId: row.accountId,
      payAccountId: row.payAccountId ?? '',
      vendor: row.vendor ?? '',
      amount: String(row.amount ?? ''),
      notes: row.notes ?? '',
      branchId: row.branchId ?? '',
    })
    setErr('')
    setOpen(true)
  }

  // عند تغيير التصنيف: اضبط حساب المصروف الافتراضي (إن لم يُغيّره المستخدم يدويًا)
  const onCategoryChange = (val: string) => {
    const code = CATEGORY_OPTIONS.find((o) => o.value === val)?.code
    const acc = code ? expenseAccounts.find((a) => a.code === code) : null
    setForm((prev: any) => ({ ...prev, category: val, accountId: acc ? acc.id : prev.accountId }))
  }

  const submit = async () => {
    setSaving(true); setErr('')
    try {
      const payload = {
        date: form.date || localDateStr(),
        category: form.category,
        accountId: form.accountId,
        payAccountId: form.payAccountId || null,
        vendor: form.vendor || null,
        amount: Number(form.amount) || 0,
        notes: form.notes || null,
        branchId: form.branchId || null,
      }
      if (!payload.accountId) { setErr('اختر حساب المصروف'); setSaving(false); return }
      if (!(payload.amount > 0)) { setErr('أدخل مبلغًا صحيحًا أكبر من صفر'); setSaving(false); return }
      if (editing) {
        await apiPatch(`/api/operating-expenses/${editing.id}`, payload)
        toast({ title: 'تم حفظ التعديلات' })
      } else {
        await apiPost('/api/operating-expenses', payload)
        toast({ title: 'تم تسجيل المصروف وقيد الترحيل' })
      }
      setOpen(false)
      mutate()
    } catch (e: any) {
      setErr(e.message)
    } finally { setSaving(false) }
  }

  const del = async (row: OpexRow) => {
    const ok = await confirmDelete({
      title: 'حذف المصروف',
      message: `سيتم عكس القيد المرتبط وحذف المصروف ${row.ref} (${fmtNum(row.amount)} ج.م). هل تريد المتابعة؟`,
    })
    if (!ok) return
    try {
      await apiDelete(`/api/operating-expenses/${row.id}`)
      toast({ title: 'تم حذف المصروف وعكس القيد' })
      mutate()
    } catch (e: any) {
      toast({ title: 'خطأ', description: e.message, variant: 'destructive' })
    }
  }

  const exportCsv = () => {
    if (!items.length) { toast({ title: 'لا توجد بيانات للتصدير' }); return }
    exportToCSV(
      items.map((r) => ({
        ref: r.ref,
        date: r.date ? fmtDate(r.date) : '',
        category: r.categoryLabel,
        account: r.account?.name ?? '',
        vendor: r.vendor ?? '',
        amount: r.amount,
        payAccount: r.payAccount?.name ?? '',
        branch: r.branch?.name ?? '',
        journalEntry: r.journalEntry?.entryNo ?? '',
        notes: r.notes ?? '',
      })),
      'مصروفات-عمومية-وتشغيل.csv',
      [
        { key: 'ref', header: 'رقم' },
        { key: 'date', header: 'التاريخ' },
        { key: 'category', header: 'التصنيف' },
        { key: 'account', header: 'حساب المصروف' },
        { key: 'vendor', header: 'المورد/المتجر' },
        { key: 'amount', header: 'المبلغ' },
        { key: 'payAccount', header: 'مدفوع من' },
        { key: 'branch', header: 'الفرع' },
        { key: 'journalEntry', header: 'القيد' },
        { key: 'notes', header: 'ملاحظات' },
      ],
    )
  }

  const byCat = (c: string) => summary?.byCategory.find((x) => x.category === c)

  return (
    <div className="space-y-4">
      {/* شريط الإجراءات العلوي */}
      <div className="flex items-center justify-between gap-2 flex-wrap print:hidden">
        <div className="text-sm text-muted-foreground tnum">{data?.total ?? 0} مصروف</div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => mutate()}><RefreshCw className="size-4" /> تحديث</Button>
          <Button variant="outline" size="sm" onClick={exportCsv}><FileSpreadsheet className="size-4" /> تصدير Excel</Button>
          {canManage && (
            <Button size="sm" onClick={openAdd}><Plus className="size-4" /> <span className="hidden sm:inline">تسجيل مصروف</span><span className="sm:hidden">جديد</span></Button>
          )}
        </div>
      </div>

      {/* مؤشرات الأداء */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {isLoading ? (
          <>
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </>
        ) : (
          <>
            <Kpi title="إجمالي المصروفات" value={fmtNum(summary?.totalAmount ?? 0)} unit="ج.م" icon={Wallet} tone="primary" subtitle={`${summary?.total ?? 0} سجل`} />
            <Kpi title="مصروفات عمومية وإدارية" value={fmtNum(byCat('general')?.amount ?? 0)} unit="ج.م" icon={ReceiptText} tone="purple" subtitle={`${byCat('general')?.count ?? 0} سجل`} />
            <Kpi title="مصروفات تشغيلية" value={fmtNum(byCat('operating')?.amount ?? 0)} unit="ج.م" icon={ShoppingBag} tone="teal" subtitle={`${byCat('operating')?.count ?? 0} سجل`} />
            <Kpi title="مصروفات أخرى" value={fmtNum(byCat('other')?.amount ?? 0)} unit="ج.م" icon={Building2} tone="green" subtitle={`${byCat('other')?.count ?? 0} سجل`} />
          </>
        )}
      </div>

      {/* فلاتر */}
      <Card className="print:hidden">
        <CardContent className="p-3 flex flex-col lg:flex-row gap-2 lg:items-end">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute top-1/2 -translate-y-1/2 start-2.5 size-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث برقم المصروف/الحساب/المورد/الملاحظات..." className="ps-9 min-w-0" aria-label="بحث في المصروفات" />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="التصنيف" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل التصنيفات</SelectItem>
                {CATEGORY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="الحساب" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحسابات</SelectItem>
                {expenseAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="من تاريخ" className="w-[150px]" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="إلى تاريخ" className="w-[150px]" />
            {(q || category !== 'all' || accountId !== 'all' || branchId !== 'all' || from || to) && (
              <Button variant="ghost" size="sm" onClick={() => { setQ(''); setCategory('all'); setAccountId('all'); setBranchId('all'); setFrom(''); setTo('') }}>مسح</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* جدول المصروفات */}
      <DataTable
        rows={items}
        loading={isLoading}
        getRowKey={(r) => r.id}
        emptyText="لا توجد مصروفات مطابقة"
        emptyTitle="كل المصروفات تظهر هنا"
        emptyHint="اضغط «تسجيل مصروف» لتسجيل أول مصروف للمكتب (لابتوب/بوفية/أدوات...)"
        emptyAction={canManage ? <Button size="sm" onClick={openAdd}><Plus className="size-4" /> تسجيل مصروف</Button> : undefined}
        emptyIcon={ReceiptText}
        columns={[
          { key: 'ref', header: 'رقم', width: 'w-24', primary: true, render: (r: OpexRow) => <span className="font-mono font-bold text-xs">{r.ref}</span> },
          { key: 'date', header: 'التاريخ', width: 'w-28', hideInCard: true, render: (r: OpexRow) => <span className="text-xs tnum">{r.date ? fmtDate(r.date) : '-'}</span> },
          { key: 'category', header: 'التصنيف', width: 'w-36', render: (r: OpexRow) => <Badge variant="outline" className={cn('font-medium text-[11px]', categoryTone(r.category))}>{r.categoryLabel}</Badge> },
          { key: 'account', header: 'حساب المصروف', width: 'min-w-[140px]', render: (r: OpexRow) => (
            <div className="min-w-0">
              <div className="text-xs font-medium truncate">{r.account?.name ?? '-'}</div>
              {r.account && <div className="text-[10px] text-muted-foreground tnum">{r.account.code}</div>}
            </div>
          ) },
          { key: 'vendor', header: 'المورد/المتجر', width: 'min-w-[120px]', hideInCard: true, render: (r: OpexRow) => <span className="text-xs truncate">{r.vendor || '-'}</span> },
          { key: 'amount', header: 'المبلغ', width: 'w-28', align: 'left', render: (r: OpexRow) => <span className="font-bold tnum num-ltr text-foreground">{fmtNum(r.amount)}</span> },
          { key: 'payAccount', header: 'مدفوع من', width: 'w-28', hideInCard: true, render: (r: OpexRow) => <span className="text-xs text-muted-foreground">{r.payAccount?.name ?? '-'}</span> },
          { key: 'journalEntry', header: 'القيد', width: 'w-24', hideInCard: true, render: (r: OpexRow) => r.journalEntry ? <Badge variant="outline" className="text-[10px] font-mono">{r.journalEntry.entryNo}</Badge> : <span className="text-xs text-muted-foreground">-</span> },
          { key: 'actions', header: 'إجراءات', width: 'w-24', align: 'left', hideInCard: true, render: (r: OpexRow) => (
            <div className="flex gap-1 print:hidden">
              {canManage && <Button variant="ghost" size="sm" onClick={() => openEdit(r)} title="تعديل"><Pencil className="size-4" /></Button>}
              {canManage && <Button variant="ghost" size="sm" className="text-destructive" onClick={() => del(r)} title="حذف"><Trash2 className="size-4" /></Button>}
            </div>
          ) },
        ]}
      />

      {/* نافذة الإضافة/التعديل */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ReceiptText className="size-5 text-primary" /> {editing ? 'تعديل مصروف' : 'تسجيل مصروف عمومي/تشغيلي'}</DialogTitle>
            <DialogDescription>سجل مصروفات المكتب اليومية (لابتوب/أدوات/بوفية/مشتريات...). يُرحّل النظام قيدًا مزدوجًا تلقائيًا: مدين المصروف / دائن الصندوق أو البنك.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <div>
              <Label className="text-xs font-medium">التاريخ</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs font-medium">التصنيف</Label>
              <Select value={form.category} onValueChange={onCategoryChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="text-[10px] text-muted-foreground mt-1">يحدد الحساب الافتراضي (عمومية ← 5105، تشغيلية ← 5104)</div>
            </div>

            {/* اختيار سريع لنوع المصروف — يعبّي التصنيف والبيان تلقائيًا */}
            <div className="sm:col-span-2">
              <Label className="text-xs font-medium">نوع المصروف (اختيار سريع)</Label>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {EXPENSE_TYPES.map((t) => {
                  const active = form.notes === t.note || (t.note && (form.notes ?? '').startsWith(t.note))
                  return (
                    <button
                      key={t.label}
                      type="button"
                      onClick={() => {
                        const next: any = { ...form }
                        if (t.category) {
                          next.category = t.category
                          const code = CATEGORY_OPTIONS.find((o) => o.value === t.category)?.code
                          const acc = code ? expenseAccounts.find((a) => a.code === code) : null
                          if (acc) next.accountId = acc.id
                        }
                        next.notes = t.note || form.notes
                        setForm(next)
                      }}
                      className={cn(
                        'text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all',
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40',
                      )}
                    >
                      {t.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="sm:col-span-2">
              <Label className="text-xs font-medium">حساب المصروف (مدين) *</Label>
              <Select value={form.accountId || '__'} onValueChange={(val) => setForm({ ...form, accountId: val === '__' ? '' : val })}>
                <SelectTrigger><SelectValue placeholder="اختر حساب المصروف..." /></SelectTrigger>
                <SelectContent>
                  {expenseAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-medium">مدفوع من (دائن)</Label>
              <Select value={form.payAccountId || '__'} onValueChange={(val) => setForm({ ...form, payAccountId: val === '__' ? '' : val })}>
                <SelectTrigger><SelectValue placeholder="الصندوق/البنك..." /></SelectTrigger>
                <SelectContent>
                  {payAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="text-[10px] text-muted-foreground mt-1">الخزينة أو البنك اللي اتدفع منه المصروف</div>
            </div>
            <div>
              <Label className="text-xs font-medium">المبلغ (ج.م) *</Label>
              <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0" className="tnum" />
            </div>
            <div>
              <Label className="text-xs font-medium">المورد / المتجر</Label>
              <Input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="اسم المحل أو المورد (اختياري)" />
            </div>
            <div>
              <Label className="text-xs font-medium">الفرع</Label>
              <Select value={form.branchId || '__'} onValueChange={(val) => setForm({ ...form, branchId: val === '__' ? '' : val })}>
                <SelectTrigger><SelectValue placeholder="— بدون —" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__">— بدون —</SelectItem>
                  {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs font-medium">البيان / ملاحظات</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="مثال: شراء لابتوب للمكتب / طلبات بوفية / أدوات مكتبية..." />
            </div>
          </div>

          {/* معاينة القيد */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-primary"><Landmark className="size-3.5" /> معاينة القيد المزدوج</div>
            <div className="flex justify-between"><span className="text-muted-foreground">مدين — حساب المصروف:</span><span className="font-medium">{expenseAccounts.find((a) => a.id === form.accountId)?.name ?? '-'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">دائن — مدفوع من:</span><span className="font-medium">{payAccounts.find((a) => a.id === form.payAccountId)?.name ?? 'الصندوق'}</span></div>
            <div className="flex justify-between border-t border-primary/20 pt-1"><span className="text-muted-foreground">المبلغ:</span><span className="font-bold tnum num-ltr text-primary">{fmtNum(Number(form.amount) || 0)} ج.م</span></div>
          </div>

          {err && (
            <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
              <Info className="size-4 shrink-0" /> {err}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit} disabled={saving}>{saving ? 'جاري الحفظ...' : editing ? 'حفظ التعديلات' : 'تسجيل المصروف'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
