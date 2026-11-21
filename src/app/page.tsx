'use client'

// ============================================================================
// الصفحة الرئيسية — هيكل لوحة التحكم
// - قائمة جانبية + هيدر + محتوى ديناميكي حسب التبويب
// - عدّادات موحدة عبر /api/counts (طلب واحد بدل 13)
// - هيدر ذكي: عنوان + وصف + شارة المجموعة (breadcrumb) + نطاق تاريخ سريع
// ============================================================================

import * as React from 'react'
import useSWR from 'swr'
import { Calendar, X, ChevronLeft } from 'lucide-react'
import { Sidebar, MobileNav, MobileHeader, type ModuleKey, MODULES, MODULE_PERMISSIONS, visibleModules, GROUP_LABELS, isSimplifiedUser } from '@/components/dashboard/sidebar'
import { OverdueReceiptsBadge } from '@/components/dashboard/overdue-badge'
import { QuickTourButton } from '@/components/dashboard/quick-tour'
import { DarkModeToggle } from '@/components/dashboard/dark-mode-toggle'
import { UserMenu } from '@/components/dashboard/user-menu'
import { AuthProvider, useAuth } from '@/components/dashboard/auth-provider'
import { ModuleErrorBoundary } from '@/components/dashboard/module-error-boundary'
import { ConfirmProvider } from '@/components/ui/confirm-dialog'
import { LoginScreen, AuthSplash } from '@/components/dashboard/login-screen'
import { DashboardModule, type QuickAction } from '@/components/dashboard/modules/dashboard'
import { ShipmentsModule } from '@/components/dashboard/modules/shipments'
import { ReceiptsModule } from '@/components/dashboard/modules/receipts'
import { ExtraCostsModule } from '@/components/dashboard/modules/extra-costs'
import { InvoicesModule } from '@/components/dashboard/modules/invoices'
import { ExecutiveModule } from '@/components/dashboard/modules/executive'
import { PartiesModule } from '@/components/dashboard/modules/parties'
import { BranchesModule, WarehousesModule } from '@/components/dashboard/modules/structure'
import { InventoryModule, MovementsModule, FreightModule } from '@/components/dashboard/modules/inventory'
import { AccountsModule, JournalModule } from '@/components/dashboard/modules/accounting'
import { VouchersModule } from '@/components/dashboard/modules/vouchers-ops'
import { PendingReturnsModule } from '@/components/dashboard/modules/pending-returns'
import { ReportsModule } from '@/components/dashboard/modules/reports'
import { ImportModule } from '@/components/dashboard/modules/import-wizard'
import { UsersModule, RolesModule, SettingsModule, AuditModule } from '@/components/dashboard/modules/system'
import { LookupsModule } from '@/components/dashboard/modules/lookups'
import { PrintHeader, PrintFooter } from '@/components/dashboard/print-layout'
import { fetcher } from '@/lib/api'
import { bus, BUS_EVENTS, setIntent } from '@/lib/bus'
import { cn } from '@/lib/utils'

// ----------------------------------------------------------------------------
// بيانات تعريف التبويبات — تُستورد إلى الهيدر والقائمة
// ----------------------------------------------------------------------------
const TAB_LABELS: Record<ModuleKey, { title: string; subtitle: string }> = {
  overview: { title: 'الرئيسية', subtitle: 'كل حاجة تحتاجها في صفحة واحدة — ابدأ من الأزرار الكبيرة فوق' },
  executive: { title: 'متابعة الإدارة', subtitle: 'الموقف المالي والتشغيلي لكل مقاول — أذونات ومستحقات ومسحوبات' },
  shipments: { title: 'الشحنات', subtitle: 'سجّل النقلات الجديدة وتابع حالتها برقم الديليفري' },
  receipts: { title: 'أذونات التسليم', subtitle: 'ابحث برقم الديليفري واضغط علامة ✓ فور استلام الإذن الورقي من المقاول' },
  'extra-costs': { title: 'البنود الإضافية', subtitle: 'تعتيق ومبيت ومرتجعات ودفعات على حساب المقاول — تُعتمد من الشركة قبل ما تسمع في الحساب' },
  invoices: { title: 'الفواتير', subtitle: 'فواتير العملاء الضريبية — إصدار وترحيل محاسبي وتحصيل وطباعة A4' },
  'pending-returns': { title: 'المرتجعات لم تُستلم', subtitle: 'تتبع عهدة المرتجعات مع المندوبين' },
  customers: { title: 'العملاء', subtitle: 'ملفات العملاء وأرصدتهم' },
  contractors: { title: 'المقاولون', subtitle: 'الناقلون وأداؤهم' },
  suppliers: { title: 'الموردون', subtitle: 'موردو الخدمات' },
  branches: { title: 'الفروع', subtitle: 'الفروع ومناطق التغطية' },
  warehouses: { title: 'المخازن', subtitle: 'المخازن وأرصدتها' },
  inventory: { title: 'المخزون', subtitle: 'الأصناف وأرصدتها' },
  movements: { title: 'حركة المخزون', subtitle: 'الاستلام والصرف والتحويل' },
  freight: { title: 'أسعار النولون', subtitle: 'جدول أسعار المناطق' },
  accounts: { title: 'شجرة الحسابات', subtitle: 'دليل الحسابات والأرصدة' },
  journal: { title: 'القيود اليومية', subtitle: 'القيد المزدوج والترحيل' },
  vouchers: { title: 'الأذونات التشغيلية', subtitle: 'إدارة أذونات الشحن والمالية بدورة حياة كاملة' },
  reports: { title: 'التقارير', subtitle: 'تقارير شاملة قابلة للتصدير' },
  import: { title: 'استيراد البيانات', subtitle: 'معالج استيراد Excel' },
  users: { title: 'المستخدمون', subtitle: 'حسابات المستخدمين وكلمات المرور' },
  roles: { title: 'الصلاحيات والأدوار', subtitle: 'مصفوفة صلاحيات الوصول للوحدات' },
  settings: { title: 'الإعدادات', subtitle: 'إعدادات النظام وتعريفات الأعمدة' },
  audit: { title: 'سجل التدقيق', subtitle: 'سجل عمليات النظام والدخول والخروج' },
  lookups: { title: 'القوائم المنسدلة', subtitle: 'إدارة قوائم النظام المنسدلة' },
}

// في الوضع المبسّط (موظفو العمليات) تُعرض شاشة المقاولين بلغة الأعمال اليومية
const SIMPLIFIED_TAB_LABELS: Partial<Record<ModuleKey, { title: string; subtitle: string }>> = {
  overview: { title: 'الرئيسية', subtitle: 'ابدأ من الأزرار الكبيرة — أهم 3 عمليات في شغلك اليومي' },
  contractors: { title: 'حسابات المقاولين', subtitle: 'كل مقاول ليه كام شغل وكام اتسحب وكام متبقي له — في نظرة واحدة' },
  shipments: { title: 'الشحنات اليومية', subtitle: 'اضغط «تسجيل شحنة جديدة» واكتب رقم الديليفري واختر المقاول — وتابع حالة كل نقلة من هنا' },
  'extra-costs': { title: 'المصاريف والبنود', subtitle: 'سجّل تعتيق أو مبيت أو مرتجع أو دفعة للمقاول — بتتسمع في الحساب بعد موافقة الشركة' },
}

function labelsFor(tab: ModuleKey, simplified: boolean): { title: string; subtitle: string } {
  if (simplified && SIMPLIFIED_TAB_LABELS[tab]) return SIMPLIFIED_TAB_LABELS[tab]!
  return TAB_LABELS[tab]
}

// ----------------------------------------------------------------------------
// نطاقات تاريخ سريعة للوحة المؤشرات
// ----------------------------------------------------------------------------
type DatePreset = 'today' | '7d' | '30d' | 'all'
const PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'today', label: 'اليوم' },
  { key: '7d', label: '7 أيام' },
  { key: '30d', label: '30 يوم' },
  { key: 'all', label: 'الكل' },
]

function presetToRange(preset: DatePreset): { from: string; to: string } {
  const today = new Date()
  const todayISO = today.toISOString().slice(0, 10)
  if (preset === 'today') return { from: todayISO, to: todayISO }
  if (preset === '7d' || preset === '30d') {
    const days = preset === '7d' ? 7 : 30
    const start = new Date(today)
    start.setDate(today.getDate() - days + 1)
    return { from: start.toISOString().slice(0, 10), to: todayISO }
  }
  return { from: '', to: '' } // all
}

// ----------------------------------------------------------------------------
// هيدر لوحة التحكم — عنوان + وصف + شارة المجموعة + نطاق تاريخ (overview فقط)
// ----------------------------------------------------------------------------
function DashboardHeader({
  tab,
  simplified,
  from,
  to,
  setFrom,
  setTo,
  overdueCount,
  onOverdueClick,
}: {
  tab: ModuleKey
  simplified: boolean
  from: string
  to: string
  setFrom: (v: string) => void
  setTo: (v: string) => void
  overdueCount: number
  onOverdueClick: () => void
}) {
  const activeMod = MODULES.find((m) => m.key === tab)
  const ActiveIcon = activeMod?.icon
  const groupLabel = activeMod ? GROUP_LABELS[activeMod.group] : null
  const labels = labelsFor(tab, simplified)

  // اكتشاف البريسيت الحالي من from/to (لإبرار الزر النشط)
  const activePreset: DatePreset | null = React.useMemo(() => {
    if (!from && !to) return 'all'
    const today = new Date().toISOString().slice(0, 10)
    if (from === today && to === today) return 'today'
    const start7 = new Date(); start7.setDate(new Date().getDate() - 6)
    if (from === start7.toISOString().slice(0, 10) && to === today) return '7d'
    const start30 = new Date(); start30.setDate(new Date().getDate() - 29)
    if (from === start30.toISOString().slice(0, 10) && to === today) return '30d'
    return null
  }, [from, to])

  const applyPreset = (p: DatePreset) => {
    const r = presetToRange(p)
    setFrom(r.from)
    setTo(r.to)
  }

  return (
    <header className="desktop-header-print-hide hidden lg:flex sticky top-0 z-20 bg-white/95 dark:bg-slate-900/95 backdrop-blur supports-[backdrop-filter]:bg-white/85 dark:supports-[backdrop-filter]:bg-slate-900/85 border-b border-slate-250 dark:border-slate-800 flex-col xl:flex-row items-stretch xl:items-center justify-start xl:justify-between gap-1.5 xl:gap-4 py-2.5 px-4 sm:px-6 min-h-[64px] print:hidden">
      {/* يمين: شارة المجموعة (breadcrumb) + الأيقونة + العنوان + الوصف */}
      <div className="flex items-center gap-3 min-w-0">
        {ActiveIcon && (
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 dark:bg-primary/20 text-primary border border-primary/20 dark:border-primary/30 shadow-sm shrink-0">
            <ActiveIcon className="w-5 h-5" />
          </div>
        )}
        <div className="flex flex-col justify-center min-w-0 space-y-1 leading-normal">
          {/* breadcrumb: المجموعة ← الوحدة — تُخفى على الرئيسية لتفادي التكرار */}
          {groupLabel && tab !== 'overview' && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground/80 leading-normal">
              <span className="truncate">{groupLabel}</span>
              <ChevronLeft className="size-2.5 shrink-0" />
              <span className="text-foreground/90 font-medium truncate">{labels.title}</span>
            </div>
          )}
          <h1 className="text-base font-bold text-slate-850 dark:text-white leading-normal truncate">
            {labels.title}
          </h1>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal truncate">
            {labels.subtitle}
          </span>
        </div>
      </div>

      {/* يسار: شريط أدوات أفقي مضغوط — flex-nowrap بدون التفاف داخلي */}
      <div className="flex flex-nowrap items-center justify-start xl:justify-end gap-2 h-9 text-xs shrink-0">
        <QuickTourButton variant="desktop" />
        <OverdueReceiptsBadge count={overdueCount} onNavigate={onOverdueClick} />
        {tab === 'overview' && (
          <div className="hidden sm:flex flex-nowrap items-center gap-1.5">
            {/* أزرار البريسيت السريعة */}
            <div className="flex items-center gap-0.5 bg-secondary/60 rounded-lg p-0.5 shrink-0">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => applyPreset(p.key)}
                  className={cn(
                    'text-[11px] font-medium px-1.5 py-1 rounded-md transition-all whitespace-nowrap',
                    activePreset === p.key
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  title={p.label}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {/* نطاق مخصص — يظهر من 1360px لحماية مساحة العنوان في الشاشات المتوسطة */}
            <div className="hidden min-[1360px]:flex flex-nowrap items-center gap-1 bg-card border border-border rounded-xl p-1 px-1.5 min-w-0">
              <Calendar className="size-3.5 text-muted-foreground shrink-0" />
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="date-input-compact text-xs bg-transparent border-0 outline-none px-0.5 py-1 min-w-0 w-[104px] 2xl:w-[112px]"
                aria-label="من تاريخ"
              />
              <span className="text-muted-foreground text-xs shrink-0">→</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="date-input-compact text-xs bg-transparent border-0 outline-none px-0.5 py-1 min-w-0 w-[104px] 2xl:w-[112px]"
                aria-label="إلى تاريخ"
              />
              {(from || to) && activePreset !== 'all' && (
                <button
                  onClick={() => { setFrom(''); setTo('') }}
                  className="size-6 rounded-md hover:bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
                  title="مسح"
                  aria-label="مسح"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
        <DarkModeToggle />
        <UserMenu />
      </div>
    </header>
  )
}

// ----------------------------------------------------------------------------
// هيكل لوحة التحكم الرئيسي
// ----------------------------------------------------------------------------
function DashboardShell() {
  const { user, logout, has } = useAuth()
  // الوضع المبسّط: موظفو العمليات يرون شاشات الشغل اليومي فقط بدون مصطلحات محاسبية
  const simplified = isSimplifiedUser(user?.permissions)
  // آخر شاشة كان عليها المستخدم تُستعاد بعد تحديث الصفحة (مع تحقق الصلاحية أدناه)
  const [tab, setTab] = React.useState<ModuleKey>(() => {
    if (typeof window === 'undefined') return 'overview'
    try {
      const saved = window.localStorage.getItem('active-tab') as ModuleKey | null
      if (saved && MODULES.some((m) => m.key === saved)) return saved
    } catch { /* ignore */ }
    return 'overview'
  })
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  // حالة الدرج المنزلق للقائمة الجانبية على الشاشات < lg (موبايل + تابلت)
  const [navOpen, setNavOpen] = React.useState(false)
  const labels = labelsFor(tab, simplified)

  // حفظ آخر شاشة — تعود المجموعة الجانبية نفسها مفتوحة بعد أي تحديث للصفحة
  React.useEffect(() => {
    try { window.localStorage.setItem('active-tab', tab) } catch { /* ignore */ }
  }, [tab])

  // إعادة توجيه تلقائية إذا فقد المستخدم صلاحية التبويب الحالي
  React.useEffect(() => {
    if (!user) return
    if (!has(MODULE_PERMISSIONS[tab])) {
      const first = visibleModules(user.permissions)[0]
      if (first) setTab(first.key)
    }
  }, [user, tab, has])

  // طلب موحّد لكل العدّادات (استبدل 13 طلب SWR منفصل)
  const { data: countsData } = useSWR<Partial<Record<ModuleKey, number> & { receiptsOverdue?: number }>>('/api/counts', fetcher, {
    refreshInterval: 60000, // تحديث كل دقيقة بدل 30 ثانية لخفض الحمل
    revalidateOnFocus: false,
  })
  const counts: Partial<Record<ModuleKey, number> & { receiptsOverdue?: number }> = countsData ?? {}

  // شارة الأذونات المتأخرة — تنقل مباشر لتبويب الأذونات بعرض «الأذونات المتأخرة»
  const openOverdueReceipts = React.useCallback(() => {
    // تسجيل النية قبل تبديل التبويب (تُستهلك عند تركيب وحدة الأذونات) + بث للوحدة المفتوحة حاليًا
    setIntent(BUS_EVENTS.OPEN_OVERDUE_RECEIPTS)
    setTab('receipts')
    bus.emit(BUS_EVENTS.OPEN_OVERDUE_RECEIPTS)
  }, [setTab])

  // الأزرار السريعة في الرئيسية — تنقل للشاشة المطلوبة مع فتح النافذة جاهزة للإدخال
  const handleQuickAction = React.useCallback((action: QuickAction) => {
    if (action === 'new-shipment') {
      setIntent(BUS_EVENTS.OPEN_SHIPMENT_CREATE)
      setTab('shipments')
      bus.emit(BUS_EVENTS.OPEN_SHIPMENT_CREATE)
    } else if (action === 'confirm-receipt') {
      setIntent(BUS_EVENTS.OPEN_RECEIPTS_PENDING)
      setTab('receipts')
      bus.emit(BUS_EVENTS.OPEN_RECEIPTS_PENDING)
    } else {
      setIntent(BUS_EVENTS.OPEN_EXTRA_COST_CREATE)
      setTab('extra-costs')
      bus.emit(BUS_EVENTS.OPEN_EXTRA_COST_CREATE)
    }
  }, [setTab])

  // الوحدة النشطة حاليًا — تُمرّر للهيدر والموبايل-هيدر
  const activeMod = MODULES.find((m) => m.key === tab)

  return (
    <div className="min-h-screen flex flex-col bg-background overflow-x-clip" dir="rtl">
      <MobileHeader
        title={labels.title}
        subtitle={labels.subtitle}
        icon={activeMod?.icon}
        onMenuClick={() => setNavOpen(true)}
        overdueCount={Number(counts['receiptsOverdue'] ?? 0)}
        onOverdueClick={openOverdueReceipts}
      />
      <div className="dashboard-layout-row flex flex-1 min-h-0">
        <Sidebar
          active={tab}
          onChange={setTab}
          counts={counts}
          permissions={user?.permissions}
          user={user}
          onLogout={logout}
          mobileOpen={navOpen}
          onMobileClose={() => setNavOpen(false)}
        />
        <main className="flex-1 min-w-0 flex flex-col pb-20 lg:pb-0">
          <DashboardHeader
            tab={tab}
            simplified={simplified}
            from={from}
            to={to}
            setFrom={setFrom}
            setTo={setTo}
            overdueCount={Number(counts['receiptsOverdue'] ?? 0)}
            onOverdueClick={openOverdueReceipts}
          />
          <div className="flex-1 p-3 sm:p-4 md:p-6 xl:p-8 w-full mx-auto max-w-[1600px] print:p-0">
            {/* ترويسة التقرير الرسمية — تظهر فقط أثناء الطباعة */}
            <PrintHeader
              title={labels.title}
              subtitle={labels.subtitle}
              user={user?.name}
            />
            <ModuleErrorBoundary>
              <div key={tab} className="anim-fade-in">
                {tab === 'overview' && (
                  <DashboardModule
                    from={from || undefined}
                    to={to || undefined}
                    setFrom={setFrom}
                    setTo={setTo}
                    onQuickAction={handleQuickAction}
                    quickCan={{
                      'new-shipment': has('shipments.create'),
                      'confirm-receipt': has('shipments.receipts') || has('shipments.view'),
                      'new-payment': has('parties.extras.manage'),
                    }}
                  />
                )}
              {tab === 'executive' && <ExecutiveModule />}
              {tab === 'shipments' && <ShipmentsModule />}
              {tab === 'receipts' && <ReceiptsModule />}
              {tab === 'extra-costs' && <ExtraCostsModule />}
              {tab === 'invoices' && <InvoicesModule />}
              {tab === 'pending-returns' && <PendingReturnsModule />}
              {tab === 'customers' && <PartiesModule type="customer" title="عملاء" />}
              {/* في الوضع المبسّط: «حسابات المقاولين» = ملخص مبسط لكل مقاول (نفس شاشة متابعة الإدارة) */}
              {tab === 'contractors' && (simplified ? <ExecutiveModule /> : <PartiesModule type="contractor" title="مقاولون" />)}
              {tab === 'suppliers' && <PartiesModule type="supplier" title="موردون" />}
              {tab === 'branches' && <BranchesModule />}
              {tab === 'warehouses' && <WarehousesModule />}
              {tab === 'inventory' && <InventoryModule />}
              {tab === 'movements' && <MovementsModule />}
              {tab === 'freight' && <FreightModule />}
              {tab === 'accounts' && <AccountsModule />}
              {tab === 'journal' && <JournalModule />}
              {tab === 'vouchers' && <VouchersModule />}
              {tab === 'reports' && <ReportsModule />}
              {tab === 'import' && <ImportModule />}
              {tab === 'users' && <UsersModule />}
              {tab === 'roles' && <RolesModule />}
              {tab === 'lookups' && <LookupsModule />}
              {tab === 'settings' && <SettingsModule />}
              {tab === 'audit' && <AuditModule />}
              </div>
            </ModuleErrorBoundary>
            {/* تذييل التقرير — خانات التوقيع، تظهر فقط في الطباعة */}
            <PrintFooter />
          </div>
        </main>
      </div>
      <MobileNav active={tab} onChange={setTab} permissions={user?.permissions} />
    </div>
  )
}

function Gate() {
  const { user, loading } = useAuth()
  if (loading) return <AuthSplash />
  if (!user) return <LoginScreen />
  return <DashboardShell />
}

export default function Page() {
  return (
    <AuthProvider>
      <ConfirmProvider>
        <Gate />
      </ConfirmProvider>
    </AuthProvider>
  )
}
