'use client'

// ============================================================================
// وحدة البنود الإضافية على حساب المقاولين — تعتيق / مبيت / مرتجعات
// قاعدة العمل: المبيت والمرتجعات لا تدخل مستحقات المقاول إلا بعد اعتماد
// الشركة (دورة PENDING → APPROVED/REJECTED + قيد مزدوج عند الاعتماد
// وقيد عكسي عند رفض معتمد سابقًا) — التعتيق يُعتمد تلقائيًا.
// صلاحيات: parties.extras.view / manage / approve
// ============================================================================

import * as React from 'react'
import useSWR from 'swr'
import {
  Plus, Pencil, Trash2, CheckCircle2, XCircle, Search, RefreshCw,
  FileSpreadsheet, Info, Hourglass, BadgeCheck, Layers,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Kpi } from '../ui-cards'
import { DataTable } from '../data-table'
import { fetcher, apiPost, apiPatch, apiDelete } from '@/lib/api'
import { exportToCSV } from '@/lib/export'
import { fmtNum, fmtDate } from '@/lib/format'
import { EXTRA_COST_TYPES, EXTRA_COST_STATUSES, extraCostTypeLabel, extraCostTypeDef, extraCostStatusDef } from '@/lib/extra-cost-catalog'
import { cn } from '@/lib/utils'
import { useAuth } from '../auth-provider'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useToast } from '@/hooks/use-toast'

interface ExtraCostItem {
  id: string
  ref: string
  type: string
  amount: number | null
  notes: string | null
  approvalStatus: string
  contractorId: string
  contractor: { id: string; name: string; code: string | null } | null
  shipmentId: string | null
  shipment: { id: string; shipmentNo: string | null; deliveryNumber: string | null; destination: string | null; date: string | null } | null
  date: string
  userName: string | null
  approvalUserName: string | null
  approvalAt: string | null
  approvalNotes: string | null
  journalEntry: { id: string; entryNo: string; status: string } | null
}

interface ExtrasResponse {
  items: ExtraCostItem[]
  total: number
  summary: {
    total: number
    pending: { count: number; amount: number }
    approved: { count: number; amount: number }
    rejected: { count: number }
    byType: { type: string; pending: number; approved: number; approvedAmount: number }[]
  }
}

function TypeBadge({ type }: { type: string }) {
  const def = extraCostTypeDef(type)
  return <span className={cn('inline-block text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap', def?.tone ?? 'bg-slate-100 text-slate-700')}>{def?.label ?? type}</span>
}

function StatusBadge({ status }: { status: string }) {
  const def = extraCostStatusDef(status as any)
  return <span className={cn('inline-block text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap', def?.tone ?? 'bg-slate-100 text-slate-700')}>{def?.label ?? status}</span>
}

export function ExtraCostsModule() {
  const { has } = useAuth()
  const { toast } = useToast()
  const { confirm: confirmDialog } = useConfirm()
  const canManage = has('parties.extras.manage')
  const canApprove = has('parties.extras.approve')
  const canPrices = has('prices.view')

  const [contractorId, setContractorId] = React.useState('all')
  const [type, setType] = React.useState('all')
  const [status, setStatus] = React.useState('all')
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [busy, setBusy] = React.useState(false)

  // نافذة الإنشاء/التعديل
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<ExtraCostItem | null>(null)
  const [fContractor, setFContractor] = React.useState('')
  const [fType, setFType] = React.useState('taateeq')
  const [fAmount, setFAmount] = React.useState('')
  const [fDate, setFDate] = React.useState(() => new Date().toISOString().slice(0, 10))
  const [fShipment, setFShipment] = React.useState('none')
  const [fNotes, setFNotes] = React.useState('')
  const [formError, setFormError] = React.useState('')

  // نافذة رفض بسبب
  const [rejectTarget, setRejectTarget] = React.useState<ExtraCostItem | null>(null)
  const [rejectNotes, setRejectNotes] = React.useState('')

  const qs = new URLSearchParams()
  if (contractorId !== 'all') qs.set('contractorId', contractorId)
  if (type !== 'all') qs.set('type', type)
  if (status !== 'all') qs.set('approvalStatus', status)
  if (search.trim()) qs.set('q', search.trim())
  qs.set('page', String(page))
  qs.set('pageSize', '10')

  const { data, isLoading, mutate } = useSWR<ExtrasResponse>(`/api/extras?${qs.toString()}`, fetcher, {
    keepPreviousData: true,
    refreshInterval: 45000,
  })

  const { data: contractorsData } = useSWR<{ items: { id: string; name: string; code: string | null }[] }>('/api/parties?type=contractor', fetcher)
  const contractors = contractorsData?.items ?? []

  // شحنات المقاول المختار (لربط البند بنقلة محددة برقم ديليفري)
  const { data: shipmentsData } = useSWR<{ items: { id: string; shipmentNo: string | null; deliveryNumber: string | null; destination: string | null; date: string | null }[] }>(
    formOpen && fContractor ? `/api/shipments?contractor=${fContractor}&pageSize=200` : null,
    fetcher,
  )
  const shipmentOptions = shipmentsData?.items ?? []

  const items = data?.items ?? []
  const summary = data?.summary

  React.useEffect(() => { setPage(1) }, [contractorId, type, status, search])

  const openCreate = () => {
    setEditing(null)
    setFContractor(contractorId !== 'all' ? contractorId : '')
    setFType('taateeq')
    setFAmount('')
    setFDate(new Date().toISOString().slice(0, 10))
    setFShipment('none')
    setFNotes('')
    setFormError('')
    setFormOpen(true)
  }

  const openEdit = (ec: ExtraCostItem) => {
    setEditing(ec)
    setFContractor(ec.contractorId)
    setFType(ec.type)
    setFAmount(ec.amount != null ? String(ec.amount) : '')
    setFDate(String(ec.date).slice(0, 10))
    setFShipment(ec.shipmentId ?? 'none')
    setFNotes(ec.notes ?? '')
    setFormError('')
    setFormOpen(true)
  }

  const submitForm = async () => {
    setFormError('')
    if (!fContractor) { setFormError('حدد المقاول'); return }
    const amount = Number(fAmount)
    if (!Number.isFinite(amount) || amount <= 0) { setFormError('أدخل مبلغًا صحيحًا أكبر من صفر'); return }
    setBusy(true)
    try {
      const body = {
        contractorId: fContractor,
        type: fType,
        amount,
        date: fDate || undefined,
        shipmentId: fShipment !== 'none' ? fShipment : null,
        notes: fNotes.trim() || null,
      }
      if (editing) {
        await apiPatch(`/api/extras/${editing.id}`, body)
        toast({ title: 'تم تعديل البند', description: `${editing.ref} — ${extraCostTypeLabel(fType)}` })
      } else {
        const res: any = await apiPost('/api/extras', body)
        toast({
          title: 'تم تسجيل البند',
          description: res?.approvalStatus === 'approved'
            ? `${res.ref} — تعتيق معتمد تلقائيًا ورُحّل بقيد ${res.journalEntryNo ?? ''}`
            : `${res.ref} — بانتظار اعتماد الشركة`,
        })
      }
      setFormOpen(false)
      mutate()
    } catch (e: any) {
      setFormError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const approve = async (ec: ExtraCostItem) => {
    const ok = await confirmDialog({
      title: 'اعتماد البند وموافقة الشركة',
      message: `اعتماد ${extraCostTypeLabel(ec.type)} بمبلغ ${fmtNum(ec.amount ?? 0)} ج.م للمقاول «${ec.contractor?.name}»؟ سيُرحّل القيد المحاسبي ويُضاف لمستحقات المقاول فورًا.`,
      variant: 'primary',
      confirmText: 'اعتماد',
    })
    if (!ok) return
    setBusy(true)
    try {
      const res: any = await apiPost(`/api/extras/${ec.id}/approve`, {})
      toast({ title: 'تم الاعتماد', description: `${res.ref} — قيد ${res.journalEntryNo ?? ''}` })
      mutate()
    } catch (e: any) {
      toast({ title: 'تعذر الاعتماد', description: e.message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const submitReject = async () => {
    if (!rejectTarget) return
    setBusy(true)
    try {
      const res: any = await apiPost(`/api/extras/${rejectTarget.id}/reject`, { notes: rejectNotes.trim() || null })
      toast({
        title: 'تم رفض البند',
        description: res?.reversalEntryNo ? `${res.ref} — عُكس القيد بالقيد ${res.reversalEntryNo} وخرج من المستحقات` : `${res.ref} — لن يُحسب في المستحقات`,
      })
      setRejectTarget(null)
      setRejectNotes('')
      mutate()
    } catch (e: any) {
      toast({ title: 'تعذر الرفض', description: e.message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (ec: ExtraCostItem) => {
    const ok = await confirmDialog({
      title: 'حذف البند الإضافي',
      message: `حذف البند ${ec.ref} (${extraCostTypeLabel(ec.type)} — ${fmtNum(ec.amount ?? 0)} ج.م)؟`,
      variant: 'destructive',
      confirmText: 'حذف',
    })
    if (!ok) return
    setBusy(true)
    try {
      await apiDelete(`/api/extras/${ec.id}`)
      toast({ title: 'تم حذف البند', description: ec.ref })
      mutate()
    } catch (e: any) {
      toast({ title: 'تعذر الحذف', description: e.message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const exportCSV = () => {
    if (!items.length) return
    const rows = items.map((x) => ({
      'المرجع': x.ref,
      'التاريخ': String(x.date).slice(0, 10),
      'المقاول': x.contractor?.name ?? '',
      'النوع': extraCostTypeLabel(x.type),
      'المبلغ': x.amount ?? 0,
      'الشحنة': x.shipment?.deliveryNumber ?? x.shipment?.shipmentNo ?? '',
      'الوجهة': x.shipment?.destination ?? '',
      'الحالة': extraCostStatusDef(x.approvalStatus as any)?.label ?? x.approvalStatus,
      'اعتمده': x.approvalUserName ?? '',
      'ملاحظات': x.notes ?? '',
    }))
    exportToCSV(rows, `extra-costs-${new Date().toISOString().slice(0, 10)}.csv`)
    toast({ title: `تم تصدير ${rows.length} سجل` })
  }

  return (
    <div className="space-y-4">
      {/* ── مؤشرات سريعة ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Kpi title="بانتظار اعتماد الشركة" value={fmtNum(summary?.pending.count ?? 0)} unit="بند" icon={Hourglass} tone="purple" subtitle={canPrices ? `${fmtNum(summary?.pending.amount ?? 0)} ج.م غير محسوبة للمقاولين بعد` : 'غير محسوبة في المستحقات'} />
        <Kpi title="معتمد (داخل المستحقات)" value={fmtNum(summary?.approved.count ?? 0)} unit="بند" icon={BadgeCheck} tone="green" subtitle={canPrices ? `${fmtNum(summary?.approved.amount ?? 0)} ج.م رُحّلت محاسبيًا` : 'رُحّلت محاسبيًا'} />
        <Kpi title="مرفوض" value={fmtNum(summary?.rejected.count ?? 0)} unit="بند" icon={XCircle} tone="teal" subtitle="لن تُحسب في مستحقات المقاولين" />
        <Kpi title="إجمالي البنود" value={fmtNum(summary?.total ?? 0)} unit="بند" icon={Layers} tone="primary" subtitle="تعتيق / مبيت / مرتجعات" />
      </div>

      {/* ── شريط الأدوات ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap print:hidden">
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={contractorId} onValueChange={setContractorId}>
            <SelectTrigger className="h-9 w-40 text-xs" aria-label="فلترة المقاول"><SelectValue placeholder="كل المقاولين" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل المقاولين</SelectItem>
              {contractors.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-9 w-36 text-xs" aria-label="فلترة النوع"><SelectValue placeholder="كل الأنواع" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأنواع</SelectItem>
              {EXTRA_COST_TYPES.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-40 text-xs" aria-label="فلترة الحالة"><SelectValue placeholder="كل الحالات" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              {EXTRA_COST_STATUSES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالمرجع/المقاول/الديليفري..." className="pr-8 h-9 w-44 sm:w-56 text-xs bg-card" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => mutate()} className="h-9"><RefreshCw className="size-4" /></Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!items.length} className="h-9">
            <FileSpreadsheet className="size-4" /> <span className="hidden sm:inline">تصدير</span>
          </Button>
          {canManage && (
            <Button size="sm" onClick={openCreate} className="h-9">
              <Plus className="size-4" /> <span className="hidden sm:inline">بند إضافي</span>
            </Button>
          )}
        </div>
      </div>

      {/* ── تنبيه قاعدة الاعتماد ── */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2.5 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200 print:hidden">
        <Info className="size-4 shrink-0 mt-0.5" />
        <span>
          <b>قاعدة الاعتماد:</b> المبيت والمرتجعات لا تُضاف لمستحقات المقاول إلا بعد موافقة الشركة — وعند الاعتماد يُرحّل قيد محاسبي (مدين تكلفة النقل / دائن مستحقات المقاول) ويرتبط بالبند والشحنة والخزينة.
          رفض بند معتمد سابقًا يعكس القيد تلقائيًا. التعتيق بند قياسي يُعتمد تلقائيًا عند التسجيل.
        </span>
      </div>

      {/* ── جدول البنود ── */}
      <DataTable
        rows={items}
        loading={isLoading && !data}
        emptyText="لا توجد بنود إضافية مطابقة للفلترة"
        getRowKey={(x) => x.id}
        minW={1050}
        resetKey={`${contractorId}|${type}|${status}|${search}|${page}`}
        columns={[
          {
            key: 'ref', header: 'المرجع', primary: true, width: 'w-24',
            render: (x: ExtraCostItem) => (
              <div>
                <div className="font-mono text-xs font-bold">{x.ref}</div>
                <div className="text-[10px] text-muted-foreground tnum">{fmtDate(x.date)}</div>
              </div>
            ),
          },
          { key: 'contractor', header: 'المقاول', width: 'w-36', render: (x: ExtraCostItem) => <span className="text-xs font-medium truncate-1 block" dir="auto">{x.contractor?.name ?? '—'}</span> },
          { key: 'type', header: 'النوع', align: 'center' as const, width: 'w-32', render: (x: ExtraCostItem) => <TypeBadge type={x.type} /> },
          {
            key: 'amount', header: 'المبلغ', align: 'center' as const, width: 'w-28',
            render: (x: ExtraCostItem) => canPrices ? <span className="text-xs font-bold tnum num-ltr">{fmtNum(x.amount ?? 0, 2)} ج.م</span> : <span className="text-xs text-muted-foreground">—</span>,
          },
          {
            key: 'shipment', header: 'الشحنة (الديليفري)', hideInCard: true, width: 'w-40',
            render: (x: ExtraCostItem) => x.shipment
              ? <div><div className="font-mono text-xs">{x.shipment.deliveryNumber ?? x.shipment.shipmentNo ?? '—'}</div><div className="text-[10px] text-muted-foreground truncate-1">{x.shipment.destination ?? ''}</div></div>
              : <span className="text-xs text-muted-foreground">—</span>,
          },
          { key: 'status', header: 'الحالة', align: 'center' as const, width: 'w-36', render: (x: ExtraCostItem) => <StatusBadge status={x.approvalStatus} /> },
          {
            key: 'approval', header: 'الاعتماد', hideInCard: true, width: 'w-36',
            render: (x: ExtraCostItem) => x.approvalUserName
              ? <div><div className="text-[11px] truncate-1">{x.approvalUserName}</div>{x.approvalAt && <div className="text-[10px] text-muted-foreground tnum">{fmtDate(x.approvalAt)}</div>}</div>
              : <span className="text-xs text-muted-foreground">—</span>,
          },
          {
            key: 'journal', header: 'القيد', hideInCard: true, align: 'center' as const, width: 'w-24',
            render: (x: ExtraCostItem) => x.journalEntry
              ? <span className="font-mono text-[11px] tnum">{x.journalEntry.entryNo}</span>
              : <span className="text-xs text-muted-foreground">—</span>,
          },
          {
            key: 'actions', header: 'إجراءات', align: 'center' as const, width: 'w-52',
            render: (x: ExtraCostItem) => {
              const isPending = x.approvalStatus === 'pending'
              const isApproved = x.approvalStatus === 'approved'
              return (
                <div className="flex items-center justify-center gap-1.5">
                  {isPending && canApprove && (
                    <Button size="sm" variant="default" onClick={() => approve(x)} disabled={busy} className="h-8 px-2 text-xs bg-emerald-600 hover:bg-emerald-700">
                      <CheckCircle2 className="size-3.5" /> اعتماد
                    </Button>
                  )}
                  {(isPending || isApproved) && canApprove && (
                    <Button size="sm" variant="outline" onClick={() => { setRejectTarget(x); setRejectNotes('') }} disabled={busy} className="h-8 px-2 text-xs text-rose-600 hover:text-rose-700 border-rose-200 hover:border-rose-300">
                      <XCircle className="size-3.5" /> رفض
                    </Button>
                  )}
                  {isPending && canManage && (
                    <Button size="sm" variant="outline" onClick={() => openEdit(x)} disabled={busy} className="h-8 w-8 p-0" aria-label="تعديل">
                      <Pencil className="size-3.5" />
                    </Button>
                  )}
                  {!isApproved && canManage && (
                    <Button size="sm" variant="outline" onClick={() => remove(x)} disabled={busy} className="h-8 w-8 p-0 text-rose-600 hover:text-rose-700" aria-label="حذف">
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                  {isApproved && !canApprove && !canManage && <span className="text-[11px] text-muted-foreground">معتمد</span>}
                </div>
              )
            },
          },
        ]}
      />

      {/* ── نافذة تسجيل/تعديل بند ── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="w-[95vw] sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `تعديل البند ${editing.ref}` : 'تسجيل بند إضافي على حساب مقاول'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'التعديل متاح للبنود «بانتظار الاعتماد» فقط — المعتمد مُرحّل محاسبيًا ولا يُعدل.'
                : 'اختر المقاول والنوع والمبلغ — ويمكن ربط البند بشحنة محددة برقم الديليفري.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <Label className="text-xs">المقاول *</Label>
              <Select value={fContractor} onValueChange={(v) => { setFContractor(v); setFShipment('none') }} disabled={!!editing}>
                <SelectTrigger className="w-full" aria-label="المقاول"><SelectValue placeholder="اختر المقاول..." /></SelectTrigger>
                <SelectContent>
                  {contractors.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.code ? ` — ${c.code}` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">نوع البند *</Label>
              <div className="grid grid-cols-3 gap-2">
                {EXTRA_COST_TYPES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setFType(t.key)}
                    className={cn(
                      'rounded-lg border p-2.5 text-center transition-all',
                      fType === t.key ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-border hover:border-primary/40',
                    )}
                  >
                    <div className={cn('inline-block text-[10px] px-1.5 py-0.5 rounded-full', t.tone)}>{t.label}</div>
                    <div className="text-[9px] text-muted-foreground mt-1.5 leading-tight">{t.autoApprove ? 'اعتماد تلقائي' : 'بحاجة لموافقة'}</div>
                  </button>
                ))}
              </div>
              <div className="text-[10px] text-muted-foreground">{extraCostTypeDef(fType)?.hint}</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">المبلغ (ج.م) *</Label>
                <Input type="number" min="0" step="0.01" inputMode="decimal" value={fAmount} onChange={(e) => setFAmount(e.target.value)} placeholder="مثلًا 1500" className="tnum num-ltr" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">التاريخ</Label>
                <Input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">ربط بشحنة (اختياري)</Label>
              <Select value={fShipment} onValueChange={setFShipment} disabled={!fContractor}>
                <SelectTrigger className="w-full" aria-label="الشحنة"><SelectValue placeholder={fContractor ? 'اختر شحنة...' : 'اختر المقاول أولًا'} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون ربط بشحنة</SelectItem>
                  {shipmentOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.deliveryNumber ?? s.shipmentNo} — {s.destination ?? 'بدون وجهة'} ({String(s.date ?? '').slice(0, 10)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">ملاحظات</Label>
              <Textarea value={fNotes} onChange={(e) => setFNotes(e.target.value)} rows={2} placeholder="تفاصيل البند (سبب المبيت، نوع المرتجع...)" />
            </div>

            {formError && (
              <div className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">{formError}</div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setFormOpen(false)} disabled={busy}>إلغاء</Button>
              <Button onClick={submitForm} disabled={busy}>
                {busy ? 'جارٍ الحفظ...' : editing ? 'حفظ التعديل' : 'تسجيل البند'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── نافذة الرفض بسبب ── */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent className="w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <XCircle className="size-4" /> رفض بند {rejectTarget?.ref}
            </DialogTitle>
            <DialogDescription>
              {rejectTarget?.approvalStatus === 'approved'
                ? 'هذا البند معتمد ومُرحّل محاسبيًا — الرفض سيعكس القيد تلقائيًا ويخرج المبلغ من مستحقات المقاول.'
                : 'البند لن يُحسب في مستحقات المقاول.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs bg-secondary/60 rounded-lg p-2.5 space-y-1">
              <div><span className="text-muted-foreground">النوع:</span> <b>{rejectTarget && extraCostTypeLabel(rejectTarget.type)}</b></div>
              <div><span className="text-muted-foreground">المقاول:</span> <b>{rejectTarget?.contractor?.name}</b></div>
              {canPrices && <div><span className="text-muted-foreground">المبلغ:</span> <b className="tnum num-ltr">{fmtNum(rejectTarget?.amount ?? 0, 2)} ج.م</b></div>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">سبب الرفض (يُسجل في التدقيق)</Label>
              <Textarea value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} rows={2} placeholder="مثلًا: الشركة لم توافق على هذا المبيت" />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={busy}>إلغاء</Button>
              <Button variant="destructive" onClick={submitReject} disabled={busy}>{busy ? 'جارٍ التنفيذ...' : 'تأكيد الرفض'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
