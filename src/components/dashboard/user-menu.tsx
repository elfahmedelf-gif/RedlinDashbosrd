'use client'

// ============================================================================
// قائمة المستخدم في الهيدر — الصورة الرمزية + الدور + تسجيل الخروج
// ============================================================================

import * as React from 'react'
import { LogOut, ShieldCheck, ChevronDown } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from './auth-provider'
import { cn } from '@/lib/utils'

const ROLE_TONES: Record<string, string> = {
  admin: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  finance_manager: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  branch_manager: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  operations: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  viewer: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
}

export function UserMenu() {
  const { user, logout } = useAuth()
  if (!user) return null

  const initial = (user.name || user.username || 'م').charAt(0)
  const tone = ROLE_TONES[user.roleName ?? ''] ?? 'bg-primary/10 text-primary'

  return (
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
          onClick={logout}
          className="text-destructive focus:text-destructive cursor-pointer justify-start gap-2"
        >
          <LogOut className="size-4" />
          تسجيل الخروج
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
