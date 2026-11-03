'use client'

// ============================================================================
// مزود المصادقة — سياق React للجلسة الحالية والصلاحيات
// ============================================================================

import * as React from 'react'
import { login as doLogin, logout as doLogout, restoreSession } from '@/lib/auth'
import { matchPermission, type SessionUser } from '@/lib/permissions'

interface AuthContextValue {
  user: SessionUser | null
  loading: boolean
  login: (username: string, password: string) => Promise<SessionUser>
  logout: () => void
  /** فحص صلاحية — true دائمًا لو مفيش مستخدم (قبل تسجيل الدخول نستخدمها بحذر) */
  has: (permission: string) => boolean
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<SessionUser | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    // استعادة الجلسة المحفوظة عند الإقلاع
    const t = setTimeout(() => {
      setUser(restoreSession())
      setLoading(false)
    }, 350)
    return () => clearTimeout(t)
  }, [])

  const login = React.useCallback(async (username: string, password: string) => {
    const u = doLogin(username, password)
    setUser(u)
    return u
  }, [])

  const logout = React.useCallback(() => {
    doLogout(user)
    setUser(null)
  }, [user])

  const has = React.useCallback(
    (permission: string) => (user ? matchPermission(user.permissions, permission) : false),
    [user],
  )

  const value = React.useMemo(
    () => ({ user, loading, login, logout, has }),
    [user, loading, login, logout, has],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
