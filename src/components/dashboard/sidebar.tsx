'use client'

import * as React from 'react'
import {
  Truck, LayoutDashboard, LayoutGrid, PackageSearch, Users, UserCog, Building2,
  Warehouse as WarehouseIcon, Boxes, ArrowRightLeft, Receipt, BookOpen,
  FileText, Landmark, FileBarChart, Upload, UserCircle, Settings, History,
  ChevronRight, ChevronLeft, ChevronDown, PanelRightClose, PanelRightOpen,
  LogOut, ListChecks, Shield, Undo2, Menu, X, ClipboardCheck, Layers, Eye, FilePlus2, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { matchPermission } from '@/lib/permissions'
import type { SessionUser } from '@/lib/permissions'
import { OverdueReceiptsBadge } from './overdue-badge'
import { DarkModeToggle } from './dark-mode-toggle'
import { UserMenu } from './user-menu'
import { QuickTourButton } from './quick-tour'

export type ModuleKey =
  | 'overview' | 'shipments' | 'receipts' | 'extra-costs' | 'invoices' | 'executive' | 'pending-returns' | 'customers' | 'contractors' | 'suppliers'
  | 'branches' | 'warehouses' | 'inventory' | 'movements' | 'freight'
  | 'accounts' | 'journal' | 'vouchers' | 'reports' | 'import'
  | 'users' | 'roles' | 'lookups' | 'settings' | 'audit'

export interface ModuleDef {
  key: ModuleKey
  label: string
  /** مسمّى مبسّط بلغة الأعمال اليومية — يظهر للمستخدمين التشغيليين في الوضع المبسّط */
  simpleLabel?: string
  icon: LucideIcon
  desc: string
  group: string
}

export const MODULES: ModuleDef[] = [
  { key: 'overview', label: 'الرئيسية', simpleLabel: 'الرئيسية', icon: LayoutDashboard, desc: 'لوحة المؤشرات', group: 'main' },
  { key: 'executive', label: 'متابعة الإدارة', simpleLabel: 'متابعة الإدارة', icon: Eye, desc: 'الموقف المالي والتشغيلي للإدارة', group: 'main' },
  { key: 'shipments', label: 'الشحنات', simpleLabel: 'الشحنات اليومية', icon: PackageSearch, desc: 'سجل الشحنات', group: 'main' },
  { key: 'receipts', label: 'أذونات التسليم', simpleLabel: 'أذونات التسليم', icon: ClipboardCheck, desc: 'الديليفري لكل مقاول', group: 'main' },
  { key: 'extra-costs', label: 'البنود الإضافية', simpleLabel: 'المصاريف والبنود', icon: Layers, desc: 'تعتيق/مبيت/مرتجعات + الاعتماد', group: 'main' },
  { key: 'invoices', label: 'الفواتير', simpleLabel: 'الفواتير', icon: FilePlus2, desc: 'فواتير العملاء الضريبية والتحصيل', group: 'main' },
  { key: 'pending-returns', label: 'المرتجعات لم تُستلم', icon: Undo2, desc: 'تتبع عهدة المرتجعات', group: 'main' },
  { key: 'customers', label: 'العملاء', icon: Users, desc: 'ملفات العملاء', group: 'parties' },
  { key: 'contractors', label: 'المقاولون', simpleLabel: 'حسابات المقاولين', icon: UserCog, desc: 'الناقلون', group: 'parties' },
  { key: 'suppliers', label: 'الموردون', icon: Truck, desc: 'الموردون', group: 'parties' },
  { key: 'branches', label: 'الفروع', icon: Building2, desc: 'الفروع', group: 'structure' },
  { key: 'warehouses', label: 'المخازن', icon: WarehouseIcon, desc: 'المخازن', group: 'structure' },
  { key: 'inventory', label: 'المخزون', icon: Boxes, desc: 'الأصناف', group: 'inventory' },
  { key: 'movements', label: 'حركة المخزون', icon: ArrowRightLeft, desc: 'الحركات', group: 'inventory' },
  { key: 'freight', label: 'أسعار النولون', icon: Receipt, desc: 'جدول الأسعار', group: 'inventory' },
  { key: 'accounts', label: 'شجرة الحسابات', icon: BookOpen, desc: 'دليل الحسابات', group: 'accounting' },
  { key: 'journal', label: 'القيود اليومية', icon: FileText, desc: 'القيد المزدوج', group: 'accounting' },
  { key: 'vouchers', label: 'الأذونات التشغيلية', icon: Landmark, desc: 'أذونات الشحن والمالية', group: 'accounting' },
  { key: 'reports', label: 'التقارير', icon: FileBarChart, desc: 'التقارير', group: 'reports' },
  { key: 'import', label: 'استيراد البيانات', icon: Upload, desc: 'استيراد Excel', group: 'system' },
  { key: 'users', label: 'المستخدمون', icon: UserCircle, desc: 'حسابات المستخدمين', group: 'system' },
  { key: 'roles', label: 'الصلاحيات والأدوار', icon: Shield, desc: 'مصفوفة الصلاحيات', group: 'system' },
  { key: 'lookups', label: 'القوائم المنسدلة', icon: ListChecks, desc: 'إدارة قوائم النظام', group: 'system' },
  { key: 'settings', label: 'الإعدادات', icon: Settings, desc: 'إعدادات النظام', group: 'system' },
  { key: 'audit', label: 'سجل التدقيق', icon: History, desc: 'سجل العمليات', group: 'system' },
]

/** الصلاحية المطلوبة لكل وحدة */
export const MODULE_PERMISSIONS: Record<ModuleKey, string> = {
  overview: 'dashboard.view',
  executive: 'executive.view',
  shipments: 'shipments.view',
  receipts: 'receipts.view',
  'extra-costs': 'extra_costs.view',
  invoices: 'invoices.view',
  'pending-returns': 'returns.view',
  customers: 'customers.view',
  contractors: 'contractors.view',
  suppliers: 'suppliers.view',
  branches: 'branches.view',
  warehouses: 'warehouses.view',
  inventory: 'inventory.view',
  movements: 'inventory.view',
  freight: 'inventory.view',
  accounts: 'accounting.view',
  journal: 'accounting.journal',
  vouchers: 'vouchers.view',
  reports: 'reports.view',
  import: 'import.manage',
  users: 'users.manage',
  roles: 'roles.manage',
  lookups: 'lookups.manage',
  settings: 'settings.manage',
  audit: 'audit.view',
}

/** الوحدات المسموحة حسب صلاحيات المستخدم */
export function visibleModules(permissions: string[] | null | undefined): ModuleDef[] {
  const allowed = MODULES.filter((m) => matchPermission(permissions, MODULE_PERMISSIONS[m.key]))
  // الوضع المبسّط: موظفو العمليات وإدخال البيانات يرون شغلهم اليومي فقط —
  // بدون مصطلحات محاسبية (القيود، شجرة الحسابات، التقارير...).
  // الصلاحيات تبقى طبقة الأمان الفعلية — هذا تبسيط للعرض فقط.
  if (!isSimplifiedUser(permissions)) return allowed
  return allowed
    .filter((m) => SIMPLIFIED_KEYS.includes(m.key))
    .map((m) => ({ ...m, label: m.simpleLabel ?? m.label, group: SIMPLE_GROUP }))
}

// ----------------------------------------------------------------------------
// الوضع المبسّط للمستخدم العادي — 4 شاشات شغل يومية + الرئيسية
// ----------------------------------------------------------------------------

/** مفتاح مجموعة الشغل اليومي في الوضع المبسّط */
export const SIMPLE_GROUP = 'daily'

/** الشاشات اليومية الأربع + الرئيسية — كل ما يحتاجه موظف العمليات */
export const SIMPLIFIED_KEYS: ModuleKey[] = ['overview', 'shipments', 'receipts', 'extra-costs', 'contractors']

/**
 * هل هذا المستخدم يحتاج الواجهة المبسّطة؟
 * المعيار: من لا يملك صلاحية عرض شجرة الحسابات يُعامل كمستخدم تشغيلي يومي —
 * فيرى شاشات الشغل الأربع فقط بدل القوائم الكاملة.
 * (المدير المالي والمالك والعارف بالمحاسبة يرون الواجهة الكاملة)
 */
export function isSimplifiedUser(permissions: string[] | null | undefined): boolean {
  return !matchPermission(permissions, 'accounting.view')
}

export const GROUP_LABELS: Record<string, string> = {
  main: 'العمليات الرئيسية',
  daily: 'شغلك اليومي',
  parties: 'الأطراف',
  structure: 'الهيكل التنظيمي',
  inventory: 'المخزون والتسعير',
  accounting: 'الحسابات المالية',
  reports: 'التقارير',
  system: 'النظام',
}

// Group meta: icon + label
const GROUP_META: Record<string, { icon: LucideIcon; label: string }> = {
  main: { icon: LayoutDashboard, label: 'العمليات الرئيسية' },
  daily: { icon: LayoutDashboard, label: 'شغلك اليومي' },
  parties: { icon: Users, label: 'الأطراف' },
  structure: { icon: Building2, label: 'الهيكل التنظيمي' },
  inventory: { icon: Boxes, label: 'المخزون والتسعير' },
  accounting: { icon: BookOpen, label: 'الحسابات المالية' },
  reports: { icon: FileBarChart, label: 'التقارير' },
  system: { icon: Settings, label: 'النظام' },
}

interface SidebarProps {
  active: ModuleKey
  onChange: (k: ModuleKey) => void
  counts: Partial<Record<ModuleKey, number>>
  permissions?: string[] | null
  user?: SessionUser | null
  onLogout?: () => void
  /** حالة الدرج المنزلق على الشاشات < lg */
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export function Sidebar({ active, onChange, counts, permissions, user, onLogout, mobileOpen = false, onMobileClose }: SidebarProps) {
  const mods = React.useMemo(() => visibleModules(permissions), [permissions])

  // Sidebar collapse state - persisted (desktop only; mobile drawer is always expanded)
  const [collapsed, setCollapsed] = React.useState(false)
  React.useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('sidebar-collapsed') : null
    if (saved === '1') setCollapsed(true)
  }, [])
  const toggle = React.useCallback(() => {
    setCollapsed((c) => {
      const next = !c
      if (typeof window !== 'undefined') localStorage.setItem('sidebar-collapsed', next ? '1' : '0')
      return next
    })
  }, [])

  const groups = React.useMemo(() => {
    const m = new Map<string, ModuleDef[]>()
    for (const mod of mods) {
      if (!m.has(mod.group)) m.set(mod.group, [])
      m.get(mod.group)!.push(mod)
    }
    return Array.from(m.entries())
  }, [mods])

  // Which group is the active module in?
  const activeGroup = React.useMemo(
    () => mods.find((m) => m.key === active)?.group ?? null,
    [active, mods],
  )

  // Accordion-style expanded groups: only ONE group open at a time. Persisted.
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  React.useEffect(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('sidebar-groups-expanded') : null
      if (saved) {
        const arr = JSON.parse(saved) as string[]
        const valid = arr.filter((g) => GROUP_META[g])
        if (valid.length) {
          setExpanded(new Set(valid.slice(0, 1)))
          return
        }
      }
      const initial = activeGroup || 'main'
      setExpanded(new Set([initial]))
      // حفظ الحالة الابتدائية فورًا — تعود المجموعة نفسها بعد أي تحديث للصفحة
      if (typeof window !== 'undefined') {
        localStorage.setItem('sidebar-groups-expanded', JSON.stringify([initial]))
      }
    } catch {
      setExpanded(new Set([activeGroup || 'main']))
    }
  }, [])

  // Auto-expand the active group on navigation — accordion style (persisted).
  React.useEffect(() => {
    if (!activeGroup) return
    setExpanded((prev) => {
      if (prev.size === 1 && prev.has(activeGroup)) return prev
      const next = new Set<string>([activeGroup])
      if (typeof window !== 'undefined') localStorage.setItem('sidebar-groups-expanded', JSON.stringify(Array.from(next)))
      return next
    })
  }, [activeGroup])

  const toggleGroup = React.useCallback((g: string) => {
    setExpanded((prev) => {
      const next = new Set<string>()
      if (!prev.has(g)) next.add(g)
      if (typeof window !== 'undefined') localStorage.setItem('sidebar-groups-expanded', JSON.stringify(Array.from(next)))
      return next
    })
  }, [])

  // اختيار وحدة — يغلق الدرج المنزلق تلقائيًا
  const handleSelect = React.useCallback((k: ModuleKey) => {
    onChange(k)
    onMobileClose?.()
  }, [onChange, onMobileClose])

  // Escape يغلق الدرج + قفل تمرير الـ body عند الفتح
  React.useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onMobileClose?.() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [mobileOpen, onMobileClose])

  // =========================================================================
  // المحتوى المشترك (براند + تنقل + تذييل) — يُستخدم في السايدبار الثابت والدرج
  // =========================================================================
  const renderContent = (variant: 'desktop' | 'mobile') => {
    const isMobile = variant === 'mobile'
    const isCollapsed = !isMobile && collapsed
    return (
      <>
        {/* Header / brand */}
        <div className={cn(
          'flex items-center gap-2 border-b border-sidebar-border h-16 shrink-0',
          isCollapsed ? 'justify-center px-2' : 'px-3',
        )}>
          <div className="relative flex items-center justify-center size-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-lg shrink-0">
            <Truck className="size-5" />
            <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-400 ring-2 ring-sidebar" />
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0 anim-fade-in">
              <h1 className="font-bold text-sm leading-snug truncate">شركة النقل والشحن</h1>
              <p className="text-[10px] text-muted-foreground leading-snug truncate">نظام الإدارة المتكامل</p>
            </div>
          )}
          {/* زر الطي — ديسكتوب فقط */}
          {!isCollapsed && !isMobile && (
            <button
              onClick={toggle}
              className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent rounded-lg size-7 flex items-center justify-center transition-colors shrink-0"
              title="طي القائمة"
            >
              <PanelRightClose className="size-4" />
            </button>
          )}
          {/* زر الإغلاق — الدرج فقط */}
          {isMobile && onMobileClose && (
            <button
              onClick={onMobileClose}
              className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent rounded-lg size-8 flex items-center justify-center transition-colors shrink-0"
              title="إغلاق القائمة"
              aria-label="إغلاق القائمة"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* Expand button when collapsed (desktop only) */}
        {isCollapsed && (
          <button
            onClick={toggle}
            className="mx-auto mt-2 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent rounded-lg size-8 flex items-center justify-center transition-colors"
            title="توسيع القائمة"
          >
            <PanelRightOpen className="size-4" />
          </button>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 space-y-1 scrollbar-thin">
          {groups.map(([groupKey, mods]) => {
            const isExpanded = expanded.has(groupKey) || isMobile
            const isActiveGroup = activeGroup === groupKey
            const groupMeta = GROUP_META[groupKey]
            const GIcon = groupMeta?.icon
            const groupTotal = mods.reduce((acc, m) => acc + (counts[m.key] ?? 0), 0)

            if (isCollapsed) {
              // Collapsed mode: icon-only buttons
              return (
                <React.Fragment key={groupKey}>
                  <div className="mx-2 my-1.5 border-t border-sidebar-border/60" />
                  {mods.map((m) => {
                    const isActive = active === m.key
                    const Icon = m.icon
                    const count = counts[m.key]
                    return (
                      <button
                        key={m.key}
                        onClick={() => handleSelect(m.key)}
                        title={m.label}
                        className={cn(
                          'group relative w-full flex items-center justify-center rounded-xl py-2.5 transition-all duration-200',
                          isActive ? 'nav-item-active shadow-md' : 'hover:bg-sidebar-accent text-sidebar-foreground/90',
                        )}
                      >
                        {isActive && <span className="absolute right-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-l-full bg-primary-foreground/80" />}
                        <Icon className={cn('size-5', isActive ? '' : 'text-muted-foreground group-hover:text-foreground')} />
                        {typeof count === 'number' && count > 0 && (
                          <span className="absolute top-1 right-1 size-2 rounded-full bg-primary ring-2 ring-sidebar" />
                        )}
                      </button>
                    )
                  })}
                </React.Fragment>
              )
            }

            return (
              <div key={groupKey}>
                {/* Group header */}
                <button
                  onClick={() => { if (!isMobile) toggleGroup(groupKey) }}
                  className={cn(
                    'group w-full flex items-center gap-2 px-2.5 py-2 rounded-xl transition-all duration-200',
                    isActiveGroup
                      ? 'bg-sidebar-accent text-sidebar-foreground'
                      : 'hover:bg-sidebar-accent/60 text-sidebar-foreground/85 hover:text-sidebar-foreground',
                  )}
                >
                  {GIcon && (
                    <GIcon className={cn('size-4 shrink-0', isActiveGroup ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
                  )}
                  <span className="flex-1 text-right text-[12px] font-bold leading-tight truncate">{groupMeta?.label}</span>
                  {groupTotal > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full tnum font-semibold bg-secondary text-secondary-foreground shrink-0">
                      {groupTotal.toLocaleString('en-US')}
                    </span>
                  )}
                  {!isMobile && (
                    <ChevronDown
                      className={cn(
                        'size-3.5 text-muted-foreground transition-transform duration-300 shrink-0',
                        isExpanded && 'rotate-180',
                      )}
                    />
                  )}
                </button>

                {/* Modules list — على الموبايل كل المجموعات مفتوحة دائمًا */}
                <div
                  className={cn(
                    'overflow-hidden transition-all duration-300 ease-out',
                    isExpanded ? 'max-h-[900px] opacity-100 mt-1' : 'max-h-0 opacity-0',
                  )}
                >
                  <div className="space-y-0.5 pr-1.5 border-r-2 border-sidebar-border/40 mr-2 my-1">
                    {mods.map((m) => {
                      const isActive = active === m.key
                      const Icon = m.icon
                      const count = counts[m.key]
                      return (
                        <button
                          key={m.key}
                          onClick={() => handleSelect(m.key)}
                          className={cn(
                            'group relative w-full flex items-center gap-2 rounded-lg text-sm transition-all duration-200 px-2.5 py-2',
                            isActive
                              ? 'nav-item-active shadow-sm'
                              : 'hover:bg-sidebar-accent text-sidebar-foreground/85 hover:text-sidebar-foreground',
                          )}
                        >
                          {isActive && (
                            <span className="absolute right-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-l-full bg-primary-foreground/80" />
                          )}
                          <Icon className={cn(
                            'shrink-0 size-4',
                            isActive ? '' : 'text-muted-foreground group-hover:text-foreground',
                          )} />
                          <span className="flex-1 text-right font-medium leading-tight text-[12px] truncate">{m.label}</span>
                          {typeof count === 'number' && (
                            <span className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded-full tnum font-semibold shrink-0',
                              isActive
                                ? 'bg-primary-foreground/20 text-primary-foreground'
                                : 'bg-secondary/80 text-secondary-foreground',
                            )}>
                              {count.toLocaleString('en-US')}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}
        </nav>

        {/* Footer: user info + logout */}
        <div className={cn('border-t border-sidebar-border p-2 space-y-1', isCollapsed && 'flex flex-col items-center')}>
          {!isCollapsed ? (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-sidebar-accent transition-colors">
              <div className="flex items-center justify-center size-7 rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground text-[10px] font-bold shrink-0">
                {(user?.name || 'م').charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold truncate">{user?.name || 'مستخدم'}</div>
                <div className="text-[10px] text-muted-foreground truncate">{user?.roleLabel || user?.username || ''}</div>
              </div>
              <button
                onClick={onLogout}
                title="تسجيل الخروج"
                aria-label="تسجيل الخروج"
                className="size-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
              >
                <LogOut className="size-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={onLogout}
              title="تسجيل الخروج"
              aria-label="تسجيل الخروج"
              className="size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="size-4" />
            </button>
          )}
          {!isCollapsed && (
            <div className="px-2.5 pt-1 text-[10px] text-muted-foreground/60 leading-relaxed truncate">
              نظام إدارة شحن · إصدار 2.0
            </div>
          )}
        </div>
      </>
    )
  }

  return (
    <>
      {/* ===== السايدبار الثابت — lg: فأعلى ===== */}
      <aside
        className={cn(
          'sidebar-print-hide hidden lg:flex shrink-0 flex-col border-l border-sidebar-border bg-sidebar text-sidebar-foreground sticky top-0 h-screen z-30 transition-[width] duration-300 ease-out print:hidden',
          collapsed ? 'w-[68px]' : 'w-60 xl:w-64',
        )}
      >
        {renderContent('desktop')}
      </aside>

      {/* ===== الدرج المنزلق — أقل من lg (موبايل + تابلت) ===== */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="القائمة الجانبية">
          {/* الخلفية المعتمة — الضغط خارجها يغلق */}
          <div
            className="mobile-nav-overlay absolute inset-0 bg-black/40 backdrop-blur-sm anim-fade-in print:hidden"
            onClick={onMobileClose}
          />
          {/* اللوحة المنزلقة من اليمين (RTL) */}
          <aside className="sidebar-print-hide absolute top-0 right-0 h-full w-72 max-w-[85vw] bg-sidebar border-l border-sidebar-border shadow-2xl flex flex-col anim-slide-in-right print:hidden">
            {renderContent('mobile')}
          </aside>
        </div>
      )}
    </>
  )
}

// Mobile bottom nav — 4 primary modules + "More" (h-16 مريح للمس + safe-area)
export function MobileNav({ active, onChange, permissions }: { active: ModuleKey; onChange: (k: ModuleKey) => void; permissions?: string[] | null }) {
  const [open, setOpen] = React.useState(false)
  const allowed = React.useMemo(() => visibleModules(permissions), [permissions])
  const allowedKeys = React.useMemo(() => new Set(allowed.map((m) => m.key)), [allowed])
  // الوضع المبسّط: الشحنات والأذونات والبنود هي الأكثر استخدامًا — والإدارة الكاملة تحتفظ بترتيبها
  const primaryFor: ModuleKey[] = isSimplifiedUser(permissions)
    ? ['overview', 'shipments', 'receipts', 'extra-costs']
    : ['overview', 'shipments', 'customers', 'reports']
  const primary: ModuleKey[] = primaryFor.filter((k) => allowedKeys.has(k))
  const primaryHas = primary.includes(active)

  // Escape يغلق شبكة الوحدات
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <nav className="mobile-nav-print-hide lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border glass supports-[backdrop-filter]:bg-card/85 backdrop-blur-xl print:hidden">
        <div className="grid grid-cols-5 gap-0.5 h-16 p-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
          {primary.map((k) => {
            const m = MODULES.find((x) => x.key === k)!
            const Icon = m.icon
            const isActive = active === k
            return (
              <button
                key={k}
                onClick={() => onChange(k)}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium transition-all min-h-[44px]',
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span className={cn(
                  'flex items-center justify-center size-8 rounded-xl transition-all',
                  isActive && 'bg-primary/10 scale-105',
                )}>
                  <Icon className="size-5" />
                </span>
                <span className="truncate max-w-full leading-none">{m.label}</span>
              </button>
            )
          })}
          {/* "More" button — opens the full module grid */}
          <button
            onClick={() => setOpen(true)}
            className={cn(
              'flex flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium transition-all min-h-[44px]',
              !primaryHas ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className={cn(
              'flex items-center justify-center size-8 rounded-xl transition-all',
              !primaryHas && 'bg-primary/10 scale-105',
            )}>
              <LayoutGrid className="size-5" />
            </span>
            <span className="leading-none">المزيد</span>
          </button>
        </div>
      </nav>

      {open && (
        <div className="mobile-nav-overlay lg:hidden fixed inset-0 z-50 bg-black/40 backdrop-blur-sm anim-fade-in print:hidden" onClick={() => setOpen(false)}>
          <div
            className="absolute bottom-4 left-4 right-4 max-h-[75vh] overflow-y-auto rounded-2xl border border-border glass shadow-2xl p-3 anim-slide-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3 px-2">
              <h3 className="font-bold text-sm">كل الوحدات</h3>
              <button onClick={() => setOpen(false)} className="text-muted-foreground size-8 rounded-full hover:bg-secondary flex items-center justify-center" aria-label="إغلاق">
                <ChevronLeft className="size-4" />
              </button>
            </div>
            {Array.from(new Set(allowed.map((m) => m.group))).map((g) => (
              <div key={g} className="mb-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-bold px-2 mb-1">{GROUP_LABELS[g]}</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {allowed.filter((m) => m.group === g).map((m) => {
                    const Icon = m.icon
                    const isActive = active === m.key
                    return (
                      <button
                        key={m.key}
                        onClick={() => { onChange(m.key); setOpen(false) }}
                        className={cn(
                          'flex flex-col items-center gap-1.5 p-3 rounded-xl text-[11px] font-medium transition-all min-h-[64px] justify-center',
                          isActive ? 'nav-item-active' : 'hover:bg-secondary text-foreground',
                        )}
                      >
                        <Icon className="size-5" />
                        <span className="text-center leading-tight">{m.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// Mobile top header — hamburger + page title + overdue badge + dark mode + user menu (< lg فقط)
export function MobileHeader({ title, subtitle, icon: Icon, onMenuClick, overdueCount = 0, onOverdueClick }: { title: string; subtitle: string; icon?: LucideIcon; onMenuClick?: () => void; overdueCount?: number; onOverdueClick?: () => void }) {
  return (
    <header className="mobile-header-print-hide lg:hidden sticky top-0 z-30 flex items-center gap-2 px-3 h-14 border-b border-border glass supports-[backdrop-filter]:bg-card/90 backdrop-blur-xl print:hidden">
      {/* زر القائمة (Hamburger) — يفتح الدرج المنزلق */}
      {onMenuClick && (
        <button
          onClick={onMenuClick}
          className="flex items-center justify-center size-10 rounded-xl border border-border bg-card text-foreground hover:bg-accent transition-colors shrink-0"
          title="فتح القائمة"
          aria-label="فتح القائمة الجانبية"
        >
          <Menu className="size-5" />
        </button>
      )}
      <div className="flex items-center justify-center size-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-md shrink-0">
        {Icon ? <Icon className="size-5" /> : <Truck className="size-5" />}
      </div>
      <div className="flex-1 min-w-0">
        <h1 className="font-bold text-sm leading-snug truncate">{title}</h1>
        <p className="text-[11px] text-muted-foreground leading-snug truncate">{subtitle}</p>
      </div>
      {overdueCount > 0 && onOverdueClick && (
        <div className="shrink-0">
          <OverdueReceiptsBadge count={overdueCount} onNavigate={onOverdueClick} compact />
        </div>
      )}
      <QuickTourButton variant="mobile" />
      <DarkModeToggle className="size-9 shrink-0" />
      <div className="shrink-0">
        <UserMenu />
      </div>
    </header>
  )
}
