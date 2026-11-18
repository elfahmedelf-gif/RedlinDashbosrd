'use client'

// ============================================================================
// وحدة الفواتير الرسمية للعملاء — فاتورة ضريبية مرتبطة بالشحنات والقيد المزدوج
// - دورة حياة كاملة: مسودة ← إصدار (قيد مزدوج تلقائي) ← دفعات تحصيل ← إلغاء (قيد عكسي)
// - إنشاء من شحنات العميل غير المفوترة (جلب آلي بنون الديليفري والمسار والنولون)
//   أو بنود يدوية — مع منع الفوترة المزدوجة لأي شحنة على مستوى الخادم
// - طباعة A4 ضريبية + تصدير Excel بنفس تنسيق النظام RTL
// ============================================================================

import * as React from 'react'
import useSWR from 'swr'
import {
  FilePlus2, Printer, Eye, CheckCheck, Banknote, Ban, Pencil, Trash2,
  Plus, X, Truck, RefreshCw, Loader2, FileStack, Wallet, AlarmClock, FileDown,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Kpi } from '../ui-cards'
import { DataTable } from '../data-table'
import { fetcher } from '@/lib/api'
import { apiPostSync, apiPatchSync, apiDeleteSync } from '@/lib/sync'
import { exportToExcel } from '@/lib/export'
import { fmtNum, fmtDate, fmtDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuth } from '../auth-provider'
import { useToast } from '@/hooks/use-toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { InvoicePrint, type InvoicePrintData } from '../invoice-print'

// ---------------------------------------------------------------------------
// بيانات + ثوابت
// ---------------------------------------------------------------------------
interface InvoiceRow {
  id: string
  invoiceNumber: string
  customerId: string
  customer: { id: string; name: string; code: string | null; taxNumber: string | null } | null
  issueDate: string
  dueDate: string | null
  status: string
  statusLabel: string
  subtotal: number
  vatRate: number
  vatAmount: number
  discountAmount: number
  totalAmount: number
  paidAmount: number
  remaining: number
  itemsCount: number
  paymentsCount: number
  journalEntryNo: string | null
  journalEntryStatus: string | null
  overdue: boolean
  notes: string | null
  createdByName: string | null
  issuedByName: string | null
  issuedAt: string | null
  createdAt: string
}

interface InvoicesResponse {
  items: InvoiceRow[]
  total: number
  summary: {
    count: number; drafts: number; open: number; overdue: number
    totalIssued: number; totalPaid: number; totalOutstanding: number
  }
}

interface DetailItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  total: number
  shipment?: { id: string; shipmentNo: string | null; deliveryNumber: string | null; destination: string | null; freightTotal: number | null; status: string } | null
}

interface InvoiceDetail extends InvoiceRow {
  items: DetailItem[]
  customer: { id: string; name: string; code: string | null; taxNumber: string | null; phone: string | null; phones: string | null; address: string | null; city: string | null }
  payments: { id: string; voucherNo: string; amount: number; notes: string | null; status: string; accountName: string | null; createdAt: string; journalEntry: { entryNo: string; status: string } | null }[]
  journalEntry: { entryNo: string; status: string; totalDebit: number; totalCredit: number; lines: { id: string; debit: number; credit: number; description: string | null; account: { code: string; name: string } }[] } | null
  cancelReason: string | null
  cancelledAt: string | null
  cancelledByName: string | null
}

interface UninvoicedShipment {
  id: string
  shipmentNo: string | null
  deliveryNumber: string | null
  destination: string | null
  recipientName: string | null
  status: string
  date: string | null
  freightTotal: number
  contractor: { id: string; name: string } | null
  delivered: boolean
}

const STATUS_META: Record<string, { label: string; tone: string }> = {
  draft: { label: 'مسودة', tone: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' },
  issued: { label: 'صادرة', tone: 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300' },
  partially_paid: { label: 'مسددة جزئيًا', tone: 'bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300' },
  paid: { label: 'مسددة بالكامل', tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' },
  cancelled: { label: 'ملغاة', tone: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300' },
}

const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'draft', label: 'المسودات' },
  { key: 'issued', label: 'الصادرة' },
  { key: 'partially_paid', label: 'مسددة جزئيًا' },
  { key: 'paid', label: 'المسددة' },
  { key: 'cancelled', label: 'الملغاة' },
]

const OPEN_STATUSES = ['issued', 'partially_paid']
const money = (n: number) => fmtNum(Number(n) || 0, 2)

function StatusBadge({ status, label }: { status: string; label: string }) {
  const meta = STATUS_META[status] ?? { label, tone: 'bg-slate-100 text-slate-700' }
  return <span className={cn('inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap', meta.tone)}>{meta.label}</span>
}

// ---------------------------------------------------------------------------
// نافذة إنشاء/تعديل فاتورة — عميل + شحنات غير مفوترة + بنود يدوية + ضريبة وخصم
// ---------------------------------------------------------------------------
interface FormItem { key: string; shipmentId: string | null; description: string; quantity: number; unitPrice: number }

function InvoiceFormDialog({
  open, onOpenChange, editing, onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: InvoiceRow | null
  onSaved: () => void
}) {
  const { toast } = useToast()
  const isEdit = !!editing
  const [customerId, setCustomerId] = React.useState('')
  const [items, setItems] = React.useState<FormItem[]>([])
  const [vatRate, setVatRate] = React.useState('14')
  const [discount, setDiscount] = React.useState('')
  const [dueDate, setDueDate] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState('')

  // الشحنات غير المفوترة
  const [showShipments, setShowShipments] = React.useState(false)
  const [selectedShipments, setSelectedShipments] = React.useState<Set<string>>(new Set())
  const { data: uninvoiced, isLoading: loadingShipments, mutate: refetchShipments } = useSWR<{ items: UninvoicedShipment[] }>(
    open && customerId ? `/api/invoices/uninvoiced-shipments?customerId=${customerId}` : null, fetcher)

  const { data: customersData } = useSWR<{ items: { id: string; name: string; code: string | null }[] }>(
    open ? '/api/parties?type=customer' : null, fetcher)
  const customers = customersData?.items ?? []

  // تحميل بيانات المسودة عند التعديل
  const { data: detail } = useSWR<InvoiceDetail>(open && isEdit ? `/api/invoices/${editing!.id}` : null, fetcher)

  React.useEffect(() => {
    if (!open) return
    setErr('')
    setSelectedShipments(new Set())
    setShowShipments(false)
    if (isEdit && detail) {
      setCustomerId(detail.customerId)
      setItems(detail.items.map((it, i) => ({
        key: `edit-${it.id}-${i}`,
        shipmentId: it.shipment?.id ?? null,
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
      })))
      setVatRate(String(detail.vatRate))
      setDiscount(detail.discountAmount > 0 ? String(detail.discountAmount) : '')
      setDueDate(detail.dueDate ? new Date(detail.dueDate).toISOString().slice(0, 10) : '')
      setNotes(detail.notes ?? '')
    } else if (!isEdit) {
      setCustomerId('')
      setItems([])
      setVatRate('14')
      setDiscount('')
      setDueDate('')
      setNotes('')
    }
  }, [open, isEdit, detail])

  const setItem = (key: string, patch: Partial<FormItem>) =>
    setItems((s) => s.map((it) => (it.key === key ? { ...it, ...patch } : it)))

  const addManualLine = () =>
    setItems((s) => [...s, { key: `m-${Date.now()}-${s.length}`, shipmentId: null, description: '', quantity: 1, unitPrice: 0 }])

  const removeItem = (key: string) => setItems((s) => s.filter((it) => it.key !== key))

  const addSelectedShipments = () => {
    const rows = (uninvoiced?.items ?? []).filter((s) => selectedShipments.has(s.id))
    if (!rows.length) return
    setItems((cur) => {
      const existing = new Set(cur.map((i) => i.shipmentId))
      const additions = rows
        .filter((r) => !existing.has(r.id))
        .map((r) => ({
          key: `sh-${r.id}`,
          shipmentId: r.id,
          description: `نقل شحنة رقم ديليفري ${r.deliveryNumber ?? r.shipmentNo ?? ''}${r.destination ? ` — ${r.destination}` : ''}`,
          quantity: 1,
          unitPrice: Math.max(0, r.freightTotal || 0),
        }))
      return [...cur, ...additions]
    })
    setSelectedShipments(new Set())
    setShowShipments(false)
    toast({ title: `تم استيراد ${rows.length} شحنة`, description: 'راجع الأسعار والبنود ثم احفظ الفاتورة' })
  }

  const subtotal = items.reduce((s, it) => s + Math.max(0, it.quantity) * Math.max(0, it.unitPrice), 0)
  const discountVal = Math.min(Math.max(Number(discount) || 0, 0), subtotal)
  const net = subtotal - discountVal
  const vatVal = (net * (Number(vatRate) || 0)) / 100
  const totalVal = net + vatVal

  const submit = async () => {
    setErr('')
    if (!customerId) { setErr('اختيار العميل مطلوب'); return }
    if (!items.length) { setErr('الفاتورة تحتاج بندًا واحدًا على الأقل — استورد شحنات أو أضف بندًا يدويًا'); return }
    if (items.some((it) => !it.description.trim())) { setErr('كل البنود تحتاج وصفًا'); return }
    if (items.some((it) => !(it.quantity > 0) || !(it.unitPrice > 0))) { setErr('الكمية وسعر الوحدة يجب أن يكونا أكبر من صفر'); return }
    setBusy(true)
    try {
      const payload = {
        customerId,
        items: items.map((it) => ({ shipmentId: it.shipmentId, description: it.description.trim(), quantity: Number(it.quantity), unitPrice: Number(it.unitPrice) })),
        vatRate: Number(vatRate),
        discountAmount: discountVal,
        dueDate: dueDate || null,
        notes: notes || null,
      }
      if (isEdit) {
        const r = await apiPatchSync(`/api/invoices/${editing!.id}`, payload)
        toast({ title: 'تم تحديث المسودة', description: `الفاتورة ${r.invoiceNumber} — إجمالي ${money(r.totalAmount)} ج.م` })
      } else {
        const r = await apiPostSync('/api/invoices', payload)
        toast({ title: 'تم إنشاء مسودة الفاتورة', description: `${r.invoiceNumber} — إجمالي ${money(r.totalAmount)} ج.م — أصدرها لتُرحّل قيدها المحاسبي` })
      }
      onOpenChange(false)
      onSaved()
    } catch (e: any) {
      setErr(e.message || 'حدث خطأ غير متوقع')
    } finally {
      setBusy(false)
    }
  }

  const shipmentRows = uninvoiced?.items ?? []

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v) }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" dir="rtl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{isEdit ? `تعديل مسودة الفاتورة ${editing?.invoiceNumber}` : 'فاتورة جديدة — مسودة'}</DialogTitle>
          <DialogDescription>
            المسودة بلا أثر محاسبي — عند الإصدار يُرحّل قيد مزدوج تلقائيًا (مدين العملاء / دائن الإيراد + الضريبة 2103)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* العميل + تاريخ الاستحقاق — شبكة 12 عمودًا مع min-w-0 لمنع أي تداخل في RTL */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
            <div className="sm:col-span-8 min-w-0">
              <Label className="text-xs font-medium mb-1.5 block whitespace-nowrap">العميل *</Label>
              <Select value={customerId} onValueChange={(v) => { setCustomerId(v); setShowShipments(false) }} disabled={isEdit || busy}>
                <SelectTrigger className="w-full overflow-hidden"><SelectValue placeholder="اختر عميلًا..." /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-4 min-w-0">
              <Label className="text-xs font-medium mb-1.5 block whitespace-nowrap">تاريخ الاستحقاق</Label>
              <Input type="date" className="w-full" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={busy} />
            </div>
          </div>

          {/* استيراد الشحنات غير المفوترة */}
          {customerId && (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <FileStack className="size-4 text-primary" />
                  شحنات العميل غير المفوترة {shipmentRows.length > 0 && <Badge variant="secondary" className="tnum">{shipmentRows.length}</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowShipments((s) => !s)} disabled={busy}>
                    {showShipments ? 'إخفاء القائمة' : 'جلب الشحنات غير المفوترة'}
                    <RefreshCw className={cn('size-3.5', loadingShipments && 'animate-spin')} />
                  </Button>
                  {selectedShipments.size > 0 && (
                    <Button size="sm" onClick={addSelectedShipments} disabled={busy}>
                      إضافة {selectedShipments.size} شحنة كبنود
                    </Button>
                  )}
                </div>
              </div>
              {showShipments && (
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-card divide-y divide-border/60">
                  {loadingShipments ? (
                    <div className="p-3 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
                  ) : shipmentRows.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      لا توجد شحنات غير مفوترة لهذا العميل — كل شحناته مفوترة أو محصّلة أو ملغاة
                    </div>
                  ) : (
                    shipmentRows.map((s) => (
                      <label key={s.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 cursor-pointer text-xs">
                        <Checkbox
                          checked={selectedShipments.has(s.id)}
                          onCheckedChange={(v) => setSelectedShipments((prev) => {
                            const next = new Set(prev)
                            if (v) next.add(s.id); else next.delete(s.id)
                            return next
                          })}
                        />
                        <span className="font-mono font-bold text-[11px] min-w-[80px]">{s.deliveryNumber ?? s.shipmentNo ?? '—'}</span>
                        <span className="flex-1 truncate">{s.destination ?? '—'}</span>
                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap',
                          s.delivered ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300')}>
                          {s.delivered ? 'مسلّمة' : 'قيد التشغيل'}
                        </span>
                        <span className="tnum font-bold text-[11px] min-w-[72px] text-left">{money(s.freightTotal)} ج.م</span>
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {/* بنود الفاتورة */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">بنود الفاتورة ({items.length})</Label>
              <Button variant="outline" size="sm" onClick={addManualLine} disabled={busy}>
                <Plus className="size-3.5" /> بند يدوي
              </Button>
            </div>
            {items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                لا بنود بعد — استورد شحنات العميل من الأعلى أو أضف بندًا يدويًا (خدمات إضافية...)
              </div>
            ) : (
              <div className="space-y-2">
                <div className="hidden sm:grid grid-cols-12 gap-2 text-[10px] font-bold text-muted-foreground px-1">
                  <div className="col-span-7">البيان</div>
                  <div className="col-span-1 text-center">كمية</div>
                  <div className="col-span-2 text-center">سعر الوحدة</div>
                  <div className="col-span-1 text-center">إجمالي</div>
                  <div className="col-span-1" />
                </div>
                {items.map((it) => (
                  <div key={it.key} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-12 sm:col-span-7 space-y-1">
                      {it.shipmentId && (
                        <Badge variant="secondary" className="text-[9px] mb-1">
                          <Truck className="size-2.5 ml-1" /> شحنة مرتبطة — تُحجب للفاتورة
                        </Badge>
                      )}
                      <Input
                        value={it.description}
                        onChange={(e) => setItem(it.key, { description: e.target.value })}
                        placeholder="وصف البند (مثال: نقل شحنة رقم ديليفري DLV-1045 — القاهرة إلى المنصورة)"
                        className="text-xs"
                        disabled={busy}
                      />
                    </div>
                    <Input
                      type="number" min="1" step="1" value={String(it.quantity)}
                      onChange={(e) => setItem(it.key, { quantity: Math.max(0, Number(e.target.value) || 0) })}
                      className="col-span-3 sm:col-span-1 text-center text-xs tnum" disabled={busy}
                    />
                    <Input
                      type="number" min="0" step="0.01" value={String(it.unitPrice)}
                      onChange={(e) => setItem(it.key, { unitPrice: Math.max(0, Number(e.target.value) || 0) })}
                      className="col-span-5 sm:col-span-2 text-center text-xs tnum" disabled={busy}
                    />
                    <div className="col-span-2 sm:col-span-1 text-center text-xs font-bold tnum">
                      {money(it.quantity * it.unitPrice)}
                    </div>
                    <button
                      onClick={() => removeItem(it.key)}
                      className="col-span-2 sm:col-span-1 mx-auto size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title="إزالة البند" aria-label="إزالة البند"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* الضريبة والخصم — صف مستقل بعمودين متساويين مع min-w-0 (بلا تداخل) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
            <div className="min-w-0">
              <Label className="text-xs font-medium mb-1.5 block whitespace-nowrap">نسبة ضريبة القيمة المضافة</Label>
              <Select value={vatRate} onValueChange={setVatRate} disabled={busy}>
                <SelectTrigger className="w-full overflow-hidden"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="14">14% — خاضعة للضريبة</SelectItem>
                  <SelectItem value="0">0% — معفاة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label className="text-xs font-medium mb-1.5 block whitespace-nowrap">الخصم (ج.م)</Label>
              <Input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" className="tnum w-full" disabled={busy} />
            </div>
          </div>

          {/* ملخص الإجماليات — بطاقة كاملة العرض أسفل الحقلين */}
          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 space-y-1.5 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
              <div className="flex justify-between"><span className="text-muted-foreground">الإجمالي قبل الضريبة</span><b className="tnum">{money(subtotal)} ج.م</b></div>
              {discountVal > 0 && <div className="flex justify-between text-amber-600"><span>الخصم</span><b className="tnum">- {money(discountVal)} ج.م</b></div>}
              <div className="flex justify-between"><span className="text-muted-foreground">الصافي</span><b className="tnum">{money(net)} ج.م</b></div>
              <div className="flex justify-between"><span className="text-muted-foreground">الضريبة ({vatRate}%)</span><b className="tnum">{money(vatVal)} ج.م</b></div>
            </div>
            <Separator />
            <div className="flex justify-between text-sm"><span>الإجمالي النهائي</span><b className="tnum text-primary">{money(totalVal)} ج.م</b></div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">ملاحظات</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات تظهر على الفاتورة (اختياري)" disabled={busy} />
          </div>

          {err && (
            <div className="rounded-lg bg-destructive/10 text-destructive text-xs px-3 py-2 font-medium">{err}</div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>إلغاء</Button>
          <Button onClick={submit} disabled={busy || !items.length}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? 'حفظ تعديلات المسودة' : 'حفظ المسودة'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// نافذة تفاصيل الفاتورة — بنود + دفعات + القيد المحاسبي
// ---------------------------------------------------------------------------
function InvoiceDetailDialog({
  invoiceId, open, onOpenChange, onAction,
  canIssue, canPay, canCancel,
}: {
  invoiceId: string | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onAction: (action: 'issue' | 'pay' | 'cancel' | 'print', row: InvoiceDetail) => void
  canIssue: boolean
  canPay: boolean
  canCancel: boolean
}) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const { data: d, isLoading, mutate } = useSWR<InvoiceDetail>(open && invoiceId ? `/api/invoices/${invoiceId}` : null, fetcher)

  const reversePayment = async (p: { id: string; voucherNo: string; amount: number }) => {
    const ok = await confirm({
      title: 'عكس دفعة التحصيل',
      message: `سيُعكس قيد سند القبض ${p.voucherNo} بمبلغ ${money(p.amount)} ج.م وتعود الفاتورة لحالة السداد السابقة. هل تريد المتابعة؟`,
      variant: 'warning',
      confirmText: 'عكس الدفعة',
    })
    if (!ok) return
    try {
      const r = await apiPostSync(`/api/invoices/${invoiceId}/payments/reverse`, { paymentId: p.id, reason: 'عكس من شاشة الفواتير' })
      toast({ title: 'تم عكس الدفعة', description: `سند ${r.voucherNo} — عكس بالقيد ${r.reversalNo} — المسدد الآن ${money(r.paidAmount)} ج.م` })
      mutate()
    } catch (e: any) {
      toast({ title: 'تعذر عكس الدفعة', description: e.message, variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" dir="rtl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            الفاتورة {d?.invoiceNumber ?? '...'}
            {d && <StatusBadge status={d.status} label={d.statusLabel} />}
            {d?.overdue && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                <AlarmClock className="size-3" /> متأخرة السداد
              </span>
            )}
          </DialogTitle>
          {d && <DialogDescription>{d.customer?.name} — صادرة {fmtDate(d.issueDate)}{d.dueDate ? ` — تستحق ${fmtDate(d.dueDate)}` : ''}</DialogDescription>}
        </DialogHeader>

        {isLoading || !d ? (
          <div className="space-y-3 py-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : (
          <div className="space-y-4">
            {/* ملخص مالي */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: 'قبل الضريبة', value: `${money(d.subtotal)} ج.م` },
                { label: `الضريبة ${fmtNum(d.vatRate)}%`, value: `${money(d.vatAmount)} ج.م` },
                { label: 'الإجمالي', value: `${money(d.totalAmount)} ج.م`, strong: true },
                { label: 'المتبقي', value: `${money(d.remaining)} ج.م` },
              ].map((k, i) => (
                <div key={i} className={cn('rounded-xl border border-border px-3 py-2', k.strong && 'bg-primary/5 border-primary/30')}>
                  <div className="text-[10px] text-muted-foreground">{k.label}</div>
                  <div className={cn('text-sm font-bold tnum', k.strong && 'text-primary')}>{k.value}</div>
                </div>
              ))}
            </div>

            {/* بيانات العميل */}
            <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs space-y-1">
              <div className="font-bold text-sm">{d.customer?.name}</div>
              <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5">
                {d.customer?.code && <span>الكود: <b className="font-mono">{d.customer.code}</b></span>}
                {d.customer?.taxNumber && <span>الرقم الضريبي: <b className="font-mono">{d.customer.taxNumber}</b></span>}
                {(d.customer?.phone || d.customer?.phones) && <span dir="ltr">{d.customer?.phone || d.customer?.phones}</span>}
              </div>
            </div>

            {/* البنود */}
            <div className="space-y-1.5">
              <div className="text-xs font-bold text-muted-foreground">بنود الفاتورة ({d.items.length})</div>
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="text-right font-medium px-3 py-2">البيان</th>
                      <th className="text-center font-medium px-2 py-2 w-14">كمية</th>
                      <th className="text-center font-medium px-2 py-2 w-24">السعر</th>
                      <th className="text-center font-medium px-2 py-2 w-24">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {d.items.map((it) => (
                      <tr key={it.id}>
                        <td className="px-3 py-2">
                          <div className="leading-snug">{it.description}</div>
                          {it.shipment && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              ديلفري {it.shipment.deliveryNumber ?? it.shipment.shipmentNo ?? '—'}{it.shipment.destination ? ` — ${it.shipment.destination}` : ''}
                            </div>
                          )}
                        </td>
                        <td className="text-center tnum px-2 py-2">{fmtNum(it.quantity)}</td>
                        <td className="text-center tnum px-2 py-2">{money(it.unitPrice)}</td>
                        <td className="text-center tnum font-bold px-2 py-2">{money(it.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {d.discountAmount > 0 && (
                <div className="text-[11px] text-amber-600">خصم ممنوح: {money(d.discountAmount)} ج.م</div>
              )}
            </div>

            {/* الدفعات */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-muted-foreground">دفعات التحصيل ({d.payments.filter((p) => p.status === 'completed').length})</div>
                {canPay && OPEN_STATUSES.includes(d.status) && (
                  <Button size="sm" variant="outline" onClick={() => onAction('pay', d)}>
                    <Banknote className="size-3.5" /> تسجيل دفعة
                  </Button>
                )}
              </div>
              {d.payments.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  لا دفعات مسجلة على الفاتورة بعد
                </div>
              ) : (
                <div className="rounded-xl border border-border divide-y divide-border/60 max-h-56 overflow-y-auto">
                  {d.payments.map((p) => (
                    <div key={p.id} className={cn('flex items-center gap-3 px-3 py-2 text-xs', p.status !== 'completed' && 'opacity-50')}>
                      <Banknote className={cn('size-4 shrink-0', p.status === 'completed' ? 'text-emerald-600' : 'text-muted-foreground')} />
                      <span className="font-mono font-bold">{p.voucherNo}</span>
                      <span className="tnum font-bold">{money(p.amount)} ج.م</span>
                      <span className="text-muted-foreground truncate flex-1">{p.accountName ?? ''} — {fmtDateTime(p.createdAt)}</span>
                      {p.journalEntry && <span className="text-[10px] text-muted-foreground font-mono">قيد {p.journalEntry.entryNo}</span>}
                      {p.status !== 'completed' && <Badge variant="secondary" className="text-[9px]">معكوسة</Badge>}
                      {p.status === 'completed' && canCancel && (
                        <Button size="sm" variant="ghost" className="h-7 text-[11px] text-destructive hover:text-destructive" onClick={() => reversePayment(p)}>
                          عكس
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* القيد المحاسبي */}
            {d.journalEntry ? (
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="bg-muted/60 px-3 py-2 text-xs font-bold flex items-center justify-between">
                  <span>القيد المحاسبي للإصدار — <span className="font-mono">{d.journalEntry.entryNo}</span></span>
                  <Badge variant={d.journalEntry.status === 'posted' ? 'default' : 'secondary'} className="text-[9px]">
                    {d.journalEntry.status === 'posted' ? 'مُرحّل' : d.journalEntry.status === 'void' ? 'ملغي' : 'مسودة'}
                  </Badge>
                </div>
                <table className="w-full text-[11px]">
                  <tbody className="divide-y divide-border/50">
                    {d.journalEntry.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="px-3 py-1.5 font-mono text-muted-foreground w-16">{l.account.code}</td>
                        <td className="px-1 py-1.5 flex-1">{l.account.name}{l.description ? ` — ${l.description}` : ''}</td>
                        <td className="px-3 py-1.5 text-center tnum w-28">{l.debit > 0 ? <b className="text-emerald-700 dark:text-emerald-400">{money(l.debit)}</b> : '—'}</td>
                        <td className="px-3 py-1.5 text-center tnum w-28">{l.credit > 0 ? <b className="text-rose-700 dark:text-rose-400">{money(l.credit)}</b> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : d.status === 'draft' ? (
              <div className="rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                المسودة بلا قيد محاسبي — يُرحّل القيد المزدوج تلقائيًا عند الإصدار
              </div>
            ) : null}

            {/* ملخص الحالة */}
            <div className="text-[11px] text-muted-foreground space-y-0.5">
              <div>أنشأها: <b>{d.createdByName ?? '—'}</b> — {fmtDateTime(d.createdAt)}</div>
              {d.issuedByName && <div>أصدرها: <b>{d.issuedByName}</b> — {fmtDateTime(d.issuedAt ?? d.createdAt)}</div>}
              {d.cancelledByName && <div>ألغاها: <b>{d.cancelledByName}</b> — {fmtDateTime(d.cancelledAt ?? '')}{d.cancelReason ? ` — السبب: ${d.cancelReason}` : ''}</div>}
            </div>
          </div>
        )}

        <DialogFooter className="flex flex-wrap items-center justify-start gap-2 sm:justify-start">
          {d && (
            <>
              <Button variant="outline" size="sm" onClick={() => onAction('print', d)}>
                <Printer className="size-3.5" /> طباعة A4
              </Button>
              {canIssue && d.status === 'draft' && (
                <Button size="sm" onClick={() => onAction('issue', d)}>
                  <CheckCheck className="size-3.5" /> إصدار الفاتورة
                </Button>
              )}
              {canPay && OPEN_STATUSES.includes(d.status) && (
                <Button size="sm" onClick={() => onAction('pay', d)}>
                  <Banknote className="size-3.5" /> تسجيل دفعة
                </Button>
              )}
              {canCancel && ['issued', 'partially_paid'].includes(d.status) && (
                <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => onAction('cancel', d)}>
                  <Ban className="size-3.5" /> إلغاء الفاتورة
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// نافذة دفعة تحصيل
// ---------------------------------------------------------------------------
function PaymentDialog({
  invoice, open, onOpenChange, onDone,
}: {
  invoice: InvoiceRow | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const [amount, setAmount] = React.useState('')
  const [method, setMethod] = React.useState('cash')
  const [notes, setNotes] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState('')

  React.useEffect(() => {
    if (open && invoice) {
      setAmount(String(invoice.remaining || ''))
      setMethod('cash')
      setNotes('')
      setErr('')
    }
  }, [open, invoice])

  const submit = async () => {
    if (!invoice) return
    setErr('')
    const amt = Number(amount)
    if (!(amt > 0)) { setErr('أدخل مبلغًا صحيحًا أكبر من صفر'); return }
    if (amt > invoice.remaining + 0.001) { setErr(`الدفعة تتجاوز المتبقي (${money(invoice.remaining)} ج.م)`); return }
    setBusy(true)
    try {
      const r = await apiPostSync(`/api/invoices/${invoice.id}/payments`, { amount: amt, method, notes: notes || null })
      toast({
        title: r.status === 'paid' ? 'الفاتورة مسددة بالكامل' : 'تم تسجيل الدفعة',
        description: `سند ${r.voucherNo} — قيد ${r.journalEntryNo} — المسدد ${money(r.paidAmount)} من ${money(invoice.totalAmount)} ج.م`,
      })
      onOpenChange(false)
      onDone()
    } catch (e: any) {
      setErr(e.message || 'حدث خطأ')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v) }}>
      <DialogContent className="max-w-md" dir="rtl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>تسجيل دفعة تحصيل — {invoice?.invoiceNumber}</DialogTitle>
          <DialogDescription>
            سند قبض مكتمل مع قيده المزدوج (مدين الصندوق/البنك — دائن العملاء) وتحديث حالة السداد تلقائيًا
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs flex items-center justify-between">
            <span className="text-muted-foreground">المتبقي على الفاتورة</span>
            <b className="tnum text-sm">{money(invoice?.remaining ?? 0)} ج.م</b>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">مبلغ الدفعة (ج.م) *</Label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="tnum" disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">طريقة الدفع</Label>
            <Select value={method} onValueChange={setMethod} disabled={busy}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">نقدي من الصندوق</SelectItem>
                <SelectItem value="bank">تحويل بنكي</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">ملاحظات</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثال: شيك رقم 4521 بنك مصر" disabled={busy} />
          </div>
          {err && <div className="rounded-lg bg-destructive/10 text-destructive text-xs px-3 py-2 font-medium">{err}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>إلغاء</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            تسجيل الدفعة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// نافذة إلغاء الفاتورة
// ---------------------------------------------------------------------------
function CancelDialog({
  invoice, open, onOpenChange, onDone,
}: {
  invoice: InvoiceRow | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState('')

  React.useEffect(() => {
    if (open) { setReason(''); setErr('') }
  }, [open])

  const submit = async () => {
    if (!invoice) return
    setErr('')
    setBusy(true)
    try {
      const r = await apiPostSync(`/api/invoices/${invoice.id}/cancel`, { reason: reason || null })
      toast({ title: 'تم إلغاء الفاتورة', description: `قيد عكسي ${r.reversalNo} — فُك ربط الشحنات وأصبحت جاهزة للفوترة من جديد` })
      onOpenChange(false)
      onDone()
    } catch (e: any) {
      setErr(e.message || 'حدث خطأ')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v) }}>
      <DialogContent className="max-w-md" dir="rtl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>إلغاء الفاتورة {invoice?.invoiceNumber}</DialogTitle>
          <DialogDescription>
            سيُرحّل قيد عكسي يلغي أثر الفاتورة، وتُفك ربط شحناتها لتُفوترة من جديد. لا يمكن الإلغاء إذا كانت على الفاتورة دفعات تحصيل.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">سبب الإلغاء</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: خطأ في بيانات البنود — سيُعاد إصدار فاتورة معدلة" disabled={busy} />
          </div>
          {err && <div className="rounded-lg bg-destructive/10 text-destructive text-xs px-3 py-2 font-medium">{err}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>رجوع</Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            تأكيد الإلغاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// الوحدة الرئيسية
// ---------------------------------------------------------------------------
export function InvoicesModule() {
  const { has } = useAuth()
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const canCreate = has('invoices.create')
  const canIssue = has('invoices.issue')
  const canCancel = has('invoices.cancel')

  const [status, setStatus] = React.useState('all')
  const [customerId, setCustomerId] = React.useState('all')
  const [search, setSearch] = React.useState('')
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<InvoiceRow | null>(null)
  const [detailId, setDetailId] = React.useState<string | null>(null)
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [payInvoice, setPayInvoice] = React.useState<InvoiceRow | null>(null)
  const [cancelInvoiceRow, setCancelInvoiceRow] = React.useState<InvoiceRow | null>(null)
  const [printId, setPrintId] = React.useState<string | null>(null)
  const [printOpen, setPrintOpen] = React.useState(false)

  const qs = new URLSearchParams()
  if (status !== 'all') qs.set('status', status)
  if (customerId !== 'all') qs.set('customerId', customerId)
  if (search.trim()) qs.set('q', search.trim())
  qs.set('pageSize', '200')

  const { data, isLoading, mutate } = useSWR<InvoicesResponse>(`/api/invoices?${qs.toString()}`, fetcher, {
    keepPreviousData: true,
    refreshInterval: 60000,
  })

  const { data: customersData } = useSWR<{ items: { id: string; name: string; code: string | null }[] }>(
    '/api/parties?type=customer', fetcher)
  const customers = customersData?.items ?? []

  const rows = data?.items ?? []
  const summary = data?.summary

  // ── الإجراءات ──
  const openEdit = (row: InvoiceRow) => { setEditing(row); setFormOpen(true) }
  const openDetail = (row: InvoiceRow) => { setDetailId(row.id); setDetailOpen(true) }
  const openPrint = (row: InvoiceRow) => { setPrintId(row.id); setPrintOpen(true) }

  const issueInvoice = async (row: InvoiceRow) => {
    const ok = await confirm({
      title: `إصدار الفاتورة ${row.invoiceNumber}`,
      message: `سيُرحّل قيد مزدوج:\n• مدين العملاء (1103): ${money(row.totalAmount)} ج.م\n• دائن إيراد الشحن (4101): ${money(row.subtotal - row.discountAmount)} ج.م${row.vatAmount > 0 ? `\n• دائن ضريبة القيمة المضافة (2103): ${money(row.vatAmount)} ج.م` : ''}\n\nوتُحجب الشحنات المُدخلة من أي فوترة لاحقة. هل تريد المتابعة؟`,
      confirmText: 'إصدار وترحيل القيد',
    })
    if (!ok) return
    try {
      const r = await apiPostSync(`/api/invoices/${row.id}/issue`, {})
      toast({ title: 'تم إصدار الفاتورة', description: `${r.invoiceNumber} — قيد ${r.journalEntryNo} متوازن ومُرحّل${r.reversedNos.length ? ` — أُعيد تصنيف إيراد ${r.reversedNos.length} شحنة` : ''}` })
      mutate()
    } catch (e: any) {
      toast({ title: 'تعذر الإصدار', description: e.message, variant: 'destructive' })
    }
  }

  const deleteDraft = async (row: InvoiceRow) => {
    const ok = await confirm({
      title: `حذف مسودة ${row.invoiceNumber}`,
      message: 'المسودة بلا أثر محاسبي — سيتم حذفها وبنودها نهائيًا.',
      variant: 'danger',
      confirmText: 'حذف',
    })
    if (!ok) return
    try {
      await apiDeleteSync(`/api/invoices/${row.id}`)
      toast({ title: 'تم حذف المسودة', description: `الفاتورة ${row.invoiceNumber} حُذفت نهائيًا` })
      mutate()
    } catch (e: any) {
      toast({ title: 'تعذر الحذف', description: e.message, variant: 'destructive' })
    }
  }

  const exportExcel = () => {
    exportToExcel(
      rows.map((r) => ({
        'رقم الفاتورة': r.invoiceNumber,
        'العميل': r.customer?.name ?? '',
        'كود العميل': r.customer?.code ?? '',
        'الحالة': r.statusLabel,
        'تاريخ الإصدار': r.issueDate ? new Date(r.issueDate).toISOString().slice(0, 10) : '',
        'الاستحقاق': r.dueDate ? new Date(r.dueDate).toISOString().slice(0, 10) : '',
        'قبل الضريبة': r.subtotal,
        'الخصم': r.discountAmount,
        'نسبة الضريبة': r.vatRate,
        'قيمة الضريبة': r.vatAmount,
        'الإجمالي': r.totalAmount,
        'المسدد': r.paidAmount,
        'المتبقي': r.remaining,
        'عدد البنود': r.itemsCount,
        'القيد': r.journalEntryNo ?? '',
        'متأخرة': r.overdue ? 'نعم' : '',
      })),
      `invoices-${new Date().toISOString().slice(0, 10)}.xls`,
    )
    toast({ title: `تم تصدير ${rows.length} فاتورة`, description: 'ملف Excel متوافق مع العربية وRTL' })
  }

  const columns = [
    {
      key: 'invoiceNumber', header: 'رقم الفاتورة', primary: true, width: 'w-32',
      render: (r: InvoiceRow) => (
        <div className="space-y-0.5">
          <div className="font-mono font-bold text-[13px]">{r.invoiceNumber}</div>
          <div className="text-[10px] text-muted-foreground">{r.itemsCount} بند</div>
        </div>
      ),
    },
    {
      key: 'customer', header: 'العميل',
      render: (r: InvoiceRow) => (
        <div className="min-w-0">
          <div className="font-medium truncate-1">{r.customer?.name ?? '—'}</div>
          {r.customer?.code && <div className="text-[10px] text-muted-foreground font-mono">{r.customer.code}</div>}
        </div>
      ),
    },
    { key: 'issueDate', header: 'الإصدار', width: 'w-24', hideInCard: true, render: (r: InvoiceRow) => <span className="text-xs text-muted-foreground">{fmtDate(r.issueDate)}</span> },
    {
      key: 'dueDate', header: 'الاستحقاق', width: 'w-28', hideInCard: true,
      render: (r: InvoiceRow) => (
        <span className={cn('text-xs', r.overdue ? 'text-destructive font-bold' : 'text-muted-foreground')}>
          {r.dueDate ? fmtDate(r.dueDate) : '—'}
          {r.overdue && ' ⚠'}
        </span>
      ),
    },
    {
      key: 'totalAmount', header: 'الإجمالي', width: 'w-28', align: 'center' as const,
      render: (r: InvoiceRow) => <span className="font-bold tnum text-[13px]">{money(r.totalAmount)}</span>,
    },
    {
      key: 'paidAmount', header: 'المسدد', width: 'w-24', align: 'center' as const, hideInCard: true,
      render: (r: InvoiceRow) => <span className="tnum text-emerald-700 dark:text-emerald-400">{money(r.paidAmount)}</span>,
    },
    {
      key: 'remaining', header: 'المتبقي', width: 'w-24', align: 'center' as const,
      render: (r: InvoiceRow) => (
        <span className={cn('tnum font-semibold', r.remaining > 0 && OPEN_STATUSES.includes(r.status) ? 'text-amber-600' : 'text-muted-foreground')}>
          {money(r.remaining)}
        </span>
      ),
    },
    {
      key: 'status', header: 'الحالة', width: 'w-28', align: 'center' as const,
      render: (r: InvoiceRow) => <StatusBadge status={r.status} label={r.statusLabel} />,
    },
    {
      key: 'actions', header: 'إجراءات', width: 'w-56', align: 'center' as const,
      render: (r: InvoiceRow) => (
        <div className="flex items-center justify-center gap-1 flex-wrap">
          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => openDetail(r)} title="عرض التفاصيل">
            <Eye className="size-3.5" /> عرض
          </Button>
          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => openPrint(r)} title="طباعة A4">
            <Printer className="size-3.5" />
          </Button>
          {r.status === 'draft' && canIssue && (
            <Button size="sm" variant="ghost" className="h-8 px-2 text-primary hover:text-primary" onClick={() => issueInvoice(r)} title="إصدار وترحيل القيد">
              <CheckCheck className="size-3.5" /> إصدار
            </Button>
          )}
          {r.status === 'draft' && canCreate && (
            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => openEdit(r)} title="تعديل المسودة">
              <Pencil className="size-3.5" />
            </Button>
          )}
          {r.status === 'draft' && canCreate && (
            <Button size="sm" variant="ghost" className="h-8 px-2 text-destructive hover:text-destructive" onClick={() => deleteDraft(r)} title="حذف المسودة">
              <Trash2 className="size-3.5" />
            </Button>
          )}
          {OPEN_STATUSES.includes(r.status) && canCreate && r.remaining > 0 && (
            <Button size="sm" variant="ghost" className="h-8 px-2 text-emerald-700 hover:text-emerald-700 dark:text-emerald-400" onClick={() => setPayInvoice(r)} title="تسجيل دفعة تحصيل">
              <Banknote className="size-3.5" /> دفعة
            </Button>
          )}
          {['issued', 'partially_paid'].includes(r.status) && canCancel && (
            <Button size="sm" variant="ghost" className="h-8 px-2 text-destructive hover:text-destructive" onClick={() => setCancelInvoiceRow(r)} title="إلغاء الفاتورة">
              <Ban className="size-3.5" />
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi title="فواتير مفتوحة (صادرة + جزئي)" value={fmtNum(summary?.open ?? 0)} unit="فاتورة" icon={FilePlus2} tone="primary" subtitle={`مسودات بانتظار الإصدار: ${fmtNum(summary?.drafts ?? 0)}`} />
        <Kpi title="إجمالي المبيعات المفتوحة" value={fmtNum(summary?.totalIssued ?? 0, 0)} unit="ج.م" icon={Wallet} tone="green" subtitle="الإجمالي شامل الضريبة" />
        <Kpi title="المحصل من الفواتير" value={fmtNum(summary?.totalPaid ?? 0, 0)} unit="ج.م" icon={Banknote} tone="teal" subtitle="من سندات القبض المرتبطة" />
        <Kpi title="المتبقي للتحصيل" value={fmtNum(summary?.totalOutstanding ?? 0, 0)} unit="ج.م" icon={AlarmClock} tone="orange" subtitle={`فواتير متأخرة عن الاستحقاق: ${fmtNum(summary?.overdue ?? 0)}`} />
      </div>

      {/* شريط الأدوات */}
      <Card className="border-border py-0 gap-0">
        <CardContent className="p-3 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h3 className="text-base md:text-lg font-semibold">الفواتير الرسمية للعملاء</h3>
              <span className="text-xs text-muted-foreground tnum">{fmtNum(data?.total ?? 0)} فاتورة</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {canCreate && (
                <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true) }}>
                  <Plus className="size-4" /> فاتورة جديدة
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={exportExcel} disabled={!rows.length}>
                <FileDown className="size-4" /> تصدير Excel
              </Button>
            </div>
          </div>
          <div className="flex flex-col lg:flex-row lg:items-center gap-2 flex-wrap">
            {/* تصفية الحالة */}
            <div className="flex items-center gap-1 flex-wrap">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setStatus(f.key)}
                  className={cn(
                    'text-[11px] font-medium px-2.5 py-1.5 rounded-lg border transition-all',
                    status === f.key
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'bg-card text-muted-foreground hover:text-foreground border-border',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 lg:mr-auto flex-wrap">
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger className="h-9 w-full sm:w-56 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="all">كل العملاء</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث برقم الفاتورة أو اسم العميل..."
                className="h-9 w-full sm:w-64 text-xs"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* الجدول */}
      <DataTable
        rows={rows}
        columns={columns}
        loading={isLoading}
        getRowKey={(r) => r.id}
        onRowClick={(r) => openDetail(r)}
        minW={980}
        pageSize={15}
        resetKey={`${status}-${customerId}`}
        searchFn={undefined}
        emptyText="لا فواتير مطابقة للتصفية الحالية"
        emptyTitle="لا فواتير بعد"
        emptyHint={canCreate ? 'ابدأ بإنشاء فاتورة من شحنات العميل غير المفوترة — ثم أصدرها لترحيل قيدها المحاسبي' : 'راجع صلاحياتك مع مدير النظام'}
        emptyIcon={FilePlus2}
        emptyAction={canCreate ? (
          <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true) }}>
            <Plus className="size-4" /> إنشاء أول فاتورة
          </Button>
        ) : undefined}
      />

      {/* النوافذ */}
      <InvoiceFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        onSaved={() => mutate()}
      />
      <InvoiceDetailDialog
        invoiceId={detailId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        canIssue={canIssue}
        canPay={canCreate}
        canCancel={canCancel}
        onAction={(action, row) => {
          if (action === 'issue') issueInvoice(row as unknown as InvoiceRow)
          else if (action === 'pay') { setDetailOpen(false); setPayInvoice(row as unknown as InvoiceRow) }
          else if (action === 'cancel') { setDetailOpen(false); setCancelInvoiceRow(row as unknown as InvoiceRow) }
          else if (action === 'print') { openPrint(row as unknown as InvoiceRow) }
        }}
      />
      <PaymentDialog
        invoice={payInvoice}
        open={!!payInvoice}
        onOpenChange={(v) => { if (!v) setPayInvoice(null) }}
        onDone={() => { mutate(); setDetailId(null); setDetailOpen(false) }}
      />
      <CancelDialog
        invoice={cancelInvoiceRow}
        open={!!cancelInvoiceRow}
        onOpenChange={(v) => { if (!v) setCancelInvoiceRow(null) }}
        onDone={() => mutate()}
      />
      <InvoicePrint
        invoiceId={printId}
        open={printOpen}
        onOpenChange={setPrintOpen}
      />
    </div>
  )
}
