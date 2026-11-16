'use client'

// ============================================================================
// وحدة متابعة الإدارة (التنفيذية) — «افتح الموبايل من البيت واعرف الموقف»
// لكل مقاول: إجمالي الشغل المعتمد / المسحوبات / المتبقي له (من دفتر الأستاذ
// 2102 حتى نهاية التاريخ المحدد — بلا تكرار بيانات) + أذونات التسليم المعلقة
// + البنود بانتظار الاعتماد + عدّادات شحنات اليوم برقم الديليفري.
// المبالغ مخفية لغير أصحاب prices.view (خادم + واجهة).
// ============================================================================

import * as React from 'react'
import useSWR from 'swr'
import {
  UserCog, Package, PackageCheck, PackageX, Wallet, ArrowDownToLine,
  Scale, Hourglass, ClipboardCheck, RefreshCw, Eye,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Kpi } from '../ui-cards'
import { PartyFinancialProfile } from '../party-financial-profile'
import { fetcher } from '@/lib/api'
import { fmtNum, fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuth } from '../auth-provider'
import { useToast } from '@/hooks/use-toast'

interface ContractorSummary {
  id: string
  name: string
  code: string | null
  earned: number
  paid: number
  remaining: number
  receiptsPending: number
  extrasPending: number
  extrasPendingAmount: number
}

interface ExecutiveResponse {
  asOf: string
  kpis: { date: string; total: number; dispatched: number; remaining: number; receiptsPending: number }
  contractors: ContractorSummary[]
  totals: { earned: number; paid: number; remaining: number; receiptsPending: number; extrasPending: number }
}

export function ExecutiveModule() {
  const { has } = useAuth()
  const { toast } = useToast()
  const canPrices = has('prices.view')
  const todayISO = React.useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [asOf, setAsOf] = React.useState(todayISO)
  const [profilePartyId, setProfilePartyId] = React.useState<string | null>(null)
  const [profileOpen, setProfileOpen] = React.useState(false)
  const [profileName, setProfileName] = React.useState('')

  const { data, isLoading, mutate, error } = useSWR<ExecutiveResponse>(
    `/api/executive?asOf=${asOf}`,
    fetcher,
    { refreshInterval: 60000, keepPreviousData: true },
  )

  React.useEffect(() => {
    if (error) toast({ title: 'تعذر تحميل ملخص الإدارة', description: error instanceof Error ? error.message : 'حاول مرة أخرى', variant: 'destructive' })
  }, [error, toast])

  const contractors = data?.contractors ?? []
  const kpis = data?.kpis
  const totals = data?.totals

  const openProfile = (c: ContractorSummary) => {
    setProfilePartyId(c.id)
    setProfileName(c.name)
    setProfileOpen(true)
  }

  const moneyTone = (v: number) => (v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground')

  return (
    <div className="space-y-4">
      {/* ── شريط التاريخ + التحديث ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap print:hidden">
        <div className="flex items-center gap-1.5 bg-card border border-border rounded-xl p-1 px-2">
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">الرصيد حتى نهاية</span>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value || todayISO)} className="h-8 text-xs border-0 px-1 w-36 bg-transparent" aria-label="تاريخ الموقف" />
        </div>
        <Button variant="outline" size="sm" onClick={() => mutate()} className="h-9">
          <RefreshCw className="size-4" /> <span className="hidden sm:inline">تحديث</span>
        </Button>
      </div>

      {/* ── عدّادات اليوم ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Kpi title="إجمالي شحنات اليوم" value={fmtNum(kpis?.total ?? 0)} unit="شحنة" icon={Package} tone="primary" subtitle={kpis ? `يوم ${kpis.date}` : undefined} />
        <Kpi title="خرجت من الفرع" value={fmtNum(kpis?.dispatched ?? 0)} unit="شحنة" icon={PackageCheck} tone="teal" />
        <Kpi title="المتبقية" value={fmtNum(kpis?.remaining ?? 0)} unit="شحنة" icon={PackageX} tone="purple" />
        <Kpi title="أذونات معلقة (الكل)" value={fmtNum(totals?.receiptsPending ?? 0)} unit="إذن" icon={ClipboardCheck} tone="green" subtitle={totals?.extrasPending ? `${totals.extrasPending} بند بانتظار الاعتماد` : undefined} />
      </div>

      {/* ── بطاقات المقاولين — الموقف المالي والعملياتي ── */}
      {isLoading && !data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
        </div>
      ) : contractors.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <UserCog className="size-10 mx-auto mb-2 text-muted-foreground/60" />
            <div className="text-sm font-medium">لا يوجد مقاولون مسجلون</div>
            <div className="text-xs text-muted-foreground mt-1">أضف مقاولين من وحدة «المقاولون» لتظهر مواقفهم هنا.</div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {contractors.map((c) => (
              <Card
                key={c.id}
                className="hover-lift min-w-0 cursor-pointer transition-shadow"
                onClick={() => openProfile(c)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openProfile(c) }}
                aria-label={`ملف ${c.name} المالي`}
              >
                <CardContent className="p-4 space-y-3">
                  {/* رأس البطاقة */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate-1" dir="auto">{c.name}</div>
                      {c.code && <div className="text-[10px] text-muted-foreground tnum">كود: {c.code}</div>}
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0 inline-flex items-center gap-1">
                      <Eye className="size-3" /> الملف المالي
                    </Badge>
                  </div>

                  {/* الموقف المالي الثلاثي */}
                  {canPrices ? (
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="rounded-lg bg-secondary/60 p-2 text-center min-w-0">
                        <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground leading-none mb-1"><Wallet className="size-3" /> شغل معتمد</div>
                        <div className="text-sm font-bold tnum num-ltr leading-tight">{fmtNum(c.earned)}</div>
                      </div>
                      <div className="rounded-lg bg-secondary/60 p-2 text-center min-w-0">
                        <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground leading-none mb-1"><ArrowDownToLine className="size-3" /> مسحوبات</div>
                        <div className="text-sm font-bold tnum num-ltr leading-tight">{fmtNum(c.paid)}</div>
                      </div>
                      <div className={cn('rounded-lg p-2 text-center min-w-0', c.remaining > 0 ? 'bg-emerald-500/10' : c.remaining < 0 ? 'bg-rose-500/10' : 'bg-secondary/60')}>
                        <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground leading-none mb-1"><Scale className="size-3" /> متبقي له</div>
                        <div className={cn('text-sm font-bold tnum num-ltr leading-tight', moneyTone(c.remaining))}>{fmtNum(c.remaining)}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground bg-secondary/60 rounded-lg p-2.5 text-center">
                      المبالغ متاحة لمن يملك صلاحية رؤية الأسعار
                    </div>
                  )}

                  {/* المتبقي بصيغة الأعمال */}
                  {canPrices && (
                    <div className={cn('text-[11px] font-medium', moneyTone(c.remaining))}>
                      {c.remaining > 0
                        ? `عليه الشركة ${fmtNum(c.remaining)} ج.م`
                        : c.remaining < 0
                          ? `له عند الشركة ${fmtNum(Math.abs(c.remaining))} ج.م`
                          : 'متوازن'}
                    </div>
                  )}

                  {/* شارات المتابعة */}
                  <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-border/60">
                    <Badge variant="outline" className={cn('text-[10px] inline-flex items-center gap-1',
                      c.receiptsPending > 0 ? 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900' : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900')}>
                      <ClipboardCheck className="size-3" /> {c.receiptsPending > 0 ? `${c.receiptsPending} إذن لم يُسلّم` : 'أذونات سليمة'}
                    </Badge>
                    {c.extrasPending > 0 && (
                      <Badge variant="outline" className="text-[10px] inline-flex items-center gap-1 bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900">
                        <Hourglass className="size-3" /> {c.extrasPending} بند بانتظار الاعتماد
                        {canPrices && c.extrasPendingAmount > 0 ? ` (${fmtNum(c.extrasPendingAmount)} ج.م)` : ''}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* ── شريط الإجماليات ── */}
          {canPrices && (
            <Card className="py-0 gap-0">
              <CardContent className="px-4 py-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[11px] text-muted-foreground">إجمالي الشغل المعتمد (كل المقاولين)</div>
                  <div className="text-base font-bold tnum num-ltr">{fmtNum(totals?.earned ?? 0)} ج.م</div>
                </div>
                <div className="border-x border-border">
                  <div className="text-[11px] text-muted-foreground">إجمالي المسحوبات</div>
                  <div className="text-base font-bold tnum num-ltr">{fmtNum(totals?.paid ?? 0)} ج.م</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">الصافي المتبقي لهم</div>
                  <div className={cn('text-base font-bold tnum num-ltr', moneyTone(totals?.remaining ?? 0))}>{fmtNum(totals?.remaining ?? 0)} ج.م</div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <div className="text-[11px] text-muted-foreground leading-relaxed print:hidden">
        «شغل معتمد» = قيمة الشحنات المسلّمة + البنود الإضافية المعتمدة (تعتيق/مبيت/مرتجعات بعد موافقة الشركة) —
        مشتقة من القيود المحاسبية الفعلية حتى نهاية {data?.asOf ? fmtDate(data.asOf) : asOf}. اضغط بطاقة المقاول لفتح ملفه المالي الكامل وكشف حسابه.
      </div>

      {/* الملف المالي الكامل للمقاول */}
      <PartyFinancialProfile
        partyId={profilePartyId}
        partyName={profileName}
        open={profileOpen}
        onOpenChange={setProfileOpen}
      />
    </div>
  )
}
