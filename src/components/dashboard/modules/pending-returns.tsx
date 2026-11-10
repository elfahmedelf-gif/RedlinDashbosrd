'use client'

// ============================================================================
// وحدة "المرتجعات لم تُستلم" — صفحة مستقلة في القائمة الجانبية
// تتابع عهدة المرتجعات: الشحنات بحالة "returned" لا تزال مع المندوبين
// لا تكشف أي أسعار — متاحة لكل من يملك vouchers.view
// ============================================================================

import * as React from 'react'
import useSWR from 'swr'
import { Undo2, Users, FileSpreadsheet, Printer, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable } from '../data-table'
import { fetcher, apiPost } from '@/lib/api'
import { exportToCSV, exportToExcel } from '@/lib/export'
import { cn } from '@/lib/utils'
import { useAuth } from '../auth-provider'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useToast } from '@/hooks/use-toast'

interface PendingItem {
  shipmentId: string
  shipmentNo: string | null
  recipientName: string | null
  destination: string | null
  customerName: string | null
  branchName: string | null
  returnVoucherNo: string | null
  returnVoucherId: string | null
  courierId: string | null
  courierName: string | null
  returnDate: string | null
  daysOutstanding: number | null
}

interface CourierSummary {
  courierId: string
  courierName: string
  count: number
  oldestDays: number
}

interface PendingReturnsResponse {
  items: PendingItem[]
  byCourier: CourierSummary[]
  total: number
}

export function PendingReturnsModule() {
  const { has } = useAuth()
  const { toast } = useToast()
  const { confirm: confirmDialog } = useConfirm()
  // التاريخ اختياري — المرتجعات المعلقة لا تعتمد على نطاق زمني (تنظر للحالة الراهنة)
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')

  const qs = new URLSearchParams()
  if (from) qs.set('from', from)
  if (to) qs.set('to', to)
  const url = `/api/reports/pending-returns?${qs.toString()}`
  const { data, isLoading, mutate } = useSWR<PendingReturnsResponse>(url, fetcher, { refreshInterval: 30000 })

  const items = data?.items ?? []
  const byCourier = data?.byCourier ?? []
  const total = data?.total ?? 0
  const canExecute = has('vouchers.execute')

  // إجراء "تم التسليم" — ينشئ إذن استلام مرتجعات تلقائيًا
  const markReceived = async (voucherId: string, voucherNo?: string) => {
    const ok = await confirmDialog({
      title: 'تأكيد تسليم المرتجع',
      message: `تأكيد تسليم مرتجع ${voucherNo ?? ''}؟ سيُنشأ إذن استلام مرتجعات تلقائيًا.`,
      tone: 'success',
      confirmText: 'تم التسليم',
    })
    if (!ok) return
    try {
      const res: any = await apiPost(`/api/vouchers/${voucherId}/mark-received`, { userName: 'admin' })
      const summary = res?.succeeded != null && res?.total != null
        ? `تم تسليم ${res.succeeded}/${res.total} شحنة${res.failed ? ` — ${res.failed} فشل` : ''}`
        : 'تم التسليم'
      toast({ title: 'تم التسليم', description: summary })
      mutate()
    } catch (e: any) {
      toast({ title: 'خطأ', description: e.message, variant: 'destructive' })
    }
  }

  // تسليم كل المرتجعات المعلقة دفعة واحدة (لكل إذن مرتجع فريد)
  const markAllReceived = async () => {
    const uniqueVouchers = new Map<string, string>()
    for (const it of items) {
      if (it.returnVoucherId && it.returnVoucherNo) {
        uniqueVouchers.set(it.returnVoucherId, it.returnVoucherNo)
      }
    }
    if (uniqueVouchers.size === 0) {
      toast({ title: 'لا توجد مرتجعات معلقة' })
      return
    }
    const ok = await confirmDialog({
      title: 'تسليم كل المرتجعات',
      message: `تأكيد تسليم ${uniqueVouchers.size} إذن مرتجع (يغطي ${items.length} شحنة)؟`,
      tone: 'success',
      confirmText: 'تسليم الكل',
    })
    if (!ok) return
    let totalSucceeded = 0
    let totalFailed = 0
    let totalProcessed = 0
    for (const [vid, vno] of uniqueVouchers) {
      try {
        const res: any = await apiPost(`/api/vouchers/${vid}/mark-received`, { userName: 'admin' })
        totalSucceeded += res?.succeeded ?? 0
        totalFailed += res?.failed ?? 0
        totalProcessed += res?.total ?? 0
      } catch (e: any) {
        totalFailed += 1
      }
    }
    toast({
      title: 'تم تسليم المرتجعات',
      description: `نجح ${totalSucceeded}/${totalProcessed} شحنة${totalFailed ? ` — ${totalFailed} فشل` : ''}`,
    })
    mutate()
  }

  const exportCSV = () => {
    if (!items.length) {
      toast({ title: 'لا توجد بيانات للتصدير' })
      return
    }
    const rows = items.map((it) => ({
      'رقم الشحنة': it.shipmentNo ?? '',
      'المستلم': it.recipientName ?? '',
      'الوجهة': it.destination ?? '',
      'العميل': it.customerName ?? '',
      'الفرع': it.branchName ?? '',
      'المندوب': it.courierName ?? '',
      'إذن المرتجع': it.returnVoucherNo ?? '',
      'تاريخ المرتجع': it.returnDate ?? '',
      'المدة (أيام)': it.daysOutstanding ?? '',
    }))
    exportToCSV(rows, `pending-returns-${new Date().toISOString().slice(0, 10)}.csv`)
    toast({ title: `تم تصدير ${rows.length} سجل` })
  }

  const exportXls = () => {
    if (!items.length) {
      toast({ title: 'لا توجد بيانات للتصدير' })
      return
    }
    const rows = items.map((it) => ({
      'رقم الشحنة': it.shipmentNo ?? '',
      'المستلم': it.recipientName ?? '',
      'الوجهة': it.destination ?? '',
      'العميل': it.customerName ?? '',
      'الفرع': it.branchName ?? '',
      'المندوب': it.courierName ?? '',
      'إذن المرتجع': it.returnVoucherNo ?? '',
      'تاريخ المرتجع': it.returnDate ?? '',
      'المدة (أيام)': it.daysOutstanding ?? '',
    }))
    exportToExcel(rows, `pending-returns-${new Date().toISOString().slice(0, 10)}.xls`)
    toast({ title: `تم تصدير ${rows.length} سجل` })
  }

  return (
    <div className="space-y-4">
      {/* شريط الأدوات العلوي */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn('text-[12px] tnum', total > 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300')}>
            {total} مرتجع معلق
          </Badge>
          {total > 0 && byCourier.length > 0 && (
            <Badge variant="outline" className="text-[12px] tnum">
              {byCourier.length} مندوب
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-8 text-xs px-2 border border-border rounded-md bg-card"
            aria-label="من تاريخ"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-8 text-xs px-2 border border-border rounded-md bg-card"
            aria-label="إلى تاريخ"
          />
          {(from || to) && (
            <Button variant="ghost" size="sm" onClick={() => { setFrom(''); setTo('') }} className="h-8">
              مسح
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!items.length}>
            <Printer className="size-4" /> <span className="hidden sm:inline">طباعة</span>
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!items.length}>
            <FileSpreadsheet className="size-4" /> <span className="hidden sm:inline">CSV</span>
          </Button>
          <Button variant="outline" size="sm" onClick={exportXls} disabled={!items.length}>
            <FileSpreadsheet className="size-4" /> <span className="hidden sm:inline">Excel</span>
          </Button>
          {canExecute && total > 0 && (
            <Button size="sm" onClick={markAllReceived} disabled={isLoading}>
              <Undo2 className="size-4" /> <span className="hidden sm:inline">تسليم الكل</span>
              <span className="sm:hidden">الكل</span>
            </Button>
          )}
        </div>
      </div>

      {isLoading && !data ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : total === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Undo2 className="size-10 mx-auto mb-2 text-muted-foreground/60" />
            <div className="text-sm font-medium">لا توجد مرتجعات معلقة</div>
            <div className="text-xs text-muted-foreground mt-1">كل المرتجعات المسجلة تم استلامها بالفرع.</div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* بطاقة مسؤولية المندوبين */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="size-4 text-muted-foreground" />
                مسؤولية المندوبين ({byCourier.length})
              </CardTitle>
              <CardDescription>عدد المرتجعات غير المستلمة لكل مندوب + أقدم مدة بقاء — تلوين أحمر للأقدم من 7 أيام، أصفر للأقدم من 3</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {byCourier.map((c, i) => (
                  <div key={c.courierId || i} className={cn(
                    'border rounded-lg p-3',
                    c.oldestDays > 7
                      ? 'border-rose-300 bg-rose-50 dark:bg-rose-950/30'
                      : c.oldestDays > 3
                        ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/30'
                        : 'border-border bg-muted/30'
                  )}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm truncate" title={c.courierName}>{c.courierName}</span>
                      <Badge variant="outline" className={cn('text-[11px] tnum',
                        c.oldestDays > 7 ? 'bg-rose-100 text-rose-700' :
                        c.oldestDays > 3 ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-100 text-slate-700')}>
                        {c.oldestDays} يوم
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      <b className="text-foreground tnum">{c.count}</b> مرتجع لم يُستلم بعد
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* جدول المرتجعات المعلقة */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Undo2 className="size-4 text-muted-foreground" />
                المرتجعات لم تُستلم ({total})
              </CardTitle>
              <CardDescription>كل شحنة بحالة «مرتجعة» لا تزال مع المندوب — اضغط «تم التسليم» لتسجيل استلامها</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                rows={items}
                columns={[
                  { key: 'no', header: 'رقم الشحنة', primary: true, align: 'center' as const, width: 'w-28', render: (s: any) => <span className="font-mono text-xs font-bold">{s.shipmentNo ?? '—'}</span> },
                  { key: 'recipient', header: 'المستلم', width: 'w-40', render: (s: any) => <span className="text-xs truncate-1 block" dir="auto">{s.recipientName ?? '—'}</span> },
                  { key: 'dest', header: 'الوجهة', hideInCard: true, width: 'w-32', render: (s: any) => <span className="text-xs truncate-1 block">{s.destination ?? '—'}</span> },
                  { key: 'customer', header: 'العميل', hideInCard: true, width: 'w-32', render: (s: any) => <span className="text-xs truncate-1 block">{s.customerName ?? '—'}</span> },
                  { key: 'courier', header: 'المندوب', width: 'w-32', render: (s: any) => <span className="text-xs font-medium truncate-1 block" dir="auto">{s.courierName ?? 'غير محدد'}</span> },
                  { key: 'voucher', header: 'إذن المرتجع', align: 'center' as const, hideInCard: true, width: 'w-28', render: (s: any) => <span className="font-mono text-xs">{s.returnVoucherNo ?? '—'}</span> },
                  {
                    key: 'days', header: 'المدة', align: 'center' as const, width: 'w-24',
                    render: (s: any) => (
                      <Badge variant="outline" className={cn('text-[11px] tnum',
                        (s.daysOutstanding ?? 0) > 7 ? 'bg-rose-100 text-rose-700' :
                        (s.daysOutstanding ?? 0) > 3 ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-100 text-slate-700')}>
                        {s.daysOutstanding ?? '—'} يوم
                      </Badge>
                    ),
                  },
                  {
                    key: 'actions', header: 'إجراءات', align: 'center' as const, width: 'w-32',
                    render: (s: any) => (
                      canExecute && s.returnVoucherId ? (
                        <Button size="sm" variant="default" onClick={(e) => { e.stopPropagation(); markReceived(s.returnVoucherId, s.returnVoucherNo) }}>
                          <Undo2 className="size-3.5" /> تم التسليم
                        </Button>
                      ) : <span className="text-xs text-muted-foreground">—</span>
                    ),
                  },
                ]}
                getRowKey={(s) => s.shipmentId}
                minW={1100}
                searchFn={(s, q) => (s.shipmentNo || '').toLowerCase().includes(q) || (s.courierName || '').toLowerCase().includes(q) || (s.recipientName || '').toLowerCase().includes(q)}
                searchPlaceholder="بحث برقم الشحنة/المندوب/المستلم..."
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
