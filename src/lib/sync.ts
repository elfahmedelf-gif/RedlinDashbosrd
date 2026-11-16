// ============================================================================
// مزامنة البيانات اللحظية (Instant Cross-Module Sync)
// ----------------------------------------------------------------------------
// بعد أي عملية POST/PATCH/DELETE ناجحة تُعاد validation لكل مفاتيح SWR
// النشطة التي تشير إلى /api — فتتحدث فورًا:
//   • شارات القائمة الجانبية (/api/counts)
//   • بطاقات KPI اليومية (/api/receipts، /api/executive)
//   • تبويبات المقاولين وعدّادات الأذونات
//   • كشف الحساب والتقرير الشهري والقيود المحاسبية
// لا حاجة لأي تحديث يدوي للصفحة بعد أي إضافة/تعديل/حذف.
// ============================================================================

import { mutate as globalMutate } from 'swr'
import { apiPost, apiPatch, apiDelete } from './api'

/**
 * إعادة تحقق فوري لكل مفاتيح SWR النشطة (نفس الجلسة) — «تسميع لحظي» لكل الشاشات.
 * تُستدعى داخليًا بعد كل عملية تعديل ناجحة عبر apiPostSync/apiPatchSync/apiDeleteSync.
 */
export function syncAll() {
  return globalMutate(
    (key) => typeof key === 'string' && key.startsWith('/api/'),
    undefined,
    { revalidate: true, rollbackOnError: false },
  )
}

/** POST مع مزامنة لحظية لكل الشاشات بعد النجاح */
export async function apiPostSync<T = any>(url: string, body?: any): Promise<T> {
  const r = (await apiPost(url, body)) as T
  void syncAll()
  return r
}

/** PATCH مع مزامنة لحظية لكل الشاشات بعد النجاح */
export async function apiPatchSync<T = any>(url: string, body?: any): Promise<T> {
  const r = (await apiPatch(url, body)) as T
  void syncAll()
  return r
}

/** DELETE مع مزامنة لحظية لكل الشاشات بعد النجاح */
export async function apiDeleteSync<T = any>(url: string): Promise<T> {
  const r = (await apiDelete(url)) as T
  void syncAll()
  return r
}
