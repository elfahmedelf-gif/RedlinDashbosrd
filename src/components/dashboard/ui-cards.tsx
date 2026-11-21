'use client'

// ============================================================================
// مكوّنات بطاقات مشتركة — تُستخدم عبر كل الوحدات للتقليل من التكرار
// وموازنة التصميم البصري.
// ============================================================================

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { fmtNum } from '@/lib/format'

// ---------------------------------------------------------------------------
// Kpi — بطاقة مؤشر أداء رئيسي مع تدرّج لوني وأيقونة بارزة
// ---------------------------------------------------------------------------
const KPI_TONES: Record<string, { wrap: string; icon: string; glow: string }> = {
  primary: {
    wrap: 'from-primary/15 to-primary/5 dark:from-primary/20 dark:to-primary/10',
    icon: 'bg-gradient-to-br from-primary to-primary/70 text-primary-foreground',
    glow: 'shadow-[0_8px_24px_-8px_var(--primary)]',
  },
  teal: {
    wrap: 'from-teal-500/15 to-teal-500/5 dark:from-teal-500/20 dark:to-teal-500/10',
    icon: 'bg-gradient-to-br from-teal-500 to-teal-600 text-white dark:from-teal-400 dark:to-teal-500',
    glow: 'shadow-[0_8px_24px_-8px_oklch(0.6_0.13_170)]',
  },
  purple: {
    wrap: 'from-purple-500/15 to-purple-500/5 dark:from-purple-500/20 dark:to-purple-500/10',
    icon: 'bg-gradient-to-br from-purple-500 to-purple-600 text-white dark:from-purple-400 dark:to-purple-500',
    glow: 'shadow-[0_8px_24px_-8px_oklch(0.62_0.19_295)]',
  },
  green: {
    wrap: 'from-emerald-500/15 to-emerald-500/5 dark:from-emerald-500/20 dark:to-emerald-500/10',
    icon: 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white dark:from-emerald-400 dark:to-emerald-500',
    glow: 'shadow-[0_8px_24px_-8px_oklch(0.7_0.18_145)]',
  },
}

export function Kpi({
  title,
  value,
  unit,
  icon: Icon,
  tone = 'primary',
  subtitle,
}: {
  title: string
  value: string
  unit?: string
  icon: React.ElementType
  tone?: keyof typeof KPI_TONES
  subtitle?: string
}) {
  const t = KPI_TONES[tone] ?? KPI_TONES.primary
  return (
    <Card className={cn('relative overflow-hidden hover-lift group min-w-0 border-border py-0 gap-0', `bg-gradient-to-br ${t.wrap}`)}>
      <CardContent className="p-3.5 sm:p-4 relative z-10">
        <div className="flex justify-between items-center gap-3">
          {/* ── يمين (RTL): العنوان + القيمة + الفرعية ── */}
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="text-xs text-muted-foreground font-medium truncate-1">{title}</div>
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span className="kpi-value font-bold tnum tracking-tight num-ltr text-foreground">{value}</span>
              {unit && <span className="text-xs text-muted-foreground font-medium shrink-0">{unit}</span>}
            </div>
            {subtitle && <div className="text-[11px] text-muted-foreground/80 truncate-2 leading-snug">{subtitle}</div>}
          </div>
          {/* ── يسار (RTL): الأيقونة في خلفية مدوّرة ── */}
          <div className={cn(
            'flex items-center justify-center size-10 sm:size-11 rounded-2xl shrink-0 transition-transform group-hover:scale-105',
            t.icon, t.glow,
          )}>
            <Icon className="size-5 sm:size-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// StatCard — بطاقة حالة مدمجة (عدّ + تسمية + أيقونة صغيرة)
// ---------------------------------------------------------------------------
const STAT_TONES: Record<string, string> = {
  indigo: 'text-indigo-600 dark:text-indigo-300 bg-indigo-500/10 dark:bg-indigo-500/20',
  emerald: 'text-emerald-600 dark:text-emerald-300 bg-emerald-500/10 dark:bg-emerald-500/20',
  rose: 'text-rose-600 dark:text-rose-300 bg-rose-500/10 dark:bg-rose-500/20',
  amber: 'text-amber-600 dark:text-amber-300 bg-amber-500/10 dark:bg-amber-500/20',
  teal: 'text-teal-600 dark:text-teal-300 bg-teal-500/10 dark:bg-teal-500/20',
  primary: 'text-primary bg-primary/10 dark:bg-primary/20',
  slate: 'text-slate-600 dark:text-slate-300 bg-slate-500/10 dark:bg-slate-500/20',
  orange: 'text-orange-600 dark:text-orange-300 bg-orange-500/10 dark:bg-orange-500/20',
  sky: 'text-sky-600 dark:text-sky-300 bg-sky-500/10 dark:bg-sky-500/20',
}

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'primary',
}: {
  label: string
  value: number | string
  icon: React.ElementType
  tone?: keyof typeof STAT_TONES
}) {
  return (
    <Card className="hover-lift min-w-0 border-border py-0 gap-0">
      <CardContent className="px-3 py-2.5 flex items-center gap-2.5">
        <div className={cn('flex items-center justify-center size-8 rounded-lg shrink-0', STAT_TONES[tone])}>
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold tnum leading-tight num-ltr text-foreground truncate-1">
            {typeof value === 'number' ? fmtNum(value) : value}
          </div>
          <div className="text-[11px] text-muted-foreground leading-tight truncate-1">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Mini — بطاقة مالية مصغّرة (تسمية + قيمة + أيقونة)
// ---------------------------------------------------------------------------
export function Mini({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
  return (
    <Card className="hover-lift min-w-0 py-0 gap-0">
      <CardContent className="p-2.5 sm:p-3 flex items-center gap-2 sm:gap-2.5">
        <div className="flex items-center justify-center size-7 sm:size-8 rounded-lg bg-secondary text-secondary-foreground shrink-0">
          <Icon className="size-3.5 sm:size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] sm:text-[11px] text-muted-foreground leading-tight truncate-1">{label}</div>
          <div className="text-sm sm:text-base font-bold tnum leading-tight num-ltr">{value}</div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Alert — تنبيه ملوّن مع أيقونة
// ---------------------------------------------------------------------------
const ALERT_TONES: Record<string, string> = {
  amber: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200 border-amber-200 dark:border-amber-900',
  rose: 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200 border-rose-200 dark:border-rose-900',
  sky: 'bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200 border-sky-200 dark:border-sky-900',
  emerald: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 border-emerald-200 dark:border-emerald-900',
  purple: 'bg-purple-50 text-purple-800 dark:bg-purple-950/40 dark:text-purple-200 border-purple-200 dark:border-purple-900',
}

export function Alert({
  tone = 'sky',
  icon: Icon,
  children,
}: {
  tone?: keyof typeof ALERT_TONES
  icon: React.ElementType
  children: React.ReactNode
}) {
  return (
    <div className={cn('rounded-lg border px-3 py-2.5 flex items-center gap-2 text-sm', ALERT_TONES[tone])}>
      <Icon className="size-4 shrink-0" />
      <span className="flex-1">{children}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SectionCard — بطاقة قسم موحّدة برأس (عنوان + وصف + أيقونة اختيارية)
// ---------------------------------------------------------------------------
export function SectionCard({
  title,
  description,
  icon: Icon,
  action,
  className,
  children,
  contentClassName,
}: {
  title: string
  description?: string
  icon?: React.ElementType
  action?: React.ReactNode
  className?: string
  contentClassName?: string
  children: React.ReactNode
}) {
  return (
    <Card className={cn('min-w-0', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {Icon && <Icon className="size-5 text-muted-foreground shrink-0" />}
            <div className="min-w-0">
              <CardTitle className="text-base leading-tight truncate">{title}</CardTitle>
              {description && <CardDescription className="truncate">{description}</CardDescription>}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// EmptyState — حالة فارغة موحّدة (أيقونة + رسالة + اقتراح)
// ---------------------------------------------------------------------------
export function EmptyState({
  icon: Icon,
  title,
  hint,
  className,
}: {
  icon: React.ElementType
  title: string
  hint?: string
  className?: string
}) {
  return (
    <Card className={cn('min-w-0', className)}>
      <CardContent className="py-12 text-center text-muted-foreground">
        <Icon className="size-10 mx-auto mb-2 text-muted-foreground/60" />
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// LoadingGrid — شبكة هياكل عظمية (Skeletons) أثناء التحميل
// ---------------------------------------------------------------------------
export function LoadingGrid({
  count = 8,
  cols = 'grid-cols-2 lg:grid-cols-4',
  height = 'h-16',
}: {
  count?: number
  cols?: string
  height?: string
}) {
  return (
    <div className={cn('grid gap-2.5', cols)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={cn('rounded-xl', height)} />
      ))}
    </div>
  )
}
