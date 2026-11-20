'use client'

import * as React from 'react'
import useSWR from 'swr'
import { Plus, PackageSearch, Filter, X, Search, Printer, ArrowLeft, Trash2, FileSpreadsheet, CheckSquare, Layers, Banknote, Link2, Truck, Pencil, AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
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
import { WaybillPrint } from '../waybill-print'
import { DataTablePagination } from '../data-table-pagination'
import { fetcher } from '@/lib/api'
import { apiPostSync as apiPost, apiPatchSync as apiPatch, apiDeleteSync as apiDelete } from '@/lib/sync'
import { exportToCSV } from '@/lib/export'
import { fmtNum, fmtDate, fmtDateTime } from '@/lib/format'
import { useToast } from '@/hooks/use-toast'
import { useLookup } from '@/lib/lookups'
import { cn } from '@/lib/utils'
import { useAuth, useCanExtras, useCanPrices, useShipmentCols } from '../auth-provider'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { bus, BUS_EVENTS, consumeIntent } from '@/lib/bus'
// كتالوج آلة حالات الشحنة الصارمة — مصدر واحد للخادم والواجهة
import {
  SHIPMENT_STATUSES,
  allowedShipmentTransitions,
  canTransitionShipment,
  isShipmentStoppedNextDay,
  isTerminalShipmentStatus,
  shipmentStatusDef,
  shipmentStatusLabel,
} from '@/lib/shipment-catalog'

interface PartyLite { id: string; name: string }
interface Shipment {
  id: string; shipmentNo: string | null; billNo: string | null; deliveryNumber: string | null;
  policyQty: number | null; customerId: string | null; customer: PartyLite | null;
  contractorId: string | null; contractor: PartyLite | null;
  branchId: string | null; branch: PartyLite | null;
  recipientName: string | null; destination: string | null; destinationEn: string | null;
  routeCode: string | null; loadType: string | null;
  freightCost: number | null; freightTotal: number | null; salePrice: number | null;
  customerPay: number | null; totalSuppliers: number | null;
  aging: number | null; overnight: number | null; returns: number | null; transfer: number | null; drop: number | null;
  status: string; collectionStatus: string;
  // محسوبة على الخادم (مُبوَّبة وفق صلاحيات الأعمدة) — تعاد للصف حتى لو خُفيت حقولها الأصلية
  margin?: number | null; grand?: number | null;
  // قاعدة «بتقف تاني يوم» — يحسبها الخادم لكل صف (تاريخ أقدم من اليوم ولم تُحمّل)
  stopped?: boolean;
  date: string | null; date2: string | null; notes: string | null;
  ton15: number | null; ton3: number | null; m6: number | null;
}

interface ShipmentsTotals {
  shipments: number; pieces: number;
  notLoaded: number; loaded: number; stopped: number;
  mabeit: number; taateeq: number; postponed: number; returned: number; delivered: number;
  aging: number | null; overnight: number | null; transfer: number | null; drop: number | null;
  freight: number | null; suppliers: number | null; margin: number | null; grand: number | null;
}

interface ShipmentsResponse { items: Shipment[]; total: number; page: number; totalPages: number; totals?: ShipmentsTotals }

// قوائم الحقول القابلة للتعديل — متوافقة مع القائمة البيضاء على الخادم (PATCH /api/shipments/{id})
const SHIPMENT_EDIT_TEXT_FIELDS = [
  'billNo', 'recipientName', 'deliveryPhones', 'destination', 'destinationEn', 'routeCode',
  'loadType', 'customerId', 'contractorId', 'branchId', 'warehouseId', 'notes', 'vehicleNo', 'shipToParty',
] as const
const SHIPMENT_EDIT_NUM_FIELDS = [
  'freightCost', 'freightTotal', 'totalSuppliers', 'salePrice', 'customerPay',
  'aging', 'overnight', 'returns', 'transfer', 'other', 'drop', 'ton15', 'ton3', 'm6', 'policyQty',
] as const

// تاريخ اليوم بتوقيت الجهاز المحلي (بدل UTC) — يمنع انحراف الشحنة ليوم سابق في ساعات الصباح
// (toISOString كان يعطي يوم أمس لمن يسجل شحنة بعد منتصف الليل وقبل ٢ ص/٣ ص صيفًا)
function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// نموذج الإنشاء الفارغ — الحالة تُفرض دائمًا من الخادم (جديدة)
function emptyCreateForm(): any {
  return {
    deliveryNumber: '', recipientName: '', destination: '', loadType: '', customerId: '', contractorId: '',
    branchId: '', warehouseId: '', date: localDateStr(),
    freightCost: '', freightTotal: '', notes: '',
    salePrice: '', customerPay: '', aging: '', overnight: '', returns: '', transfer: '', other: '', drop: '', policyQty: '',
  }
}

export function ShipmentsModule() {
  const { toast } = useToast()
  const { has } = useAuth()
  // رؤية مستقلة لكل عمود في جدول الشحنات — يتحكم فيها المدير من شاشة الصلاحيات
  const cols = useShipmentCols()
  const { confirm: confirmDialog } = useConfirm()
  // Dynamic shipment status options from the lookup table
  const { items: statusItems } = useLookup('shipment_status')
  const STATUS_OPTIONS = statusItems.map((i) => ({ value: i.key, label: i.label, tone: i.tone }))
  const STATUS_LABEL: Record<string, { label: string; tone: string }> = Object.fromEntries(
    statusItems.map((i) => [i.key, { label: i.label, tone: i.tone || '' }]),
  )
  const [q, setQ] = React.useState('')
  const [status, setStatus] = React.useState<string>('all')
  const [destination, setDestination] = React.useState<string>('all')
  const [contractor, setContractor] = React.useState<string>('all')
  const [province, setProvince] = React.useState<string>('all')
  // فلاتر جدول الصباح: يوم محدد + الشحنات المتوقفة (بتقف تاني يوم)
  const [dateFilter, setDateFilter] = React.useState<string>('')
  const [stoppedOnly, setStoppedOnly] = React.useState<boolean>(false)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(10) // rows-per-page selectable from the unified pagination bar
  const [debouncedQ, setDebouncedQ] = React.useState('')
  const [showFilters, setShowFilters] = React.useState(false)
  const [addOpen, setAddOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<string | null>(null)
  // bulk selection + actions
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  // حالة كل شحنة محددة وقت التحديد — لحساب تقاطع الانتقالات المسموحة في التغيير الجماعي
  const [selectedStatuses, setSelectedStatuses] = React.useState<Map<string, string>>(new Map())
  const [bulkActionOpen, setBulkActionOpen] = React.useState<null | 'status' | 'assign'>(null)
  const [bulkStatus, setBulkStatus] = React.useState('')
  const [bulkContractor, setBulkContractor] = React.useState('')
  const [bulkNotes, setBulkNotes] = React.useState('')
  // waybill print target
  const [waybillShipment, setWaybillShipment] = React.useState<any>(null)
  // حماية من الضغط المكرر أثناء التنفيذ الجماعي (منع طلبات مزدوجة)
  const [bulkLoading, setBulkLoading] = React.useState(false)

  React.useEffect(() => { const t = setTimeout(() => { setDebouncedQ(q); setPage(1) }, 350); return () => clearTimeout(t) }, [q])

  // زر «تسجيل شحنة جديدة» السريع في الرئيسية — يفتح نافذة الإنشاء جاهزة مباشرة
  React.useEffect(() => {
    const open = () => { if (has('shipments.create')) setAddOpen(true) }
    if (consumeIntent() === BUS_EVENTS.OPEN_SHIPMENT_CREATE) open()
    return bus.on(BUS_EVENTS.OPEN_SHIPMENT_CREATE, open)
  }, [])

  const params = new URLSearchParams()
  if (debouncedQ) params.set('q', debouncedQ)
  if (status !== 'all') params.set('status', status)
  if (destination !== 'all') params.set('destination', destination)
  if (contractor !== 'all') params.set('contractor', contractor)
  if (province !== 'all') params.set('province', province)
  if (dateFilter) params.set('date', dateFilter)
  if (stoppedOnly) params.set('stopped', '1')
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))
  const { data, error, isLoading, mutate } = useSWR<ShipmentsResponse>(`/api/shipments?${params.toString()}`, fetcher, { keepPreviousData: true, refreshInterval: 30000 })
  const totals = data?.totals

  // Load filter options (destinations + contractors + provinces) — derive from stats endpoint
  const { data: stats } = useSWR<{ destinations: { name: string }[]; codings?: { name: string }[] }>('/api/stats', fetcher)
  const { data: contractorsRes } = useSWR<{ items: any[] }>('/api/parties?type=contractor', fetcher)
  const destinations = stats?.destinations.map((d) => d.name) ?? []
  const contractorsList = contractorsRes?.items ?? []
  // المحافظات تُشتق من كود الخط (routeCode) — أول كلمة منه — لأن الخادم يفلتر المحافظة على routeCode
  // (اشتقاقها من أول كلمة الوجهة كان ينتج فلاتر بلا نتائج: وجهات مثل «العبور» تتبع خط «القاهرة 1»)
  const provinces = React.useMemo(() => {
    const set = new Set<string>()
    for (const c of stats?.codings ?? []) {
      const first = String(c?.name ?? '').trim().split(/\s+/)[0]
      if (first && first !== '-') set.add(first)
    }
    return Array.from(set).sort()
  }, [stats])

  const hasFilters = debouncedQ || status !== 'all' || destination !== 'all' || contractor !== 'all' || province !== 'all' || !!dateFilter || stoppedOnly

  // عدد أعمدة جدول سطح المكتب (يُستخدم في colSpan للهياكل/الفراغ)
  // محسوب من رؤية الأعمدة الفعلية (cols.count يشمل عمود التحديد + كل الأعمدة الظاهرة)
  const colCount = cols.count

  // شريط الإجراءات: إعادة جدولة شحنة متوقفة (بتقف تاني يوم) لليوم — تفرخ تحميلها
  const [reschedulingId, setReschedulingId] = React.useState<string | null>(null)
  const reschedule = async (id: string) => {
    const ok = await confirmDialog({
      title: 'إعادة جدولة الشحنة لليوم',
      message: 'هيتم تحديث تاريخ الشحنة لليوم وإلغاء الإيقاف (بتقف تاني يوم) — وبكدا تتسمح بالتحميل النهارده. متابعة؟',
      variant: 'primary',
      confirmText: 'جدولة لليوم',
    })
    if (!ok) return
    setReschedulingId(id)
    try {
      await apiPost(`/api/shipments/${id}/reschedule`, {})
      toast({ title: 'تمت إعادة الجدولة لليوم — الشحنة مسموح تحميلها' })
      mutate()
    } catch (e: any) {
      toast({ title: 'تعذّرت إعادة الجدولة', description: e.message, variant: 'destructive' })
    } finally { setReschedulingId(null) }
  }

  // ---- bulk selection helpers ----
  const pageItems = data?.items ?? []
  const pageIds = pageItems.map((s) => s.id)
  const allOnPageSelected = pageItems.length > 0 && pageIds.every((id) => selectedIds.has(id))
  const someSelected = pageIds.some((id) => selectedIds.has(id))
  const toggleAll = () => {
    if (allOnPageSelected) {
      setSelectedIds((prev) => { const next = new Set(prev); for (const id of pageIds) next.delete(id); return next })
      setSelectedStatuses((prev) => { const next = new Map(prev); for (const id of pageIds) next.delete(id); return next })
    } else {
      setSelectedIds((prev) => { const next = new Set(prev); for (const id of pageIds) next.add(id); return next })
      setSelectedStatuses((prev) => { const next = new Map(prev); for (const s of pageItems) next.set(s.id, s.status); return next })
    }
  }
  const toggleOne = (id: string, status?: string) => {
    if (selectedIds.has(id)) {
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next })
      setSelectedStatuses((prev) => { const next = new Map(prev); next.delete(id); return next })
    } else {
      setSelectedIds((prev) => { const next = new Set(prev); next.add(id); return next })
      if (status) setSelectedStatuses((prev) => { const next = new Map(prev); next.set(id, status); return next })
    }
  }
  const clearSelection = () => { setSelectedIds(new Set()); setSelectedStatuses(new Map()) }

  // الانتقالات المسموحة المشتركة بين كل الشحنات المحددة (تقاطع آلة الحالات الصارمة)
  const bulkAllowedOptions = React.useMemo(() => {
    if (bulkActionOpen !== 'status' || selectedIds.size === 0) return []
    const ids = Array.from(selectedIds)
    return SHIPMENT_STATUSES.filter((s) => ids.every((id) => canTransitionShipment(selectedStatuses.get(id), s.key)))
  }, [bulkActionOpen, selectedIds, selectedStatuses])
  // تقاطع فارغ = لا يمكن تطبيق انتقال موحّد على التحديد الحالي
  const bulkBlocked = bulkActionOpen === 'status' && selectedIds.size > 0 && bulkAllowedOptions.length === 0

  const runBulkStatus = async () => {
    if (!bulkStatus || selectedIds.size === 0 || bulkBlocked) return
    // تأكيد قبل التغيير الجماعي للحالة — تشغيلية جوهرية (primary)
    const targetLabel = STATUS_LABEL[bulkStatus]?.label ?? shipmentStatusLabel(bulkStatus)
    const ok = await confirmDialog({
      title: 'تغيير حالة الشحنات المحددة',
      message: `سيتم تغيير حالة ${selectedIds.size} شحنة إلى «${targetLabel}». هل تريد المتابعة؟`,
      variant: 'primary',
      confirmText: 'تغيير الحالة',
    })
    if (!ok) return
    if (bulkLoading) return
    setBulkLoading(true)
    const ids = Array.from(selectedIds)
    try {
      // الخادم يفرض آلة الحالات لكل شحنة ويعيد نتيجة لكل معرف
      const res = await apiPost('/api/shipments/bulk/status', { ids, status: bulkStatus, notes: bulkNotes })
      const total = Number(res?.total ?? ids.length)
      const count = Number(res?.count ?? 0)
      const failures = (Array.isArray(res?.results) ? res.results : []).filter((r: any) => !r?.ok)
      toast({
        title: `نجح ${fmtNum(count)} من ${fmtNum(total)}`,
        description: failures.length ? failures.slice(0, 2).map((f: any) => f.reason).filter(Boolean).join(' • ') : undefined,
        variant: count === 0 ? 'destructive' : 'default',
      })
      setBulkActionOpen(null); setBulkStatus(''); setBulkNotes('')
      if (failures.length) {
        // إبقاء الشحنات التي فشلت محددة لإعادة المحاولة بحالة أخرى
        const failedIds: string[] = failures.map((f: any) => f.id)
        setSelectedIds(new Set(failedIds))
        setSelectedStatuses((prev) => {
          const next = new Map<string, string>()
          for (const fid of failedIds) { const st = prev.get(fid); if (st) next.set(fid, st) }
          return next
        })
      } else clearSelection()
      mutate()
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
    finally { setBulkLoading(false) }
  }

  const runBulkAssign = async () => {
    if (!bulkContractor || selectedIds.size === 0 || bulkLoading) return
    setBulkLoading(true)
    const ids = Array.from(selectedIds)
    try {
      const res = await apiPost('/api/shipments/bulk/assign', { ids, contractorId: bulkContractor })
      toast({ title: `تم إسناد ${fmtNum(res?.count ?? ids.length)} من ${fmtNum(res?.total ?? ids.length)} شحنة للمقاول` })
      setBulkActionOpen(null); setBulkContractor(''); clearSelection(); mutate()
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
    finally { setBulkLoading(false) }
  }

  // ---- export to CSV ----
  const exportShipments = () => {
    if (!pageItems.length) {
      toast({ title: 'لا توجد بيانات للتصدير' })
      return
    }
    // كل عمود يُصدّر فقط إذا كان ظاهرًا للمستخدم (cols) — ضمان عدم تسرّب نولون العميل لمن لا يراه
    const rows = pageItems.map((s) => {
      const r: Record<string, any> = {}
      if (cols.shipmentNo) {
        r['رقم الشحنة'] = s.shipmentNo
        r['رقم البوليصة'] = s.billNo
      }
      if (cols.customer) {
        r['العميل'] = s.customer?.name || s.recipientName
        r['المستلم'] = s.recipientName
      }
      if (cols.destination) {
        r['الوجهة'] = s.destination
        r['الوجهة EN'] = s.destinationEn
        r['كود الخط'] = s.routeCode
      }
      if (cols.pieces) r['الكمية (سياسات)'] = s.policyQty
      if (cols.loadType) r['النوع'] = s.loadType
      if (cols.contractor) r['المقاول'] = s.contractor?.name
      r['الفرع'] = s.branch?.name // الفرع دائمًا — معلومة لوجستية غير مالية
      if (cols.date) r['تاريخ الشحن'] = s.date ? fmtDate(s.date) : ''
      if (cols.status) r['الحالة'] = STATUS_LABEL[s.status]?.label || s.status
      // المبالغ — صلاحية العمود + prices.view
      if (cols.freight) r['نولون العميل'] = s.freightTotal ?? s.freightCost
      if (cols.suppliers) r['نولون المقاول'] = s.totalSuppliers ?? 0
      if (cols.margin) r['هامش الربح'] = s.margin ?? ((s.freightTotal ?? 0) - (s.totalSuppliers ?? 0))
      // بنود النقلة الإضافية — صلاحية العمود + extras.view
      if (cols.aging) r['تعتيق'] = s.aging
      if (cols.overnight) r['مبيت'] = s.overnight
      if (cols.transfer) r['تحويلة'] = s.transfer
      if (cols.drop) r['دروب'] = s.drop
      return r
    })
    exportToCSV(rows, `shipments-${localDateStr()}.csv`)
    toast({ title: `تم تصدير ${rows.length} شحنة` })
  }

  if (selected) return <ShipmentDetail id={selected} onBack={() => setSelected(null)} onChanged={() => mutate()} />

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2 print:hidden">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground shrink-0" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث برقم الشحنة/العميل/الوجهة/الهاتف..." className="pr-9 min-w-0" />
          {q && <button onClick={() => setQ('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground shrink-0"><X className="size-4" /></button>}
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant={showFilters ? 'default' : 'outline'} onClick={() => setShowFilters((v) => !v)} className="flex-1 sm:flex-none min-h-[40px]">
            <Filter className="size-4" /> تصفية
          </Button>
          {has('shipments.export') && (
            <Button variant="outline" onClick={exportShipments} className="flex-1 sm:flex-none min-h-[40px]" disabled={!pageItems.length}>
              <FileSpreadsheet className="size-4" /> <span className="hidden sm:inline">تصدير</span>
            </Button>
          )}
          <Button onClick={() => setAddOpen(true)} className="flex-1 sm:flex-none min-h-[40px]">
            <Plus className="size-4" /> <span className="hidden sm:inline">شحنة جديدة</span><span className="sm:hidden">جديد</span>
          </Button>
        </div>
      </div>

      {/* خطأ التحميل — يميّز فشل الشبكة عن غياب البيانات (كان يظهر كأنه «لا توجد شحنات») */}
      {error && !data && (
        <Card className="border-destructive/40 bg-destructive/5 print:hidden">
          <CardContent className="p-4 flex flex-wrap items-center gap-3">
            <AlertTriangle className="size-5 text-destructive shrink-0" />
            <div className="flex-1 min-w-[200px] text-sm">
              <b>تعذّر تحميل الشحنات.</b>{error?.message ? ` (${error.message})` : ''} تأكد من الاتصال ثم أعد المحاولة.
            </div>
            <Button variant="outline" size="sm" onClick={() => mutate()} className="min-h-[40px]">إعادة المحاولة</Button>
          </CardContent>
        </Card>
      )}

      {/* Bulk selection action bar */}
      {selectedIds.size > 0 && (
        <Card className="border-primary/40 bg-primary/5 print:hidden">
          <CardContent className="p-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium tnum">{selectedIds.size} شحنة محددة</span>
            <Button variant="ghost" size="sm" onClick={clearSelection} className="text-muted-foreground"><X className="size-3.5" /> إلغاء التحديد</Button>
            <div className="flex-1" />
            {has('shipments.status') && (
              <Button variant="outline" size="sm" className="min-h-[40px]" onClick={() => {
                // تحديث الحالات المحفوظة من آخر استجابة — منع حساب التقاطع من لقطة قديمة (تحديث تلقائي كل 30 ثانية)
                setSelectedStatuses((prev) => { const next = new Map(prev); for (const it of pageItems) if (next.has(it.id)) next.set(it.id, it.status); return next })
                setBulkStatus(''); setBulkActionOpen('status')
              }}>
                <CheckSquare className="size-3.5" /> تغيير الحالة دفعة
              </Button>
            )}
            {has('shipments.assign') && (
              <Button variant="outline" size="sm" className="min-h-[40px]" onClick={() => { setBulkContractor(''); setBulkActionOpen('assign') }}>
                <Truck className="size-3.5" /> إسناد لمقاول
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {showFilters && (
        <Card className="print:hidden">
          <CardContent className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
              <SelectTrigger><SelectValue placeholder="الحالة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={destination} onValueChange={(v) => { setDestination(v); setPage(1) }}>
              <SelectTrigger><SelectValue placeholder="الوجهة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الوجهات</SelectItem>
                {destinations.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={contractor} onValueChange={(v) => { setContractor(v); setPage(1) }}>
              <SelectTrigger><SelectValue placeholder="المقاول" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المقاولين</SelectItem>
                {contractorsList.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={province} onValueChange={(v) => { setProvince(v); setPage(1) }}>
              <SelectTrigger><SelectValue placeholder="المحافظة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المحافظات</SelectItem>
                {provinces.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">جدول يوم محدد</label>
              <Input type="date" value={dateFilter} onChange={(e) => { setDateFilter(e.target.value); setPage(1) }} className="min-h-[40px]" />
            </div>
            <label className="flex items-center gap-2 text-sm rounded-md border border-border px-3 h-10 cursor-pointer hover:bg-muted/40 self-end">
              <input type="checkbox" checked={stoppedOnly} onChange={(e) => { setStoppedOnly(e.target.checked); setPage(1) }} className="size-4 accent-[hsl(var(--primary))]" />
              <span className="font-medium text-xs">المتوقفة فقط (بتقف تاني يوم)</span>
            </label>
            {hasFilters && <Button variant="ghost" onClick={() => { setQ(''); setStatus('all'); setDestination('all'); setContractor('all'); setProvince('all'); setDateFilter(''); setStoppedOnly(false); setPage(1) }} className="sm:col-span-2 lg:col-span-4 justify-start"><X className="size-4" /> مسح المرشحات</Button>}
          </CardContent>
        </Card>
      )}

      {/* شريط جدول الصباح — إحصاءات الحالة اليومية + الإجمالي النقلة */}
      {totals && (
        <div className="rounded-2xl border border-border bg-card elev-sm px-3 py-2.5 print:hidden">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            <span className="font-bold text-foreground">جدول الصباح:</span>
            <span className="tnum">الشحنات: <b className="text-foreground">{fmtNum(totals.shipments)}</b></span>
            {cols.pieces && <span className="tnum">القطع: <b className="text-foreground">{fmtNum(totals.pieces)}</b></span>}
            {cols.status && <>
              <span className="text-emerald-700 tnum dark:text-emerald-400">محمّلة: <b>{fmtNum(totals.loaded)}</b></span>
              <span className="text-amber-700 tnum dark:text-amber-400">مش محمّلة: <b>{fmtNum(totals.notLoaded)}</b></span>
              {totals.stopped > 0 && <button onClick={() => { setStoppedOnly(true); setPage(1) }} className="text-rose-700 tnum underline decoration-dotted underline-offset-2 dark:text-rose-400 hover:no-underline">متوقفة (بتقف تاني يوم): <b>{fmtNum(totals.stopped)}</b></button>}
              {totals.mabeit > 0 && <button onClick={() => { setStatus('mabeit'); setPage(1) }} className="text-amber-700 tnum underline decoration-dotted underline-offset-2 dark:text-amber-400 hover:no-underline">مبيت: <b>{fmtNum(totals.mabeit)}</b></button>}
              {totals.taateeq > 0 && <button onClick={() => { setStatus('taateeq'); setPage(1) }} className="text-sky-700 tnum underline decoration-dotted underline-offset-2 dark:text-sky-400 hover:no-underline">تعتيق: <b>{fmtNum(totals.taateeq)}</b></button>}
              {totals.postponed > 0 && <span className="text-yellow-700 tnum dark:text-yellow-400">مؤجلة: <b>{fmtNum(totals.postponed)}</b></span>}
              {totals.returned > 0 && <span className="text-rose-700 tnum dark:text-rose-400">مرتجعة: <b>{fmtNum(totals.returned)}</b></span>}
              {totals.delivered > 0 && <span className="text-emerald-700 tnum dark:text-emerald-400">مُسلّمة: <b>{fmtNum(totals.delivered)}</b></span>}
            </>}
            {(cols.aging || cols.overnight || cols.transfer || cols.drop) && (totals.aging || totals.overnight || totals.transfer || totals.drop) ? (
              <span className="tnum text-muted-foreground">
                بنود النقلة:
                {cols.aging && <> تعتيق <b className="text-foreground">{fmtNum(totals.aging ?? 0)}</b></>}
                {cols.overnight && <> • مبيت <b className="text-foreground">{fmtNum(totals.overnight ?? 0)}</b></>}
                {cols.transfer && <> • تحويلة <b className="text-foreground">{fmtNum(totals.transfer ?? 0)}</b></>}
                {cols.drop && <> • دروب <b className="text-foreground">{fmtNum(totals.drop ?? 0)}</b></>}
              </span>
            ) : null}
            {cols.grand && totals.grand != null && (
              <span className="ms-auto rounded-lg bg-primary/10 px-2.5 py-1 font-bold text-primary tnum" title="الإجمالي النقلة = نولون العميل + التعتيق + المبيت + التحويلة + الدروب">
                الإجمالي النقلة: {fmtNum(totals.grand)} ج.م
              </span>
            )}
          </div>
        </div>
      )}

      <div className="text-xs text-muted-foreground tnum print:hidden">إجمالي النتائج: <b className="text-foreground">{fmtNum(data?.total ?? 0)}</b></div>

      {/* Mobile (< md): card view */}
      {data && data.items.length > 0 && (
        <div className="md:hidden space-y-2 print:hidden">
          {data.items.map((s) => {
            const size = s.loadType === '1.5TON' ? '1.5ط' : s.loadType === '3TON' ? '3ط' : s.loadType === '6M' ? '6م' : '-'
            const sizeTone = s.loadType === '1.5TON' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
              : s.loadType === '3TON' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300'
              : 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
            const sMeta = STATUS_LABEL[s.status] || { label: shipmentStatusLabel(s.status), tone: shipmentStatusDef(s.status)?.tone || '' }
            const isSel = selectedIds.has(s.id)
            return (
              <div
                key={s.id}
                className={cn('rounded-2xl border bg-card elev-sm p-3 transition-colors active:scale-[0.99] space-y-2', isSel ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40')}
              >
                {/* Title row: shipment no + status badge + checkbox */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleOne(s.id, s.status) }}
                      className={cn('shrink-0 mt-0.5 size-5 rounded-md border-2 flex items-center justify-center', isSel ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-300 dark:border-slate-600')}
                      aria-label="تحديد"
                    >
                      {isSel && <CheckSquare className="size-3.5" />}
                    </button>
                    <button onClick={() => setSelected(s.id)} className="min-w-0 flex-1 text-right">
                      {cols.shipmentNo && <div className="font-mono text-xs font-bold truncate-1">{s.shipmentNo}</div>}
                      {cols.shipmentNo && s.deliveryNumber && s.deliveryNumber !== s.shipmentNo && (
                        <div className="text-[10px] text-muted-foreground tnum truncate-1">ديليفري: {s.deliveryNumber}</div>
                      )}
                      {cols.customer && (
                        <div className="font-semibold text-sm truncate-1 mt-0.5" title={s.customer?.name || s.recipientName || ''}>
                          {s.customer?.name || s.recipientName || '-'}
                        </div>
                      )}
                      {cols.shipmentNo && s.billNo && <div className="text-[10px] text-muted-foreground tnum truncate-1">بوليصة: {s.billNo}</div>}
                    </button>
                  </div>
                  {cols.status && <Badge variant="outline" className={sMeta.tone + ' shrink-0'}>{sMeta.label}</Badge>}
                </div>
                {s.stopped && cols.status && (
                  <Badge variant="outline" className="w-full justify-center font-bold bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-900/60">
                    بتقف تاني يوم — لم تُحمّل في يومها
                  </Badge>
                )}
                {/* Meta grid — كل حقل يُعرض فقط إذا كان عموده ظاهرًا */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-1 border-t border-border/60">
                  {cols.destination && (
                    <div className="min-w-0">
                      <div className="text-[10px] text-muted-foreground/70">الجهة</div>
                      <div className="text-xs font-medium truncate-1">{s.destination ?? '-'}</div>
                      {s.destinationEn && <div className="text-[10px] text-muted-foreground/80 truncate-1 num-ltr" dir="ltr">{s.destinationEn}</div>}
                    </div>
                  )}
                  {cols.pieces && (
                    <div className="min-w-0">
                      <div className="text-[10px] text-muted-foreground/70">القطع (كام قطعة)</div>
                      <div className="text-xs font-medium tnum num-ltr">{s.policyQty != null ? fmtNum(s.policyQty) : '-'}</div>
                    </div>
                  )}
                  {cols.loadType && (
                    <div className="min-w-0">
                      <div className="text-[10px] text-muted-foreground/70">أدوات التحميل</div>
                      <Badge variant="outline" className={cn('font-bold', sizeTone)}>{size}</Badge>
                    </div>
                  )}
                  {cols.contractor && (
                    <div className="min-w-0">
                      <div className="text-[10px] text-muted-foreground/70">المقاول</div>
                      <div className="text-xs font-medium truncate-1">{s.contractor?.name ?? '-'}</div>
                    </div>
                  )}
                  {cols.date && (
                    <div className="min-w-0">
                      <div className="text-[10px] text-muted-foreground/70">التاريخ</div>
                      <div className="text-xs font-medium tnum truncate-1">{fmtDate(s.date)}</div>
                    </div>
                  )}
                  {/* بنود النقلة الإضافية — صلاحية العمود + shipments.extras.view */}
                  {cols.aging && (
                    <div className="min-w-0">
                      <div className="text-[10px] text-muted-foreground/70">تعتيق</div>
                      <div className="text-xs font-medium tnum num-ltr">{s.aging != null ? fmtNum(s.aging) : '-'}</div>
                    </div>
                  )}
                  {cols.overnight && (
                    <div className="min-w-0">
                      <div className="text-[10px] text-muted-foreground/70">مبيت</div>
                      <div className="text-xs font-medium tnum num-ltr">{s.overnight != null ? fmtNum(s.overnight) : '-'}</div>
                    </div>
                  )}
                  {cols.transfer && (
                    <div className="min-w-0">
                      <div className="text-[10px] text-muted-foreground/70">تحويلة</div>
                      <div className="text-xs font-medium tnum num-ltr">{s.transfer != null ? fmtNum(s.transfer) : '-'}</div>
                    </div>
                  )}
                  {cols.drop && (
                    <div className="min-w-0">
                      <div className="text-[10px] text-muted-foreground/70">دروب</div>
                      <div className="text-xs font-medium tnum num-ltr">{s.drop != null ? fmtNum(s.drop) : '-'}</div>
                    </div>
                  )}
                  {/* المبالغ — صلاحية العمود + prices.view */}
                  {cols.freight && (
                    <div className="min-w-0">
                      <div className="text-[10px] text-muted-foreground/70">نولون العميل</div>
                      <div className="text-xs font-bold tnum num-ltr">{fmtNum(s.freightTotal ?? s.freightCost)} ج.م</div>
                    </div>
                  )}
                  {cols.suppliers && (
                    <div className="min-w-0">
                      <div className="text-[10px] text-muted-foreground/70">نولون المقاول</div>
                      <div className="text-xs font-bold tnum num-ltr">{fmtNum(s.totalSuppliers ?? 0)} ج.م</div>
                    </div>
                  )}
                  {/* إجمالي النقلة لهذا الصف — نولون العميل + بنود النقلة */}
                  {cols.grand && (
                    <div className="min-w-0">
                      <div className="text-[10px] text-muted-foreground/70">الإجمالي</div>
                      <div className="text-xs font-bold tnum num-ltr text-primary">
                        {fmtNum(s.grand ?? ((Number(s.freightTotal ?? s.freightCost ?? 0) || 0) + (Number(s.aging ?? 0) || 0) + (Number(s.overnight ?? 0) || 0) + (Number(s.transfer ?? 0) || 0) + (Number(s.drop ?? 0) || 0)))} ج.م
                      </div>
                    </div>
                  )}
                </div>
                {/* ذيل البطاقة: أزرار الإجراءات بحجم مناسب للمس */}
                {cols.actions && (
                  <div className="flex items-center gap-2 pt-2 border-t border-border/60">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 min-h-[40px]"
                      onClick={() => setSelected(s.id)}
                    >
                      <PackageSearch className="size-4" /> عرض التفاصيل
                    </Button>
                    {has('shipments.print') && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 min-h-[40px]"
                        onClick={() => setWaybillShipment(s)}
                      >
                        <Printer className="size-4" /> بوليصة
                      </Button>
                    )}
                  </div>
                )}
                {s.stopped && has('shipments.edit') && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full min-h-[40px] font-bold text-rose-700 border-rose-300 hover:bg-rose-50 dark:text-rose-300 dark:border-rose-900/60 dark:hover:bg-rose-950/40"
                    disabled={reschedulingId === s.id}
                    onClick={() => reschedule(s.id)}
                  >
                    جدولة لليوم — إلغاء الإيقاف
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Desktop (md+): table view */}
      <Card className="gap-0 overflow-hidden py-0 hidden md:block print:hidden">
        <div className="w-full overflow-x-auto">
          <table className="w-full table-fixed text-sm text-right" style={{ minWidth: cols.count >= 14 ? 1880 : 1280 }}>
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="font-medium px-2 py-3 text-center w-12 print:hidden">
                  <button onClick={toggleAll} aria-label="تحديد الكل" className={cn('inline-flex items-center justify-center size-5 rounded-md border-2', allOnPageSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-300 dark:border-slate-600')}>
                    {allOnPageSelected && <CheckSquare className="size-3.5" />}
                  </button>
                </th>
                {cols.shipmentNo && <th className="font-medium px-4 py-3 text-center w-28">رقم الشحنة</th>}
                {cols.customer && <th className="font-medium px-4 py-3">العميل / المستلم</th>}
                {cols.destination && <th className="font-medium px-4 py-3 w-36">الجهة</th>}
                {cols.pieces && <th className="font-medium px-4 py-3 text-center w-20" title="كام قطعة">القطع</th>}
                {cols.loadType && <th className="font-medium px-4 py-3 text-center w-24" title="أدوات التحميل / نوع الحمولة">أدوات التحميل</th>}
                {cols.contractor && <th className="font-medium px-4 py-3 w-28">المقاول</th>}
                {cols.date && <th className="font-medium px-4 py-3 text-center w-28">التاريخ</th>}
                {cols.status && <th className="font-medium px-4 py-3 text-center w-32">الحالة</th>}
                {/* بنود النقلة الإضافية — صلاحية العمود + shipments.extras.view */}
                {cols.aging && <th className="font-medium px-4 py-3 text-left w-20" title="التعتيق">تعتيق</th>}
                {cols.overnight && <th className="font-medium px-4 py-3 text-left w-20" title="المبيت">مبيت</th>}
                {cols.transfer && <th className="font-medium px-4 py-3 text-left w-20" title="التحويلة">تحويلة</th>}
                {cols.drop && <th className="font-medium px-4 py-3 text-left w-20" title="الدروب">دروب</th>}
                {/* أعمدة المبالغ — صلاحية العمود + prices.view */}
                {cols.freight && <th className="font-medium px-4 py-3 text-left w-24">نولون العميل</th>}
                {cols.suppliers && <th className="font-medium px-4 py-3 text-left w-24">نولون المقاول</th>}
                {cols.margin && <th className="font-medium px-4 py-3 text-left w-24">هامش الربح</th>}
                {/* إجمالي النقلة لكل صف — نولون العميل + بنود النقلة الإضافية */}
                {cols.grand && <th className="font-semibold px-4 py-3 text-left w-26 text-primary">الإجمالي النقلة</th>}
                {cols.actions && <th className="font-medium px-4 py-3 text-center w-24 print:hidden">إجراءات</th>}
              </tr>
            </thead>
            <tbody>
              {isLoading && !data ? (
                Array.from({ length: 10 }).map((_, i) => <tr key={i}><td colSpan={colCount}><Skeleton className="h-12 m-1" /></td></tr>)
              ) : error && !data ? (
                <tr><td colSpan={colCount} className="py-14 text-center text-muted-foreground">تعذّر تحميل البيانات من الخادم — اضغط «إعادة المحاولة» أعلاه</td></tr>
              ) : data && data.items.length > 0 ? (
                data.items.map((s, i) => {
                  const size = s.loadType === '1.5TON' ? '1.5ط' : s.loadType === '3TON' ? '3ط' : s.loadType === '6M' ? '6م' : '-'
                  const sizeTone = s.loadType === '1.5TON' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    : s.loadType === '3TON' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300'
                    : 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                  const sMeta = STATUS_LABEL[s.status] || { label: shipmentStatusLabel(s.status), tone: shipmentStatusDef(s.status)?.tone || '' }
                  // الهامش والإجمالي النقلة من الخادم (s.margin/s.grand) — يظلان صحيحين
                  // حتى لو خُفي عمود نولون العميل/المقاول (الخادم يفرّغ القيم لكن يرسل المحسوب)
                  const margin = s.margin ?? ((s.freightTotal ?? 0) - (s.totalSuppliers ?? 0))
                  // إجمالي النقلة لهذا الصف فقط — نولون العميل + التعتيق + المبيت + التحويلة + الدروب
                  const rowTotal = (Number(s.freightTotal ?? s.freightCost ?? 0) || 0)
                    + (Number(s.aging ?? 0) || 0)
                    + (Number(s.overnight ?? 0) || 0)
                    + (Number(s.transfer ?? 0) || 0)
                    + (Number(s.drop ?? 0) || 0)
                  const isSel = selectedIds.has(s.id)
                  return (
                    <tr key={s.id} className={cn('border-t border-border hover:bg-muted/40', i % 2 ? 'bg-card' : 'bg-muted/15', isSel && 'bg-primary/10')}>
                      <td className="px-2 py-3 align-middle text-center print:hidden">
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleOne(s.id, s.status) }}
                          aria-label="تحديد"
                          className={cn('inline-flex items-center justify-center size-5 rounded-md border-2', isSel ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-300 dark:border-slate-600')}
                        >
                          {isSel && <CheckSquare className="size-3.5" />}
                        </button>
                      </td>
                      {cols.shipmentNo && (
                        <td className="px-4 py-3 align-middle text-center cursor-pointer" onClick={() => setSelected(s.id)}>
                          <div className="font-mono text-xs font-bold truncate-1">{s.shipmentNo}</div>
                          {s.deliveryNumber && s.deliveryNumber !== s.shipmentNo && (
                            <div className="text-[10px] text-muted-foreground tnum truncate-1">ديليفري: {s.deliveryNumber}</div>
                          )}
                          {s.billNo && <div className="text-[10px] text-muted-foreground tnum truncate-1">بوليصة: {s.billNo}</div>}
                        </td>
                      )}
                      {cols.customer && (
                        <td className="px-4 py-3 align-middle cursor-pointer" onClick={() => setSelected(s.id)}>
                          <div className="font-medium truncate-1" title={s.customer?.name || s.recipientName || ''}>
                            {s.customer?.name || s.recipientName || '-'}
                          </div>
                        </td>
                      )}
                      {cols.destination && (
                        <td className="px-4 py-3 align-middle cursor-pointer" onClick={() => setSelected(s.id)}>
                          <div className="font-medium truncate-1">{s.destination ?? '-'}</div>
                          {s.destinationEn
                            ? <div className="text-[10px] text-muted-foreground truncate-1 num-ltr" dir="ltr">{s.destinationEn}</div>
                            : s.routeCode && <div className="text-[10px] text-muted-foreground truncate-1">كود: {s.routeCode}</div>}
                        </td>
                      )}
                      {/* كام قطعة — عمود مستقل في جدول الصباح */}
                      {cols.pieces && (
                        <td className="px-4 py-3 align-middle text-center tnum whitespace-nowrap cursor-pointer" onClick={() => setSelected(s.id)} title="كام قطعة">
                          <span className="num-ltr">{s.policyQty != null ? fmtNum(s.policyQty) : '-'}</span>
                        </td>
                      )}
                      {/* أدوات التحميل / نوع الحمولة */}
                      {cols.loadType && (
                        <td className="px-4 py-3 align-middle text-center whitespace-nowrap cursor-pointer" onClick={() => setSelected(s.id)} title="أدوات التحميل">
                          <Badge variant="outline" className={cn('font-bold', sizeTone)}>{size}</Badge>
                        </td>
                      )}
                      {cols.contractor && (
                        <td className="px-4 py-3 align-middle text-xs cursor-pointer" onClick={() => setSelected(s.id)}><span className="truncate-1 block">{s.contractor?.name ?? '-'}</span></td>
                      )}
                      {cols.date && (
                        <td className="px-4 py-3 align-middle text-xs tnum text-center whitespace-nowrap cursor-pointer" onClick={() => setSelected(s.id)}>{fmtDate(s.date)}</td>
                      )}
                      {cols.status && (
                        <td className="px-4 py-3 align-middle text-center whitespace-nowrap cursor-pointer" onClick={() => setSelected(s.id)}>
                          <Badge variant="outline" className={sMeta.tone}>{sMeta.label}</Badge>
                          {s.stopped && (
                            <Badge variant="outline" className="mt-1 font-bold bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-900/60" title="لم تُحمّل في يومها — متوقفة عن التحميل (بتقف تاني يوم)">
                              بتقف تاني يوم
                            </Badge>
                          )}
                        </td>
                      )}
                      {cols.aging && (
                        <td className="px-4 py-3 align-middle text-left tnum whitespace-nowrap cursor-pointer" onClick={() => setSelected(s.id)} title="التعتيق">
                          <span className="num-ltr">{s.aging != null ? fmtNum(s.aging) : '-'}</span>
                        </td>
                      )}
                      {cols.overnight && (
                        <td className="px-4 py-3 align-middle text-left tnum whitespace-nowrap cursor-pointer" onClick={() => setSelected(s.id)} title="المبيت">
                          <span className="num-ltr">{s.overnight != null ? fmtNum(s.overnight) : '-'}</span>
                        </td>
                      )}
                      {cols.transfer && (
                        <td className="px-4 py-3 align-middle text-left tnum whitespace-nowrap cursor-pointer" onClick={() => setSelected(s.id)} title="التحويلة">
                          <span className="num-ltr">{s.transfer != null ? fmtNum(s.transfer) : '-'}</span>
                        </td>
                      )}
                      {cols.drop && (
                        <td className="px-4 py-3 align-middle text-left tnum whitespace-nowrap cursor-pointer" onClick={() => setSelected(s.id)} title="الدروب">
                          <span className="num-ltr">{s.drop != null ? fmtNum(s.drop) : '-'}</span>
                        </td>
                      )}
                      {cols.freight && (
                        <td className="px-4 py-3 align-middle text-left font-bold tnum whitespace-nowrap cursor-pointer" onClick={() => setSelected(s.id)}>
                          <span className="num-ltr">{(s.freightTotal ?? s.freightCost) != null ? fmtNum(s.freightTotal ?? s.freightCost) : '-'}</span>
                        </td>
                      )}
                      {cols.suppliers && (
                        <td className="px-4 py-3 align-middle text-left tnum whitespace-nowrap cursor-pointer" onClick={() => setSelected(s.id)}>
                          <span className="num-ltr">{s.totalSuppliers != null ? fmtNum(s.totalSuppliers) : '-'}</span>
                        </td>
                      )}
                      {cols.margin && (
                        <td className={cn('px-4 py-3 align-middle text-left font-bold tnum whitespace-nowrap', margin >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400')}>
                          <span className="num-ltr">{fmtNum(margin)}</span>
                        </td>
                      )}
                      {cols.grand && (
                        <td className="px-4 py-3 align-middle text-left font-bold tnum whitespace-nowrap text-primary" onClick={() => setSelected(s.id)} title="إجمالي النقلة: نولون العميل + التعتيق + المبيت + التحويلة + الدروب">
                          <span className="num-ltr">{fmtNum(s.grand ?? rowTotal)}</span>
                        </td>
                      )}
                      {cols.actions && (
                        <td className="px-4 py-3 align-middle text-center whitespace-nowrap print:hidden">
                          <div className="flex items-center justify-center gap-0.5">
                            {s.stopped && has('shipments.edit') && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 px-2 text-[11px] font-bold text-rose-700 border-rose-300 hover:bg-rose-50 dark:text-rose-300 dark:border-rose-900/60 dark:hover:bg-rose-950/40"
                                disabled={reschedulingId === s.id}
                                onClick={(e) => { e.stopPropagation(); reschedule(s.id) }}
                                title="إعادة الجدولة لليوم — إلغاء الإيقاف وترخيص التحميل"
                              >
                                جدولة لليوم
                              </Button>
                            )}
                            {has('shipments.print') && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => { e.stopPropagation(); setWaybillShipment(s) }}
                                title="طباعة بوليصة الشحن"
                              >
                                <Printer className="size-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })
              ) : (
                <tr><td colSpan={colCount} className="py-14 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2 max-w-md mx-auto">
                    <span className="flex items-center justify-center size-12 rounded-full bg-muted/70 text-muted-foreground/70">
                      <PackageSearch className="size-6" />
                    </span>
                    <div className="text-sm font-semibold text-foreground mt-1">
                      {hasFilters ? 'مفيش شحنات مطابقة للبحث ده' : 'لسه مفيش شحنات مسجّلة'}
                    </div>
                    <div className="text-xs">
                      {hasFilters
                        ? 'جرّب تغيّر كلمة البحث أو الفلاتر — أو سجّل شحنة جديدة لو متوقعة'
                        : 'سجّل أول شحنة برقم الديليفري واختار المقاول — هتظهر هنا فورًا'}
                    </div>
                    {has('shipments.create') && (
                      <Button size="sm" onClick={() => setAddOpen(true)} className="mt-1.5 min-h-[40px]">
                        <Plus className="size-4" /> تسجيل شحنة جديدة
                      </Button>
                    )}
                  </div>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination — flush footer of the table card (server-side) */}
        {data && (
          <DataTablePagination
            currentPage={data.page}
            totalPages={data.totalPages}
            totalItems={data.total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1) }}
            itemLabel="شحنة"
          />
        )}
      </Card>

      {/* Mobile empty state */}
      {data && data.items.length === 0 && !isLoading && (
        <Card className="md:hidden"><CardContent className="py-12 px-6 text-center text-muted-foreground">
          <div className="flex flex-col items-center gap-2 max-w-md mx-auto">
            <span className="flex items-center justify-center size-12 rounded-full bg-muted/70 text-muted-foreground/70">
              <PackageSearch className="size-6" />
            </span>
            <div className="text-sm font-semibold text-foreground mt-1">
              {hasFilters ? 'مفيش شحنات مطابقة للبحث ده' : 'لسه مفيش شحنات مسجّلة'}
            </div>
            <div className="text-xs">
              {hasFilters
                ? 'جرّب تغيّر كلمة البحث أو الفلاتر — أو سجّل شحنة جديدة لو متوقعة'
                : 'سجّل أول شحنة برقم الديليفري واختار المقاول — هتظهر هنا فورًا'}
            </div>
            {has('shipments.create') && (
              <Button size="sm" onClick={() => setAddOpen(true)} className="mt-1.5 min-h-[40px]">
                <Plus className="size-4" /> تسجيل شحنة جديدة
              </Button>
            )}
          </div>
        </CardContent></Card>
      )}

      {/* Mobile: totals card (الإجمالي النقلة) */}
      {totals && data && data.items.length > 0 && (
        <div className="md:hidden rounded-2xl border border-border bg-muted/40 elev-sm p-3 print:hidden">
          <div className="text-xs font-bold text-foreground mb-2">الإجمالي النقلة — لـ {fmtNum(totals.shipments)} شحنة</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {cols.pieces && (
              <div className="rounded-lg bg-card px-2 py-1.5 border border-border/60">
                <div className="text-[10px] text-muted-foreground">القطع</div>
                <div className="text-xs font-bold tnum num-ltr">{fmtNum(totals.pieces)}</div>
              </div>
            )}
            {cols.aging && (
              <div className="rounded-lg bg-card px-2 py-1.5 border border-border/60">
                <div className="text-[10px] text-muted-foreground">تعتيق</div>
                <div className="text-xs font-bold tnum num-ltr">{fmtNum(totals.aging ?? 0)}</div>
              </div>
            )}
            {cols.overnight && (
              <div className="rounded-lg bg-card px-2 py-1.5 border border-border/60">
                <div className="text-[10px] text-muted-foreground">مبيت</div>
                <div className="text-xs font-bold tnum num-ltr">{fmtNum(totals.overnight ?? 0)}</div>
              </div>
            )}
            {cols.transfer && (
              <div className="rounded-lg bg-card px-2 py-1.5 border border-border/60">
                <div className="text-[10px] text-muted-foreground">تحويلة</div>
                <div className="text-xs font-bold tnum num-ltr">{fmtNum(totals.transfer ?? 0)}</div>
              </div>
            )}
            {cols.drop && (
              <div className="rounded-lg bg-card px-2 py-1.5 border border-border/60">
                <div className="text-[10px] text-muted-foreground">دروب</div>
                <div className="text-xs font-bold tnum num-ltr">{fmtNum(totals.drop ?? 0)}</div>
              </div>
            )}
            {cols.grand && totals.grand != null && (
              <div className="rounded-lg bg-primary/10 px-2 py-1.5 border border-primary/30">
                <div className="text-[10px] text-primary/80">الإجمالي النقلة</div>
                <div className="text-xs font-bold text-primary tnum num-ltr">{fmtNum(totals.grand)} ج.م</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile: pagination bar below the cards */}
      {data && data.items.length > 0 && (
        <div className="md:hidden rounded-2xl border border-border bg-card elev-sm overflow-hidden print:hidden">
          <DataTablePagination
            currentPage={data.page}
            totalPages={data.totalPages}
            totalItems={data.total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1) }}
            itemLabel="شحنة"
            className="border-t-0"
          />
        </div>
      )}

      {/* Add dialog */}
      <ShipmentCreateDialog open={addOpen} onOpenChange={setAddOpen} onCreated={() => { mutate(); toast({ title: 'تم إنشاء الشحنة بنجاح' }) }} onViewExisting={(dn) => { setQ(dn); setStatus('all'); setDestination('all'); setContractor('all'); setProvince('all'); setDateFilter(''); setStoppedOnly(false) }} />

      {/* Waybill print dialog */}
      <WaybillPrint
        shipment={waybillShipment}
        open={!!waybillShipment}
        onOpenChange={(v) => { if (!v) setWaybillShipment(null) }}
      />

      {/* Bulk action dialogs */}
      <Dialog open={bulkActionOpen === 'status'} onOpenChange={(v) => !v && setBulkActionOpen(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تغيير الحالة دفعة ({selectedIds.size} شحنة)</DialogTitle>
            <DialogDescription>سيتم تحديث حالة جميع الشحنات المحددة إلى الحالة الجديدة وإضافة سجل لكل شحنة.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {bulkBlocked ? (
              <div className="text-xs leading-relaxed text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2.5 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-900/50">
                لا توجد انتقالات حالة متاحة مشتركة للشحنات المحددة — حالاتها الحالية لا تلتقي عند انتقال موحّد (بعضها قد يكون في حالة نهائية مثل ملغاة/مشطوبة).
              </div>
            ) : (
              <Select value={bulkStatus} onValueChange={setBulkStatus}>
                <SelectTrigger><SelectValue placeholder="اختر الحالة الجديدة (الانتقالات المسموحة فقط)..." /></SelectTrigger>
                <SelectContent>
                  {bulkAllowedOptions.map((o) => (
                    <SelectItem key={o.key} value={o.key}>{STATUS_LABEL[o.key]?.label ?? o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Textarea value={bulkNotes} onChange={(e) => setBulkNotes(e.target.value)} placeholder="ملاحظات للسجل (اختياري)..." rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkActionOpen(null)}>إلغاء</Button>
            <Button onClick={runBulkStatus} disabled={!bulkStatus || bulkBlocked || bulkLoading}>{bulkLoading ? 'جاري التطبيق...' : `تطبيق على ${selectedIds.size} شحنة`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkActionOpen === 'assign'} onOpenChange={(v) => !v && setBulkActionOpen(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>إسناد شحنات لمقاول ({selectedIds.size} شحنة)</DialogTitle>
            <DialogDescription>سيتم تحديث المقاول المسؤول عن كل الشحنات المحددة. مفيد لتجميع شحنات رحلة واحدة.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Select value={bulkContractor} onValueChange={setBulkContractor}>
              <SelectTrigger><SelectValue placeholder="اختر المقاول..." /></SelectTrigger>
              <SelectContent>
                {contractorsList.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkActionOpen(null)}>إلغاء</Button>
            <Button onClick={runBulkAssign} disabled={!bulkContractor || bulkLoading}>{bulkLoading ? 'جاري الإسناد...' : `إسناد ${selectedIds.size} شحنة`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ShipmentCreateDialog({ open, onOpenChange, onCreated, onViewExisting }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void; onViewExisting?: (deliveryNumber: string) => void }) {
  const { toast } = useToast()
  // صلاحية رؤية الأسعار — تتحكم في إظهار حقول المبالغ ومحرك التسعير التلقائي
  const canPrices = useCanPrices()
  const [loading, setLoading] = React.useState(false)
  const [err, setErr] = React.useState('')
  const { data: parties } = useSWR<{ items: any[] }>('/api/parties?type=customer', fetcher)
  const { data: contractors } = useSWR<{ items: any[] }>('/api/parties?type=contractor', fetcher)
  const { data: branches } = useSWR<{ items: any[] }>('/api/branches', fetcher)
  const { data: warehousesRes } = useSWR<{ items: any[] }>('/api/warehouses', fetcher)
  const { items: loadTypeItems } = useLookup('load_type')
  const LOAD_TYPE_OPTIONS = loadTypeItems.map((i) => ({ value: i.key, label: i.label }))

  const [v, setV] = React.useState<any>(emptyCreateForm())
  // بيانات الشحنة المكررة (رقم الديليفري موجود مسبقًا) — لعرض رابط سريع لعرضها
  const [dupInfo, setDupInfo] = React.useState<null | { existingShipmentNo?: string; existingContractor?: string | null }>(null)
  // محرك التسعير التلقائي: تتبّع تعديل المستخدم لحقل النولون + السعر المقترح من جدول النولون
  const freightTouchedRef = React.useRef(false)
  const [suggested, setSuggested] = React.useState<{ routeName: string; sellPrice: number } | null>(null)
  const quoteSeqRef = React.useRef(0)

  React.useEffect(() => {
    if (open) {
      setV(emptyCreateForm())
      freightTouchedRef.current = false
      setSuggested(null)
      setErr('')
      setDupInfo(null)
    }
  }, [open])

  // محرك التسعير — يجلب السعر المقترح من جدول النولون (لمن يملك صلاحية الأسعار فقط)
  const lookupQuote = React.useCallback(async (dest: string, lt: string) => {
    const destination = String(dest ?? '').trim()
    if (!destination || !canPrices) { setSuggested(null); return }
    const seq = ++quoteSeqRef.current
    try {
      const res = await fetcher(`/api/freight/quote?destination=${encodeURIComponent(destination)}&loadType=${encodeURIComponent(String(lt ?? ''))}`)
      if (seq !== quoteSeqRef.current) return
      const price = res?.matched ? res.price : null
      // تعبئة تلقائية فقط إذا كان الحقل فارغًا أو لم يلمسه المستخدم — لا نكتب أبدًا فوق إدخال يدوي
      if (price && price.sellPrice != null && !freightTouchedRef.current) {
        setV((prev: any) => ({ ...prev, freightTotal: String(price.sellPrice) }))
        setSuggested({ routeName: String(price.routeName ?? price.regionAr ?? ''), sellPrice: Number(price.sellPrice) })
      } else {
        setSuggested(null)
      }
    } catch { /* تجاهل أخطاء التسعير — الإدخال اليدوي يبقى متاحًا */ }
  }, [canPrices])

  // استدعاء التسعير تلقائيًا (debounce 400ms) عند تغيير الوجهة أو نوع الحمولة
  React.useEffect(() => {
    if (!open || !canPrices) return
    const dest = String(v.destination ?? '').trim()
    if (!dest) { setSuggested(null); return }
    const t = setTimeout(() => { lookupQuote(v.destination, v.loadType) }, 400)
    return () => clearTimeout(t)
  }, [open, canPrices, v.destination, v.loadType, lookupQuote])

  const submit = async () => {
    setLoading(true); setErr(''); setDupInfo(null)
    try {
      // تحقق سريع قبل الإرسال: المقاول إلزامي + لا مبالغ سالبة
      if (!v.contractorId) { setErr('اختيار المقاول مطلوب — عيّن مقاول النقل قبل حفظ الشحنة'); setLoading(false); return }
      const moneyKeys = ['freightCost', 'freightTotal', 'salePrice', 'customerPay', 'aging', 'overnight', 'returns', 'transfer', 'other', 'drop', 'policyQty']
      for (const k of moneyKeys) {
        const n = Number(v[k])
        if (v[k] !== '' && Number.isFinite(n) && n < 0) { setErr(`القيمة في «${k}» لا يمكن أن تكون سالبة — أدخل مبلغًا صحيحًا`); setLoading(false); return }
      }
      // الحالة تُفرض دائمًا من الخادم (جديدة) — ونمرر الحقول المالية الكاملة
      await apiPost('/api/shipments', { ...v })
      onOpenChange(false); onCreated()
    } catch (e: any) {
      setErr(e.message)
      if (e?.details?.code === 'DUPLICATE_DELIVERY_NUMBER') setDupInfo(e.details)
    } finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>إنشاء شحنة جديدة</DialogTitle>
          <DialogDescription>أدخل بيانات الشحنة. الحقول النجمية مطلوبة.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <div>
            <label className="text-xs font-medium">رقم الديليفري</label>
            <Input
              value={v.deliveryNumber}
              onChange={(e) => setV({ ...v, deliveryNumber: e.target.value })}
              placeholder="يُولّد تلقائيًا إن تُرك فارغًا"
            />
            <div className="text-[10px] text-muted-foreground mt-1">رقم الإذن الورقي مع المقاول — فريد للنظام كله، ويُمنع التكرار</div>
          </div>
          <div>
            <label className="text-xs font-medium">المقاول / الناقل *</label>
            <Select value={v.contractorId || '__'} onValueChange={(val) => setV({ ...v, contractorId: val === '__' ? '' : val })}>
              <SelectTrigger><SelectValue placeholder="اختر المقاول..." /></SelectTrigger>
              <SelectContent>
                {(contractors?.items ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="text-[10px] text-muted-foreground mt-1">مطلوب — مستحقات النولون تُسجل على حساب المقاول المختار</div>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-medium">العميل / المستلم *</label>
            <Select value={v.customerId} onValueChange={(val) => setV({ ...v, customerId: val === '__' ? '' : val, recipientName: parties?.items.find(p => p.id === val)?.name || '' })}>
              <SelectTrigger><SelectValue placeholder="اختر عميلاً..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__">— بدون —</SelectItem>
                {(parties?.items ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium">الوجهة (المدينة)</label>
            <Input
              value={v.destination}
              onChange={(e) => setV({ ...v, destination: e.target.value })}
              onBlur={() => lookupQuote(v.destination, v.loadType)}
              placeholder="القاهرة، الإسكندرية..."
            />
          </div>
          <div>
            <label className="text-xs font-medium">نوع الحمولة</label>
            <Select value={v.loadType} onValueChange={(val) => setV({ ...v, loadType: val === '__' ? '' : val })}>
              <SelectTrigger><SelectValue placeholder="اختر الحجم..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__">— غير محدد —</SelectItem>
                {LOAD_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium">الفرع</label>
            <Select value={v.branchId} onValueChange={(val) => setV({ ...v, branchId: val === '__' ? '' : val })}>
              <SelectTrigger><SelectValue placeholder="اختر فرعًا..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__">— بدون —</SelectItem>
                {(branches?.items ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium">المخزن</label>
            <Select value={v.warehouseId} onValueChange={(val) => setV({ ...v, warehouseId: val === '__' ? '' : val })}>
              <SelectTrigger><SelectValue placeholder="اختر مخزنًا..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__">— بدون —</SelectItem>
                {(warehousesRes?.items ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium">تاريخ الشحن</label>
            <Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
          </div>
          {canPrices && (
            <div>
              <label className="text-xs font-medium">تكلفة النولون</label>
              <Input type="number" value={v.freightCost} onChange={(e) => setV({ ...v, freightCost: e.target.value })} placeholder="0" />
            </div>
          )}
          {canPrices && (
            <div>
              <label className="text-xs font-medium">إجمالي النولون</label>
              <Input
                type="number"
                value={v.freightTotal}
                onChange={(e) => { freightTouchedRef.current = true; setSuggested(null); setV({ ...v, freightTotal: e.target.value }) }}
                onBlur={() => lookupQuote(v.destination, v.loadType)}
                placeholder="0"
              />
              {/* سعر مقترح من محرك التسعير — مع إمكانية التراجع */}
              {suggested && (
                <div className="flex items-center justify-between gap-2 mt-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 dark:border-emerald-900/50 dark:bg-emerald-900/20">
                  <span className="text-[11px] text-emerald-700 truncate-1 dark:text-emerald-300">
                    سعر مقترح من جدول النولون: {suggested.routeName} — {fmtNum(suggested.sellPrice)}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setV((prev: any) => ({ ...prev, freightTotal: '' })); setSuggested(null) }}
                    className="shrink-0 min-h-[40px] px-2 text-[11px] font-medium text-emerald-800 underline-offset-2 hover:underline dark:text-emerald-200"
                  >
                    تراجع
                  </button>
                </div>
              )}
            </div>
          )}
          {/* الحقول المالية الممتدة — تُعرض فقط لمن يملك صلاحية الأسعار */}
          {canPrices && (
            <>
              <div>
                <label className="text-xs font-medium">سعر البيع</label>
                <Input type="number" value={v.salePrice} onChange={(e) => setV({ ...v, salePrice: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label className="text-xs font-medium">مدفوع من العميل</label>
                <Input type="number" value={v.customerPay} onChange={(e) => setV({ ...v, customerPay: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label className="text-xs font-medium">تعتيق</label>
                <Input type="number" value={v.aging} onChange={(e) => setV({ ...v, aging: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label className="text-xs font-medium">مبيت</label>
                <Input type="number" value={v.overnight} onChange={(e) => setV({ ...v, overnight: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label className="text-xs font-medium">مرتجعات</label>
                <Input type="number" value={v.returns} onChange={(e) => setV({ ...v, returns: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label className="text-xs font-medium">تحويلة</label>
                <Input type="number" value={v.transfer} onChange={(e) => setV({ ...v, transfer: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label className="text-xs font-medium">أخرى</label>
                <Input type="number" value={v.other} onChange={(e) => setV({ ...v, other: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label className="text-xs font-medium">دروب</label>
                <Input type="number" value={v.drop} onChange={(e) => setV({ ...v, drop: e.target.value })} placeholder="0" />
              </div>
            </>
          )}
          <div>
            <label className="text-xs font-medium">عدد القطع</label>
            <Input type="number" value={v.policyQty} onChange={(e) => setV({ ...v, policyQty: e.target.value })} placeholder="0" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-medium">ملاحظات</label>
            <Textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} rows={2} />
          </div>
        </div>
        {err && <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</div>}
        {dupInfo && (
          <div className="flex items-center justify-between gap-2 flex-wrap rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-900/60 dark:bg-amber-950/30">
            <span className="text-xs text-amber-800 dark:text-amber-200">
              الشحنة المسجلة: <b className="tnum">{dupInfo.existingShipmentNo}</b>{dupInfo.existingContractor ? ` — ${dupInfo.existingContractor}` : ''}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="min-h-[36px]"
              onClick={() => {
                onOpenChange(false)
                if (v.deliveryNumber) onViewExisting?.(String(v.deliveryNumber).trim())
              }}
            >
              عرض الشحنة المسجلة
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={submit} disabled={loading || !v.recipientName || !v.contractorId}>{loading ? 'جاري الحفظ...' : 'حفظ الشحنة'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ShipmentDetail({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged?: () => void }) {
  const { toast } = useToast()
  const { has } = useAuth()
  const { confirmDelete, confirm: confirmDialog } = useConfirm()
  // صلاحية رؤية الأسعار — تتحكم في إظهار المبالغ المالية في بطاقة الشحنة
  const canPrices = useCanPrices()
  // صلاحية رؤية بنود النقلة الإضافية (تعتيق/مبيت/تحويلة/دروب) — تشغيلية منفصلة
  const canExtras = useCanExtras()
  // رؤية الأعمدة المستقلة (shipcols.*) — تُوحَّد مع الجدول والخادم في كل شاشات العرض
  const cols = useShipmentCols()
  // صلاحيات التشغيل — يفرضها الخادم أيضًا (تعديل الحقول البيضاء / تغيير الحالة)
  const canEdit = has('shipments.edit')
  const canChangeStatus = has('shipments.status')
  const { data: shipment, mutate } = useSWR<any>(`/api/shipments/${id}`, fetcher)
  const { items: statusItems } = useLookup('shipment_status')
  const { items: collectionItems } = useLookup('collection_status')
  // خيارات نافذة التعديل — أطراف/فروع/مخازن/أنواع الحمولة
  const { data: editParties } = useSWR<{ items: any[] }>('/api/parties?type=customer', fetcher)
  const { data: editContractors } = useSWR<{ items: any[] }>('/api/parties?type=contractor', fetcher)
  const { data: editBranches } = useSWR<{ items: any[] }>('/api/branches', fetcher)
  const { data: editWarehouses } = useSWR<{ items: any[] }>('/api/warehouses', fetcher)
  const { items: editLoadTypes } = useLookup('load_type')
  const [statusOpen, setStatusOpen] = React.useState(false)
  const [newStatus, setNewStatus] = React.useState('')
  const [statusNotes, setStatusNotes] = React.useState('')
  const [waybillOpen, setWaybillOpen] = React.useState(false)
  const [codOpen, setCodOpen] = React.useState(false)
  const [codCustomerAmount, setCodCustomerAmount] = React.useState('')
  const [codContractorAmount, setCodContractorAmount] = React.useState('')
  // نافذة تعديل الشحنة — الحقول البيضاء المتوافقة مع الخادم
  const [editOpen, setEditOpen] = React.useState(false)
  const [editLoading, setEditLoading] = React.useState(false)
  const [editErr, setEditErr] = React.useState('')
  const [ev, setEv] = React.useState<any>(null)
  // إعادة الجدولة لليوم (بتقف تاني يوم) — hook قبل أي early return
  const [rescheduleLoading, setRescheduleLoading] = React.useState(false)
  // حماية من الضغط المكرر — كل عملية تُنفّذ مرة واحدة حتى مع النقر المتكرر
  const [statusLoading, setStatusLoading] = React.useState(false)
  const [codLoading, setCodLoading] = React.useState(false)
  const [deleteLoading, setDeleteLoading] = React.useState(false)

  React.useEffect(() => {
    if (shipment && codOpen) {
      setCodCustomerAmount(String(shipment.freightTotal ?? 0))
      setCodContractorAmount(String(shipment.totalSuppliers ?? shipment.freightCost ?? 0))
    }
  }, [shipment, codOpen])

  if (!shipment) return <Skeleton className="h-96 rounded-xl" />

  const STATUS_LOOKUP: Record<string, { label: string; tone: string }> = Object.fromEntries(
    statusItems.map((i) => [i.key, { label: i.label, tone: i.tone || '' }]),
  )
  const COLLECTION_LOOKUP: Record<string, { label: string; tone: string }> = Object.fromEntries(
    collectionItems.map((i) => [i.key, { label: i.label, tone: i.tone || '' }]),
  )
  const sMeta = STATUS_LOOKUP[shipment.status] || { label: shipment.status, tone: '' }
  const cMeta = COLLECTION_LOOKUP[shipment.collectionStatus] || { label: shipment.collectionStatus, tone: '' }
  const margin = shipment.margin ?? ((Number(shipment.freightTotal ?? 0)) - (Number(shipment.totalSuppliers ?? 0)))
  // قاعدة «بتقف تاني يوم» — الشحنة متوقفة عن التحميل لأنها لم تُحمّل في يومها
  const stopped = isShipmentStoppedNextDay(shipment)
  const reschedule = async () => {
    const ok = await confirmDialog({
      title: 'إعادة جدولة الشحنة لليوم',
      message: 'هيتم تحديث تاريخ الشحنة لليوم وإلغاء الإيقاف (بتقف تاني يوم) — وبكذا تسمح بالتحميل النهارده. متابعة؟',
      variant: 'primary',
      confirmText: 'جدولة لليوم',
    })
    if (!ok) return
    setRescheduleLoading(true)
    try {
      await apiPost(`/api/shipments/${id}/reschedule`, {})
      toast({ title: 'تمت إعادة الجدولة لليوم — الشحنة مسموح تحميلها' })
      mutate()
      onChanged?.()
    } catch (e: any) {
      toast({ title: 'تعذّرت إعادة الجدولة', description: e.message, variant: 'destructive' })
    } finally { setRescheduleLoading(false) }
  }
  // آلة الحالات الصارمة: الحالات النهائية لا تقبل التغيير، والانتقالات تقتصر على الجدول المعتمد
  const isTerminal = isTerminalShipmentStatus(shipment.status)
  const allowedNext = allowedShipmentTransitions(shipment.status).map((key) => ({
    key,
    label: STATUS_LOOKUP[key]?.label ?? shipmentStatusLabel(key),
    tone: STATUS_LOOKUP[key]?.tone || shipmentStatusDef(key)?.tone || '',
  }))

  const changeStatus = async () => {
    if (!newStatus || isTerminal) return
    // تأكيد قبل تغيير الحالة — تشغيلية جوهرية (primary)
    const targetLabel = STATUS_LOOKUP[newStatus]?.label ?? shipmentStatusLabel(newStatus)
    const ok = await confirmDialog({
      title: 'تغيير حالة الشحنة',
      message: `سيتم تغيير حالة الشحنة إلى «${targetLabel}». هل تريد المتابعة؟`,
      variant: 'primary',
      confirmText: 'تغيير الحالة',
    })
    if (!ok) return
    if (statusLoading) return
    setStatusLoading(true)
    try {
      // الخادم يفرض آلة الحالات — 409 برسالة عربية عند انتقال غير مسموح
      await apiPost(`/api/shipments/${id}/status`, { status: newStatus, notes: statusNotes })
      toast({ title: 'تم تحديث الحالة' })
      setStatusOpen(false); setNewStatus(''); setStatusNotes('')
      mutate()
      onChanged?.()
    } catch (e: any) {
      toast({ title: 'تعذّر تغيير الحالة', description: e.message, variant: 'destructive' })
    } finally { setStatusLoading(false) }
  }

  const settleCOD = async () => {
    if (codLoading) return
    setCodLoading(true)
    try {
      const res = await apiPost(`/api/shipments/${id}/settle-cod`, {
        customerAmount: Number(codCustomerAmount) || 0,
        contractorAmount: Number(codContractorAmount) || 0,
      })
      toast({ title: 'تمت تسوية COD', description: `قبض ${res.receiptVoucherNo ?? '—'} • صرف ${res.paymentVoucherNo ?? '—'}` })
      setCodOpen(false)
      mutate()
      onChanged?.()
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
    finally { setCodLoading(false) }
  }

  const remove = async () => {
    const ok = await confirmDelete({
      title: 'حذف الشحنة',
      message: 'هل تريد حذف هذه الشحنة؟ لا يمكن التراجع.',
    })
    if (!ok) return
    if (deleteLoading) return
    setDeleteLoading(true)
    try {
      await apiDelete(`/api/shipments/${id}`)
      toast({ title: 'تم الحذف' })
      onChanged?.()
      onBack()
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
    finally { setDeleteLoading(false) }
  }

  // فتح نافذة التعديل — تعبئة الحقول البيضاء فقط (المبالغ لمن يملك صلاحية الأسعار)
  const openEdit = () => {
    if (!shipment) return
    setEv({
      billNo: shipment.billNo ?? '', recipientName: shipment.recipientName ?? '', deliveryPhones: shipment.deliveryPhones ?? '',
      destination: shipment.destination ?? '', destinationEn: shipment.destinationEn ?? '', routeCode: shipment.routeCode ?? '',
      loadType: shipment.loadType ?? '', customerId: shipment.customerId ?? '', contractorId: shipment.contractorId ?? '',
      branchId: shipment.branchId ?? '', warehouseId: shipment.warehouseId ?? '', notes: shipment.notes ?? '',
      vehicleNo: shipment.vehicleNo ?? '', shipToParty: shipment.shipToParty ?? '',
      ...(canPrices ? {
        freightCost: shipment.freightCost ?? '', freightTotal: shipment.freightTotal ?? '', totalSuppliers: shipment.totalSuppliers ?? '',
        salePrice: shipment.salePrice ?? '', customerPay: shipment.customerPay ?? '',
        aging: shipment.aging ?? '', overnight: shipment.overnight ?? '', returns: shipment.returns ?? '',
        transfer: shipment.transfer ?? '', other: shipment.other ?? '', drop: shipment.drop ?? '',
        ton15: shipment.ton15 ?? '', ton3: shipment.ton3 ?? '', m6: shipment.m6 ?? '', policyQty: shipment.policyQty ?? '',
      } : {}),
    })
    setEditErr('')
    setEditOpen(true)
  }

  const submitEdit = async () => {
    if (!ev) return
    setEditLoading(true); setEditErr('')
    try {
      const payload: Record<string, unknown> = {}
      for (const k of SHIPMENT_EDIT_TEXT_FIELDS) payload[k] = ev[k] ?? ''
      if (canPrices) for (const k of SHIPMENT_EDIT_NUM_FIELDS) payload[k] = ev[k] ?? ''
      // 409: حماية الخادم للمبالغ على الشحنات المحصّلة/المرحّلة قيدها — رسالة الخادم عربية
      await apiPatch(`/api/shipments/${id}`, payload)
      toast({ title: 'تم حفظ التعديلات بنجاح' })
      setEditOpen(false)
      mutate()
      onChanged?.()
    } catch (e: any) {
      setEditErr(e.message)
    } finally { setEditLoading(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="size-4" /> رجوع للقائمة</Button>
        <div className="flex gap-2 flex-wrap items-center">
          {has('shipments.print') && (
            <Button variant="outline" size="sm" className="min-h-[40px]" onClick={() => setWaybillOpen(true)}><Printer className="size-4" /> طباعة بوليصة</Button>
          )}
          {/* إعادة الجدولة لليوم — إلغاء إيقاف «بتقف تاني يوم» */}
          {stopped && canEdit && (
            <Button variant="outline" size="sm" className="min-h-[40px] font-bold text-rose-700 border-rose-300 hover:bg-rose-50 dark:text-rose-300 dark:border-rose-900/60 dark:hover:bg-rose-950/40" disabled={rescheduleLoading} onClick={reschedule}>
              جدولة لليوم
            </Button>
          )}
          {/* تسوية COD تتطلب صلاحية الأسعار (تتعامل مع مبالغ) */}
          {canPrices && <Button variant="outline" size="sm" className="min-h-[40px]" onClick={() => setCodOpen(true)}><Banknote className="size-4" /> تسوية COD</Button>}
          {/* تعديل الشحنة — الحقول البيضاء المتوافقة مع الخادم */}
          {canEdit && <Button variant="outline" size="sm" className="min-h-[40px]" onClick={openEdit}><Pencil className="size-4" /> تعديل</Button>}
          {/* آلة الحالات الصارمة: الحالة النهائية لا تقبل التغيير */}
          {isTerminal && <span className="text-[11px] text-muted-foreground">حالة نهائية — لا يمكن التغيير</span>}
          {canChangeStatus && (
            <Button
              variant="outline"
              size="sm"
              className="min-h-[40px]"
              onClick={() => { setNewStatus(''); setStatusNotes(''); setStatusOpen(true) }}
              disabled={isTerminal}
              title={isTerminal ? 'حالة نهائية — لا يمكن التغيير' : undefined}
            >
              تغيير الحالة
            </Button>
          )}
          {has('shipments.delete') && (
            <Button variant="outline" size="sm" className="text-destructive min-h-[40px]" disabled={deleteLoading} onClick={remove}>
              {deleteLoading ? 'جاري الحذف...' : <><Trash2 className="size-4" /> حذف</>}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div>
              <div className="text-xs text-muted-foreground">رقم الشحنة</div>
              <div className="text-2xl font-bold font-mono">{shipment.shipmentNo}</div>
              {shipment.billNo && <div className="text-sm text-muted-foreground tnum mt-1">بوليصة: {shipment.billNo}</div>}
            </div>
            <div className="flex gap-2 flex-wrap">
              <Badge variant="outline" className={cn('font-bold', sMeta.tone)}>{sMeta.label}</Badge>
              <Badge variant="outline" className={cn('font-bold', cMeta.tone)}>{cMeta.label}</Badge>
              {stopped && (
                <Badge variant="outline" className="font-bold bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-900/60">
                  متوقفة — بتقف تاني يوم
                </Badge>
              )}
            </div>
          </div>
          {stopped && (
            <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
              الشحنة متوقفة عن التحميل (بتقف تاني يوم) — بتاريخ {shipment.date ? fmtDate(shipment.date) : '—'} ولم تُحمّل في يومها.
              إما إعادة جدولتها لليوم من زر «جدولة لليوم» أو تسجيلها مبيت/تعتيق/مؤجلة وفق الواقع.
            </div>
          )}
        </CardContent>
      </Card>

      {/* شريط هامش الربح — كل خانة تظهر وفق صلاحية عمودها (نولون/تكلفة/هامش) */}
      {(cols.freight || cols.suppliers || cols.margin) && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
            {cols.freight && (
              <div>
                <div className="text-xs text-muted-foreground">نولون العميل (بيع)</div>
                <div className="text-lg font-bold tnum num-ltr">{fmtNum(shipment.freightTotal ?? 0)} ج.م</div>
              </div>
            )}
            {cols.suppliers && (
              <div className={cn(cols.freight && 'sm:border-x sm:border-border/60')}>
                <div className="text-xs text-muted-foreground">نولون المقاول (تكلفة)</div>
                <div className="text-lg font-bold tnum num-ltr">{fmtNum(shipment.totalSuppliers ?? 0)} ج.م</div>
              </div>
            )}
            {cols.margin && (
              <div>
                <div className="text-xs text-muted-foreground">هامش الربح (صافي)</div>
                <div className={cn('text-lg font-bold tnum num-ltr', margin >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400')}>
                  {fmtNum(margin)} ج.م
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4 space-y-2 text-sm">
            <h3 className="font-semibold mb-2">بيانات العميل والتسليم</h3>
            <Row label="العميل" value={shipment.customer?.name || shipment.recipientName || '-'} />
            <Row label="جهة الشحن" value={shipment.shipToParty || '-'} />
            <Row label="هاتف التوصيل" value={shipment.deliveryPhones || '-'} ltr />
            <Row label="الوجهة" value={shipment.destination || '-'} />
            <Row label="الوجهة (EN)" value={shipment.destinationEn || '-'} ltr />
            <Row label="خط السير/التكويد" value={shipment.routeCode || '-'} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-2 text-sm">
            <h3 className="font-semibold mb-2">بيانات التشغيل</h3>
            <Row label="الفرع" value={shipment.branch?.name || '-'} />
            <Row label="المخزن" value={shipment.warehouse?.name || '-'} />
            <Row label="المقاول" value={shipment.contractor?.name || '-'} />
            <Row label="نوع الحمولة" value={shipment.loadType || '-'} />
            <Row label="رقم السيارة" value={shipment.vehicleNo || '-'} ltr />
            <Row label="الكمية (سياسات)" value={fmtNum(shipment.policyQty)} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* بطاقة المبالغ المالية — كل سطر يظهر وفق صلاحيته (عمود مستقل shipcols.* أو الفئة الأوسع) */}
        {(() => {
          const showFreightCost = cols.freight
          const showFreightTotal = cols.freight
          const showSalePrice = canPrices
          const showCustomerPay = canPrices
          const showSuppliers = cols.suppliers
          const showAging = canExtras || cols.aging
          const showOvernight = canExtras || cols.overnight
          const showReturns = canExtras
          const showTransfer = canExtras || cols.transfer
          const showOtherDrop = canExtras || cols.drop
          const anyRow = showFreightCost || showFreightTotal || showSalePrice || showCustomerPay || showSuppliers || showAging || showOvernight || showReturns || showTransfer || showOtherDrop
          if (!anyRow) {
            return (
              <Card>
                <CardContent className="p-4 space-y-2 text-sm">
                  <h3 className="font-semibold mb-2">المبالغ المالية</h3>
                  <p className="text-xs text-muted-foreground">المبالغ وبنود النقلة محجوبة — لا تملك صلاحية رؤيتها.</p>
                </CardContent>
              </Card>
            )
          }
          return (
            <Card>
              <CardContent className="p-4 space-y-2 text-sm">
                <h3 className="font-semibold mb-2">المبالغ المالية</h3>
                {showFreightCost && <Row label="تكلفة النولون" value={`${fmtNum(shipment.freightCost)} ج.م`} money />}
                {showFreightTotal && <Row label="إجمالي النولون" value={`${fmtNum(shipment.freightTotal)} ج.م`} money bold />}
                {showSalePrice && <Row label="سعر البيع" value={`${fmtNum(shipment.salePrice ?? 0)} ج.م`} money />}
                {showCustomerPay && <Row label="تحصيل العميل" value={`${fmtNum(shipment.customerPay)} ج.م`} money />}
                {showSuppliers && <Row label="إجمالي الموردين" value={`${fmtNum(shipment.totalSuppliers)} ج.م`} money bold />}
                {showAging && <Row label="التعتيق" value={`${fmtNum(shipment.aging)} ج.م`} money />}
                {showOvernight && <Row label="المبيت" value={`${fmtNum(shipment.overnight)} ج.م`} money />}
                {showReturns && <Row label="المرتجع" value={`${fmtNum(shipment.returns)} ج.م`} money />}
                {showTransfer && <Row label="التحويلة" value={`${fmtNum(shipment.transfer)} ج.م`} money />}
                {showOtherDrop && <Row label="أخرى / Drop" value={`${fmtNum((shipment.other ?? 0) + (shipment.drop ?? 0))} ج.م`} money />}
              </CardContent>
            </Card>
          )
        })()}
        <Card>
          <CardContent className="p-4 space-y-2 text-sm">
            <h3 className="font-semibold mb-2">التواريخ والملاحظات</h3>
            <Row label="تاريخ الشحن" value={fmtDate(shipment.date)} />
            <Row label="تاريخ (2)" value={fmtDate(shipment.date2)} />
            <Row label="تاريخ التسليم الفعلي" value={fmtDate(shipment.actualDeliveryDate)} />
            <Row label="ملاحظات" value={shipment.notes || '-'} />
            <Row label="ملاحظة ص" value={shipment.note1 || '-'} />
          </CardContent>
        </Card>
      </div>

      {/* Linked vouchers */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold mb-3 text-sm flex items-center gap-2">
            <Link2 className="size-4 text-muted-foreground" /> السندات المرتبطة بالشحنة
          </h3>
          {(shipment.vouchers ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد سندات مرتبطة بهذه الشحنة. استخدم «تسوية COD» لتوليد سندات قبض/صرف تلقائية.</p>
          ) : (
            <div className="space-y-2">
              {(shipment.vouchers ?? []).map((v: any) => (
                <div key={v.id} className="flex items-center justify-between gap-3 text-sm border-b last:border-0 pb-2 last:pb-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={v.type === 'receipt' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'}>
                      {v.type === 'receipt' ? 'قبض' : 'صرف'}
                    </Badge>
                    <span className="font-mono text-xs font-bold">{v.voucherNo}</span>
                    <span className="text-xs text-muted-foreground truncate-1">{v.description || '-'}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* مبلغ السند — يُعرض فقط لمن يملك صلاحية الأسعار */}
                    {canPrices && <span className="tnum font-bold text-sm">{fmtNum(v.amount)} ج.م</span>}
                    <span className="text-[10px] text-muted-foreground tnum">{fmtDate(v.date)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status history */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold mb-3 text-sm flex items-center gap-2">
            <Layers className="size-4 text-muted-foreground" /> سجل تغييرات الحالة
          </h3>
          {shipment.statusHistory?.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا يوجد سجل تغييرات.</p>
          ) : (
            <div className="space-y-2">
              {(shipment.statusHistory ?? []).map((h: any, i: number) => {
                const statusKey = h.toStatus ?? h.status
                const statusLabel = STATUS_LOOKUP[statusKey]?.label || statusKey
                const statusTone = STATUS_LOOKUP[statusKey]?.tone || ''
                return (
                  <div key={h.id ?? i} className="flex items-center gap-3 text-sm border-b last:border-0 pb-2 last:pb-0 flex-wrap">
                    <Badge variant="outline" className={statusTone}>{statusLabel}</Badge>
                    {h.fromStatus && <span className="text-muted-foreground text-xs">من {STATUS_LOOKUP[h.fromStatus]?.label || h.fromStatus}</span>}
                    <span className="text-xs text-muted-foreground tnum">{fmtDateTime(h.changedAt ?? h.date)}</span>
                    <span className="text-xs text-muted-foreground">— {h.userName}</span>
                    {h.notes && <span className="text-xs text-muted-foreground">• {h.notes}</span>}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status change dialog — الانتقالات المسموحة فقط (آلة الحالات الصارمة) */}
      <Dialog open={statusOpen} onOpenChange={setStatusOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>تغيير حالة الشحنة</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {isTerminal ? (
              <div className="text-xs leading-relaxed text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2.5 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-900/50">
                حالة نهائية — لا يمكن التغيير
              </div>
            ) : allowedNext.length === 0 ? (
              <div className="text-xs leading-relaxed text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2.5 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-900/50">
                لا توجد انتقالات مسموحة من الحالة الحالية.
              </div>
            ) : (
              <>
                <Select value={newStatus} onValueChange={setNewStatus}>
                  <SelectTrigger><SelectValue placeholder="اختر الحالة الجديدة (الانتقالات المسموحة فقط)..." /></SelectTrigger>
                  <SelectContent>
                    {allowedNext.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">التسلسل القياسي: جديدة ← مستلمة ← محمّلة/في الطريق ← تم التسليم أو مرتجع</p>
              </>
            )}
            <Textarea value={statusNotes} onChange={(e) => setStatusNotes(e.target.value)} placeholder="ملاحظات (اختياري)..." rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusOpen(false)}>إلغاء</Button>
            <Button onClick={changeStatus} disabled={isTerminal || !newStatus || statusLoading}>{statusLoading ? 'جاري التغيير...' : 'تأكيد'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog — الحقول البيضاء المتوافقة مع الخادم (المبالغ لمن يملك صلاحية الأسعار) */}
      <Dialog open={editOpen} onOpenChange={(v2) => { if (!v2) setEditOpen(false) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تعديل الشحنة {shipment.shipmentNo}</DialogTitle>
            <DialogDescription>
              تعديل بيانات الشحنة ضمن الحقول المسموحة. لا يمكن تعديل مبالغ الشحنات المحصّلة أو التي رُحّل قيدها المحاسبي (409 من الخادم).
            </DialogDescription>
          </DialogHeader>
          {ev && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
              <div>
                <label className="text-xs font-medium">رقم البوليصة</label>
                <Input value={ev.billNo} onChange={(e) => setEv({ ...ev, billNo: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium">اسم المستلم</label>
                <Input value={ev.recipientName} onChange={(e) => setEv({ ...ev, recipientName: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium">هواتف التوصيل</label>
                <Input value={ev.deliveryPhones} onChange={(e) => setEv({ ...ev, deliveryPhones: e.target.value })} className="dir-ltr" />
              </div>
              <div>
                <label className="text-xs font-medium">رقم السيارة</label>
                <Input value={ev.vehicleNo} onChange={(e) => setEv({ ...ev, vehicleNo: e.target.value })} className="dir-ltr" />
              </div>
              <div>
                <label className="text-xs font-medium">الوجهة (المدينة)</label>
                <Input value={ev.destination} onChange={(e) => setEv({ ...ev, destination: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium">الوجهة (EN)</label>
                <Input value={ev.destinationEn} onChange={(e) => setEv({ ...ev, destinationEn: e.target.value })} className="dir-ltr" />
              </div>
              <div>
                <label className="text-xs font-medium">كود الخط/التكويد</label>
                <Input value={ev.routeCode} onChange={(e) => setEv({ ...ev, routeCode: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium">جهة الشحن</label>
                <Input value={ev.shipToParty} onChange={(e) => setEv({ ...ev, shipToParty: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium">نوع الحمولة</label>
                <Select value={ev.loadType || '__'} onValueChange={(val) => setEv({ ...ev, loadType: val === '__' ? '' : val })}>
                  <SelectTrigger><SelectValue placeholder="اختر الحجم..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__">— غير محدد —</SelectItem>
                    {editLoadTypes.map((i) => <SelectItem key={i.key} value={i.key}>{i.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium">العميل</label>
                <Select value={ev.customerId || '__'} onValueChange={(val) => setEv({ ...ev, customerId: val === '__' ? '' : val })}>
                  <SelectTrigger><SelectValue placeholder="اختر عميلاً..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__">— بدون —</SelectItem>
                    {(editParties?.items ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium">المقاول/الناقل</label>
                <Select value={ev.contractorId || '__'} onValueChange={(val) => setEv({ ...ev, contractorId: val === '__' ? '' : val })}>
                  <SelectTrigger><SelectValue placeholder="اختر مقاولًا..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__">— بدون —</SelectItem>
                    {(editContractors?.items ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium">الفرع</label>
                <Select value={ev.branchId || '__'} onValueChange={(val) => setEv({ ...ev, branchId: val === '__' ? '' : val })}>
                  <SelectTrigger><SelectValue placeholder="اختر فرعًا..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__">— بدون —</SelectItem>
                    {(editBranches?.items ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium">المخزن</label>
                <Select value={ev.warehouseId || '__'} onValueChange={(val) => setEv({ ...ev, warehouseId: val === '__' ? '' : val })}>
                  <SelectTrigger><SelectValue placeholder="اختر مخزنًا..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__">— بدون —</SelectItem>
                    {(editWarehouses?.items ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {/* أعداد تشغيلية — ليست مبالغ مالية */}
              <div>
                <label className="text-xs font-medium">عدد القطع</label>
                <Input type="number" value={ev.policyQty ?? ''} onChange={(e) => setEv({ ...ev, policyQty: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label className="text-xs font-medium">عدد 1.5 طن</label>
                <Input type="number" value={ev.ton15 ?? ''} onChange={(e) => setEv({ ...ev, ton15: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label className="text-xs font-medium">عدد 3 طن</label>
                <Input type="number" value={ev.ton3 ?? ''} onChange={(e) => setEv({ ...ev, ton3: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label className="text-xs font-medium">عدد 6 متر</label>
                <Input type="number" value={ev.m6 ?? ''} onChange={(e) => setEv({ ...ev, m6: e.target.value })} placeholder="0" />
              </div>
              {/* المبالغ المالية — تُعرض فقط لمن يملك صلاحية الأسعار */}
              {canPrices && (
                <>
                  <div>
                    <label className="text-xs font-medium">تكلفة النولون</label>
                    <Input type="number" value={ev.freightCost ?? ''} onChange={(e) => setEv({ ...ev, freightCost: e.target.value })} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">إجمالي النولون</label>
                    <Input type="number" value={ev.freightTotal ?? ''} onChange={(e) => setEv({ ...ev, freightTotal: e.target.value })} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">نولون المقاول (إجمالي الموردين)</label>
                    <Input type="number" value={ev.totalSuppliers ?? ''} onChange={(e) => setEv({ ...ev, totalSuppliers: e.target.value })} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">سعر البيع</label>
                    <Input type="number" value={ev.salePrice ?? ''} onChange={(e) => setEv({ ...ev, salePrice: e.target.value })} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">مدفوع من العميل</label>
                    <Input type="number" value={ev.customerPay ?? ''} onChange={(e) => setEv({ ...ev, customerPay: e.target.value })} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">تعتيق</label>
                    <Input type="number" value={ev.aging ?? ''} onChange={(e) => setEv({ ...ev, aging: e.target.value })} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">مبيت</label>
                    <Input type="number" value={ev.overnight ?? ''} onChange={(e) => setEv({ ...ev, overnight: e.target.value })} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">مرتجعات</label>
                    <Input type="number" value={ev.returns ?? ''} onChange={(e) => setEv({ ...ev, returns: e.target.value })} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">تحويلة</label>
                    <Input type="number" value={ev.transfer ?? ''} onChange={(e) => setEv({ ...ev, transfer: e.target.value })} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">أخرى</label>
                    <Input type="number" value={ev.other ?? ''} onChange={(e) => setEv({ ...ev, other: e.target.value })} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">دروب</label>
                    <Input type="number" value={ev.drop ?? ''} onChange={(e) => setEv({ ...ev, drop: e.target.value })} placeholder="0" />
                  </div>
                </>
              )}
              <div className="sm:col-span-2">
                <label className="text-xs font-medium">ملاحظات</label>
                <Textarea value={ev.notes} onChange={(e) => setEv({ ...ev, notes: e.target.value })} rows={2} />
              </div>
            </div>
          )}
          {editErr && <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{editErr}</div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>إلغاء</Button>
            <Button onClick={submitEdit} disabled={editLoading}>{editLoading ? 'جاري الحفظ...' : 'حفظ التعديلات'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* COD settlement dialog */}
      <Dialog open={codOpen} onOpenChange={setCodOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تسوية الدفع عند الاستلام (COD)</DialogTitle>
            <DialogDescription>
              يصدر النظام سند قبض من العميل بقيمة نولون العميل وسند صرف للمقاول بقيمة نولون المقاول — مع قيود يومية تلقائية — ويُحدّث حالة التحصيل.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <div>
              <label className="text-xs font-medium">سند قبض من العميل (ج.م)</label>
              <Input type="number" value={codCustomerAmount} onChange={(e) => setCodCustomerAmount(e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-0.5">قيمة نولون العميل — يصدر سند قبض للعميل ويُرحّل في الصندوق ومديونية العميل.</p>
            </div>
            <div>
              <label className="text-xs font-medium">سند صرف للمقاول (ج.م)</label>
              <Input type="number" value={codContractorAmount} onChange={(e) => setCodContractorAmount(e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-0.5">قيمة نولون المقاول — يصدر سند صرف للمقاول ويُرحّل في الصندوق ومستحقات المقاولين.</p>
            </div>
          </div>
          <div className="text-xs text-muted-foreground bg-muted/30 rounded-md p-2">
            العميل: <b>{shipment.customer?.name || shipment.recipientName || '-'}</b> — المقاول: <b>{shipment.contractor?.name || '-'}</b>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCodOpen(false)}>إلغاء</Button>
            <Button onClick={settleCOD} disabled={codLoading}><Banknote className="size-4" /> {codLoading ? 'جاري التسوية...' : 'تأكيد التسوية'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Waybill print */}
      <WaybillPrint shipment={shipment} open={waybillOpen} onOpenChange={setWaybillOpen} />
    </div>
  )
}

function Row({ label, value, ltr, money, bold }: { label: string; value: string; ltr?: boolean; money?: boolean; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 border-b last:border-0">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={cn('text-right', ltr && 'dir-ltr font-mono', money && 'tnum', bold && 'font-bold')} dir={ltr ? 'ltr' : undefined}>{value}</span>
    </div>
  )
}
