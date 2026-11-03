// ============================================================================
// طبقة الجلسة (client-side) — تخزين الجلسة في localStorage
// متسقة مع معمارية النظام (محرك in-memory بدون شبكة)
// ============================================================================

import { authLogin, authValidate, authLogout } from './api'
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

function store(session: SessionUser) {
  try { window.localStorage.setItem(SESSION_KEY, JSON.stringify(session)) } catch { /* ignore */ }
}

function clear() {
  try { window.localStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
}

/** محاولة استعادة الجلسة المحفوظة — تُلغي تلقائيًا إذا كان المستخدم موقوفًا/محذوفًا */
export function restoreSession(): SessionUser | null {
  const stored = readStored()
  if (!stored) return null
  const valid = authValidate(stored)
  if (!valid) {
    clear()
    return null
  }
  // تحديث الصلاحيات المحفوظة (لو اتغيرت صلاحيات الدور)
  store(valid)
  return valid
}

export function login(username: string, password: string): SessionUser {
  const user = authLogin(username, password)
  store(user)
  return user
}

export function logout(user: SessionUser | null) {
  authLogout(user)
  clear()
}
