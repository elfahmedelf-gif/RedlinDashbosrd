// Arabic + numeric helpers
export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || isNaN(n as any)) return '0'
  const v = Number(n)
  return v.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function fmtMoney(n: number | null | undefined, digits = 0): string {
  return fmtNum(n, digits)
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '-'
  const dt = typeof d === 'string' ? new Date(d) : d
  if (isNaN(dt.getTime())) return '-'
  try {
    return dt.toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return dt.toISOString().slice(0, 10)
  }
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '-'
  const dt = typeof d === 'string' ? new Date(d) : d
  if (isNaN(dt.getTime())) return '-'
  try {
    return dt.toLocaleString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return String(d)
  }
}

export function shortDate(d: string | Date | null | undefined): string {
  if (!d) return '-'
  const dt = typeof d === 'string' ? new Date(d) : d
  if (isNaN(dt.getTime())) return '-'
  const yyyy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${dd}/${mm}/${yyyy}`
}

export function weekdayName(d: string | Date): string {
  const dt = typeof d === 'string' ? new Date(d) : d
  const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
  return days[dt.getDay()]
}

export function isoDate(d: string | Date | null | undefined): string {
  if (!d) return ''
  const dt = typeof d === 'string' ? new Date(d) : d
  if (isNaN(dt.getTime())) return ''
  return dt.toISOString().slice(0, 10)
}

// Status labels and tones
export const SHIPMENT_STATUS: Record<string, { label: string; tone: string }> = {
  new: { label: 'جديدة', tone: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  preparing: { label: 'قيد التجهيز', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  out_for_delivery: { label: 'خرجت للتوصيل', tone: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
  delivered: { label: 'تم التسليم', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  postponed: { label: 'مؤجلة', tone: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  failed: { label: 'فشل التسليم', tone: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  returned: { label: 'مرتجعة', tone: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  cancelled: { label: 'ملغاة', tone: 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
}

export const COLLECTION_STATUS: Record<string, { label: string; tone: string }> = {
  uncollected: { label: 'غير محصّلة', tone: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  partial: { label: 'تحصيل جزئي', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  collected: { label: 'محصّلة', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
}

export const MOVEMENT_TYPE: Record<string, { label: string; tone: string; sign: number }> = {
  opening: { label: 'رصيد افتتاحي', tone: 'bg-sky-100 text-sky-700', sign: 1 },
  receipt: { label: 'استلام مشتريات', tone: 'bg-emerald-100 text-emerald-700', sign: 1 },
  issue: { label: 'صرف', tone: 'bg-amber-100 text-amber-700', sign: -1 },
  transfer: { label: 'تحويل', tone: 'bg-indigo-100 text-indigo-700', sign: -1 },
  return: { label: 'مرتجع', tone: 'bg-purple-100 text-purple-700', sign: 1 },
  adjustment: { label: 'تسوية جرد', tone: 'bg-orange-100 text-orange-700', sign: 0 },
  damage: { label: 'تالف', tone: 'bg-rose-100 text-rose-700', sign: -1 },
}

export const ACCOUNT_TYPE: Record<string, { label: string; tone: string }> = {
  asset: { label: 'أصول', tone: 'bg-emerald-100 text-emerald-700' },
  liability: { label: 'خصوم', tone: 'bg-rose-100 text-rose-700' },
  equity: { label: 'حقوق ملكية', tone: 'bg-purple-100 text-purple-700' },
  revenue: { label: 'إيرادات', tone: 'bg-sky-100 text-sky-700' },
  expense: { label: 'مصروفات', tone: 'bg-amber-100 text-amber-700' },
}

export const ROLE_LABELS: Record<string, string> = {
  admin: 'مدير النظام',
  finance_manager: 'مدير مالي',
  branch_manager: 'مدير فرع',
  warehouse_clerk: 'موظف مخزن',
  shipping_clerk: 'موظف شحن',
  accountant: 'محاسب',
  rep: 'مندوب/عامل',
  auditor: 'مدقق',
}
