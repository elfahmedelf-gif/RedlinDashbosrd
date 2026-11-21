// ============================================================================
// كتالوج دورة حياة الشحنة — آلة حالات صارمة (مصدر واحد للخادم والواجهة)
// التسلسل القياسي:
//   جديدة (new) ← مستلمة بالمخزن (received) ← محمّلة/في الطريق
//   (loaded / in_transit) ← وصلت (arrived) ← مع المندوب (assigned_courier /
//   out_for_delivery) ← تم التسليم (delivered) أو مرتجع (returned) أو مؤجل
//   (postponed) أو فاشل (failed)
// الممنوع: أي قفز عشوائي (مثل delivered → new أو cancelled → أي شيء)
// ============================================================================

export interface ShipmentStatusDef {
  key: string
  label: string
  labelEn: string
  /** فئة الحالة لعرض الألوان (fallback عند غياب القوائم) */
  tone: string
}

export const SHIPMENT_STATUSES: ShipmentStatusDef[] = [
  { key: 'new', label: 'جديدة', labelEn: 'New', tone: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  { key: 'preparing', label: 'قيد التجهيز', labelEn: 'Preparing', tone: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300' },
  { key: 'received', label: 'مستلمة بالمخزن', labelEn: 'Received', tone: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' },
  { key: 'loaded', label: 'محمّلة على المركبة', labelEn: 'Loaded', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  { key: 'in_transit', label: 'في الطريق بين الفروع', labelEn: 'In Transit', tone: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  { key: 'arrived', label: 'وصلت فرع الوجهة', labelEn: 'Arrived', tone: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  { key: 'assigned_courier', label: 'مُسلّمة لمندوب التوصيل', labelEn: 'Assigned to Courier', tone: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
  { key: 'out_for_delivery', label: 'قيد التوصيل', labelEn: 'Out for Delivery', tone: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  { key: 'delivered', label: 'تم التسليم', labelEn: 'Delivered', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  { key: 'mabeit', label: 'مبيت — مرابطة عند المقاول', labelEn: 'Overnight (With Contractor)', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  { key: 'taateeq', label: 'تعتيق — متوقفة بالرصيف', labelEn: 'Detained (Aging)', tone: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  { key: 'postponed', label: 'مؤجلة (بتتأجل)', labelEn: 'Postponed', tone: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' },
  { key: 'failed', label: 'فشل التسليم', labelEn: 'Delivery Failed', tone: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  { key: 'returned', label: 'مرتجعة مع المندوب', labelEn: 'Returned (with courier)', tone: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  { key: 'received_returned', label: 'مرتجعة مستلمة بالفرع', labelEn: 'Return Received', tone: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  { key: 'cancelled', label: 'ملغاة', labelEn: 'Cancelled', tone: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  { key: 'written_off', label: 'مشطوبة', labelEn: 'Written Off', tone: 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
]

/** الحالات النهائية — لا انتقال منها إلا عبر إذن تصحيح (غير مسموح حاليًا) */
export const SHIPMENT_TERMINAL_STATUSES = ['cancelled', 'written_off'] as const

/** حالات "قيد التنفيذ" التشغيلية */
export const SHIPMENT_ACTIVE_STATUSES = ['new', 'preparing', 'received', 'loaded', 'in_transit', 'arrived', 'assigned_courier', 'out_for_delivery', 'mabeit', 'taateeq'] as const

/**
 * قاعدة «بتقف تاني يوم» — حالات "لم تُحمّل بعد":
 * الشحنة المسجلة في يوم ولم تُحمّل بحلول نهاية يومها تُوقف تلقائيًا عن التحميل
 * في اليوم التالي (لا تُحمّل ولا تُرسل) — إما إعادة جدولتها لليوم من العمليات
 * أو تسجيلها مبيت/تعتيق/مؤجلة وفق الواقع.
 */
export const SHIPMENT_NOT_LOADED_STATUSES = ['new', 'preparing', 'received'] as const
/** الانتقالات الممنوعة لشحنة متوقفة (بتقف تاني يوم) — كل مسارات الخروج المُحمّلة */
export const SHIPMENT_STOPPED_BLOCKED_TARGETS = ['loaded', 'in_transit', 'assigned_courier', 'out_for_delivery'] as const

/**
 * جدول الانتقالات الصارم (يدوي عبر شاشة تغيير الحالة).
 * ملاحظة: انتقالات الأذونات التشغيلية تمر عبر محرك الأذونات (preStatuses/postStatus)
 * وهي متوافقة مع هذا الجدول.
 */
export const SHIPMENT_TRANSITIONS: Record<string, string[]> = {
  new: ['preparing', 'received', 'mabeit', 'taateeq', 'cancelled', 'postponed'],
  preparing: ['received', 'loaded', 'mabeit', 'taateeq', 'cancelled', 'postponed'],
  received: ['loaded', 'in_transit', 'assigned_courier', 'out_for_delivery', 'mabeit', 'taateeq', 'cancelled', 'postponed'],
  loaded: ['in_transit', 'out_for_delivery', 'assigned_courier', 'mabeit', 'cancelled', 'postponed'],
  in_transit: ['arrived', 'out_for_delivery', 'returned', 'postponed', 'cancelled'],
  arrived: ['assigned_courier', 'out_for_delivery', 'received', 'mabeit', 'postponed'],
  assigned_courier: ['out_for_delivery', 'delivered', 'returned', 'postponed', 'failed', 'received'],
  out_for_delivery: ['delivered', 'failed', 'returned', 'postponed', 'assigned_courier'],
  delivered: ['returned'],
  failed: ['out_for_delivery', 'assigned_courier', 'delivered', 'postponed', 'returned', 'received'],
  postponed: ['out_for_delivery', 'assigned_courier', 'delivered', 'failed', 'returned', 'received', 'mabeit', 'taateeq'],
  mabeit: ['loaded', 'in_transit', 'assigned_courier', 'out_for_delivery', 'taateeq', 'postponed', 'received'],
  taateeq: ['loaded', 'in_transit', 'assigned_courier', 'out_for_delivery', 'mabeit', 'received', 'postponed'],
  returned: ['received_returned'],
  received_returned: ['preparing', 'received', 'assigned_courier', 'out_for_delivery'],
  cancelled: [],
  written_off: [],
}

/** الحالات التي يُثبت فيها الأثر المالي (إثبات النولون على العميل) */
export const REVENUE_POSTING_STATUSES = ['delivered'] as const

export function shipmentStatusDef(key: string): ShipmentStatusDef | undefined {
  return SHIPMENT_STATUSES.find((s) => s.key === key)
}

export function shipmentStatusLabel(key: string): string {
  return shipmentStatusDef(key)?.label ?? key
}

export function isKnownShipmentStatus(key: string): boolean {
  return SHIPMENT_STATUSES.some((s) => s.key === key)
}

export function isTerminalShipmentStatus(key: string): boolean {
  return (SHIPMENT_TERMINAL_STATUSES as readonly string[]).includes(key)
}

/** هل الانتقال من حالة إلى أخرى مسموح؟ */
export function canTransitionShipment(from: string | null | undefined, to: string): boolean {
  if (!from) return false
  if (from === to) return false
  return (SHIPMENT_TRANSITIONS[from] ?? []).includes(to)
}

/** الانتقالات المتاحة من حالة معينة (للواجهة) */
export function allowedShipmentTransitions(from: string | null | undefined): string[] {
  if (!from) return []
  return SHIPMENT_TRANSITIONS[from] ?? []
}

/**
 * قاعدة «بتقف تاني يوم»: هل الشحنة متوقفة عن التحميل؟
 * الشحنة بتاريخ أقدم من اليوم الحالي ولا تزال في حالة «لم تُحمّل»
 * (جديدة/قيد التجهيز/مستلمة) = متوقفة — لا تحميل ولا إرسال في اليوم التالي.
 */
export function isShipmentStoppedNextDay(
  s: { date?: string | Date | null; status?: string | null },
  now: Date = new Date(),
): boolean {
  if (!s?.date || !s?.status) return false
  if (!(SHIPMENT_NOT_LOADED_STATUSES as readonly string[]).includes(s.status)) return false
  const d = new Date(s.date)
  if (isNaN(d.getTime())) return false
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return d.getTime() < dayStart
}

/** رسالة رفض الانتقال (للاستخدام في الواجهة والخادم) */
export function shipmentTransitionError(from: string, to: string): string {
  if (isTerminalShipmentStatus(from)) {
    return `لا يمكن تغيير حالة شحنة "${shipmentStatusLabel(from)}" — الحالة نهائية، استخدم قيدًا عكسيًا أو إذن تصحيح وفق سياسة النظام`
  }
  if (!isKnownShipmentStatus(to)) {
    return `حالة غير معروفة: "${to}"`
  }
  return `انتقال حالة غير مسموح: من "${shipmentStatusLabel(from)}" إلى "${shipmentStatusLabel(to)}" — التسلسل القياسي: جديدة ← مستلمة ← محمّلة/في الطريق ← تم التسليم أو مرتجع`
}
