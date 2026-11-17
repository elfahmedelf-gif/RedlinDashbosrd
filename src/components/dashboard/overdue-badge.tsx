'use client'

// ============================================================================
// شارة الأذونات المتأخرة — تظهر في الهيدر (سطح المكتب والموبايل)
// تعرض إجمالي الأذونات غير المسلّمة الأقدم من 3 أيام، والضغط عليها ينقل
// المستخدم مباشرة إلى تبويب «أذونات التسليم» بعرض «الأذونات المتأخرة».
// ============================================================================

import * as React from 'react'
import { AlarmClock } from 'lucide-react'
import { bus, BUS_EVENTS } from '@/lib/bus'
import { cn } from '@/lib/utils'

interface Props {
  count: number
  /** معاينة الاستدعاء عند التنقل (تبديل التبويب النشط) — يُضاف قبل إطلاق الحدث */
  onNavigate: () => void
  /** حجم موبايل الهيدر المصغر */
  compact?: boolean
}

export function OverdueReceiptsBadge({ count, onNavigate, compact }: Props) {
  const click = React.useCallback(() => {
    onNavigate()
    bus.emit(BUS_EVENTS.OPEN_OVERDUE_RECEIPTS)
  }, [onNavigate])

  if (!count || count <= 0) return null

  return (
    <button
      onClick={click}
      title={`${count} إذن تسليم متأخر (أكثر من 3 أيام) — اضغط للمتابعة فورًا`}
      aria-label={`${count} إذن تسليم متأخر — فتح الأذونات المتأخرة`}
      className={cn(
        'group relative inline-flex items-center gap-1.5 rounded-full border border-rose-300 bg-rose-100 text-rose-700 shadow-sm transition-all',
        'hover:bg-rose-200 hover:shadow dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300 dark:hover:bg-rose-900/60',
        'animate-pulse-slow focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50',
        compact ? 'h-8 px-2.5 text-[11px]' : 'h-9 px-2.5 text-xs font-semibold',
      )}
    >
      <AlarmClock className={cn('shrink-0', compact ? 'size-3.5' : 'size-4')} />
      <span className="tnum font-bold leading-none">{count}</span>
      {!compact && <span className="hidden 2xl:inline leading-none">إذن متأخر</span>}
      {/* نقطة تنبيه حمراء */}
      <span className="absolute -top-1 -left-1 flex size-3">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-60" />
        <span className="relative inline-flex size-3 rounded-full bg-rose-600 border-2 border-white dark:border-slate-900" />
      </span>
    </button>
  )
}
