// ============================================================================
// ناقل أحداث صغير داخل التطبيق (Event Bus) — للتنقل المتبادل بين الوحدات
// مثال: شارة «الأذونات المتأخرة» في الهيدر تنقل المستخدم لتبويب الأذونات
// مع تفعيل عرض «الأذونات المتأخرة» مباشرة دون أي تدخل يدوي.
// ============================================================================

type Handler = (payload?: any) => void

const handlers = new Map<string, Set<Handler>>()

export const bus = {
  /** الاشتراك في حدث — يعيد دالة إلغاء الاشتراك (مناسبة لـ useEffect) */
  on(event: string, handler: Handler): () => void {
    let set = handlers.get(event)
    if (!set) {
      set = new Set()
      handlers.set(event, set)
    }
    set.add(handler)
    return () => {
      set?.delete(handler)
      if (set && set.size === 0) handlers.delete(event)
    }
  },

  /** إطلاق حدث لكل المشتركين الحاليين */
  emit(event: string, payload?: any): void {
    handlers.get(event)?.forEach((h) => {
      try { h(payload) } catch { /* معزل — خطأ مشترك لا يوقف الباقي */ }
    })
  },
}

/** أسماء الأحداث الموثقة (توحيد الاستخدام ومنع الأخطاء الإملائية) */
export const BUS_EVENTS = {
  /** التنقل إلى وحدة — payload: { tab: ModuleKey } */
  NAVIGATE_TAB: 'navigate-tab',
  /** فتح عرض الأذونات المتأخرة في وحدة أذونات التسليم */
  OPEN_OVERDUE_RECEIPTS: 'open-overdue-receipts',
} as const

// ----------------------------------------------------------------------------
// «النية المعلقة» — حدث يُطلق قبل تركيب الوحدة الهدف (مثل الضغط على شارة
// الأذونات المتأخرة من الهيدر). تقرأه الوحدة عند أول تركيب ثم يُستهلك.
// ----------------------------------------------------------------------------
let pendingIntent: string | null = null

/** تسجيل نية تُستهلك عند تركيب الوحدة الهدف (آمن مع إعادة التركيب) */
export function setIntent(event: string): void {
  pendingIntent = event
}

/** قراءة النية المعلقة واستهلاكها (مرة واحدة) */
export function consumeIntent(): string | null {
  const v = pendingIntent
  pendingIntent = null
  return v
}
