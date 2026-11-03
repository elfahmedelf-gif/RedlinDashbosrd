// ============================================================================
// طبقة الجلسة (client-side) — token الخادم في localStorage + تحقق شبكي
// ============================================================================
import { authLogin as apiLogin, authValidate as apiValidate, authLogout as apiLogout } from './api'
import type { SessionUser } from './permissions'

const SESSION_KEY = 'shipping-session-v1'

function readStored(): SessionUser | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as SessionUser
  } catch {
    return null
  }
}

function store(session: SessionUser | null) {
  try {
    if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else window.localStorage.removeItem(SESSION_KEY)
  } catch { /* ignore */ }
}

/** استعادة الجلسة المحفوظة — تتحقق من الخادم (يلغي تلقائيًا لو انتهت أو أُوقف المستخدم) */
export async function restoreSession(): Promise<SessionUser | null> {
  const valid = await apiValidate(readStored())
  if (!valid) {
    store(null)
    return null
  }
  store(valid)
  return valid
}

export async function login(username: string, password: string): Promise<SessionUser> {
  const user = await apiLogin(username, password)
  store(user)
  return user
}

export async function logout(user: SessionUser | null) {
  await apiLogout(user)
  store(null)
}
