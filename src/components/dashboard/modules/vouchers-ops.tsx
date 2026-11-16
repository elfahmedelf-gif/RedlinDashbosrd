'use client'

// ============================================================================
// وحدة الأذونات التشغيلية — VouchersModule
// تعرض الأذونات الـ16 (تشغيلي/مالي/جرد/خاص) مع دورة الحياة الكاملة:
// مسودة → رفع → اعتماد → تنفيذ → إكمال (أو رفض/إلغاء).
// تشمل: لوحة مؤشرات، فلترة، جدول بيانات، حوار إنشاء، حوار تفاصيل مع
// سجل الاعتماد وأزرار الإجراءات، حوار تعديل، طباعة A4، وتصدير CSV.
// ============================================================================

import * as React from 'react'
import useSWR from 'swr'
import {
  Landmark, Plus, Trash2, Printer, FileSpreadsheet, Clock, CheckCircle2, FileText,
  Loader2, Banknote, BanknoteArrowDown, Link2, Search, X,
  PackageCheck, AlertCircle, Undo2,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable } from '../data-table'
import { fetcher, VOUCHER_TYPES, VOUCHER_STATES, VOUCHER_CATEGORIES } from '@/lib/api'
import { apiPostSync as apiPost, apiPatchSync as apiPatch, apiDeleteSync as apiDelete } from '@/lib/sync'
import { exportToCSV } from '@/lib/export'
import { fmtNum, fmtDate, fmtDateTime } from '@/lib/format'
import { useAuth, useCanPrices } from '../auth-provider'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { VoucherOpsPrint } from '../voucher-print-ops'
import { voucherTypeDef } from '@/lib/voucher-catalog'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// خريطة تسميات الأفعال في سجل الاعتماد
// ---------------------------------------------------------------------------
const ACTION_LABELS: Record<string, string> = {
  submit: 'رفع',
  approve: 'اعتماد',
  reject: 'رفض',
  execute: 'تنفيذ',
  complete: 'إكمال',
  cancel: 'إلغاء',
  resubmit: 'إعادة',
  edit: 'تعديل',
  create: 'إنشاء',
}

// خريطة ألوان النقاط في سجل الاعتماد
const ACTION_DOT: Record<string, string> = {
  create: 'bg-slate-400',
  edit: 'bg-slate-500',
  submit: 'bg-amber-500',
  approve: 'bg-emerald-500',
  reject: 'bg-rose-500',
  execute: 'bg-indigo-500',
  complete: 'bg-emerald-600',
  cancel: 'bg-rose-600',
  resubmit: 'bg-amber-500',
}

// ---------------------------------------------------------------------------
// خريطة حالة الشحنة (تدمج مع SHIPMENT_STATUS ومع lookups إن وُجدت)
// ---------------------------------------------------------------------------
function buildShipmentStatusMap(lookups: any[] | undefined): Record<string, { label: string; tone: string }> {
  const base: Record<string, { label: string; tone: string }> = {
    new: { label: 'جديدة', tone: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
    preparing: { label: 'قيد التجهيز', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
    out_for_delivery: { label: 'خرجت للتوصيل', tone: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
    delivered: { label: 'تم التسليم', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
    postponed: { label: 'مؤجلة', tone: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
    failed: { label: 'فشل', tone: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
    returned: { label: 'مرتجعة', tone: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
    cancelled: { label: 'ملغاة', tone: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
    received: { label: 'مستلمة بالفرع', tone: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' },
    loaded: { label: 'محمّلة', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
    in_transit: { label: 'في الطريق', tone: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
    arrived: { label: 'وصلت', tone: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
    assigned_courier: { label: 'مُسلّمة لمندوب', tone: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
    received_returned: { label: 'مرتجعة مستلمة', tone: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
    written_off: { label: 'شُطبت', tone: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  }
  if (lookups?.length) {
    for (const l of lookups) {
      if (l.category === 'shipment_status' && l.key) {
        base[l.key] = { label: l.label ?? l.key, tone: l.tone ?? 'bg-slate-100 text-slate-700' }
      }
    }
  }
  return base
}

// ---------------------------------------------------------------------------
// حالة استلام المرتجعات — تُحسب من عناصر الإذن (حالة الشحنات) بدل شارة ثابتة:
// كل الشحنات "مرتجعة مستلمة" → تم الاستلام | لا شيء مُستلم → لم يُستلم | خليط → جزئي
// ---------------------------------------------------------------------------
type ReturnReceiptState = 'received' | 'pending' | 'partial' | null

function returnReceiptState(v: { type: string; status: string; items?: any[] | null }): ReturnReceiptState {
  if ((v.type !== 'return' && v.type !== 'returned_receiving') || v.status !== 'completed') return null
  const items = v.items ?? []
  if (items.length === 0) return null
  const received = items.filter((it: any) => it.shipment?.status === 'received_returned').length
  if (received === items.length) return 'received'
  if (received === 0) return 'pending'
  return 'partial'
}

const RETURN_RECEIPT_BADGE: Record<Exclude<ReturnReceiptState, null>, { label: string; tone: string }> = {
  received: { label: 'تم الاستلام', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  pending: { label: 'لم يُستلم', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  partial: { label: 'استلام جزئي', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
}

// ---------------------------------------------------------------------------
// ShipmentPicker — منتقي شحنات للإذن (يُستخدم في الإنشاء والتفاصيل)
// ---------------------------------------------------------------------------
function ShipmentPicker({
  preStatuses,
  excludeIds,
  onAdd,
  onRemove,
  selected,
  emptyHint,
  canPrices = true,
}: {
  preStatuses: string[] | null
  excludeIds: string[]
  onAdd: (shipment: any) => void
  onRemove: (id: string) => void
  selected: any[]
  emptyHint?: string
  canPrices?: boolean
}) {
  const { toast } = useToast()
  const [q, setQ] = React.useState('')
  const [results, setResults] = React.useState<any[] | null>(null)
  const [loading, setLoading] = React.useState(false)

  const doSearch = async () => {
    setLoading(true)
    try {
      const res: any = await fetcher(`/api/shipments?q=${encodeURIComponent(q)}&pageSize=30`)
      setResults(res?.items ?? [])
    } catch (e: any) {
      toast({ title: 'خطأ في البحث', description: e.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const excluded = new Set(excludeIds)

  return (
    <div className="space-y-2">
      {/* Hint */}
      {preStatuses && preStatuses.length > 0 && (
        <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 rounded-md px-2.5 py-1.5 flex items-start gap-1.5">
          <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
          <span>هذا الإذن يقبل الشحنات بحالة: <b>{preStatuses.join(' أو ')}</b></span>
        </div>
      )}

      {/* Search */}
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch() } }}
            placeholder="بحث برقم الشحنة/المستلم/الوجهة..."
            className="pr-8 h-8 text-xs"
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={doSearch} disabled={loading} className="h-8">
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
          <span className="hidden sm:inline">بحث</span>
        </Button>
      </div>

      {/* Results dropdown */}
      {results && results.length > 0 && (
        <div className="border border-border rounded-lg max-h-56 overflow-y-auto no-scrollbar bg-card elev-sm">
          {results.map((s) => {
            const added = excluded.has(s.id)
            const statusOk = !preStatuses || preStatuses.includes(s.status)
            return (
              <button
                key={s.id}
                type="button"
                disabled={added || !statusOk}
                onClick={() => { onAdd(s); setResults(null); setQ('') }}
                className={cn(
                  'w-full text-right px-3 py-2 border-b border-border last:border-0 flex items-center justify-between gap-2 text-xs',
                  (added || !statusOk) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted/50',
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono font-bold shrink-0">{s.shipmentNo}</span>
                  <span className="text-muted-foreground truncate-1">{s.customer?.name || s.recipientName || '—'}</span>
                  <span className="text-muted-foreground truncate-1 hidden md:inline">→ {s.destination || '—'}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {s.status && <Badge variant="outline" className="text-[10px]">{s.status}</Badge>}
                  {added && <span className="text-[10px] text-emerald-700 dark:text-emerald-300">مُضافة</span>}
                  {!added && !statusOk && <span className="text-[10px] text-rose-700 dark:text-rose-300">حالة غير مناسبة</span>}
                  {!added && statusOk && <Plus className="size-3.5 text-primary" />}
                </div>
              </button>
            )
          })}
        </div>
      )}
      {results && results.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-3 border border-dashed border-border rounded-lg">
          لا توجد نتائج للبحث "{q}"
        </div>
      )}

      {/* Selected shipments */}
      <div className="space-y-1">
        {selected.length === 0 && emptyHint && (
          <div className="text-xs text-muted-foreground text-center py-2 border border-dashed border-border rounded-lg">
            {emptyHint}
          </div>
        )}
        {selected.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-2 border border-border rounded-md px-2.5 py-1.5 bg-muted/20">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="font-mono text-xs font-bold shrink-0">{s.shipmentNo}</span>
              <span className="text-xs text-muted-foreground truncate-1">{s.customer?.name || s.recipientName || '—'}</span>
              <span className="text-xs text-muted-foreground truncate-1 hidden md:inline">→ {s.destination || '—'}</span>
              {s.status && <Badge variant="outline" className="text-[10px] shrink-0">{s.status}</Badge>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {/* النولون يُعرض فقط لمن يملك صلاحية الأسعار */}
              {canPrices && <span className="text-xs tnum text-muted-foreground">{fmtNum(s.freightTotal ?? 0)} ج.م</span>}
              <button type="button" onClick={() => onRemove(s.id)} className="text-destructive hover:text-destructive/80 p-1">
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
        {selected.length > 0 && canPrices && (
          <div className="text-[11px] text-muted-foreground text-left px-1 tnum">
            الإجمالي: {fmtNum(selected.reduce((s, sh) => s + (Number(sh.freightTotal) || 0), 0))} ج.م
          </div>
        )}
        {selected.length > 0 && !canPrices && (
          <div className="text-[11px] text-muted-foreground text-left px-1 tnum">
            {selected.length} شحنة مضافة
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// VouchersModule
// ---------------------------------------------------------------------------
export function VouchersModule() {
  const { toast } = useToast()
  const { has, user: me } = useAuth()
  const { confirmDelete, confirm: confirmDialog } = useConfirm()
  // صلاحية رؤية الأسعار/المبالغ — فقط للمالك ومحمود
  const canPrices = useCanPrices()

  // ---- Filters ----
  const [typeFilter, setTypeFilter] = React.useState<string>('all')
  const [statusFilter, setStatusFilter] = React.useState<string>('all')
  const [from, setFrom] = React.useState<string>('')
  const [to, setTo] = React.useState<string>('')

  const listUrl = React.useMemo(() => {
    const params = new URLSearchParams()
    if (typeFilter !== 'all') params.set('type', typeFilter)
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const qs = params.toString()
    return `/api/vouchers${qs ? `?${qs}` : ''}`
  }, [typeFilter, statusFilter, from, to])

  const { data, isLoading, mutate } = useSWR<{ items: any[]; total: number }>(listUrl, fetcher, { refreshInterval: 30000 })
  const { data: statsData, isLoading: statsLoading, mutate: mutateStats } = useSWR<any>('/api/vouchers/stats', fetcher, { refreshInterval: 30000 })
  const { data: partiesRes } = useSWR<{ items: any[] }>('/api/parties', fetcher)
  const { data: usersRes } = useSWR<{ items: any[] }>('/api/users', fetcher)
  const { data: branchesRes } = useSWR<{ items: any[] }>('/api/branches', fetcher)
  const { data: lookupsRes } = useSWR<{ items: any[] }>('/api/lookups?category=shipment_status', fetcher)

  const items = data?.items ?? []
  const parties = partiesRes?.items ?? []
  const users = usersRes?.items ?? []
  const branches = branchesRes?.items ?? []
  const shipmentStatusMap = React.useMemo(() => buildShipmentStatusMap(lookupsRes?.items), [lookupsRes])

  // ---- Type grouping (for selects) ----
  const typesByCategory = React.useMemo(() => {
    const groups: Record<string, any[]> = { operational: [], financial: [], inventory: [], special: [] }
    for (const t of VOUCHER_TYPES) {
      if (groups[t.category]) groups[t.category].push(t)
    }
    return groups
  }, [])

  // ---- Create dialog ----
  const [open, setOpen] = React.useState(false)
  const [v, setV] = React.useState<any>({
    type: 'receiving',
    employeeId: '',
    courierId: '',
    partyId: '',
    sourceBranchId: '',
    destBranchId: '',
    amount: '',
    accountName: 'الصندوق',
    notes: '',
  })
  const [addedShipments, setAddedShipments] = React.useState<any[]>([])
  const [err, setErr] = React.useState('')
  const [loading, setLoading] = React.useState(false)

  const tdef = VOUCHER_TYPES.find((t) => t.code === v.type)

  React.useEffect(() => {
    if (open) {
      // reset
      setV({
        type: 'receiving',
        employeeId: '',
        courierId: '',
        partyId: '',
        sourceBranchId: branches[0]?.id ?? '',
        destBranchId: branches[0]?.id ?? '',
        amount: '',
        accountName: 'الصندوق',
        notes: '',
      })
      setAddedShipments([])
      setErr('')
    }
  }, [open, branches])

  React.useEffect(() => {
    // default source/dest branch when loaded
    if (open && !v.sourceBranchId && branches.length) {
      setV((cur) => ({ ...cur, sourceBranchId: branches[0].id, destBranchId: cur.destBranchId || branches[0].id }))
    }
  }, [open, branches, v.sourceBranchId])

  // ---- Edit dialog ----
  const [editId, setEditId] = React.useState<string | null>(null)
  const [ev, setEv] = React.useState<any>({})
  const [eErr, setEErr] = React.useState('')
  const [eLoading, setELoading] = React.useState(false)
  const editTdef = VOUCHER_TYPES.find((t) => t.code === ev.type)

  React.useEffect(() => {
    if (editId) {
      // load the voucher details
      fetcher(`/api/vouchers/${editId}`).then((voucher: any) => {
        setEv({
          type: voucher.type,
          employeeId: voucher.employeeId ?? '',
          courierId: voucher.courierId ?? '',
          partyId: voucher.partyId ?? '',
          sourceBranchId: voucher.sourceBranchId ?? '',
          destBranchId: voucher.destBranchId ?? '',
          amount: voucher.amount ?? '',
          accountName: voucher.accountName ?? 'الصندوق',
          notes: voucher.notes ?? '',
        })
        setEErr('')
      }).catch((e: any) => setEErr(e.message))
    }
  }, [editId])

  // ---- Detail dialog ----
  const [detailId, setDetailId] = React.useState<string | null>(null)
  const { data: detailData, mutate: mutateDetail } = useSWR<any>(detailId ? `/api/vouchers/${detailId}` : null, fetcher)
  const [actionNotes, setActionNotes] = React.useState('')
  const [actionLoading, setActionLoading] = React.useState(false)
  const [detailAdded, setDetailAdded] = React.useState<any[]>([])

  // ---- Print ----
  const [printVoucher, setPrintVoucher] = React.useState<any>(null)

  // =========================================================================
  // Handlers
  // =========================================================================
  const refreshAll = React.useCallback(() => {
    mutate()
    mutateStats()
    if (detailId) mutateDetail()
  }, [mutate, mutateStats, detailId, mutateDetail])

  const submit = async () => {
    setLoading(true); setErr('')
    try {
      const t = VOUCHER_TYPES.find((x) => x.code === v.type)
      if (!t) throw new Error('نوع الإذن غير معروف')
      if (t.requiresEmployee && !v.employeeId) throw new Error('حدد الموظف المسؤول')
      if (t.requiresCourier && !v.courierId) throw new Error('حدد المندوب')
      if (t.requiresParty && !v.partyId) throw new Error('حدد الطرف')
      if (t.requiresDestBranch && !v.destBranchId) throw new Error('حدد فرع الاستلام')
      if (!v.sourceBranchId) throw new Error('حدد الفرع المصدر')
      if (t.isFinancial && (!v.amount || Number(v.amount) <= 0)) throw new Error('أدخل مبلغًا صحيحًا')
      if (t.requiresShipments && addedShipments.length === 0) throw new Error('أضف شحنة واحدة على الأقل')

      const body: any = {
        type: v.type,
        employeeId: v.employeeId || null,
        courierId: v.courierId || null,
        partyId: v.partyId || null,
        sourceBranchId: v.sourceBranchId || null,
        destBranchId: v.destBranchId || null,
        amount: t.isFinancial ? Number(v.amount) : null,
        accountName: t.isFinancial ? v.accountName : null,
        notes: v.notes || null,
        shipmentIds: addedShipments.map((s) => s.id),
        userName: me?.username,
      }
      const res: any = await apiPost('/api/vouchers', body)
      toast({ title: 'تم إنشاء الإذن', description: `رقم الإذن: ${res?.voucherNo ?? '—'}` })
      setOpen(false)
      refreshAll()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  const editSubmit = async () => {
    if (!editId) return
    setELoading(true); setEErr('')
    try {
      const t = VOUCHER_TYPES.find((x) => x.code === ev.type)
      if (!t) throw new Error('نوع الإذن غير معروف')
      if (t.requiresEmployee && !ev.employeeId) throw new Error('حدد الموظف المسؤول')
      if (t.requiresCourier && !ev.courierId) throw new Error('حدد المندوب')
      if (t.requiresParty && !ev.partyId) throw new Error('حدد الطرف')
      if (t.requiresDestBranch && !ev.destBranchId) throw new Error('حدد فرع الاستلام')
      if (t.isFinancial && (!ev.amount || Number(ev.amount) <= 0)) throw new Error('أدخل مبلغًا صحيحًا')
      await apiPatch(`/api/vouchers/${editId}`, {
        notes: ev.notes ?? null,
        partyId: ev.partyId || null,
        courierId: ev.courierId || null,
        employeeId: ev.employeeId || null,
        sourceBranchId: ev.sourceBranchId || null,
        destBranchId: ev.destBranchId || null,
        amount: t.isFinancial ? Number(ev.amount) : undefined,
        accountName: t.isFinancial ? ev.accountName : undefined,
        userName: me?.username,
      })
      toast({ title: 'تم تعديل الإذن' })
      setEditId(null)
      refreshAll()
    } catch (e: any) {
      setEErr(e.message)
    } finally {
      setELoading(false)
    }
  }

  const del = async (id: string, no?: string) => {
    const ok = await confirmDelete({
      title: 'حذف الإذن',
      message: `حذف الإذن ${no ?? ''}؟ (لا يمكن التراجع)`,
    })
    if (!ok) return
    try {
      await apiDelete(`/api/vouchers/${id}`)
      toast({ title: 'تم الحذف' })
      refreshAll()
    } catch (e: any) {
      toast({ title: 'خطأ', description: e.message, variant: 'destructive' })
    }
  }

  const addItem = async (vid: string, shipment: any) => {
    try {
      await apiPost(`/api/vouchers/${vid}/items`, { shipmentId: shipment.id, userName: me?.username })
      toast({ title: 'تمت إضافة الشحنة', description: shipment.shipmentNo })
      mutateDetail()
      mutate()
      mutateStats()
    } catch (e: any) {
      toast({ title: 'خطأ', description: e.message, variant: 'destructive' })
    }
  }

  const removeItem = async (vid: string, itemId: string) => {
    const ok = await confirmDelete({
      title: 'حذف الشحنة من الإذن',
      message: 'سيتم حذف هذه الشحنة من الإذن. هل تريد المتابعة؟',
    })
    if (!ok) return
    try {
      await apiDelete(`/api/vouchers/${vid}/items/${itemId}`)
      toast({ title: 'تم حذف الشحنة من الإذن' })
      mutateDetail()
      mutate()
    } catch (e: any) {
      toast({ title: 'خطأ', description: e.message, variant: 'destructive' })
    }
  }

  const transition = async (vid: string, action: string) => {
    // تأكيد قبل الإجراءات الجوهرية: اعتماد (primary)، رفض/إلغاء (warning)
    const CONFIRM_MAP: Record<string, { title: string; message: string; variant: 'primary' | 'warning'; confirmText: string } | undefined> = {
      approve: {
        title: 'اعتماد الإذن',
        message: 'سيتم اعتماد هذا الإذن وانتقاله إلى مرحلة التنفيذ. هل تريد المتابعة؟',
        variant: 'primary',
        confirmText: 'اعتماد',
      },
      reject: {
        title: 'رفض الإذن',
        message: 'سيتم رفض هذا الإذن وإعادته للتعديل. هل تريد المتابعة؟',
        variant: 'warning',
        confirmText: 'رفض',
      },
      cancel: {
        title: 'إلغاء الإذن',
        message: 'سيتم إلغاء هذا الإذن نهائيًا ولا يمكن التراجع. هل تريد المتابعة؟',
        variant: 'warning',
        confirmText: 'إلغاء الإذن',
      },
    }
    const c = CONFIRM_MAP[action]
    if (c) {
      const ok = await confirmDialog(c)
      if (!ok) return
    }
    setActionLoading(true)
    try {
      const res: any = await apiPost(`/api/vouchers/${vid}/transition`, {
        action,
        notes: actionNotes || null,
        userName: me?.username,
      })
      toast({ title: `تم تنفيذ الإجراء`, description: `الحالة الآن: ${res?.status ?? '—'}` })
      setActionNotes('')
      refreshAll()
    } catch (e: any) {
      toast({ title: 'خطأ', description: e.message, variant: 'destructive' })
    } finally {
      setActionLoading(false)
    }
  }

  // تسليم مرتجع: ينشئ إذن استلام مرتجعات مكتمل تلقائيًا لكل شحنة مع المندوب
  // وينقل حالتها من "returned" إلى "received_returned" (تم التسليم)
  const markReceived = async (vid: string) => {
    const ok = await confirmDialog({
      title: 'تأكيد التسليم',
      message: 'سيُنشأ إذن استلام مرتجعات لكل شحنة لم تُستلم بعد. هل تريد المتابعة؟',
      variant: 'primary',
      confirmText: 'تم التسليم',
    })
    if (!ok) return
    setActionLoading(true)
    try {
      const res: any = await apiPost(`/api/vouchers/${vid}/mark-received`, {
        notes: actionNotes || null,
        userName: me?.username,
      })
      const summary = res?.succeeded != null && res?.total != null
        ? `تم تسليم ${res.succeeded}/${res.total} شحنة${res.failed ? ` — ${res.failed} فشل` : ''}`
        : 'تم التسليم'
      toast({ title: 'تم التسليم', description: summary })
      setActionNotes('')
      refreshAll()
    } catch (e: any) {
      toast({ title: 'خطأ', description: e.message, variant: 'destructive' })
    } finally {
      setActionLoading(false)
    }
  }

  // إلغاء سند مالي مكتمل بالقيد العكسي — الخادم ينشئ قيدًا عكسيًا ويرد التحصيل عن الشحنات
  // (متاح فقط للأذونات المالية: تحصيل/صرف نقدية/توريد خزينة/تسوية عهدة — يُفرض على الخادم)
  const cancelCompletedFinancial = async (vid: string, voucherNo?: string) => {
    const ok = await confirmDialog({
      title: `إلغاء السند ${voucherNo ?? ''} بالقيد العكسي`,
      message: 'سيُنشأ قيد عكسي للقيد المرتبط بهذا السند، ويُرد التحصيل عن الشحنات المرتبطة إن وُجدت. لا يمكن التراجع عن هذه العملية. هل تريد المتابعة؟',
      variant: 'warning',
      confirmText: 'إلغاء بالقيد العكسي',
    })
    if (!ok) return
    setActionLoading(true)
    try {
      await apiPost(`/api/vouchers/${vid}/transition`, {
        action: 'cancel',
        notes: actionNotes || null,
        userName: me?.username,
      })
      toast({ title: 'تم إلغاء السند بالقيد العكسي', description: 'أُنشئ القيد العكسي وأُرجع التحصيل عن الشحنات المرتبطة إن وُجدت' })
      refreshAll()
    } catch (e: any) {
      toast({ title: 'خطأ', description: e.message, variant: 'destructive' })
    } finally {
      setActionLoading(false)
    }
  }

  const exportVouchers = () => {
    if (!items?.length) { toast({ title: 'لا توجد بيانات للتصدير' }); return }
    const rows = items.map((vch: any) => ({
      'رقم الإذن': vch.voucherNo,
      'النوع': vch.typeLabel ?? vch.type,
      'الحالة': vch.statusLabel ?? vch.status,
      'التاريخ': vch.createdAt ? fmtDate(vch.createdAt) : '',
      'الفرع المصدر': vch.sourceBranch?.name ?? '',
      'فرع الاستلام': vch.destBranch?.name ?? '',
      'الموظف': vch.employee?.name ?? '',
      'المندوب': vch.courier?.name ?? '',
      'الطرف': vch.party?.name ?? '',
      'عدد الشحنات': vch.itemCount ?? 0,
      // قيمة الإذان تُصدّر فقط لمن يملك صلاحية الأسعار
      ...(canPrices ? { 'القيمة': vch.totalValue ?? 0 } : {}),
      'البيان': vch.notes ?? '',
    }))
    exportToCSV(rows, `vouchers-ops-${new Date().toISOString().slice(0, 10)}.csv`)
    toast({ title: `تم تصدير ${rows.length} إذن` })
  }

  // =========================================================================
  // Columns
  // =========================================================================
  const columns = [
    {
      key: 'voucherNo', header: 'رقم الإذن', primary: true, align: 'center' as const, width: 'w-28',
      render: (vch: any) => <span className="font-mono text-xs font-bold">{vch.voucherNo}</span>,
    },
    {
      key: 'type', header: 'النوع', align: 'center' as const, width: 'w-44',
      render: (vch: any) => (
        <Badge variant="outline" className={cn('text-[11px]', vch.typeColor ?? '')}>
          {vch.typeLabel ?? vch.type}
        </Badge>
      ),
    },
    {
      key: 'status', header: 'الحالة', align: 'center' as const, width: 'w-32',
      render: (vch: any) => {
        // شارة استلام المرتجعات — محسوبة من حالة شحنات الإذن (وليست ثابتة)
        const receipt = returnReceiptState(vch)
        return (
          <div className="flex flex-col items-center gap-1">
            <Badge variant="outline" className={cn('text-[11px]', vch.statusColor ?? '')}>
              {vch.statusLabel ?? vch.status}
            </Badge>
            {receipt && (
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full', RETURN_RECEIPT_BADGE[receipt].tone)}>
                {RETURN_RECEIPT_BADGE[receipt].label}
              </span>
            )}
          </div>
        )
      },
    },
    {
      key: 'date', header: 'التاريخ', align: 'center' as const, width: 'w-28', hideInCard: true,
      render: (vch: any) => <span className="text-xs tnum">{fmtDate(vch.createdAt)}</span>,
    },
    {
      key: 'route', header: 'المسار', width: 'w-40',
      render: (vch: any) => {
        const src = vch.sourceBranch?.name ?? '—'
        const dst = vch.destBranch?.name
        if (!dst || dst === src) return <span className="text-xs truncate-1 block">{src}</span>
        return (
          <span className="text-xs truncate-1 block">
            {src} <span className="text-muted-foreground">←</span> {dst}
          </span>
        )
      },
    },
    {
      key: 'party', header: 'الطرف/الموظف', width: 'w-36',
      render: (vch: any) => (
        <span className="text-xs font-medium truncate-1 block">
          {vch.party?.name || vch.courier?.name || vch.employee?.name || '—'}
        </span>
      ),
    },
    {
      key: 'items', header: 'الشحنات', align: 'center' as const, width: 'w-20',
      render: (vch: any) => (
        <Badge variant="outline" className="text-[11px] tnum">{vch.itemCount ?? 0} شحنة</Badge>
      ),
    },
    // عمود القيمة المالية — يُعرض فقط لمن يملك صلاحية الأسعار
    ...(canPrices ? [{
      key: 'total', header: 'القيمة', align: 'left' as const, width: 'w-28',
      render: (vch: any) => <span className="tnum text-xs font-bold">{fmtNum(vch.totalValue ?? 0)} ج.م</span>,
    }] : []),
    {
      key: 'actions', header: 'إجراءات', align: 'center' as const, width: 'w-28',
      render: (vch: any) => (
        <div className="flex items-center justify-center gap-0.5">
          {has('vouchers.print') && (
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setPrintVoucher(vch) }} title="طباعة الإذن" aria-label={`طباعة ${vch.voucherNo}`}>
              <Printer className="size-3.5" />
            </Button>
          )}
          {/* إلغاء السند المالي المكتمل بالقيد العكسي — للأذونات المالية فقط (يُفرض على الخادم) */}
          {has('vouchers.approve') && vch.status === 'completed' && voucherTypeDef(vch.type)?.isFinancial && (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={(e) => { e.stopPropagation(); cancelCompletedFinancial(vch.id, vch.voucherNo) }} title="إلغاء بالقيد العكسي" aria-label={`إلغاء ${vch.voucherNo} بالقيد العكسي`}>
              <Undo2 className="size-3.5" />
            </Button>
          )}
          {has('vouchers.delete') && ['draft', 'cancelled'].includes(vch.status) && (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={(e) => { e.stopPropagation(); del(vch.id, vch.voucherNo) }} title="حذف الإذن" aria-label={`حذف ${vch.voucherNo}`}>
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      ),
    },
  ]

  // =========================================================================
  // Render helpers
  // =========================================================================
  const stats = statsData ?? {
    total: 0, pendingApproval: 0, completed: 0, draft: 0, inProgress: 0,
    collectionTotal: 0, disbursementTotal: 0, shipmentsLinked: 0,
  }

  // by-category distribution badges
  const categoryCounts = React.useMemo(() => {
    const counts: Record<string, number> = { operational: 0, financial: 0, inventory: 0, special: 0 }
    if (statsData?.byType) {
      for (const t of VOUCHER_TYPES) {
        const c = counts[t.category] ?? 0
        counts[t.category] = c + (statsData.byType[t.code] ?? 0)
      }
    }
    return counts
  }, [statsData])

  // Action buttons per status in detail dialog
  const renderDetailActions = (status: string) => {
    const buttons: { label: string; action?: string; perm: string; variant?: 'default' | 'outline' | 'destructive' | 'secondary'; onClick?: () => void; icon?: React.ReactNode }[] = []
    switch (status) {
      case 'draft':
        if (has('vouchers.submit')) buttons.push({ label: 'رفع للاعتماد', action: 'submit', perm: 'vouchers.submit' })
        if (has('vouchers.edit')) buttons.push({ label: 'تعديل', perm: 'vouchers.edit', variant: 'secondary', onClick: () => { setEditId(detailData.id); } })
        if (has('vouchers.delete')) buttons.push({ label: 'حذف', perm: 'vouchers.delete', variant: 'destructive', onClick: () => del(detailData.id, detailData.voucherNo) })
        break
      case 'pending':
        if (has('vouchers.approve')) buttons.push({ label: 'اعتماد', action: 'approve', perm: 'vouchers.approve' })
        if (has('vouchers.reject')) buttons.push({ label: 'رفض', action: 'reject', perm: 'vouchers.reject', variant: 'destructive' })
        if (has('vouchers.cancel')) buttons.push({ label: 'إلغاء', action: 'cancel', perm: 'vouchers.cancel', variant: 'secondary' })
        break
      case 'approved':
        if (has('vouchers.execute')) buttons.push({ label: 'بدء التنفيذ', action: 'execute', perm: 'vouchers.execute' })
        if (has('vouchers.cancel')) buttons.push({ label: 'إلغاء', action: 'cancel', perm: 'vouchers.cancel', variant: 'secondary' })
        break
      case 'in_progress':
        if (has('vouchers.execute')) buttons.push({ label: 'إكمال', action: 'complete', perm: 'vouchers.execute' })
        if (has('vouchers.cancel')) buttons.push({ label: 'إلغاء', action: 'cancel', perm: 'vouchers.cancel', variant: 'secondary' })
        break
      case 'rejected':
        if (has('vouchers.edit')) buttons.push({ label: 'إعادة كمسودة', action: 'resubmit', perm: 'vouchers.edit', variant: 'secondary' })
        break
      case 'cancelled':
        if (has('vouchers.delete')) buttons.push({ label: 'حذف', perm: 'vouchers.delete', variant: 'destructive', onClick: () => del(detailData.id, detailData.voucherNo) })
        break
      case 'completed':
        // إذن المرتجع المكتمل — يُمكن تسليمه (إنشاء إذن استلام مرتجعات تلقائيًا)
        // فقط إذا كانت هناك شحنات لا تزال بحالة "returned" (لم تُستلم بعد)
        if (detailData?.type === 'return' && has('vouchers.execute')) {
          const hasPending = (detailData.items ?? []).some((it: any) => it.shipment?.status === 'returned')
          if (hasPending) {
            buttons.push({ label: 'تم التسليم', perm: 'vouchers.execute', variant: 'default', onClick: () => markReceived(detailData.id) })
          }
        }
        // إلغاء السند المالي المكتمل بالقيد العكسي — للأذونات المالية فقط (يُفرض على الخادم)
        if (voucherTypeDef(detailData?.type)?.isFinancial && has('vouchers.approve')) {
          buttons.push({
            label: 'إلغاء بالقيد العكسي',
            action: 'cancel',
            perm: 'vouchers.approve',
            variant: 'destructive',
            icon: <Undo2 className="size-3.5" />,
            onClick: () => cancelCompletedFinancial(detailData.id, detailData.voucherNo),
          })
        }
        break
    }
    return buttons
  }

  // =========================================================================
  // JSX
  // =========================================================================
  return (
    <div className="space-y-4">
      {/* ==== Stats dashboard row ==== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {statsLoading ? (
          Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-16" />)
        ) : (
          <>
            <StatCard icon={<Landmark className="size-4.5" />} color="slate" value={fmtNum(stats.total)} label="إجمالي الأذونات" />
            <StatCard icon={<Clock className="size-4.5" />} color="amber" value={fmtNum(stats.pendingApproval)} label="بانتظار الاعتماد" />
            <StatCard icon={<CheckCircle2 className="size-4.5" />} color="emerald" value={fmtNum(stats.completed)} label="مكتملة" />
            <StatCard icon={<FileText className="size-4.5" />} color="slate" value={fmtNum(stats.draft)} label="مسودات" />
            <StatCard icon={<Loader2 className="size-4.5" />} color="indigo" value={fmtNum(stats.inProgress)} label="قيد التنفيذ" />
            {/* بطاقتا المحصّلات/المصروفات مكشوفتان فقط لمن يملك صلاحية الأسعار */}
            {canPrices ? (
              <>
                <StatCard icon={<Banknote className="size-4.5" />} color="emerald" value={`${fmtNum(stats.collectionTotal)} ج.م`} label="محصّلات" />
                <StatCard icon={<BanknoteArrowDown className="size-4.5" />} color="rose" value={`${fmtNum(stats.disbursementTotal)} ج.م`} label="مصروفات" />
              </>
            ) : (
              <>
                <StatCard icon={<FileText className="size-4.5" />} color="orange" value={fmtNum(stats.rejected)} label="مرفوضة" />
                <StatCard icon={<FileText className="size-4.5" />} color="rose" value={fmtNum(stats.cancelled)} label="ملغاة" />
              </>
            )}
            <StatCard icon={<Link2 className="size-4.5" />} color="sky" value={fmtNum(stats.shipmentsLinked)} label="شحنات مرتبطة" />
          </>
        )}
      </div>

      {/* ==== By-category distribution ==== */}
      <div className="flex items-center gap-1.5 flex-wrap text-[11px] print:hidden">
        <span className="text-muted-foreground ml-1">التوزيع حسب الفئة:</span>
        {VOUCHER_CATEGORIES.map((cat) => (
          <Badge key={cat.key} variant="outline" className={cn('text-[10px]', cat.color)}>
            {cat.label} · {fmtNum(categoryCounts[cat.key] ?? 0)}
          </Badge>
        ))}
      </div>

      {/* ==== Filter bar ==== */}
      <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
        {/* Counter + filters — تلتف على الموبايل، سطر واحد على الديسكتوب */}
        <div className="flex items-center gap-3 min-w-0 flex-1 flex-wrap lg:flex-nowrap lg:overflow-x-auto">
          {/* Counter — own bordered pill, clearly separated */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/40 border border-border shrink-0">
            <Landmark className="size-4 text-primary" />
            <span className="text-sm font-semibold tnum whitespace-nowrap">{items.length} إذن معروض</span>
          </div>
          {/* Vertical divider */}
          <div className="w-px h-7 bg-border shrink-0" />
          {/* Filters group */}
          <div className="flex items-center gap-2 shrink-0">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-36 sm:w-44 h-8 min-w-0"><SelectValue placeholder="الكل" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأنواع</SelectItem>
                {VOUCHER_CATEGORIES.map((cat) => (
                  <SelectGroup key={cat.key}>
                    <SelectLabel className={cn('text-[10px]', cat.color)}>{cat.label}</SelectLabel>
                    {(typesByCategory[cat.key] ?? []).map((t) => (
                      <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32 sm:w-36 h-8 min-w-0"><SelectValue placeholder="كل الحالات" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                {VOUCHER_STATES.map((s) => (
                  <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Date range — labels are sibling spans OUTSIDE the inputs (never overlaid).
                dir="ltr" keeps the native calendar picker on the conventional side and
                prevents RTL from flipping it over the date numbers. */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">من</span>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-36 h-8 px-2 text-xs"
                dir="ltr"
                aria-label="من تاريخ"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">إلى</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-36 h-8 px-2 text-xs"
                dir="ltr"
                aria-label="إلى تاريخ"
              />
            </div>
            {(typeFilter !== 'all' || statusFilter !== 'all' || from || to) && (
              <Button variant="ghost" size="sm" onClick={() => { setTypeFilter('all'); setStatusFilter('all'); setFrom(''); setTo('') }} className="h-8 text-xs shrink-0">
                <X className="size-3.5" /> مسح
              </Button>
            )}
          </div>
        </div>
        {/* RTL left: actions */}
        <div className="flex gap-2 shrink-0">
          {has('vouchers.export') && (
            <Button variant="outline" size="sm" onClick={exportVouchers} disabled={!items?.length} className="shrink-0">
              <FileSpreadsheet className="size-4" /> <span className="hidden sm:inline">تصدير</span>
            </Button>
          )}
          {has('vouchers.create') && (
            <Button onClick={() => setOpen(true)} size="sm" className="shrink-0">
              <Plus className="size-4" /> <span className="hidden sm:inline">إذن جديد</span><span className="sm:hidden">جديد</span>
            </Button>
          )}
        </div>
      </div>

      {/* ==== DataTable ==== */}
      <DataTable
        rows={items}
        columns={columns}
        loading={isLoading}
        getRowKey={(vch: any) => vch.id}
        minW={1100}
        resetKey={listUrl}
        onRowClick={(vch) => setDetailId(vch.id)}
        searchFn={(vch: any, q: string) =>
          (vch.voucherNo || '').toLowerCase().includes(q) ||
          (vch.party?.name || '').toLowerCase().includes(q) ||
          (vch.notes || '').toLowerCase().includes(q) ||
          (vch.typeLabel || '').toLowerCase().includes(q) ||
          (vch.courier?.name || '').toLowerCase().includes(q) ||
          (vch.employee?.name || '').toLowerCase().includes(q)
        }
        searchPlaceholder="بحث برقم الإذن/الطرف/البيان..."
      />

      {/* ==== Create dialog ==== */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>إذن جديد</DialogTitle>
            <DialogDescription>أنشئ إذنًا تشغيليًا أو ماليًا — يُحفظ كمسودة لحين رفعه للاعتماد.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {/* Type */}
            <div>
              <label className="text-xs font-medium">نوع الإذن *</label>
              <Select value={v.type} onValueChange={(val) => setV({ ...v, type: val, courierId: '', partyId: '', destBranchId: v.sourceBranchId || '', amount: '' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VOUCHER_CATEGORIES.map((cat) => {
                    // إخفاء الأذونات المالية عن غير المصرح لهم برؤية الأسعار
                    // (إنشاء سند قبض/صرف يستلزم رؤية المبالغ)
                    if (cat.key === 'financial' && !canPrices) return null
                    const opts = (typesByCategory[cat.key] ?? []).filter((t: any) => {
                      // أنواع مالية = فقط لمن يرى الأسعار
                      if (t.isFinancial && !canPrices) return false
                      return true
                    })
                    if (!opts.length) return null
                    return (
                      <SelectGroup key={cat.key}>
                        <SelectLabel className={cn('text-[10px]', cat.color)}>{cat.label}</SelectLabel>
                        {opts.map((t) => (
                          <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
                        ))}
                      </SelectGroup>
                    )
                  })}
                </SelectContent>
              </Select>
              {tdef && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  {tdef.labelEn} — بادئة: <b className="font-mono">{tdef.prefix}</b>
                </p>
              )}
            </div>

            {/* Conditional fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {tdef?.requiresEmployee && (
                <div>
                  <label className="text-xs font-medium">الموظف المسؤول *</label>
                  <Select value={v.employeeId} onValueChange={(val) => setV({ ...v, employeeId: val })}>
                    <SelectTrigger><SelectValue placeholder="اختر الموظف..." /></SelectTrigger>
                    <SelectContent>
                      {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} ({u.username})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {tdef?.requiresCourier && (
                <div>
                  <label className="text-xs font-medium">المندوب *</label>
                  <Select value={v.courierId} onValueChange={(val) => setV({ ...v, courierId: val })}>
                    <SelectTrigger><SelectValue placeholder="اختر المندوب..." /></SelectTrigger>
                    <SelectContent>
                      {parties.filter((p) => p.isContractor).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {tdef?.requiresParty && (
                <div>
                  <label className="text-xs font-medium">الطرف {tdef?.code === 'collection' ? '(العميل)' : tdef?.code === 'cash_disbursement' ? '(المقاول/المورد)' : '*'} </label>
                  <Select value={v.partyId} onValueChange={(val) => setV({ ...v, partyId: val })}>
                    <SelectTrigger><SelectValue placeholder="اختر الطرف..." /></SelectTrigger>
                    <SelectContent>
                      {(tdef?.code === 'collection' ? parties.filter((p) => p.isCustomer) : parties).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <label className="text-xs font-medium">الفرع المصدر *</label>
                <Select value={v.sourceBranchId} onValueChange={(val) => setV({ ...v, sourceBranchId: val, destBranchId: v.destBranchId || val })}>
                  <SelectTrigger><SelectValue placeholder="اختر الفرع..." /></SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {tdef?.requiresDestBranch && (
                <div>
                  <label className="text-xs font-medium">فرع الاستلام *</label>
                  <Select value={v.destBranchId} onValueChange={(val) => setV({ ...v, destBranchId: val })}>
                    <SelectTrigger><SelectValue placeholder="اختر فرع الاستلام..." /></SelectTrigger>
                    <SelectContent>
                      {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {tdef?.isFinancial && canPrices && (
                <>
                  <div>
                    <label className="text-xs font-medium">المبلغ (ج.م) *</label>
                    <Input type="number" min="0" step="0.01" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium">الحساب</label>
                    <Input value={v.accountName} onChange={(e) => setV({ ...v, accountName: e.target.value })} />
                  </div>
                </>
              )}
            </div>

            {/* Shipment picker */}
            {tdef?.requiresShipments && (
              <div className="border border-border rounded-lg p-3 bg-muted/20">
                <div className="text-xs font-bold mb-2 flex items-center gap-1.5">
                  <PackageCheck className="size-3.5" /> الشحنات المرتبطة
                </div>
                <ShipmentPicker
                  preStatuses={tdef.preStatuses}
                  excludeIds={addedShipments.map((s) => s.id)}
                  onAdd={(s) => setAddedShipments((arr) => [...arr, s])}
                  onRemove={(id) => setAddedShipments((arr) => arr.filter((s) => s.id !== id))}
                  selected={addedShipments}
                  emptyHint="ابحث وأضف الشحنات لهذا الإذن..."
                  canPrices={canPrices}
                />
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="text-xs font-medium">ملاحظات</label>
              <Textarea rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} placeholder="بيان/ملاحظات الإذن..." />
            </div>

            {err && <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</div>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin mr-1" /> : null}
              {loading ? 'جاري...' : 'حفظ كمسودة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==== Edit dialog ==== */}
      <Dialog open={!!editId} onOpenChange={(o) => !o && setEditId(null)}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تعديل الإذن — {editTdef?.label ?? ''}</DialogTitle>
            <DialogDescription>متاح فقط للمسودات والمرفوضة. لا يمكن تغيير نوع الإذن أو الشحنات إلا بإعادة الإنشاء.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {editTdef?.requiresEmployee && (
                <div>
                  <label className="text-xs font-medium">الموظف *</label>
                  <Select value={ev.employeeId ?? ''} onValueChange={(val) => setEv({ ...ev, employeeId: val })}>
                    <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                    <SelectContent>
                      {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {editTdef?.requiresCourier && (
                <div>
                  <label className="text-xs font-medium">المندوب *</label>
                  <Select value={ev.courierId ?? ''} onValueChange={(val) => setEv({ ...ev, courierId: val })}>
                    <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                    <SelectContent>
                      {parties.filter((p) => p.isContractor).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {editTdef?.requiresParty && (
                <div>
                  <label className="text-xs font-medium">الطرف *</label>
                  <Select value={ev.partyId ?? ''} onValueChange={(val) => setEv({ ...ev, partyId: val })}>
                    <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                    <SelectContent>
                      {(editTdef?.code === 'collection' ? parties.filter((p) => p.isCustomer) : parties).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <label className="text-xs font-medium">الفرع المصدر</label>
                <Select value={ev.sourceBranchId ?? ''} onValueChange={(val) => setEv({ ...ev, sourceBranchId: val })}>
                  <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {editTdef?.requiresDestBranch && (
                <div>
                  <label className="text-xs font-medium">فرع الاستلام</label>
                  <Select value={ev.destBranchId ?? ''} onValueChange={(val) => setEv({ ...ev, destBranchId: val })}>
                    <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                    <SelectContent>
                      {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {editTdef?.isFinancial && canPrices && (
                <>
                  <div>
                    <label className="text-xs font-medium">المبلغ (ج.م) *</label>
                    <Input type="number" min="0" step="0.01" value={ev.amount ?? ''} onChange={(e) => setEv({ ...ev, amount: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium">الحساب</label>
                    <Input value={ev.accountName ?? ''} onChange={(e) => setEv({ ...ev, accountName: e.target.value })} />
                  </div>
                </>
              )}
            </div>
            <div>
              <label className="text-xs font-medium">ملاحظات</label>
              <Textarea rows={2} value={ev.notes ?? ''} onChange={(e) => setEv({ ...ev, notes: e.target.value })} />
            </div>
            {eErr && <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{eErr}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditId(null)}>إلغاء</Button>
            <Button onClick={editSubmit} disabled={eLoading}>
              {eLoading ? <Loader2 className="size-4 animate-spin mr-1" /> : null}
              {eLoading ? 'جاري...' : 'حفظ التعديل'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==== Detail dialog ==== */}
      <Dialog open={!!detailId} onOpenChange={(o) => { if (!o) { setDetailId(null); setActionNotes(''); setDetailAdded([]) } }}>
        <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-y-auto">
          {detailData ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono">{detailData.voucherNo}</span>
                  <Badge variant="outline" className={cn('text-[11px]', detailData.typeColor ?? '')}>{detailData.typeLabel ?? detailData.type}</Badge>
                  <Badge variant="outline" className={cn('text-[11px]', detailData.statusColor ?? '')}>{detailData.statusLabel ?? detailData.status}</Badge>
                  {/* شارة حالة استلام المرتجعات — محسوبة من حالة شحنات الإذن (نفس منطق القائمة) */}
                  {(() => {
                    const receipt = returnReceiptState(detailData)
                    if (!receipt) return null
                    const total = (detailData.items ?? []).length
                    const received = (detailData.items ?? []).filter((it: any) => it.shipment?.status === 'received_returned').length
                    if (receipt === 'pending') {
                      return (
                        <Badge variant="outline" className="text-[11px] bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                          لم يُستلم بعد · {total} شحنة{detailData.courier?.name ? ` — مع ${detailData.courier.name}` : ''}
                        </Badge>
                      )
                    }
                    if (receipt === 'partial') {
                      return (
                        <Badge variant="outline" className="text-[11px] bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                          استلام جزئي · {received}/{total} شحنة
                        </Badge>
                      )
                    }
                    return (
                      <Badge variant="outline" className="text-[11px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        تم التسليم · {total} شحنة
                      </Badge>
                    )
                  })()}
                </DialogTitle>
                <DialogDescription>{detailData.typeLabelEn}</DialogDescription>
              </DialogHeader>

              <div className="space-y-3 min-w-0">
                {/* Info grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                  <DetailItem label="التاريخ" value={fmtDateTime(detailData.createdAt)} />
                  <DetailItem label="آخر تحديث" value={fmtDateTime(detailData.updatedAt)} />
                  <DetailItem label="أنشأه" value={detailData.createdByName ?? '—'} />
                  <DetailItem label="الموظف" value={detailData.employee?.name ?? '—'} />
                  <DetailItem label="المندوب" value={detailData.courier?.name ?? '—'} />
                  <DetailItem label="الطرف" value={detailData.party?.name ?? '—'} />
                  <DetailItem label="الفرع المصدر" value={detailData.sourceBranch?.name ?? '—'} />
                  <DetailItem label="فرع الاستلام" value={detailData.destBranch?.name ?? '—'} />
                  {/* الحساب والقيمة المالية — فقط لمن يملك صلاحية الأسعار */}
                  {canPrices && <DetailItem label="الحساب" value={detailData.accountName ?? '—'} />}
                  {canPrices && <DetailItem label="القيمة" value={`${fmtNum(detailData.totalValue ?? 0)} ج.م`} />}
                  <DetailItem label="القيد" value={detailData.journalEntryNo ?? '—'} mono />
                  <DetailItem label="عدد الشحنات" value={`${detailData.itemCount ?? 0}`} />
                </div>

                {/* Notes */}
                {detailData.notes && (
                  <div className="border border-border rounded-md p-2.5 bg-muted/20">
                    <div className="text-[10px] font-bold text-muted-foreground mb-0.5">ملاحظات</div>
                    <div className="text-sm whitespace-pre-wrap">{detailData.notes}</div>
                  </div>
                )}

                <Separator />

                {/* Linked shipments table */}
                {detailData.requiresShipments && (
                  <div>
                    <div className="text-xs font-bold mb-1.5 flex items-center gap-1.5">
                      <PackageCheck className="size-3.5" /> الشحنات المرتبطة ({detailData.itemCount ?? 0})
                    </div>
                    <div className="border border-border rounded-lg overflow-x-auto -mx-1 px-1">
                      <table className="w-full text-xs table-fixed" style={{ minWidth: canPrices ? 560 : 460 }}>
                        <colgroup>
                          <col className="w-[88px]" />
                          <col className="w-[92px]" />
                          <col className="w-[96px]" />
                          <col />
                          {canPrices && <col className="w-[92px]" />}
                          {detailData.status === 'draft' && has('vouchers.edit') && <col className="w-[40px]" />}
                        </colgroup>
                        <thead className="bg-muted/40 text-muted-foreground">
                          <tr>
                            <th className="font-medium px-2 py-2 text-right">رقم الشحنة</th>
                            <th className="font-medium px-2 py-2 text-center">الحالة</th>
                            <th className="font-medium px-2 py-2 text-right">الوجهة</th>
                            <th className="font-medium px-2 py-2 text-right">المستلم</th>
                            {canPrices && <th className="font-medium px-2 py-2 text-left">النولون</th>}
                            {detailData.status === 'draft' && has('vouchers.edit') && <th className="font-medium px-1 py-2"></th>}
                          </tr>
                        </thead>
                        <tbody>
                          {(detailData.items ?? []).map((it: any) => {
                            const s = it.shipment
                            const st = s?.status ? shipmentStatusMap[s.status] : null
                            return (
                              <tr key={it.id} className="border-t border-border align-middle">
                                <td className="px-2 py-2">
                                  <span className="block font-mono font-bold whitespace-nowrap" title={s?.shipmentNo ?? ''}>{s?.shipmentNo ?? '—'}</span>
                                </td>
                                <td className="px-2 py-2 text-center">
                                  {st ? (
                                    <Badge variant="outline" className={cn('text-[10px] whitespace-nowrap', st.tone)}>{st.label}</Badge>
                                  ) : <span className="text-muted-foreground">—</span>}
                                </td>
                                <td className="px-2 py-2">
                                  <span className="block truncate text-right" title={s?.destination ?? ''}>{s?.destination ?? '—'}</span>
                                </td>
                                <td className="px-2 py-2 max-w-[180px]">
                                  <span
                                    className="block truncate text-right"
                                    dir="auto"
                                    title={s?.recipientName ?? ''}
                                  >
                                    {s?.recipientName ?? '—'}
                                  </span>
                                </td>
                                {canPrices && <td className="px-2 py-2 text-left tnum whitespace-nowrap">{fmtNum(s?.freightTotal ?? 0)} ج.م</td>}
                                {detailData.status === 'draft' && has('vouchers.edit') && (
                                  <td className="px-1 py-2 text-center">
                                    <button onClick={() => removeItem(detailData.id, it.id)} className="text-destructive hover:text-destructive/80 p-1" aria-label="حذف الشحنة">
                                      <Trash2 className="size-3.5" />
                                    </button>
                                  </td>
                                )}
                              </tr>
                            )
                          })}
                          {(detailData.items ?? []).length === 0 && (
                            <tr>
                              <td colSpan={(detailData.status === 'draft' && has('vouchers.edit') ? 1 : 0) + 4 + (canPrices ? 1 : 0)} className="px-2 py-4 text-center text-muted-foreground">
                                لا توجد شحنات مرتبطة
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Inline add shipment (draft only) */}
                    {detailData.status === 'draft' && has('vouchers.edit') && (
                      <div className="mt-2 border border-dashed border-border rounded-md p-2.5 bg-muted/10">
                        <div className="text-[11px] font-bold mb-1.5">إضافة شحنة</div>
                        <ShipmentPicker
                          preStatuses={VOUCHER_TYPES.find((t) => t.code === detailData.type)?.preStatuses ?? null}
                          excludeIds={(detailData.items ?? []).map((it: any) => it.shipmentId)}
                          onAdd={(s) => addItem(detailData.id, s)}
                          onRemove={() => {}}
                          selected={[]}
                          emptyHint="ابحث وأضف الشحنات لهذا الإذن..."
                          canPrices={canPrices}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Approval log timeline */}
                {(detailData.approvalLog ?? []).length > 0 && (
                  <div>
                    <div className="text-xs font-bold mb-2">سجل الاعتماد</div>
                    <ol className="space-y-1.5 max-h-44 overflow-y-auto no-scrollbar">
                      {(detailData.approvalLog ?? []).map((l: any, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-xs">
                          <span className={cn('size-2 rounded-full mt-1 shrink-0', ACTION_DOT[l.action] ?? 'bg-slate-400')} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold">{ACTION_LABELS[l.action] ?? l.action}</span>
                              <span className="text-muted-foreground">{l.userName ?? '—'}</span>
                              <span className="text-muted-foreground">· {fmtDateTime(l.at)}</span>
                            </div>
                            {l.notes && <div className="text-muted-foreground text-[11px] mt-0.5">{l.notes}</div>}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                <Separator />

                {/* Action notes (for actions needing reason) */}
                {!['completed', 'cancelled'].includes(detailData.status) && renderDetailActions(detailData.status).some((b) => b.action) && (
                  <div>
                    <label className="text-xs font-medium">ملاحظة للإجراء (اختياري)</label>
                    <Input value={actionNotes} onChange={(e) => setActionNotes(e.target.value)} placeholder="سبب الرفض / الاعتماد..." className="h-8 text-xs" />
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  {renderDetailActions(detailData.status).map((b, i) => (
                    <Button
                      key={i}
                      size="sm"
                      variant={b.variant ?? 'default'}
                      disabled={actionLoading}
                      onClick={() => {
                        if (b.onClick) b.onClick()
                        else if (b.action) transition(detailData.id, b.action)
                      }}
                    >
                      {actionLoading && b.action ? <Loader2 className="size-3.5 animate-spin mr-1" /> : (b.icon ?? null)}
                      {b.label}
                    </Button>
                  ))}
                  {has('vouchers.print') && (
                    <Button size="sm" variant="outline" onClick={() => setPrintVoucher(detailData)}>
                      <Printer className="size-3.5" /> طباعة
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => { setDetailId(null); setActionNotes('') }}>
                    إغلاق
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="py-10 text-center">
              <Loader2 className="size-6 animate-spin mx-auto text-muted-foreground" />
              <p className="text-xs text-muted-foreground mt-2">جاري التحميل...</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ==== Print ==== */}
      <VoucherOpsPrint voucher={printVoucher} open={!!printVoucher} onOpenChange={(o) => !o && setPrintVoucher(null)} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
// خريطة ثابتة لألوان بطاقات الإحصائيات — لتجنّب Tailwind v4 dynamic class pitfalls
const STAT_COLORS: Record<string, string> = {
  slate: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
  amber: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  emerald: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  indigo: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
  rose: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300',
  sky: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
}

function StatCard({ icon, color, value, label }: { icon: React.ReactNode; color: string; value: string; label: string }) {
  return (
    <Card className="py-0 gap-0">
      <CardContent className="p-3.5 flex items-center gap-2.5">
        <div className={cn(
          'flex items-center justify-center size-9 rounded-lg shrink-0',
          STAT_COLORS[color] ?? STAT_COLORS.slate,
        )}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-xl font-extrabold tnum leading-none">{value}</div>
          <div className="text-[11px] text-muted-foreground mt-1 truncate-1">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function DetailItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border border-border rounded-md px-2.5 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn('text-xs font-medium truncate-1', mono && 'font-mono')}>{value}</div>
    </div>
  )
}
