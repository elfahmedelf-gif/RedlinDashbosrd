// ============================================================================
// عميل الشبكة — نفس التواقيع السابقة لكن كل الطلبات تذهب للخادم الحقيقي
// (قاعدة بيانات Prisma + قواعد عمل مفروضة من الخادم)
// الكتالوجات الثابتة (أنواع/حالات الأذونات) تُصدَّر من voucher-catalog المشترك
// ============================================================================

export { VOUCHER_TYPES, VOUCHER_STATES, VOUCHER_CATEGORIES } from './voucher-catalog'
export type { VoucherTypeDef } from './voucher-catalog'
import type { SessionUser } from './permissions'

const TOKEN_KEY = 'shipping-session-token-v1'

export function getToken(): string {
  if (typeof window === 'undefined') return ''
  try { return window.localStorage.getItem(TOKEN_KEY) ?? '' } catch { return '' }
}

export function setToken(token: string) {
  if (typeof window === 'undefined') return
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token)
    else window.localStorage.removeItem(TOKEN_KEY)
  } catch { /* ignore */ }
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const token = getToken()
  if (token) h['x-session-token'] = token
  return h
}

async function request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: any, extraHeaders?: Record<string, string>): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: buildHeaders(extraHeaders),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  })
  let data: any = null
  try { data = await res.json() } catch { /* empty body */ }
  if (!res.ok) {
    throw new Error(data?.error ?? `فشل الطلب (${res.status})`)
  }
  return data
}

/** GET — متوافق مع useSWR/useQuery fetcher */
export const fetcher = (url: string): Promise<any> => request('GET', url)

export async function apiPost(url: string, body?: any): Promise<any> {
  return request('POST', url, body)
}

export async function apiPatch(url: string, body?: any): Promise<any> {
  return request('PATCH', url, body)
}

export async function apiDelete(url: string): Promise<any> {
  return request('DELETE', url)
}

// ---------------------------------------------------------------------------
// المصادقة — جلسة حقيقية على الخادم (token مخزّن محليًا، الصلاحيات تُتحقق من الخادم)
// ---------------------------------------------------------------------------
export async function authLogin(username: string, password: string): Promise<SessionUser> {
  const r = await request('POST', '/api/auth/login', { username, password })
  setToken(r.token)
  return r.user as SessionUser
}

/** التحقق من الجلسة المخزنة — يُلغي تلقائيًا إذا انتهت/أُوقف المستخدم */
export async function authValidate(_session?: unknown): Promise<SessionUser | null> {
  if (!getToken()) return null
  try {
    const r = await request('POST', '/api/auth/validate', {})
    return r.user as SessionUser
  } catch {
    setToken('')
    return null
  }
}

export async function authLogout(_user: SessionUser | null): Promise<void> {
  try { await request('POST', '/api/auth/logout', {}) } catch { /* ignore */ }
  setToken('')
}
