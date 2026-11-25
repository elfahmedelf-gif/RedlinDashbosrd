'use client'

// ============================================================================
// شاشة تسجيل الدخول — نظام شركة النقل والشحن
// ============================================================================

import * as React from 'react'
import { Truck, User, Lock, Eye, EyeOff, LogIn, AlertCircle, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from './auth-provider'
import { cn } from '@/lib/utils'

const DEMO_ACCOUNTS = [
  { username: 'admin', password: 'admin123', label: 'مدير النظام', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  { username: 'finance', password: 'fin123', label: 'مدير مالي', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  { username: 'ops', password: 'ops123', label: 'موظف عمليات', tone: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' },
  { username: 'viewer', password: 'view123', label: 'عارض فقط', tone: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
]

export function LoginScreen() {
  const { login } = useAuth()
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [showDemo, setShowDemo] = React.useState(false)

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!username.trim() || !password) {
      setError('أدخل اسم المستخدم وكلمة المرور')
      return
    }
    setBusy(true)
    setError('')
    try {
      await login(username.trim(), password)
      // لا نجري أي شيء — تغيير user في السياق يبدّل الشاشة تلقائيًا
    } catch (err: any) {
      setError(err?.message || 'فشل تسجيل الدخول')
      setBusy(false)
    }
  }

  const quickFill = (u: string, p: string) => {
    setUsername(u)
    setPassword(p)
    setError('')
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-100 via-slate-50 to-emerald-50 dark:from-slate-950 dark:via-slate-900 dark:to-emerald-950/40" dir="rtl">
      {/* خلفية زخرفية خفيفة */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-24 -left-24 size-96 rounded-full bg-emerald-200/30 dark:bg-emerald-900/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-16 size-[28rem] rounded-full bg-teal-200/25 dark:bg-teal-900/15 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md anim-fade-in">
        {/* الشعار والعنوان */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="flex items-center justify-center size-16 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-500 text-white shadow-xl shadow-emerald-600/20 mb-4">
            <Truck className="size-8" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">شركة النقل والشحن</h1>
          <p className="text-sm text-muted-foreground mt-1">نظام الإدارة المتكامل — سجل دخولك للمتابعة</p>
        </div>

        {/* بطاقة الدخول */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur shadow-2xl shadow-slate-900/5 p-6 sm:p-7">
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="login-username" className="text-sm font-semibold text-slate-700 dark:text-slate-200">اسم المستخدم</label>
              <div className="relative">
                <User className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="login-username"
                  autoComplete="username"
                  placeholder="admin"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setError('') }}
                  className="pr-9 h-11 bg-white dark:bg-slate-950"
                  disabled={busy}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="login-password" className="text-sm font-semibold text-slate-700 dark:text-slate-200">كلمة المرور</label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError('') }}
                  className="pr-9 pl-10 h-11 bg-white dark:bg-slate-950"
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5" role="alert">
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" className="w-full h-11 text-sm font-bold" disabled={busy}>
              {busy ? (
                <><Loader2 className="size-4 animate-spin" /> جاري التحقق...</>
              ) : (
                <><LogIn className="size-4" /> تسجيل الدخول</>
              )}
            </Button>
          </form>

          {/* حسابات تجريبية */}
          <div className="mt-5 border-t border-dashed pt-4">
            <button
              type="button"
              onClick={() => setShowDemo((s) => !s)}
              className="w-full flex items-center justify-between text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              <span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5" /> حسابات النظام التجريبية</span>
              <span className="tnum">{showDemo ? 'إخفاء −' : 'إظهار +'}</span>
            </button>
            {showDemo && (
              <div className="grid grid-cols-2 gap-2 mt-3">
                {DEMO_ACCOUNTS.map((a) => (
                  <button
                    key={a.username}
                    type="button"
                    onClick={() => quickFill(a.username, a.password)}
                    disabled={busy}
                    className={cn(
                      'flex flex-col items-start gap-0.5 rounded-xl border border-border p-2.5 text-right transition-all hover:scale-[1.02] hover:shadow-md disabled:opacity-60',
                      'bg-slate-50/80 dark:bg-slate-950/60',
                    )}
                  >
                    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', a.tone)}>{a.label}</span>
                    <span className="text-xs font-mono font-bold" dir="ltr">{a.username} / {a.password}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-[11px] text-muted-foreground mt-5">
          نظام إدارة شحن · إصدار 2.0 — جميع العمليات مسجلة في سجل التدقيق
        </p>
      </div>
    </div>
  )
}

/** شاشة انتظار أثناء استرجاع الجلسة */
export function AuthSplash() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background" dir="rtl">
      <div className="flex items-center justify-center size-14 rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-lg animate-pulse">
        <Truck className="size-7" />
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        جاري تحميل النظام...
      </div>
    </div>
  )
}
