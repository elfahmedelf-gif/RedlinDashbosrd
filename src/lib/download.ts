// ============================================================================
// تنزيل ملفات من الخادم مع مصادقة الجلسة (Excel/طباعة) — client-only
// يجلب Blob برأس x-session-token ثم يشغّل تنزيلًا باسم عربي آمن.
// ============================================================================
import { getToken } from './api'

export async function downloadFile(url: string, filename: string): Promise<void> {
  const res = await fetch(url, {
    headers: { 'x-session-token': getToken() },
    cache: 'no-store',
  })
  if (!res.ok) {
    let msg = `فشل التحميل (${res.status})`
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
    } catch { /* body ليس JSON */ }
    throw new Error(msg)
  }
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
