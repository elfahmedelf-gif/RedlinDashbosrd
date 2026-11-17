'use client'

// ============================================================================
// قائمة المستخدم في الهيدر — الصورة الرمزية + الدور + تغيير كلمة المرور + خروج
// تغيير كلمة المرور الذاتي: يتحقق الخادم من كلمة المرور الحالية قبل التغيير.
// ============================================================================

import * as React from 'react'
import { LogOut, ShieldCheck, ChevronDown, KeyRound } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from './auth-provider'
import { apiPost } from '@/lib/api'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

const ROLE_TONES: Record<string, string> = {
  admin: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  finance_manager: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  branch_manager: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  operations: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  viewer: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
}

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast()
  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) { setCurrent(''); setNext(''); setConfirm(''); setError('') }
  }, [open])

  const submit = async () => {
    setError('')
    if (!current) { setError('أدخل كلمة المرور الحالية'); return }
    if (next.length < 4) { setError('كلمة المرور الجديدة يجب أن تكون 4 حروف على الأقل'); return }
    if (next !== confirm) { setError('كلمة المرور الجديدة وتأكيدها غير متطابقين'); return }
    setBusy(true)
    try {
      await apiPost('/api/auth/change-password', { currentPassword: current, newPassword: next })
      toast({ title: 'تم تغيير كلمة المرور بنجاح', description: 'استخدمها في تسجيل الدخول القادم' })
      onOpenChange(false)
    } catch (e: any) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" /> تغيير كلمة المرور
          </DialogTitle>
          <DialogDescription>غيّر كلمة مرورك الخاصة — تحتاج كلمة المرور الحالية للتأكيد.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">كلمة المرور الحالية *</Label>
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">كلمة المرور الجديدة *</Label>
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" placeholder="4 حروف على الأقل" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">تأكيد كلمة المرور الجديدة *</Label>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </div>
          {error && <div className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</div>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>إلغاء</Button>
            <Button onClick={submit} disabled={busy}>{busy ? 'جارٍ التغيير...' : 'تغيير كلمة المرور'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function UserMenu() {
  const { user, logout } = useAuth()
  const { toast } = useToast()
  const [pwdOpen, setPwdOpen] = React.useState(false)
  if (!user) return null

  const initial = (user.name || user.username || 'م').charAt(0)
  const tone = ROLE_TONES[user.roleName ?? ''] ?? 'bg-primary/10 text-primary'

  return (
    <>
      <DropdownMenu dir="rtl">
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-2 py-1.5 hover:bg-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="قائمة المستخدم"
          >
            <span className={cn('flex items-center justify-center size-7 rounded-full text-[11px] font-bold shrink-0', tone)}>
              {initial}
            </span>
            <span className="hidden sm:flex flex-col items-start leading-tight min-w-0">
              <span className="text-xs font-bold truncate max-w-[120px]">{user.name}</span>
              <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{user.roleLabel || 'بدون دور'}</span>
            </span>
            <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-right">
            <div className="font-bold text-sm">{user.name}</div>
            <div className="text-xs text-muted-foreground font-normal tnum" dir="ltr">@{user.username}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <div className="px-2 py-1.5 flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" />
            <span className="text-xs font-medium">{user.roleLabel || 'بدون دور'}</span>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setPwdOpen(true)}
            className="cursor-pointer justify-start gap-2"
          >
            <KeyRound className="size-4" />
            تغيير كلمة المرور
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => { logout(); toast({ title: 'تم تسجيل الخروج' }) }}
            className="text-destructive focus:text-destructive cursor-pointer justify-start gap-2"
          >
            <LogOut className="size-4" />
            تسجيل الخروج
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangePasswordDialog open={pwdOpen} onOpenChange={setPwdOpen} />
    </>
  )
}
