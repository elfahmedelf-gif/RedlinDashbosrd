'use client'

// ============================================================================
// الملف المالي الشامل للطرف — عميل / مقاول / مورد
// نافذة واحدة مركزية تجمع: ما له وما عليه + الرصيد الصافي + تكوين الحسابات +
// أعمار المديونية + السندات المالية (قبض/صرف) + الأذونات كمندوب + الشحنات +
// القيود المحاسبية + أحدث حركات كشف الحساب — والكشف التفصيلي بنافذة مستقلة.
// البيانات من: GET /api/parties/{id}/financial-profile (صلاحية parties.view)
// المبالغ تُفرَّغ من الخادم لمن لا يملك prices.view — والواجهة تخفي الأعمدة المالية.
// ============================================================================

import * as React from 'react'
import useSWR from 'swr'
import {
  Wallet, FileText, AlertCircle, Phone, MapPin, Building2, Landmark,
  ArrowDownLeft, ArrowUpRight, Scale, Download, Package, BookOpen, ShieldAlert,
} from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { fetcher } from '@/lib/api'
import { fmtMoney, fmtDate, fmtDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { useCanPrices } from './auth-provider'
import { PartyStatementDialog } from './party-statement'
import { voucherTypeDef, VOUCHER_STATES } from '@/lib/voucher-catalog'
import { shipmentStatusLabel } from '@/lib/shipment-catalog'
import { exportToCSV } from '@/lib/export'

// ---------------------------------------------------------------------------
// الأنواع (مطابقة لحزمة الـ API)
// ---------------------------------------------------------------------------
interface ProfileParty {
  id: string; code: string | null; name: string; nameEn: string | null
  isCustomer: boolean; isContractor: boolean; isSupplier: boolean
  phone: string | null; phones: string | null; email: string | null
  city: string | null; region: string | null; taxNumber: string | null
  paymentTerms: string | null; creditLimit: number | null
  openingBalance: number; openingBalanceType: string | null
  branch: { id: string; name: string } | null
  active: boolean; createdAt: string
}
interface CompositionRow { accountId: string; code: string; name: string; kind: string; debit: number; credit: number; net: number }
interface VoucherItem {
  id: string; voucherNo: string; type: string; status: string; createdAt: string
  amount: number | null; totalValue: number; notes: string | null
  journalEntry: { id: string; entryNo: string } | null
  cashAccount: { id: string; name: string } | null
  items: { shipment: { shipmentNo: string | null } }[]
}
interface CourierItem { id: string; voucherNo: string; type: string; status: string; createdAt: string; totalValue: number; notes: string | null }
interface ShipmentItem {
  id: string; shipmentNo: string | null; date: string | null; status: string; collectionStatus: string
  destination: string | null; freightTotal: number | null; totalSuppliers: number | null; returns: number | null
  actualDeliveryDate: string | null; customerId: string | null; contractorId: string | null
  customer: { id: string; name: string } | null; contractor: { id: string; name: string } | null
}
interface JournalItem {
  id: string; entryNo: string; date: string; description: string; reference: string | null; sourceType: string | null
  totalDebit: number; totalCredit: number
  lines: { id: string; debit: number; credit: number; description: string | null; account: { code: string; name: string }; shipment: { shipmentNo: string | null } | null }[]
}
interface LedgerRecent {
  id: string; debit: number; credit: number
  entry: { entryNo: string; date: string; description: string; sourceType: string | null }
  account: { code: string; name: string }
  shipment: { shipmentNo: string | null } | null
}
interface ExtraCostItem {
  id: string; ref: string; type: string; amount: number | null; notes: string | null; approvalStatus: string; date: string
  userName: string | null; approvalUserName: string | null; approvalAt: string | null
  shipment: { shipmentNo: string | null; deliveryNumber: string | null; destination: string | null } | null
  journalEntry: { entryNo: string } | null
}
interface ExtraCostSummary {
  approvedAmount: number; approvedCount: number; pendingAmount: number; pendingCount: number
  byType: { type: string; label: string; approved: { count: number; amount: number }; pending: { count: number; amount: number }; rejected: { count: number } }[]
  items: ExtraCostItem[]
}
interface ProfileData {
  party: ProfileParty
  balances: { opening: number; current: number; totalDebit: number; totalCredit: number; owedByParty: number; owedToParty: number; creditLimit: number | null; creditUsed: number; creditAvailable: number | null }
  composition: CompositionRow[]
  shipments: {
    asCustomer: { count: number; freightTotal: number; customerPay: number; deliveredCollected: { count: number; amount: number }; deliveredUncollected: { count: number; amount: number }; pendingDelivery: number }
    asContractor: { count: number; totalSuppliers: number; due: number; paid: number }
    items: ShipmentItem[]
  }
  aging: { buckets: { key: string; label: string; count: number; amount: number }[]; overdueAmount: number; overdueCount: number }
  vouchers: {
    received: { count: number; completedCount: number; sum: number; completedSum: number }
    paid: { count: number; completedCount: number; sum: number; completedSum: number }
    financialTotal: number; financialCount: number
    items: VoucherItem[]
    courierCount: number
    courierItems: CourierItem[]
  }
  journal: { count: number; items: JournalItem[] }
  ledgerRecent: LedgerRecent[]
  extras?: ExtraCostSummary
}

// ---------------------------------------------------------------------------
// مساعدات العرض
// ---------------------------------------------------------------------------
function balanceTone(v: number): string {
  if (v < 0) return 'text-rose-600 dark:text-rose-400'
  if (v > 0) return 'text-emerald-700 dark:text-emerald-400'
  return 'text-foreground'
}

function StatTile({ label, value, tone, signed, icon, hint }: {
  label: string; value: number; tone?: string; signed?: boolean; icon?: React.ReactNode; hint?: string
}) {
  return (
    <div className={cn('rounded-xl border p-3 min-w-0', tone)}>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn('font-bold tnum text-base mt-1 leading-tight', signed ? balanceTone(value) : 'text-foreground')}>
        {fmtMoney(value, 2)} <span className="text-[10px] font-normal text-muted-foreground">ج.م</span>
      </div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{hint}</div>}
    </div>
  )
}

function CountChip({ label, count, value, tone }: { label: string; count?: number; value?: string; tone?: string }) {
  return (
    <div className={cn('rounded-lg border px-3 py-2 min-w-0', tone ?? 'bg-secondary/50')}>
      <div className="text-[11px] text-muted-foreground truncate">{label}</div>
      <div className="text-sm font-bold tnum mt-0.5">
        {value ?? (count ?? 0)}
        {count != null && value != null && <span className="text-[10px] font-normal text-muted-foreground"> ({fmtMoney(count)} )</span>}
      </div>
    </div>
  )
}

function voucherStateDef(status: string) {
  return VOUCHER_STATES.find((s) => s.key === status)
}

const SOURCE_LABELS: Record<string, string> = {
  shipment_delivery: 'قيد تسليم شحنة',
  shipment_return_reversal: 'عكس مرتجع',
  op_voucher: 'سند مالي',
  extra_cost: 'بند إضافي معتمد',
  journal_reversal: 'قيد عكسي',
  manual: 'قيد يدوي',
}

// ---------------------------------------------------------------------------
// المكوّن الرئيسي
// ---------------------------------------------------------------------------
export interface PartyFinancialProfileProps {
  partyId: string | null
  partyName?: string
  open: boolean
  onOpenChange: (o: boolean) => void
}

type TabKey = 'overview' | 'vouchers' | 'shipments' | 'journal'

export function PartyFinancialProfile({ partyId, partyName, open, onOpenChange }: PartyFinancialProfileProps) {
  const { toast } = useToast()
  const canPrices = useCanPrices()
  const [tab, setTab] = React.useState<TabKey>('overview')
  // نافذة كشف الحساب التفصيلي المستقلة
  const [stmtOpen, setStmtOpen] = React.useState(false)

  React.useEffect(() => {
    if (open) { setTab('overview'); setStmtOpen(false) }
  }, [open, partyId])

  const { data, isLoading, error } = useSWR<ProfileData>(
    open && partyId ? `/api/parties/${partyId}/financial-profile` : null,
    fetcher,
  )

  React.useEffect(() => {
    if (error) toast({ title: 'تعذر تحميل الملف المالي', description: error instanceof Error ? error.message : 'حاول مرة أخرى', variant: 'destructive' })
  }, [error, toast])

  const party = data?.party
  const bal = data?.balances

  const exportVouchers = async () => {
    if (!data) return
    const rows = data.vouchers.items.map((v) => ({
      'رقم السند': v.voucherNo,
      'النوع': voucherTypeDef(v.type)?.label ?? v.type,
      'التاريخ': fmtDate(v.createdAt),
      'المبلغ': v.amount ?? v.totalValue,
      'الحالة': voucherStateDef(v.status)?.label ?? v.status,
      'الخزينة': v.cashAccount?.name ?? '',
      'القيد': v.journalEntry?.entryNo ?? '',
      'الشحنات': v.items.map((it) => it.shipment?.shipmentNo ?? '').filter(Boolean).join('، '),
      'ملاحظات': v.notes ?? '',
    }))
    exportToCSV(rows, `vouchers-${party?.code ?? partyId}-${new Date().toISOString().slice(0, 10)}.csv`)
    toast({ title: `تم تصدير ${rows.length} سند` })
  }

  const exportShipments = () => {
    if (!data) return
    const rows = data.shipments.items.map((s) => ({
      'رقم الشحنة': s.shipmentNo ?? '',
      'الدور': [s.customerId && 'عميل', s.contractorId && 'مقاول'].filter(Boolean).join(' + '),
      'الوجهة': s.destination ?? '',
      'التاريخ': fmtDate(s.date),
      'الحالة': shipmentStatusLabel(s.status),
      'التحصيل': s.collectionStatus === 'collected' ? 'محصّلة' : s.collectionStatus === 'partial' ? 'جزئي' : 'غير محصّلة',
      ...(canPrices ? {
        'نولون العميل': s.freightTotal ?? 0,
        'تكلفة المقاول': s.totalSuppliers ?? 0,
        'رسوم المرتجع': s.returns ?? 0,
      } : {}),
    }))
    exportToCSV(rows, `shipments-${party?.code ?? partyId}-${new Date().toISOString().slice(0, 10)}.csv`)
    toast({ title: `تم تصدير ${rows.length} شحنة` })
  }

  const exportJournal = () => {
    if (!data) return
    const rows: Record<string, unknown>[] = []
    for (const e of data.journal.items) {
      for (const l of e.lines) {
        rows.push({
          'رقم القيد': e.entryNo, 'التاريخ': fmtDate(e.date), 'البيان': e.description,
          'الحساب': `${l.account.name} (${l.account.code})`,
          'مدين': l.debit, 'دائن': l.credit,
          'الشحنة': l.shipment?.shipmentNo ?? '',
          'المصدر': SOURCE_LABELS[e.sourceType ?? ''] ?? e.sourceType ?? '',
        })
      }
    }
    exportToCSV(rows, `journal-${party?.code ?? partyId}-${new Date().toISOString().slice(0, 10)}.csv`)
    toast({ title: `تم تصدير ${rows.length} سطر قيد` })
  }

  const tabs: { key: TabKey; label: string; count?: number; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'نظرة عامة', icon: <Scale className="size-3.5" /> },
    { key: 'vouchers', label: 'السندات والأذونات', count: (data?.vouchers.financialCount ?? 0) + (data?.vouchers.courierCount ?? 0), icon: <FileText className="size-3.5" /> },
    { key: 'shipments', label: 'الشحنات', count: (data?.shipments.asCustomer.count ?? 0) + (data?.shipments.asContractor.count ?? 0), icon: <Package className="size-3.5" /> },
    { key: 'journal', label: 'القيود', count: data?.journal.count ?? 0, icon: <BookOpen className="size-3.5" /> },
  ]

  return (
    <>
      <PartyStatementDialog
        partyId={open && partyId ? partyId : null}
        partyName={partyName}
        open={stmtOpen}
        onOpenChange={setStmtOpen}
      />

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[95vw] sm:max-w-3xl lg:max-w-4xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 min-w-0">
              <Wallet className="size-4 text-primary shrink-0" />
              <span className="truncate">الملف المالي — {party?.name ?? partyName ?? ''}</span>
            </DialogTitle>
            <DialogDescription>كل ما يخص الطرف ماليًا: ما له وما عليه، السندات والأذونات، الشحنات، القيود، وأعمار المديونية.</DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="space-y-3 py-1">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
              </div>
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
            </div>
          ) : error || !data || !party || !bal ? (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-3">
              <AlertCircle className="size-4 shrink-0" />
              تعذر تحميل الملف المالي — تحقق من الاتصال وأعد المحاولة.
            </div>
          ) : (
            <div className="space-y-3">
              {/* بيانات الطرف */}
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="font-semibold text-sm">{party.name}</span>
                {party.code && <span className="text-muted-foreground tnum">كود: {party.code}</span>}
                {party.isCustomer && <Badge variant="outline" className="text-[10px]">عميل</Badge>}
                {party.isContractor && <Badge variant="outline" className="text-[10px]">مقاول</Badge>}
                {party.isSupplier && <Badge variant="outline" className="text-[10px]">مورد</Badge>}
                {!party.active && <Badge variant="outline" className="text-[10px] text-destructive">موقوف</Badge>}
                {party.branch && <span className="flex items-center gap-1 text-muted-foreground"><Building2 className="size-3" /> {party.branch.name}</span>}
                {party.phone && <span className="flex items-center gap-1 text-muted-foreground" dir="ltr"><Phone className="size-3" /> {party.phone}</span>}
                {(party.city || party.region) && <span className="flex items-center gap-1 text-muted-foreground"><MapPin className="size-3" /> {[party.city, party.region].filter(Boolean).join(' - ')}</span>}
                {party.paymentTerms && <span className="text-muted-foreground">شروط السداد: {party.paymentTerms}</span>}
              </div>

              {/* شريط التبويبات + الأدوات */}
              <div className="flex items-center justify-between gap-2 flex-wrap print:hidden">
                <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1 overflow-x-auto max-w-full">
                  {tabs.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
                        tab === t.key ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
                      )}
                      aria-pressed={tab === t.key}
                    >
                      {t.icon}
                      {t.label}
                      {t.count != null && t.count > 0 && (
                        <span className="tnum text-[10px] bg-primary/10 text-primary rounded-full px-1.5">{fmtMoney(t.count)}</span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {canPrices && (
                    <Button variant="outline" size="sm" onClick={() => setStmtOpen(true)}>
                      <FileText className="size-4" /> كشف الحساب التفصيلي
                    </Button>
                  )}
                  {tab === 'vouchers' && data.vouchers.items.length > 0 && (
                    <Button variant="outline" size="sm" onClick={exportVouchers}><Download className="size-4" /> تصدير</Button>
                  )}
                  {tab === 'shipments' && data.shipments.items.length > 0 && (
                    <Button variant="outline" size="sm" onClick={exportShipments}><Download className="size-4" /> تصدير</Button>
                  )}
                  {tab === 'journal' && data.journal.items.length > 0 && (
                    <Button variant="outline" size="sm" onClick={exportJournal}><Download className="size-4" /> تصدير</Button>
                  )}
                </div>
              </div>

              {/* ============ نظرة عامة ============ */}
              {tab === 'overview' && (
                <div className="space-y-3">
                  {/* ما له / ما عليه / الصافي */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <StatTile label="ما عليه للشركة (مدين)" value={bal.owedByParty} tone="border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/30" icon={<ArrowUpRight className="size-3" />} hint="مستحقات يجب سدادها للشركة" />
                    <StatTile label="ما له لدى الشركة (دائن)" value={bal.owedToParty} tone="border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30" icon={<ArrowDownLeft className="size-3" />} hint="مبالغ مستحقة عليه من الشركة" />
                    <StatTile label="صافي الرصيد الحالي" value={bal.current} signed icon={<Scale className="size-3" />} hint={bal.current > 0 ? 'مدين — للشركة' : bal.current < 0 ? 'دائن — على الشركة' : 'متوازن'} />
                  </div>

                  {/* بطاقات ثانوية */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <StatTile label="الرصيد الافتتاحي" value={bal.opening} signed />
                    <StatTile label="إجمالي التعامل (نولون)" value={data.shipments.asCustomer.freightTotal} hint={`${fmtMoney(data.shipments.asCustomer.count)} شحنة كعميل`} />
                    <StatTile label="مستحقات المقاول المتبقية" value={data.shipments.asContractor.due} hint={`${fmtMoney(data.shipments.asContractor.count)} شحنة كمقاول`} />
                    <StatTile
                      label="حد الائتمان"
                      value={bal.creditLimit ?? 0}
                      hint={bal.creditLimit != null ? `المتاح: ${fmtMoney(bal.creditAvailable ?? 0, 2)} ج.م — المستخدم: ${fmtMoney(bal.creditUsed, 2)}` : 'غير محدد'}
                    />
                  </div>

                  {/* أعمار المديونية المتأخرة */}
                  {data.aging.overdueCount > 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30 p-3 space-y-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                        <ShieldAlert className="size-4" />
                        مديونيات متأخرة غير محصّلة — {fmtMoney(data.aging.overdueAmount, 2)} ج.م ({fmtMoney(data.aging.overdueCount)} شحنة مسلّمة)
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {data.aging.buckets.map((b) => (
                          <div key={b.key} className={cn('rounded-lg border px-2.5 py-2 bg-card', b.amount > 0 ? 'border-amber-300' : 'opacity-60')}>
                            <div className="text-[10px] text-muted-foreground">{b.label}</div>
                            <div className="text-xs font-bold tnum mt-0.5">{fmtMoney(b.amount, 2)} ج.م</div>
                            <div className="text-[10px] text-muted-foreground tnum">{fmtMoney(b.count)} شحنة</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* تكوين الرصيد لكل حساب */}
                  <div>
                    <div className="text-xs font-semibold mb-1.5">تكوين الرصيد من دفتر الأستاذ</div>
                    <div className="rounded-xl border overflow-x-auto">
                      <table className="w-full text-xs" style={{ minWidth: 480 }}>
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-right font-medium px-3 py-2">الحساب</th>
                            <th className="text-right font-medium px-3 py-2">النوع</th>
                            <th className="text-left font-medium px-3 py-2">مدين</th>
                            <th className="text-left font-medium px-3 py-2">دائن</th>
                            <th className="text-left font-medium px-3 py-2">الصافي</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.composition.length === 0 ? (
                            <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">لا توجد حركات مسجلة لهذا الطرف بعد</td></tr>
                          ) : data.composition.map((c) => (
                            <tr key={c.accountId} className="border-t border-border">
                              <td className="px-3 py-2">
                                <div className="font-medium">{c.name}</div>
                                <div className="text-[10px] text-muted-foreground tnum">{c.code}</div>
                              </td>
                              <td className="px-3 py-2">
                                {c.kind === 'control_debit' && <Badge variant="outline" className="text-[10px]">حساب الطرف (مدين)</Badge>}
                                {c.kind === 'control_credit' && <Badge variant="outline" className="text-[10px]">حساب الطرف (دائن)</Badge>}
                                {c.kind === 'pl' && <Badge variant="outline" className="text-[10px] text-muted-foreground">إيراد/مصروف</Badge>}
                                {c.kind === 'other' && <Badge variant="outline" className="text-[10px] text-muted-foreground">نقدية/أخرى</Badge>}
                              </td>
                              <td className="px-3 py-2 text-left tnum">{c.debit ? fmtMoney(c.debit, 2) : '—'}</td>
                              <td className="px-3 py-2 text-left tnum">{c.credit ? fmtMoney(c.credit, 2) : '—'}</td>
                              <td className={cn('px-3 py-2 text-left tnum font-bold', balanceTone(c.kind === 'control_credit' ? -c.net : c.net))}>
                                {c.kind === 'control_credit' ? fmtMoney(-c.net, 2) : fmtMoney(c.net, 2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1 leading-snug">
                      الإيراد/المصروف والنقدية سطور مقابلة داخل القيود ولا تدخل في رصيد الطرف — الرصيد يتكوّن من حسابات التحكم الفرعية فقط.
                    </div>
                  </div>

                  {/* أحدث الحركات */}
                  {data.ledgerRecent.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold mb-1.5">أحدث حركات الحساب</div>
                      <div className="rounded-xl border divide-y">
                        {data.ledgerRecent.map((l) => (
                          <div key={l.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                            <div className="min-w-0">
                              <div className="truncate font-medium">{l.entry.description}</div>
                              <div className="text-[10px] text-muted-foreground tnum">
                                {fmtDate(l.entry.date)} · {l.entry.entryNo}{l.shipment?.shipmentNo ? ` · ${l.shipment.shipmentNo}` : ''}
                              </div>
                            </div>
                            <div className={cn('shrink-0 font-bold tnum', (l.debit - l.credit) > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                              {(l.debit - l.credit) > 0 ? '+' : ''}{fmtMoney(l.debit - l.credit, 2)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* البنود الإضافية (تعتيق/مبيت/مرتجعات) — للطرف المقاول */}
                  {data.extras && (data.extras.items.length > 0) && (
                    <div>
                      <div className="text-xs font-semibold mb-1.5">البنود الإضافية (تعتيق / مبيت / مرتجعات)</div>
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        <CountChip
                          label="معتمد (داخل المستحقات)"
                          count={data.extras.approvedCount}
                          value={fmtMoney(data.extras.approvedAmount, 2) + ' ج.م'}
                          tone="border border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30"
                        />
                        <CountChip
                          label="بانتظار اعتماد الشركة"
                          count={data.extras.pendingCount}
                          value={fmtMoney(data.extras.pendingAmount, 2) + ' ج.م'}
                          tone="border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30"
                        />
                        <CountChip label="مرفوض" value={String(data.extras.byType.reduce((s, t) => s + t.rejected.count, 0))} />
                      </div>
                      <div className="rounded-xl border divide-y max-h-48 overflow-y-auto">
                        {data.extras.items.map((x) => (
                          <div key={x.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                            <div className="min-w-0">
                              <div className="truncate font-medium">
                                {x.ref} — {x.type === 'taateeq' ? 'تعتيق' : x.type === 'mabeet' ? 'مبيت' : x.type === 'return' ? 'مرتجعات' : x.type}
                                <span className={cn('text-[9px] px-1 py-0.5 rounded-full mr-1',
                                  x.approvalStatus === 'approved' ? 'bg-emerald-100 text-emerald-700' : x.approvalStatus === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700')}>
                                  {x.approvalStatus === 'approved' ? 'معتمد' : x.approvalStatus === 'pending' ? 'بانتظار الاعتماد' : 'مرفوض'}
                                </span>
                              </div>
                              <div className="text-[10px] text-muted-foreground tnum">
                                {fmtDate(x.date)}{x.shipment ? ` · ${x.shipment.deliveryNumber ?? x.shipment.shipmentNo ?? ''}${x.shipment.destination ? ` — ${x.shipment.destination}` : ''}` : ''}
                                {x.journalEntry ? ` · قيد ${x.journalEntry.entryNo}` : ''}
                              </div>
                            </div>
                            {canPrices && <div className="shrink-0 font-bold tnum">{fmtMoney(x.amount ?? 0, 2)}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ============ السندات والأذونات ============ */}
              {tab === 'vouchers' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <CountChip label="سندات قبض (العدد)" count={data.vouchers.received.count} value={fmtMoney(data.vouchers.received.sum, 2) + ' ج.م'} tone="border border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30" />
                    <CountChip label="سندات صرف (العدد)" count={data.vouchers.paid.count} value={fmtMoney(data.vouchers.paid.sum, 2) + ' ج.م'} tone="border border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/30" />
                    <CountChip label="مكتملة ومرحّلة" count={data.vouchers.received.completedCount + data.vouchers.paid.completedCount} value={fmtMoney(data.vouchers.received.completedSum + data.vouchers.paid.completedSum, 2) + ' ج.م'} />
                    <CountChip label="إجمالي قيمة السندات" value={fmtMoney(data.vouchers.financialTotal, 2) + ' ج.م'} />
                  </div>

                  {data.vouchers.items.length === 0 ? (
                    <div className="text-center text-sm text-muted-foreground bg-secondary/60 rounded-lg py-8">لا توجد سندات مالية مرتبطة بهذا الطرف</div>
                  ) : (
                    <div className="rounded-xl border overflow-x-auto">
                      <table className="w-full text-xs" style={{ minWidth: 640 }}>
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-right font-medium px-3 py-2">رقم السند</th>
                            <th className="text-right font-medium px-3 py-2">النوع</th>
                            <th className="text-right font-medium px-3 py-2">التاريخ</th>
                            {canPrices && <th className="text-left font-medium px-3 py-2">المبلغ</th>}
                            <th className="text-right font-medium px-3 py-2">الحالة</th>
                            <th className="text-right font-medium px-3 py-2">الخزينة</th>
                            <th className="text-right font-medium px-3 py-2">القيد</th>
                            <th className="text-right font-medium px-3 py-2">الشحنات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.vouchers.items.map((v) => {
                            const st = voucherStateDef(v.status)
                            return (
                              <tr key={v.id} className="border-t border-border hover:bg-muted/40">
                                <td className="px-3 py-2 tnum font-bold">{v.voucherNo}</td>
                                <td className="px-3 py-2">{voucherTypeDef(v.type)?.label ?? v.type}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(v.createdAt)}</td>
                                {canPrices && <td className="px-3 py-2 text-left tnum font-bold">{fmtMoney(v.amount ?? v.totalValue, 2)}</td>}
                                <td className="px-3 py-2"><span className={cn('inline-block text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap', st?.color)}>{st?.label ?? v.status}</span></td>
                                <td className="px-3 py-2 text-muted-foreground">{v.cashAccount?.name ?? '—'}</td>
                                <td className="px-3 py-2 tnum">{v.journalEntry?.entryNo ?? '—'}</td>
                                <td className="px-3 py-2 text-muted-foreground" title={v.items.map((it) => it.shipment?.shipmentNo ?? '').filter(Boolean).join('، ')}>
                                  {v.items.length ? `${v.items.length} شحنة` : '—'}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* أذونات تشغيلية بصفته مندوبًا */}
                  {data.vouchers.courierCount > 0 && (
                    <div>
                      <div className="text-xs font-semibold mb-1.5">أذونات تشغيلية بصفته مندوبًا ({fmtMoney(data.vouchers.courierCount)})</div>
                      <div className="rounded-xl border overflow-x-auto max-h-56 overflow-y-auto">
                        <table className="w-full text-xs" style={{ minWidth: 480 }}>
                          <thead className="bg-muted/50 sticky top-0">
                            <tr>
                              <th className="text-right font-medium px-3 py-2">الرقم</th>
                              <th className="text-right font-medium px-3 py-2">النوع</th>
                              <th className="text-right font-medium px-3 py-2">التاريخ</th>
                              <th className="text-right font-medium px-3 py-2">الحالة</th>
                              {canPrices && <th className="text-left font-medium px-3 py-2">القيمة</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {data.vouchers.courierItems.map((v) => {
                              const st = voucherStateDef(v.status)
                              return (
                                <tr key={v.id} className="border-t border-border">
                                  <td className="px-3 py-2 tnum font-bold">{v.voucherNo}</td>
                                  <td className="px-3 py-2">{voucherTypeDef(v.type)?.label ?? v.type}</td>
                                  <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(v.createdAt)}</td>
                                  <td className="px-3 py-2"><span className={cn('inline-block text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap', st?.color)}>{st?.label ?? v.status}</span></td>
                                  {canPrices && <td className="px-3 py-2 text-left tnum">{fmtMoney(v.totalValue, 2)}</td>}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ============ الشحنات ============ */}
              {tab === 'shipments' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <CountChip label="شحنات كعميل" count={data.shipments.asCustomer.count} value={canPrices ? fmtMoney(data.shipments.asCustomer.freightTotal, 2) + ' ج.م' : undefined} />
                    <CountChip label="مسلّمة ومحصّلة" count={data.shipments.asCustomer.deliveredCollected.count} value={canPrices ? fmtMoney(data.shipments.asCustomer.deliveredCollected.amount, 2) + ' ج.م' : undefined} tone="border border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30" />
                    <CountChip label="مسلّمة وغير محصّلة" count={data.shipments.asCustomer.deliveredUncollected.count} value={canPrices ? fmtMoney(data.shipments.asCustomer.deliveredUncollected.amount, 2) + ' ج.م' : undefined} tone="border border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/30" />
                    <CountChip label="شحنات كمقاول — مستحقاته" count={data.shipments.asContractor.count} value={canPrices ? fmtMoney(data.shipments.asContractor.due, 2) + ' ج.م متبقية' : undefined} tone="border border-teal-200 bg-teal-50 dark:border-teal-900/50 dark:bg-teal-950/30" />
                  </div>

                  {data.shipments.items.length === 0 ? (
                    <div className="text-center text-sm text-muted-foreground bg-secondary/60 rounded-lg py-8">لا توجد شحنات مرتبطة بهذا الطرف</div>
                  ) : (
                    <div className="rounded-xl border overflow-x-auto">
                      <table className="w-full text-xs" style={{ minWidth: 700 }}>
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-right font-medium px-3 py-2">رقم الشحنة</th>
                            <th className="text-right font-medium px-3 py-2">الدور</th>
                            <th className="text-right font-medium px-3 py-2">الوجهة</th>
                            <th className="text-right font-medium px-3 py-2">التاريخ</th>
                            <th className="text-right font-medium px-3 py-2">الحالة</th>
                            <th className="text-right font-medium px-3 py-2">التحصيل</th>
                            {canPrices && <th className="text-left font-medium px-3 py-2">نولون</th>}
                            {canPrices && <th className="text-left font-medium px-3 py-2">تكلفة المقاول</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {data.shipments.items.map((s) => (
                            <tr key={s.id} className="border-t border-border hover:bg-muted/40">
                              <td className="px-3 py-2 tnum font-bold">{s.shipmentNo ?? '—'}</td>
                              <td className="px-3 py-2">
                                <div className="flex gap-1">
                                  {s.customerId && <Badge variant="outline" className="text-[10px]">عميل</Badge>}
                                  {s.contractorId && <Badge variant="outline" className="text-[10px]">مقاول</Badge>}
                                </div>
                              </td>
                              <td className="px-3 py-2">{s.destination ?? '—'}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{fmtDate(s.date)}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{shipmentStatusLabel(s.status)}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{s.collectionStatus === 'collected' ? 'محصّلة' : s.collectionStatus === 'partial' ? 'جزئي' : 'غير محصّلة'}</td>
                              {canPrices && <td className="px-3 py-2 text-left tnum">{fmtMoney(s.freightTotal ?? 0, 2)}</td>}
                              {canPrices && <td className="px-3 py-2 text-left tnum">{fmtMoney(s.totalSuppliers ?? 0, 2)}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ============ القيود المحاسبية ============ */}
              {tab === 'journal' && (
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground">
                    القيود المرحّلة التي تمس حساب هذا الطرف ({fmtMoney(data.journal.count)} قيد — يُعرض الأحدث {fmtMoney(data.journal.items.length)})
                  </div>
                  {data.journal.items.length === 0 ? (
                    <div className="text-center text-sm text-muted-foreground bg-secondary/60 rounded-lg py-8">لا توجد قيود مرتبطة بهذا الطرف</div>
                  ) : (
                    <div className="rounded-xl border overflow-x-auto max-h-[45vh] overflow-y-auto">
                      <table className="w-full text-xs" style={{ minWidth: 680 }}>
                        <thead className="bg-muted/50 sticky top-0">
                          <tr>
                            <th className="text-right font-medium px-3 py-2">رقم القيد</th>
                            <th className="text-right font-medium px-3 py-2">التاريخ</th>
                            <th className="text-right font-medium px-3 py-2">البيان</th>
                            <th className="text-right font-medium px-3 py-2">الحساب</th>
                            <th className="text-left font-medium px-3 py-2">مدين</th>
                            <th className="text-left font-medium px-3 py-2">دائن</th>
                            <th className="text-right font-medium px-3 py-2">الشحنة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.journal.items.map((e) =>
                            e.lines.map((l) => (
                              <tr key={l.id} className="border-t border-border hover:bg-muted/40">
                                <td className="px-3 py-2 tnum font-bold whitespace-nowrap">{e.entryNo}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{fmtDate(e.date)}</td>
                                <td className="px-3 py-2 min-w-[160px]">
                                  <div className="truncate max-w-[220px]" title={l.description ?? e.description}>{l.description ?? e.description}</div>
                                  <div className="text-[10px] text-muted-foreground">{SOURCE_LABELS[e.sourceType ?? ''] ?? ''}{e.reference ? ` · ${e.reference}` : ''}</div>
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  {l.account.name} <span className="text-[10px] text-muted-foreground tnum">{l.account.code}</span>
                                </td>
                                <td className="px-3 py-2 text-left tnum">{l.debit ? fmtMoney(l.debit, 2) : '—'}</td>
                                <td className="px-3 py-2 text-left tnum">{l.credit ? fmtMoney(l.credit, 2) : '—'}</td>
                                <td className="px-3 py-2 tnum whitespace-nowrap">{l.shipment?.shipmentNo ?? '—'}</td>
                              </tr>
                            )),
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
