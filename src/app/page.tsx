'use client'

import * as React from 'react'
import useSWR from 'swr'
import { Calendar, X, ChevronLeft } from 'lucide-react'
import { Sidebar, MobileNav, MobileHeader, type ModuleKey, MODULES } from '@/components/dashboard/sidebar'
import { DarkModeToggle } from '@/components/dashboard/dark-mode-toggle'
import { DashboardModule } from '@/components/dashboard/modules/dashboard'
import { ShipmentsModule } from '@/components/dashboard/modules/shipments'
import { PartiesModule } from '@/components/dashboard/modules/parties'
import { BranchesModule, WarehousesModule } from '@/components/dashboard/modules/structure'
import { InventoryModule, MovementsModule, FreightModule } from '@/components/dashboard/modules/inventory'
import { AccountsModule, JournalModule, VouchersModule } from '@/components/dashboard/modules/accounting'
import { ReportsModule } from '@/components/dashboard/modules/reports'
import { ImportModule } from '@/components/dashboard/modules/import-wizard'
import { UsersModule, RolesModule, SettingsModule, AuditModule } from '@/components/dashboard/modules/system'
import { LookupsModule } from '@/components/dashboard/modules/lookups'
import { Button } from '@/components/ui/button'
import { fetcher } from '@/lib/api'

const fetcherCounts = fetcher

const TAB_LABELS: Record<ModuleKey, { title: string; subtitle: string }> = {
  overview: { title: 'الرئيسية', subtitle: 'لوحة المؤشرات الرئيسية' },
  shipments: { title: 'الشحنات', subtitle: 'سجل عمليات الشحن وحالاتها' },
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
  vouchers: { title: 'سندات القبض/الصرف', subtitle: 'التحصيل والسداد' },
  reports: { title: 'التقارير', subtitle: 'تقارير شاملة قابلة للتصدير' },
  import: { title: 'استيراد البيانات', subtitle: 'معالج استيراد Excel' },
  users: { title: 'المستخدمون', subtitle: 'المستخدمون والأدوار' },
  settings: { title: 'الإعدادات', subtitle: 'إعدادات النظام وتعريفات الأعمدة' },
  audit: { title: 'سجل التدقيق', subtitle: 'سجل عمليات النظام' },
  lookups: { title: 'القوائم المنسدلة', subtitle: 'إدارة قوائم النظام المنسدلة' },
}

export default function Page() {
  const [tab, setTab] = React.useState<ModuleKey>('overview')
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')

  const { data: statsData } = useSWR<any>('/api/stats', fetcherCounts, { refreshInterval: 0 })
  const { data: freightData } = useSWR<any>('/api/freight', fetcherCounts, { refreshInterval: 0 })
  const { data: partiesData } = useSWR<any>('/api/parties', fetcherCounts, { refreshInterval: 0 })
  const { data: branchesData } = useSWR<any>('/api/branches', fetcherCounts, { refreshInterval: 0 })
  const { data: warehousesData } = useSWR<any>('/api/warehouses', fetcherCounts, { refreshInterval: 0 })
  const { data: itemsData } = useSWR<any>('/api/items', fetcherCounts, { refreshInterval: 0 })
  const { data: movementsData } = useSWR<any>('/api/movements', fetcherCounts, { refreshInterval: 0 })
  const { data: accountsData } = useSWR<any>('/api/accounts', fetcherCounts, { refreshInterval: 0 })
  const { data: journalData } = useSWR<any>('/api/journal', fetcherCounts, { refreshInterval: 0 })
  const { data: vouchersData } = useSWR<any>('/api/vouchers', fetcherCounts, { refreshInterval: 0 })
  const { data: usersData } = useSWR<any>('/api/users', fetcherCounts, { refreshInterval: 0 })
  const { data: auditData } = useSWR<any>('/api/audit', fetcherCounts, { refreshInterval: 0 })
  const { data: lookupsData } = useSWR<any>('/api/lookups', fetcherCounts, { refreshInterval: 0 })

  const counts: Partial<Record<ModuleKey, number>> = React.useMemo(() => ({
    overview: statsData?.summary?.totalShipments ?? 0,
    shipments: statsData?.summary?.totalShipments ?? 0,
    customers: partiesData?.items?.filter((p: any) => p.isCustomer).length ?? 0,
    contractors: partiesData?.items?.filter((p: any) => p.isContractor).length ?? 0,
    suppliers: partiesData?.items?.filter((p: any) => p.isSupplier).length ?? 0,
    branches: branchesData?.items?.length ?? 0,
    warehouses: warehousesData?.items?.length ?? 0,
    inventory: itemsData?.total ?? 0,
    movements: movementsData?.total ?? 0,
    freight: freightData?.total ?? 0,
    accounts: accountsData?.items?.length ?? 0,
    journal: journalData?.total ?? 0,
    vouchers: vouchersData?.total ?? 0,
    users: usersData?.items?.length ?? 0,
    audit: auditData?.total ?? 0,
    lookups: lookupsData?.total ?? 0,
  }), [statsData, freightData, partiesData, branchesData, warehousesData, itemsData, movementsData, accountsData, journalData, vouchersData, usersData, auditData, lookupsData])

  const activeMod = MODULES.find((m) => m.key === tab)
  const ActiveIcon = activeMod?.icon

  return (
    <div className="min-h-screen flex flex-col bg-background" dir="rtl">
      <MobileHeader />
      <div className="flex flex-1 min-h-0">
        <Sidebar active={tab} onChange={setTab} counts={counts} />
        <main className="flex-1 min-w-0 flex flex-col pb-20 md:pb-0">
          <header className="sticky top-0 z-20 border-b border-border glass supports-[backdrop-filter]:bg-background/80 backdrop-blur-xl">
            <div className="px-3 sm:px-4 md:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {ActiveIcon && (
                  <div className="hidden sm:flex items-center justify-center size-10 rounded-xl bg-primary/10 text-primary shrink-0">
                    <ActiveIcon className="size-5" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground/70 mb-0.5 truncate-1">
                    <span>النظام</span>
                    <ChevronLeft className="size-3 shrink-0" />
                    <span className="text-foreground/80 truncate-1">{TAB_LABELS[tab].title}</span>
                  </div>
                  <h2 className="text-base sm:text-lg md:text-xl font-bold tracking-tight leading-none truncate-1">
                    {TAB_LABELS[tab].title}
                  </h2>
                  <p className="text-[11px] md:text-xs text-muted-foreground mt-0.5 hidden sm:block truncate-1">
                    {TAB_LABELS[tab].subtitle}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {tab === 'overview' && (
                  <div className="flex items-center gap-1.5 bg-card border border-border rounded-xl p-1 px-2 min-w-0">
                    <Calendar className="size-4 text-muted-foreground shrink-0" />
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                      className="text-xs bg-transparent border-0 outline-none px-1 py-1 min-w-0 w-24 sm:w-28"
                    />
                    <span className="text-muted-foreground text-xs shrink-0">→</span>
                    <input
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      className="text-xs bg-transparent border-0 outline-none px-1 py-1 min-w-0 w-24 sm:w-28"
                    />
                    {(from || to) && (
                      <button
                        onClick={() => { setFrom(''); setTo('') }}
                        className="size-6 rounded-md hover:bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                )}
                <DarkModeToggle />
              </div>
            </div>
          </header>
          <div className="flex-1 p-3 sm:p-4 md:p-6 lg:p-8 w-full mx-auto max-w-[1600px]">
            <div key={tab} className="anim-fade-in">
              {tab === 'overview' && <DashboardModule from={from || undefined} to={to || undefined} />}
              {tab === 'shipments' && <ShipmentsModule />}
              {tab === 'customers' && <PartiesModule type="customer" title="عملاء" />}
              {tab === 'contractors' && <PartiesModule type="contractor" title="مقاولون" />}
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
              {tab === 'lookups' && <LookupsModule />}
              {tab === 'settings' && <SettingsModule />}
              {tab === 'audit' && <AuditModule />}
            </div>
          </div>
        </main>
      </div>
      <MobileNav active={tab} onChange={setTab} />
    </div>
  )
}
