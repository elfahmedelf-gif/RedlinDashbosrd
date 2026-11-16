// ============================================================================
// كتالوج البنود الإضافية على حساب المقاولين — مصدر واحد للخادم والواجهة
// الأنواع: تعتيق (تحميل وتنزيل) / مبيت / مرتجعات
// قاعدة العمل الحاسمة: المبيت والمرتجعات لا تدخل مستحقات المقاول إلا بعد
// اعتماد الشركة — التعتيق يُعتمد تلقائيًا عند التسجيل (بند قياسي).
// SQLite لا يدعم Enums في Prisma — الأنواع/الحالات String مع هذا الكتالوج.
// ============================================================================

export interface ExtraCostTypeDef {
  key: 'taateeq' | 'mabeet' | 'return'
  label: string
  labelEn: string
  tone: string
  /** هل يُعتمد تلقائيًا عند التسجيل؟ (التعتيق بند قياسي متفق عليه) */
  autoApprove: boolean
  hint: string
}

export const EXTRA_COST_TYPES: ExtraCostTypeDef[] = [
  {
    key: 'taateeq',
    label: 'تعتيق (تحميل وتنزيل)',
    labelEn: 'Loading/Unloading',
    tone: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
    autoApprove: true,
    hint: 'بند قياسي — يُعتمد ويُرحّل محاسبيًا تلقائيًا عند التسجيل',
  },
  {
    key: 'mabeet',
    label: 'مبيت',
    labelEn: 'Overnight Stay',
    tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    autoApprove: false,
    hint: 'لا تُحسب في مستحقات المقاول إلا بعد موافقة الشركة',
  },
  {
    key: 'return',
    label: 'مرتجعات',
    labelEn: 'Returns',
    tone: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    autoApprove: false,
    hint: 'لا تُحسب في مستحقات المقاول إلا بعد موافقة الشركة',
  },
]

export type ExtraCostStatus = 'pending' | 'approved' | 'rejected'

export interface ExtraCostStatusDef {
  key: ExtraCostStatus
  label: string
  tone: string
}

export const EXTRA_COST_STATUSES: ExtraCostStatusDef[] = [
  { key: 'pending', label: 'بانتظار اعتماد الشركة', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  { key: 'approved', label: 'معتمد', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  { key: 'rejected', label: 'مرفوض', tone: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
]

export const EXTRA_COST_SOURCE = 'extra_cost' // JournalEntry.sourceType

export function extraCostTypeDef(key: string): ExtraCostTypeDef | undefined {
  return EXTRA_COST_TYPES.find((t) => t.key === key)
}

export function extraCostTypeLabel(key: string): string {
  return extraCostTypeDef(key)?.label ?? key
}

export function extraCostStatusDef(key: string): ExtraCostStatusDef | undefined {
  return EXTRA_COST_STATUSES.find((s) => s.key === key)
}

export function extraCostStatusLabel(key: string): string {
  return extraCostStatusDef(key)?.label ?? key
}

export function isKnownExtraCostType(key: string): boolean {
  return EXTRA_COST_TYPES.some((t) => t.key === key)
}

// ---------------------------------------------------------------------------
// أذونات التسليم — تعريفات مشتركة (عدّادات اليوم + المتأخرات)
// ---------------------------------------------------------------------------

/** الحالات التي تعني أن الشحنة «خرجت» (غادرت) — أساس عدّاد الشحنات المتبقية */
export const DISPATCHED_STATUSES = [
  'loaded', 'in_transit', 'arrived', 'assigned_courier', 'out_for_delivery',
  'delivered', 'failed', 'returned', 'received_returned',
] as const

/** حالات مستبعدة تمامًا من منظومة أذونات التسليم (لا إذن لها) */
export const RECEIPT_EXCLUDED_STATUSES = ['cancelled', 'written_off'] as const

/** عدد الأيام بعد تاريخ الشحنة قبل اعتبار إذن التسليم «متأخرًا» */
export const RECEIPT_OVERDUE_DAYS = 3
