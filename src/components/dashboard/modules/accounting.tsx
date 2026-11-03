'use client'

import * as React from 'react'
import useSWR from 'swr'
import { Plus, Trash2, BookOpen, FileText, Landmark, ChevronRight, ChevronDown, Check, FileSpreadsheet, Printer, ReceiptText, TrendingDown, TrendingUp, CalendarDays } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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
import { Switch } from '@/components/ui/switch'
import { EntityFormDialog, type Field } from '../entity-dialog'
import { DataTable } from '../data-table'
import { fetcher, apiPost, apiDelete } from '@/lib/api'
import { exportToCSV } from '@/lib/export'
import { fmtNum, fmtDate, fmtDateTime, ACCOUNT_TYPE } from '@/lib/format'
import { useAuth } from '../auth-provider'
import { VoucherPrint } from '../voucher-print'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// === Chart of Accounts ===
export function AccountsModule() {
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
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
    await apiPost('/api/accounts', { ...vals, isDetail: vals.isDetail !== false, userName: 'admin' })
    toast({ title: 'تمت الإضافة' }); mutate()
  }

  const columns = [
    { key: 'code', header: 'الكود', align: 'center' as const, width: 'w-24', hideInCard: true, render: (a: any) => <span className="font-mono text-xs">{a.code}</span> },
    { key: 'name', header: 'اسم الحساب', primary: true, render: (a: any) => (
      <span style={{ paddingRight: `${a.depth * 16}px` }} className={cn('text-sm block truncate-1', a.isDetail ? 'font-medium' : 'font-bold text-primary')}>
        {a.name}
      </span>
    ) },
    { key: 'type', header: 'النوع', align: 'center' as const, width: 'w-32', render: (a: any) => {
      const t = ACCOUNT_TYPE[a.type] || { label: a.type, tone: '' }
      return <Badge variant="outline" className={t.tone}>{t.label}</Badge>
    } },
    { key: 'debit', header: 'مدين', align: 'left' as const, width: 'w-28', render: (a: any) => <span className="tnum">{fmtNum(a.debit)}</span> },
    { key: 'credit', header: 'دائن', align: 'left' as const, width: 'w-28', render: (a: any) => <span className="tnum">{fmtNum(a.credit)}</span> },
    { key: 'balance', header: 'الرصيد', align: 'left' as const, width: 'w-28', render: (a: any) => <span className="tnum font-bold">{fmtNum(a.balance)}</span> },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="size-5 text-muted-foreground shrink-0" />
          <span className="text-sm text-muted-foreground tnum">{data?.items.length ?? 0} حساب</span>
        </div>
        <Button onClick={() => setOpen(true)} size="sm" className="shrink-0"><Plus className="size-4" /> <span className="hidden sm:inline">حساب جديد</span><span className="sm:hidden">جديد</span></Button>
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">شجرة الحسابات</CardTitle><CardDescription>مع أرصدة من القيود المرحّلة</CardDescription></CardHeader>
        <CardContent className="p-0">
          <DataTable rows={tree} columns={columns} loading={isLoading} getRowKey={(a: any) => a.id} minW={800} searchFn={(a, q) => (a.name || '').toLowerCase().includes(q) || (a.code || '').toLowerCase().includes(q)} searchPlaceholder="بحث بالاسم أو الكود..." />
        </CardContent>
      </Card>
      <EntityFormDialog open={open} onOpenChange={setOpen} title="إضافة حساب" fields={fields} initial={{}} onSubmit={submit} />
    </div>
  )
}

// === Journal Entries ===
export function JournalModule() {
  const { toast } = useToast()
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
        userName: 'admin',
      })
      toast({ title: 'تم إنشاء القيد' }); setOpen(false); mutate()
    } catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }

  const post = async (id: string) => {
    try {
      await apiPost(`/api/journal/${id}/post`, { userName: 'admin' })
      toast({ title: 'تم ترحيل القيد' }); mutate()
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  const del = async (id: string) => {
    if (!confirm('حذف القيد؟ (لا يمكن حذف قيد مرحّل)')) return
    try { await apiDelete(`/api/journal/${id}`); mutate(); toast({ title: 'تم الحذف' }) }
    catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  const columns = [
    { key: 'no', header: 'رقم القيد', primary: true, align: 'center' as const, width: 'w-24', render: (e: any) => <span className="font-mono text-xs font-bold">{e.entryNo}</span> },
    { key: 'date', header: 'التاريخ', hideInCard: true, align: 'center' as const, width: 'w-32', render: (e: any) => <span className="text-xs tnum">{fmtDate(e.date)}</span> },
    { key: 'desc', header: 'البيان', hideInCard: true, render: (e: any) => <div><div className="text-sm font-medium truncate-1">{e.description || '-'}</div>{e.reference && <div className="text-[10px] text-muted-foreground">مرجع: {e.reference}</div>}</div> },
    { key: 'branch', header: 'الفرع', hideInCard: true, width: 'w-32', render: (e: any) => <span className="text-xs">{e.branch?.name || '-'}</span> },
    { key: 'lines', header: 'السطور', hideInCard: true, align: 'center' as const, width: 'w-20', render: (e: any) => <Badge variant="outline" className="tnum">{e.lines?.length ?? 0}</Badge> },
    { key: 'debit', header: 'مدين', align: 'left' as const, width: 'w-28', render: (e: any) => <span className="tnum font-bold">{fmtNum(e.totalDebit)}</span> },
    { key: 'credit', header: 'دائن', align: 'left' as const, width: 'w-28', render: (e: any) => <span className="tnum font-bold">{fmtNum(e.totalCredit)}</span> },
    { key: 'status', header: 'الحالة', align: 'center' as const, width: 'w-24', render: (e: any) => <Badge variant="outline" className={e.status === 'posted' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}>{e.status === 'posted' ? 'مرحّل' : 'مسودة'}</Badge> },
    { key: 'actions', header: 'إجراءات', align: 'center' as const, width: 'w-24', hideInCard: false, render: (e: any) => (
      <div className="flex gap-1 justify-center">
        {e.status === 'draft' && <Button variant="ghost" size="sm" onClick={() => post(e.id)} title="ترحيل"><Check className="size-3.5 text-emerald-600" /></Button>}
        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => del(e.id)}><Trash2 className="size-3.5" /></Button>
      </div>
    ) },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileText className="size-5 text-muted-foreground shrink-0" />
          <span className="text-sm text-muted-foreground tnum shrink-0">{data?.items.length ?? 0} قيد</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32 sm:w-36 h-8 min-w-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل القيود</SelectItem>
              <SelectItem value="draft">مسودات فقط</SelectItem>
              <SelectItem value="posted">مرحّلة فقط</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => setOpen(true)} size="sm" className="shrink-0"><Plus className="size-4" /> <span className="hidden sm:inline">قيد جديد</span><span className="sm:hidden">جديد</span></Button>
      </div>

      <DataTable rows={data?.items ?? []} columns={columns} loading={isLoading} getRowKey={(e: any) => e.id} minW={1100} searchFn={(e, q) => (e.entryNo || '').toLowerCase().includes(q) || (e.description || '').toLowerCase().includes(q)} searchPlaceholder="بحث برقم القيد أو البيان..." />

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
            <table className="w-full text-sm">
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
                    <td className="p-1 text-center">{lines.length > 2 && <button onClick={() => removeLine(i)} className="text-destructive"><Trash2 className="size-3.5" /></button>}</td>
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

// === Vouchers ===
export function VouchersModule() {
  const { toast } = useToast()
  const { has, user: me } = useAuth()
  const [open, setOpen] = React.useState(false)
  const [typeFilter, setTypeFilter] = React.useState<string>('all')
  // نجلب كل الأذونات لحساب العدّادات — والفلترة تتم محليًا
  const { data, isLoading, mutate } = useSWR<{ items: any[] }>('/api/vouchers', fetcher, { refreshInterval: 30000 })
  const { data: parties } = useSWR<{ items: any[] }>('/api/parties', fetcher)
  // recent shipments for optional voucher-shipment link
  const { data: shipmentsRes } = useSWR<{ items: any[] }>('/api/shipments?pageSize=200', fetcher)
  const shipmentsList = shipmentsRes?.items ?? []

  const allVouchers = React.useMemo(() => data?.items ?? [], [data])
  const items = React.useMemo(
    () => (typeFilter !== 'all' ? allVouchers.filter((v: any) => v.type === typeFilter) : allVouchers),
    [allVouchers, typeFilter],
  )

  // ==== عدّادات الأذونات ====
  const stats = React.useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const receipts = allVouchers.filter((v: any) => v.type === 'receipt')
    const payments = allVouchers.filter((v: any) => v.type === 'payment')
    const monthItems = allVouchers.filter((v: any) => v.date && new Date(v.date).toISOString() >= monthStart)
    return {
      total: allVouchers.length,
      receiptCount: receipts.length,
      receiptSum: receipts.reduce((s: number, v: any) => s + (Number(v.amount) || 0), 0),
      paymentCount: payments.length,
      paymentSum: payments.reduce((s: number, v: any) => s + (Number(v.amount) || 0), 0),
      monthCount: monthItems.length,
    }
  }, [allVouchers])

  const [printVoucher, setPrintVoucher] = React.useState<any>(null)

  const [v, setV] = React.useState<any>({ type: 'receipt', partyId: '', shipmentId: '', amount: 1, description: '', date: new Date().toISOString().slice(0, 10), accountName: 'الصندوق' })
  React.useEffect(() => { if (open) setV({ type: 'receipt', partyId: '', shipmentId: '', amount: 1, description: '', date: new Date().toISOString().slice(0, 10), accountName: 'الصندوق' }) }, [open])
  const [err, setErr] = React.useState(''); const [loading, setLoading] = React.useState(false)

  const submit = async () => {
    setLoading(true); setErr('')
    try {
      const res: any = await apiPost('/api/vouchers', { ...v, amount: Number(v.amount), shipmentId: v.shipmentId || null, userName: me?.username || 'admin' })
      toast({ title: 'تم إنشاء السند', description: `رقم الإذن: ${res?.voucherNo ?? '—'} — قُيد قيد محاسبي تلقائي` })
      setOpen(false); mutate()
    } catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }
  const del = async (id: string) => {
    if (!confirm('حذف السند؟')) return
    try { await apiDelete(`/api/vouchers/${id}`); mutate(); toast({ title: 'تم الحذف' }) }
    catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  const exportVouchers = () => {
    if (!items?.length) { toast({ title: 'لا توجد بيانات للتصدير' }); return }
    const rows = items.map((v: any) => ({
      'رقم السند': v.voucherNo, 'النوع': v.type === 'receipt' ? 'قبض' : 'صرف',
      'التاريخ': v.date ? fmtDate(v.date) : '', 'الطرف': v.party?.name ?? '',
      'الشحنة المرتبطة': v.shipment?.shipmentNo ?? '',
      'المبلغ': v.amount, 'الحساب': v.accountName, 'البيان': v.description ?? '',
    }))
    exportToCSV(rows, `vouchers-${new Date().toISOString().slice(0, 10)}.csv`)
    toast({ title: `تم تصدير ${rows.length} سند` })
  }

  const columns = [
    { key: 'no', header: 'رقم السند', primary: true, align: 'center' as const, width: 'w-24', render: (v: any) => <span className="font-mono text-xs font-bold">{v.voucherNo}</span> },
    { key: 'type', header: 'النوع', align: 'center' as const, width: 'w-24', render: (v: any) => <Badge variant="outline" className={v.type === 'receipt' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'}>{v.type === 'receipt' ? 'قبض' : 'صرف'}</Badge> },
    { key: 'date', header: 'التاريخ', hideInCard: true, align: 'center' as const, width: 'w-28', render: (v: any) => <span className="text-xs tnum">{fmtDate(v.date)}</span> },
    { key: 'party', header: 'الطرف', hideInCard: true, width: 'w-36', render: (v: any) => <span className="text-sm font-medium truncate-1 block">{v.party?.name || '-'}</span> },
    { key: 'shipment', header: 'الشحنة', align: 'center' as const, width: 'w-28', render: (v: any) => v.shipment?.shipmentNo ? <span className="font-mono text-xs font-bold text-primary">{v.shipment.shipmentNo}</span> : <span className="text-xs text-muted-foreground">—</span> },
    { key: 'amount', header: 'المبلغ', align: 'left' as const, width: 'w-28', render: (v: any) => <span className="tnum font-bold">{fmtNum(v.amount)} ج.م</span> },
    { key: 'desc', header: 'البيان', hideInCard: true, render: (v: any) => <span className="text-xs text-muted-foreground truncate-1 block">{v.description || '-'}</span> },
    {
      key: 'actions', header: 'إجراءات', align: 'center' as const, width: 'w-24',
      render: (v: any) => (
        <div className="flex items-center justify-center gap-0.5">
          <Button variant="ghost" size="sm" onClick={() => setPrintVoucher(v)} title="طباعة السند" aria-label={`طباعة السند ${v.voucherNo}`}>
            <Printer className="size-3.5" />
          </Button>
          {has('accounting.vouchers.delete') && (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => del(v.id)} title="حذف السند" aria-label={`حذف السند ${v.voucherNo}`}>
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      ),
    },
  ]

  const pendingSettle = shipmentsList.filter((s: any) => s.collectionStatus !== 'collected' && s.customerId && s.contractorId && (s.freightTotal ?? 0) > 0)

  return (
    <div className="space-y-4">
      {/* ==== عدّادات الأذونات ==== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Card className="py-0 gap-0">
          <CardContent className="p-3.5 flex items-center gap-2.5">
            <div className="flex items-center justify-center size-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0"><ReceiptText className="size-4.5" /></div>
            <div className="min-w-0">
              <div className="text-xl font-extrabold tnum leading-none">{fmtNum(stats.total)}</div>
              <div className="text-[11px] text-muted-foreground mt-1">إجمالي الأذونات</div>
            </div>
          </CardContent>
        </Card>
        <Card className="py-0 gap-0">
          <CardContent className="p-3.5 flex items-center gap-2.5">
            <div className="flex items-center justify-center size-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 shrink-0"><TrendingUp className="size-4.5" /></div>
            <div className="min-w-0">
              <div className="text-xl font-extrabold tnum leading-none text-emerald-700 dark:text-emerald-300">{fmtNum(stats.receiptCount)}</div>
              <div className="text-[11px] text-muted-foreground mt-1 truncate">قبض — {fmtNum(stats.receiptSum)} ج.م</div>
            </div>
          </CardContent>
        </Card>
        <Card className="py-0 gap-0">
          <CardContent className="p-3.5 flex items-center gap-2.5">
            <div className="flex items-center justify-center size-9 rounded-lg bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 shrink-0"><TrendingDown className="size-4.5" /></div>
            <div className="min-w-0">
              <div className="text-xl font-extrabold tnum leading-none text-rose-700 dark:text-rose-300">{fmtNum(stats.paymentCount)}</div>
              <div className="text-[11px] text-muted-foreground mt-1 truncate">صرف — {fmtNum(stats.paymentSum)} ج.م</div>
            </div>
          </CardContent>
        </Card>
        <Card className="py-0 gap-0">
          <CardContent className="p-3.5 flex items-center gap-2.5">
            <div className="flex items-center justify-center size-9 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 shrink-0"><CalendarDays className="size-4.5" /></div>
            <div className="min-w-0">
              <div className="text-xl font-extrabold tnum leading-none">{fmtNum(stats.monthCount)}</div>
              <div className="text-[11px] text-muted-foreground mt-1">أذونات هذا الشهر</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Landmark className="size-5 text-muted-foreground shrink-0" />
          <span className="text-sm text-muted-foreground tnum shrink-0">{items.length} سند معروض</span>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-28 sm:w-32 h-8 min-w-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="receipt">قبض</SelectItem>
              <SelectItem value="payment">صرف</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportVouchers} disabled={!items?.length} className="shrink-0">
            <FileSpreadsheet className="size-4" /> <span className="hidden sm:inline">تصدير</span>
          </Button>
          {has('accounting.vouchers.create') && (
            <Button onClick={() => setOpen(true)} size="sm" className="shrink-0"><Plus className="size-4" /> <span className="hidden sm:inline">سند جديد</span><span className="sm:hidden">جديد</span></Button>
          )}
        </div>
      </div>
      <DataTable rows={items} columns={columns} loading={isLoading} getRowKey={(v: any) => v.id} minW={950} searchFn={(v: any, q: string) => (v.voucherNo || '').toLowerCase().includes(q) || (v.party?.name || '').toLowerCase().includes(q) || (v.shipment?.shipmentNo || '').toLowerCase().includes(q)} searchPlaceholder="بحث برقم السند/الطرف/الشحنة..." />

      {/* Quick COD settlement panel — show shipments ready to settle */}
      {has('shipments.settle') && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Landmark className="size-4" /> تسوية سريعة للشحنات (COD)</CardTitle>
            <CardDescription>شحنات لم تُسوَّ بعد ولها عميل ومقاول — يصدر النظام سند قبض من العميل وسند صرف للمقاول دفعة واحدة.</CardDescription>
          </CardHeader>
          <CardContent className="p-3">
            <div className="space-y-2 max-h-72 overflow-y-auto no-scrollbar">
              {pendingSettle.slice(0, 20).map((s: any) => {
                const margin = (s.freightTotal ?? 0) - (s.totalSuppliers ?? 0)
                return (
                  <div key={s.id} className="flex items-center justify-between gap-2 p-2 rounded-lg border border-border hover:bg-muted/30 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-xs font-bold shrink-0">{s.shipmentNo}</span>
                      <span className="text-xs text-muted-foreground truncate-1">{s.customer?.name || s.recipientName}</span>
                      <span className="text-xs text-muted-foreground truncate-1 hidden sm:inline">→ {s.contractor?.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="tnum text-xs text-muted-foreground">هامش: <b className={margin >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{fmtNum(margin)}</b></span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            const res = await apiPost(`/api/shipments/${s.id}/settle-cod`, {
                              customerAmount: s.freightTotal ?? 0,
                              contractorAmount: s.totalSuppliers ?? 0,
                              userName: me?.username || 'admin',
                            })
                            toast({ title: 'تمت تسوية COD', description: `قبض ${res.receiptVoucherNo ?? '—'} • صرف ${res.paymentVoucherNo ?? '—'}` })
                            mutate()
                          } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
                        }}
                      >
                        تسوية
                      </Button>
                    </div>
                  </div>
                )
              })}
              {pendingSettle.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">لا توجد شحنات معلقة للتسوية.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>سند قبض/صرف</DialogTitle><DialogDescription>يسجل في الصندوق أو البنك ويرتبط بالطرف — ويمكن ربطه اختياريًا بشحنة محددة.</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2">
              <label className="text-xs font-medium">نوع السند *</label>
              <Select value={v.type} onValueChange={(val) => setV({ ...v, type: val })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="receipt">سند قبض (تحصيل)</SelectItem>
                  <SelectItem value="payment">سند صرف (سداد)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium">الطرف *</label>
              <Select value={v.partyId} onValueChange={(val) => setV({ ...v, partyId: val })}>
                <SelectTrigger><SelectValue placeholder="اختر الطرف..." /></SelectTrigger>
                <SelectContent>{(parties?.items ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium">شحنة مرتبطة (اختياري)</label>
              <Select value={v.shipmentId} onValueChange={(val) => setV({ ...v, shipmentId: val === '__' ? '' : val })}>
                <SelectTrigger><SelectValue placeholder="— بدون شحنة —" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__">— بدون شحنة —</SelectItem>
                  {shipmentsList.map((s) => <SelectItem key={s.id} value={s.id}>{s.shipmentNo} — {s.customer?.name || s.recipientName || '-'} — {s.destination ?? '-'}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-0.5">يربط السند بالشحنة المحددة — يظهر في تفاصيل الشحنة وتقارير التسويات.</p>
            </div>
            <div><label className="text-xs font-medium">المبلغ *</label><Input type="number" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></div>
            <div><label className="text-xs font-medium">التاريخ</label><Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></div>
            <div><label className="text-xs font-medium">الحساب (صندوق/بنك)</label><Input value={v.accountName} onChange={(e) => setV({ ...v, accountName: e.target.value })} /></div>
            <div className="col-span-2"><label className="text-xs font-medium">البيان</label><Textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} rows={2} /></div>
          </div>
          {err && <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit} disabled={loading || !v.partyId}>{loading ? 'جاري...' : 'حفظ السند'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* طباعة السند */}
      <VoucherPrint voucher={printVoucher} open={!!printVoucher} onOpenChange={(o) => !o && setPrintVoucher(null)} />
    </div>
  )
}
