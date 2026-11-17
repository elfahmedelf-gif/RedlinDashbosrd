'use client'

// ============================================================================
// وحدة أذونات التسليم (الديليفري) — متابعة إذن كل نقلة لكل مقاول على حدة
// - عدّادات اليوم: إجمالي شحنات اليوم / التي خرجت / المتبقية (لتاريخ محدد)
// - تبويبات لكل مقاول (أذوناته الخاصة — لا قوائم مختلطة)
// - CRUD كامل: إضافة إذن / تعديل / حذف — بمزامنة محاسبية لحظية على الخادم
//   وتحديث تفاؤلي فوري في كل شاشات النظام (عدّادات + أرصدة + تقارير)
// - علامة «تم تسليم الإذن» لكل شحنة (تحديث تفاؤلي) + عرض الأذونات المتأخرة
// - البحث برقم الديليفري أولاً (المعرف الأساسي)
// ============================================================================

import * as React from 'react'
import useSWR from 'swr'
import {
  ClipboardCheck, Package, PackageCheck, PackageX, AlarmClock, Search,
  FileSpreadsheet, Printer, CircleCheck, Circle, RefreshCw, Plus, Pencil, Trash2, Loader2,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Kpi } from '../ui-cards'
import { DataTable } from '../data-table'
import { EntityFormDialog, type Field } from '../entity-dialog'
import { fetcher } from '@/lib/api'
import { apiPostSync, apiPatchSync, apiDeleteSync } from '@/lib/sync'
import { exportToCSV } from '@/lib/export'
import { fmtNum, fmtDate, SHIPMENT_STATUS } from '@/lib/format'
import { shipmentStatusLabel, SHIPMENT_STATUSES, allowedShipmentTransitions } from '@/lib/shipment-catalog'
import { RECEIPT_OVERDUE_DAYS } from '@/lib/extra-cost-catalog'
import { cn } from '@/lib/utils'
import { useAuth } from '../auth-provider'
import { useToast } from '@/hooks/use-toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { bus, BUS_EVENTS, consumeIntent } from '@/lib/bus'

interface ReceiptItem {
  id: string
  deliveryNumber: string | null
  shipmentNo: string | null
  billNo: string | null
  destination: string | null
  recipientName: string | null
  date: string | null
  status: string
  contractor: { id: string; name: string; code: string | null } | null
  customer: { id: string; name: string } | null
  isReceiptDelivered: boolean
  receiptDeliveredAt: string | null
  ageDays: number
  overdue: boolean
  /** تظهر فقط لمن يملك صلاحية الأسعار (تعديل النولون من نافذة الإذن) */
  freightCost?: number | null
  freightTotal?: number | null
  collected?: boolean
}

interface ContractorTab {
  id: string
  name: string
  code: string | null
  pending: number
  overdue: number
  delivered: number
  total: number
}

interface ReceiptsResponse {
  items: ReceiptItem[]
  total: number
  totals: { all: number; pending: number; overdue: number; delivered: number }
  byContractor: ContractorTab[]
  kpis: { date: string; total: number; dispatched: number; remaining: number; receiptsPending: number }
}

type ViewKey = 'all' | 'undelivered' | 'delivered' | 'overdue'

const VIEWS: { key: ViewKey; label: string; icon: React.ElementType; tone: string }[] = [
  { key: 'all', label: 'الكل', icon: ClipboardCheck, tone: '' },
  { key: 'undelivered', label: 'غير مسلمة', icon: PackageX, tone: 'data-[on=true]:bg-amber-50 data-[on=true]:text-amber-700 data-[on=true]:border-amber-300 dark:data-[on=true]:bg-amber-950/40 dark:data-[on=true]:text-amber-300' },
  { key: 'overdue', label: 'الأذونات المتأخرة', icon: AlarmClock, tone: 'data-[on=true]:bg-rose-50 data-[on=true]:text-rose-700 data-[on=true]:border-rose-300 dark:data-[on=true]:bg-rose-950/40 dark:data-[on=true]:text-rose-300' },
  { key: 'delivered', label: 'المسلّمة', icon: PackageCheck, tone: 'data-[on=true]:bg-emerald-50 data-[on=true]:text-emerald-700 data-[on=true]:border-emerald-300 dark:data-[on=true]:bg-emerald-950/40 dark:data-[on=true]:text-emerald-300' },
]

/** حالات الإنشاء المتاحة عند إضافة إذن جديد (خرج مع المقاول افتراضيًا) */
const CREATE_STATUSES = ['new', 'received', 'loaded', 'in_transit', 'assigned_courier', 'out_for_delivery', 'delivered'] as const

function statusLabel(key: string) {
  return SHIPMENT_STATUSES.find((s) => s.key === key)?.label ?? shipmentStatusLabel(key)
}

function statusBadge(status: string) {
  const def = SHIPMENT_STATUS[status]
  return (
    <span className={cn('inline-block text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap', def?.tone ?? 'bg-slate-100 text-slate-700')}>
      {def?.label ?? shipmentStatusLabel(status)}
    </span>
  )
}

/**
 * حبة حالة الإذن بلغة الأعمال اليومية — 3 ألوان واضحة بلا مصطلحات:
 * تم التسليم ✓ (أخضر) · لم يُسلّم بعد (أصفر) · متأخر +3 أيام (أحمر)
 */
function receiptPill(item: ReceiptItem) {
  if (item.isReceiptDelivered) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
        تم التسليم ✓
      </span>
    )
  }
  if (item.overdue) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
        متأخر +{RECEIPT_OVERDUE_DAYS} أيام
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
      لم يُسلّم بعد
    </span>
  )
}

export function ReceiptsModule() {
  const { has } = useAuth()
  const { toast } = useToast()
  const { confirmDelete } = useConfirm()
  const canToggle = has('shipments.receipts')
  const canAdd = has('shipments.create')
  const canEdit = has('shipments.edit')
  const canDelete = has('shipments.delete')
  const canPrices = has('prices.view')

  const todayISO = React.useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [date, setDate] = React.useState(todayISO)
  const [contractorId, setContractorId] = React.useState<string>('all')
  const [view, setView] = React.useState<ViewKey>('undelivered')
  const [search, setSearch] = React.useState('')
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [formBusy, setFormBusy] = React.useState(false)

  // شارة الهيدر: فتح عرض الأذونات المتأخرة مباشرة عند الضغط عليها
  // (النية المعلقة عند تركيب الوحدة من الهيدر + البث الحي إذا كانت مفتوحة بالفعل)
  React.useEffect(() => {
    if (consumeIntent() === BUS_EVENTS.OPEN_OVERDUE_RECEIPTS) {
      setView('overdue')
      setContractorId('all')
    }
    return bus.on(BUS_EVENTS.OPEN_OVERDUE_RECEIPTS, () => {
      setView('overdue')
      setContractorId('all')
    })
  }, [])

  // زر «تأكيد استلام إذن» السريع في الرئيسية — فتح عرض «غير مسلمة» جاهز للتأشير ✓
  React.useEffect(() => {
    if (consumeIntent() === BUS_EVENTS.OPEN_RECEIPTS_PENDING) setView('undelivered')
    return bus.on(BUS_EVENTS.OPEN_RECEIPTS_PENDING, () => setView('undelivered'))
  }, [])

  const qs = new URLSearchParams()
  if (contractorId !== 'all') qs.set('contractorId', contractorId)
  if (view !== 'all') qs.set('view', view)
  if (search.trim()) qs.set('q', search.trim())
  qs.set('date', date)
  qs.set('pageSize', '500')

  const { data, isLoading, mutate } = useSWR<ReceiptsResponse>(`/api/receipts?${qs.toString()}`, fetcher, {
    keepPreviousData: true,
    refreshInterval: 45000,
  })

  // قوائم المقاولين والعملاء لنوافذ الإضافة/التعديل
  const { data: contractorsData } = useSWR<{ items: { id: string; name: string; code: string | null }[] }>(
    canAdd || canEdit ? '/api/parties?type=contractor' : null, fetcher)
  const { data: customersData } = useSWR<{ items: { id: string; name: string; code: string | null }[] }>(
    canAdd || canEdit ? '/api/parties?type=customer' : null, fetcher)
  const contractors = contractorsData?.items ?? []
  const customers = customersData?.items ?? []

  const items = data?.items ?? []
  const kpis = data?.kpis
  const byContractor = data?.byContractor ?? []
  const totals = data?.totals

  // ── تسليم/إرجاع علامة الإذن — تحديث تفاؤلي مع تراجع عند الخطأ ──
  const toggleReceipt = async (item: ReceiptItem) => {
    if (!canToggle || busyId) return
    const next = !item.isReceiptDelivered
    setBusyId(item.id)
    mutate(async (cur) => {
      if (!cur) return cur
      return {
        ...cur,
        items: cur.items.map((x) => (x.id === item.id
          ? { ...x, isReceiptDelivered: next, receiptDeliveredAt: next ? new Date().toISOString() : null, overdue: next ? false : x.overdue }
          : x)),
        totals: {
          ...cur.totals,
          pending: cur.totals.pending + (next ? -1 : 1),
          delivered: cur.totals.delivered + (next ? 1 : -1),
        },
        byContractor: cur.byContractor.map((c) => (item.contractor && c.id === item.contractor.id
          ? { ...c, pending: c.pending + (next ? -1 : 1), delivered: c.delivered + (next ? 1 : -1), overdue: next ? Math.max(0, c.overdue - (item.overdue ? 1 : 0)) : c.overdue }
          : c)),
      } as ReceiptsResponse
    }, {
      optimisticData: undefined,
      rollbackOnError: true,
      revalidate: true,
    }).catch(() => {})
    try {
      await apiPostSync(`/api/shipments/${item.id}/receipt`, { delivered: next })
      toast({ title: next ? 'تم تسجيل تسليم الإذن' : 'تم إرجاع العلامة', description: `الديليفري ${item.deliveryNumber ?? item.shipmentNo ?? ''} — ${item.contractor?.name ?? ''}` })
      mutate()
    } catch (e: any) {
      toast({ title: 'تعذر تحديث الحالة', description: e.message, variant: 'destructive' })
      mutate()
    } finally {
      setBusyId(null)
    }
  }

  // ── نافذة الإضافة/التعديل ──
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<ReceiptItem | null>(null)

  const openAdd = () => {
    setEditing(null)
    setDialogOpen(true)
  }
  const openEdit = (item: ReceiptItem) => {
    setEditing(item)
    setDialogOpen(true)
  }

  const dialogFields: Field[] = React.useMemo(() => {
    const fields: Field[] = [
      { name: 'deliveryNumber', label: 'رقم الديليفري', type: 'text', placeholder: editing?.deliveryNumber ?? 'يُولّد تلقائيًا إن تُرك فارغًا' },
      {
        name: 'contractorId', label: 'المقاول (مطلوب)', type: 'select', span: 1,
        options: contractors.map((c) => ({ value: c.id, label: c.code ? `${c.name} — ${c.code}` : c.name })),
        placeholder: 'اختر المقاول...',
      },
      {
        name: 'customerId', label: 'العميل', type: 'select', span: 1,
        options: customers.map((c) => ({ value: c.id, label: c.name })),
        placeholder: 'اختر العميل...',
      },
      { name: 'destination', label: 'الوجهة', type: 'text', span: 1 },
      { name: 'recipientName', label: 'المستلم', type: 'text', span: 1 },
      { name: 'date', label: 'تاريخ النقلة', type: 'date', span: 1 },
    ]
    // الحالة: عند الإضافة قائمة مختارة، وعند التعديل انتقالات آلة الحالات الصارمة
    if (editing) {
      const allowed = allowedShipmentTransitions(editing.status)
      if (allowed.length) {
        fields.push({ name: 'status', label: 'الحالة (التسلسل القياسي)', type: 'select', options: allowed.map((k) => ({ value: k, label: statusLabel(k) })), span: 1, placeholder: statusLabel(editing.status) })
      }
    } else {
      fields.push({ name: 'status', label: 'حالة النقلة', type: 'select', options: CREATE_STATUSES.map((k) => ({ value: k, label: statusLabel(k) })), span: 1, placeholder: 'محمّلة على المركبة' })
    }
    if (canPrices) {
      fields.push({ name: 'freightCost', label: 'نولون المقاول (ج.م)', type: 'number', span: 1 })
      fields.push({ name: 'freightTotal', label: 'نولون العميل (ج.م)', type: 'number', span: 1 })
    }
    return fields
  }, [editing, contractors, customers, canPrices])

  const initialForm = React.useMemo(() => {
    if (!editing) return { date: todayISO, status: 'loaded' } as Record<string, any>
    return {
      deliveryNumber: editing.deliveryNumber ?? '',
      contractorId: editing.contractor?.id ?? '',
      customerId: editing.customer?.id ?? '',
      destination: editing.destination ?? '',
      recipientName: editing.recipientName ?? '',
      date: editing.date ? String(editing.date).slice(0, 10) : todayISO,
      status: '',
      freightCost: editing.freightCost ?? '',
      freightTotal: editing.freightTotal ?? '',
    } as Record<string, any>
  }, [editing, todayISO])

  const submitForm = async (values: Record<string, any>) => {
    if (!values.contractorId) throw new Error('اختيار المقاول مطلوب — لا يوجد إذن بدون مقاول')
    const payload: Record<string, any> = { ...values }
    // قيم فارغة = لا تغيير (التعديل لا يمسها) أو افتراضي الخادم (الإنشاء)
    if (!payload.deliveryNumber) delete payload.deliveryNumber
    if (!payload.status) delete payload.status
    if (!editing && !payload.date) delete payload.date

    if (editing) {
      const r = await apiPatchSync<{ reversalNo?: string | null; repostNo?: string | null; postNo?: string | null }>(`/api/receipts/${editing.id}`, payload)
      const syncNote = [
        r.reversalNo ? `عكس القيد ${r.reversalNo}` : '',
        r.repostNo ? `إعادة إثبات بالقيد ${r.repostNo}` : '',
        r.postNo ? `إثبات بالقيد ${r.postNo}` : '',
      ].filter(Boolean).join(' — ')
      toast({
        title: 'تم تعديل الإذن',
        description: `الديليفري ${values.deliveryNumber || editing.deliveryNumber || editing.shipmentNo || ''} — ${syncNote || 'بلا أثر محاسبي جديد'}`,
      })
    } else {
      const r = await apiPostSync<{ shipmentNo: string; deliveryNumber: string | null; journalEntryNo: string | null }>('/api/receipts', payload)
      toast({
        title: 'تم إضافة الإذن',
        description: `ديليفري ${r.deliveryNumber ?? '—'} — شحنة ${r.shipmentNo}${r.journalEntryNo ? ` — قيد ${r.journalEntryNo}` : ''}`,
      })
    }
    // المزامنة اللحظية لكل الشاشات تجري تلقائيًا عبر apiPostSync/apiPatchSync
  }

  // ── حذف الإذن — تأكيد ببيان الأثر ثم تنفيذ تفاؤلي ──
  const handleDelete = async (item: ReceiptItem) => {
    const ok = await confirmDelete({
      title: `حذف إذن التسليم ${item.deliveryNumber ?? item.shipmentNo ?? ''}`,
      message: `سيتم حذف الإذن نهائيًا (الشحنة ${item.shipmentNo ?? ''} — المقاول: ${item.contractor?.name ?? '—'}).\nإذا كان للإذن قيد محاسبي مرحّل سيُعكس تلقائيًا ليزول أثره من رصيد المقاول، والبنود الإضافية المعلقة المرتبطة ستُحذف.\nالبنود المعتمدة والمحصّل تمنع الحذف.`,
    })
    if (!ok) return
    setBusyId(item.id)
    mutate(async (cur) => {
      if (!cur) return cur
      const wasPending = !item.isReceiptDelivered
      const wasOverdue = item.overdue
      return {
        ...cur,
        items: cur.items.filter((x) => x.id !== item.id),
        total: Math.max(0, cur.total - 1),
        totals: {
          ...cur.totals,
          all: Math.max(0, cur.totals.all - 1),
          pending: Math.max(0, cur.totals.pending - (wasPending ? 1 : 0)),
          overdue: Math.max(0, cur.totals.overdue - (wasOverdue ? 1 : 0)),
          delivered: Math.max(0, cur.totals.delivered - (item.isReceiptDelivered ? 1 : 0)),
        },
        byContractor: cur.byContractor.map((c) => (item.contractor && c.id === item.contractor.id
          ? {
              ...c,
              total: Math.max(0, c.total - 1),
              pending: Math.max(0, c.pending - (wasPending ? 1 : 0)),
              overdue: Math.max(0, c.overdue - (wasOverdue ? 1 : 0)),
              delivered: Math.max(0, c.delivered - (item.isReceiptDelivered ? 1 : 0)),
            }
          : c)),
      } as ReceiptsResponse
    }, { optimisticData: undefined, rollbackOnError: true, revalidate: false }).catch(() => {})
    try {
      await apiDeleteSync(`/api/receipts/${item.id}`)
      toast({ title: 'تم حذف الإذن', description: `الديليفري ${item.deliveryNumber ?? item.shipmentNo ?? ''} — عُكس أي قيد مرحّل تلقائيًا` })
    } catch (e: any) {
      toast({ title: 'تعذر الحذف', description: e.message, variant: 'destructive' })
    } finally {
      setBusyId(null)
      mutate()
    }
  }

  const exportCSV = () => {
    if (!items.length) return
    const rows = items.map((x) => ({
      'رقم الديليفري': x.deliveryNumber ?? '',
      'رقم الشحنة': x.shipmentNo ?? '',
      'الوجهة': x.destination ?? '',
      'المقاول': x.contractor?.name ?? '',
      'التاريخ': x.date ? String(x.date).slice(0, 10) : '',
      'حالة الشحنة': shipmentStatusLabel(x.status),
      'الإذن سُلّم؟': x.isReceiptDelivered ? 'نعم' : 'لا',
      'تاريخ التسليم': x.receiptDeliveredAt ? String(x.receiptDeliveredAt).slice(0, 10) : '',
      'العمر (أيام)': x.ageDays,
      'متأخر؟': x.overdue ? 'نعم' : 'لا',
    }))
    exportToCSV(rows, `delivery-receipts-${todayISO}.csv`)
    toast({ title: `تم تصدير ${rows.length} سجل` })
  }

  const activeView = VIEWS.find((v) => v.key === view)!

  return (
    <div className="space-y-4">
      {/* ── عدّادات اليوم الثلاثة + المعلقة ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Kpi title="إجمالي شحنات اليوم" value={fmtNum(kpis?.total ?? 0)} unit="شحنة" icon={Package} tone="primary" subtitle={kpis ? `حركة يوم ${kpis.date}` : undefined} />
        <Kpi title="الشحنات التي خرجت" value={fmtNum(kpis?.dispatched ?? 0)} unit="شحنة" icon={PackageCheck} tone="teal" subtitle="محمّلة / في الطريق / مسلّمة" />
        <Kpi title="الشحنات المتبقية" value={fmtNum(kpis?.remaining ?? 0)} unit="شحنة" icon={PackageX} tone="purple" subtitle="لم تخرج بعد من الفرع" />
        <Kpi title="أذونات لم تُسلّم" value={fmtNum(totals?.pending ?? 0)} unit="إذن" icon={ClipboardCheck} tone="green" subtitle={totals?.overdue ? `منها ${totals.overdue} متأخرة أكثر من ${RECEIPT_OVERDUE_DAYS} أيام` : 'كلها محدثة'} />
      </div>

      {/* ── شريط الأدوات ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap print:hidden">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-card border border-border rounded-xl p-1 px-2">
            <span className="text-[11px] text-muted-foreground">حركة يوم</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value || todayISO)} className="h-8 text-xs border-0 px-1 w-32 bg-transparent" aria-label="تاريخ العدّادات" />
          </div>
          <div className="flex items-center gap-0.5 bg-secondary/60 rounded-lg p-0.5 flex-wrap">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                data-on={view === v.key}
                onClick={() => setView(v.key)}
                className={cn(
                  'flex items-center gap-1 text-[11px] font-medium px-2 py-1.5 rounded-md transition-all border border-transparent',
                  v.tone,
                  view === v.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <v.icon className="size-3.5" />
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث برقم الديليفري..." className="pr-8 h-9 w-40 sm:w-56 text-xs bg-card" />
          </div>
          {canAdd && (
            <Button size="sm" onClick={openAdd} className="h-9">
              <Plus className="size-4" /> <span className="hidden sm:inline">إضافة إذن</span>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => mutate()} className="h-9" aria-label="تحديث">
            <RefreshCw className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!items.length} className="h-9">
            <FileSpreadsheet className="size-4" /> <span className="hidden sm:inline">تصدير</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!items.length} className="h-9">
            <Printer className="size-4" /> <span className="hidden sm:inline">طباعة</span>
          </Button>
        </div>
      </div>

      {/* ── تبويبات المقاولين — أذونات كل مقاول منفصلة ── */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 print:hidden scrollbar-thin">
        <button
          onClick={() => setContractorId('all')}
          className={cn(
            'shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-full border transition-all',
            contractorId === 'all'
              ? 'bg-primary text-primary-foreground border-primary shadow-sm'
              : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-primary/40',
          )}
        >
          كل المقاولين
          {totals && totals.pending > 0 && (
            <span className={cn('text-[10px] tnum px-1.5 py-0.5 rounded-full', contractorId === 'all' ? 'bg-primary-foreground/20' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300')}>
              {totals.pending}
            </span>
          )}
        </button>
        {byContractor.map((c) => (
          <button
            key={c.id}
            onClick={() => setContractorId(c.id)}
            className={cn(
              'shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-full border transition-all',
              contractorId === c.id
                ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-primary/40',
            )}
          >
            <span className="truncate max-w-[140px]">{c.name}</span>
            {c.overdue > 0 && (
              <span className="text-[10px] tnum px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">{c.overdue} متأخر</span>
            )}
            {c.pending > 0 && (
              <span className={cn('text-[10px] tnum px-1.5 py-0.5 rounded-full', contractorId === c.id ? 'bg-primary-foreground/20' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300')}>
                {c.pending}
              </span>
            )}
          </button>
        ))}
        {byContractor.length === 0 && !isLoading && (
          <span className="text-xs text-muted-foreground px-2">لا توجد شحنات مسندة لمقاولين بعد</span>
        )}
      </div>

      {/* ── لوحة المتأخرة: ملخص مسؤولية كل مقاول ── */}
      {view === 'overdue' && byContractor.filter((c) => c.overdue > 0).length > 0 && (
        <Card className="print:hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlarmClock className="size-4 text-rose-500" />
              الأذونات المتأخرة لكل مقاول
            </CardTitle>
            <CardDescription>أذونات لم تُسلّم بعد أكثر من {RECEIPT_OVERDUE_DAYS} أيام من تاريخ الشحنة — تابعها فورًا</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {byContractor.filter((c) => c.overdue > 0).map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setContractorId(c.id); setView('overdue') }}
                  className="text-right border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-900 rounded-lg p-3 hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm truncate">{c.name}</span>
                    <Badge variant="outline" className="text-[11px] tnum bg-rose-100 text-rose-700 border-rose-300">{c.overdue} متأخر</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    من إجمالي <b className="text-foreground tnum">{c.pending}</b> إذن غير مسلّم له
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── جدول الأذونات + إجراءات الصف ── */}
      <DataTable
        rows={items}
        loading={isLoading && !data}
        emptyText="لا توجد أذونات في هذا العرض"
        emptyTitle={
          view === 'overdue'
            ? 'كل الأذونات مستلمة ✓'
            : view === 'delivered'
              ? 'لسه مفيش أذونات مسلّمة في هذا العرض'
              : 'مفيش أذونات مستنية تأشير'
        }
        emptyHint={
          view === 'overdue'
            ? (contractorId !== 'all'
              ? `لا توجد أذونات متأخرة أكثر من ${RECEIPT_OVERDUE_DAYS} أيام على هذا المقاول — شغله تمام`
              : 'لا توجد أذونات متأخرة أكثر من ٣ أيام على أي مقاول — كل الأذونات تحت السيطرة')
            : view === 'delivered'
              ? 'أول ما تُعلم ✓ على أي إذن هيظهر هنا بسجل التسليم'
              : 'الإذن بيتسجل أوتوماتيك مع كل شحنة جديدة — أو ضيفه يدوي من زر «إضافة إذن»'
        }
        emptyAction={
          canAdd && view !== 'overdue' ? (
            <Button size="sm" onClick={openAdd} className="min-h-[40px]">
              <Plus className="size-4" /> إضافة إذن يدوي
            </Button>
          ) : undefined
        }
        emptyIcon={view === 'overdue' ? PackageCheck : ClipboardCheck}
        getRowKey={(x) => x.id}
        minW={1100}
        resetKey={`${contractorId}|${view}|${search}|${date}`}
        columns={[
          {
            key: 'delivery', header: 'رقم الديليفري', primary: true, width: 'w-32',
            render: (x: ReceiptItem) => (
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold">{x.deliveryNumber ?? x.shipmentNo ?? '—'}</span>
                {x.overdue && <Badge variant="outline" className="text-[9px] px-1 py-0 bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300">متأخر</Badge>}
              </div>
            ),
          },
          { key: 'dest', header: 'الوجهة', width: 'w-32', render: (x: ReceiptItem) => <span className="text-xs truncate-1 block">{x.destination ?? '—'}</span> },
          { key: 'contractor', header: 'المقاول', width: 'w-36', render: (x: ReceiptItem) => <span className="text-xs font-medium truncate-1 block" dir="auto">{x.contractor?.name ?? '—'}</span> },
          { key: 'date', header: 'تاريخ الشحنة', hideInCard: true, align: 'center' as const, width: 'w-28', render: (x: ReceiptItem) => <span className="text-xs tnum whitespace-nowrap">{fmtDate(x.date)}</span> },
          { key: 'status', header: 'الحالة', align: 'center' as const, width: 'w-28', render: (x: ReceiptItem) => statusBadge(x.status) },
          {
            key: 'age', header: 'العمر', align: 'center' as const, hideInCard: true, width: 'w-24',
            render: (x: ReceiptItem) => (
              <Badge variant="outline" className={cn('text-[10px] tnum',
                !x.isReceiptDelivered && x.ageDays > RECEIPT_OVERDUE_DAYS ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300')}>
                {x.ageDays} يوم
              </Badge>
            ),
          },
          {
            key: 'receipt', header: 'سُلّم الإذن؟', align: 'center' as const, width: 'w-36',
            render: (x: ReceiptItem) => (
              <div
                className="flex flex-col items-center gap-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                {receiptPill(x)}
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <Checkbox
                    checked={x.isReceiptDelivered}
                    disabled={!canToggle || busyId === x.id}
                    onCheckedChange={() => toggleReceipt(x)}
                    className="size-5"
                    aria-label={`تسليم إذن الديليفري ${x.deliveryNumber ?? x.shipmentNo ?? ''}`}
                  />
                  <span className="text-[10px] text-muted-foreground">علّم ✓ عند الاستلام</span>
                </label>
              </div>
            ),
          },
          {
            key: 'deliveredAt', header: 'تاريخ التسليم', hideInCard: true, align: 'center' as const, width: 'w-28',
            render: (x: ReceiptItem) => x.isReceiptDelivered
              ? <span className="text-xs tnum text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><CircleCheck className="size-3.5" />{fmtDate(x.receiptDeliveredAt)}</span>
              : <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Circle className="size-3" />—</span>,
          },
          {
            key: 'actions', header: 'إجراءات', align: 'center' as const, width: 'w-36', hideInCard: false,
            render: (x: ReceiptItem) => (
              <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                {busyId === x.id && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                {canEdit && (
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(x)} aria-label={`تعديل الإذن ${x.deliveryNumber ?? x.shipmentNo ?? ''}`} title="تعديل">
                    <Pencil className="size-3.5 text-sky-600 dark:text-sky-400" />
                  </Button>
                )}
                {canDelete && (
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleDelete(x)} aria-label={`حذف الإذن ${x.deliveryNumber ?? x.shipmentNo ?? ''}`} title="حذف">
                    <Trash2 className="size-3.5 text-rose-600 dark:text-rose-400" />
                  </Button>
                )}
                {!canEdit && !canDelete && <span className="text-[10px] text-muted-foreground">—</span>}
              </div>
            ),
          },
        ]}
      />

      {/* ملاحظة إرشادية */}
      <div className="text-[11px] text-muted-foreground leading-relaxed print:hidden">
        علم «سُلّم الإذن» يعني أن المقاول سلّم إذن التسليم لهذه النقلة (رقم الديليفري).
        الأذونات غير المعلمة تبقى ظاهرة في عرض «غير مسلمة» و«الأذونات المتأخرة» بعد {RECEIPT_OVERDUE_DAYS} أيام — كل مقاول له أذوناته الخاصة في تبويبه.
        الإضافة/التعديل/الحذف تُزامن القيود المحاسبية وعدّادات كل الشاشات لحظيًا.
      </div>

      {/* ── نافذة إضافة/تعديل الإذن ── */}
      <EntityFormDialog
        open={dialogOpen}
        onOpenChange={(v) => { if (!formBusy) setDialogOpen(v) }}
        title={editing ? `تعديل إذن التسليم ${editing.deliveryNumber ?? editing.shipmentNo ?? ''}` : 'إضافة إذن تسليم جديد'}
        description={editing
          ? 'تعديل البيانات أو المقاول أو النولون — أي أثر محاسبي مُرحّل يُعكس ويعاد إثباته تلقائيًا'
          : 'إنشاء شحنة جديدة مسندة لمقاول برقم ديليفري — الافتراضي «محمّلة على المركبة»'}
        fields={dialogFields}
        initial={initialForm}
        onSubmit={submitForm}
        submitLabel={editing ? 'حفظ التعديل' : 'إضافة الإذن'}
      />
    </div>
  )
}
