'use client'

import * as React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'

/**
 * DarkModeToggle — reusable theme switcher button.
 * Uses next-themes to toggle between light and dark.
 * Renders a clean icon-only button that fits in any header/toolbar.
 */
export function DarkModeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  const isDark = mounted && theme === 'dark'

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={cn(
        'inline-flex items-center justify-center size-9 rounded-xl border border-border bg-card text-foreground transition-all hover:bg-accent hover:scale-105 active:scale-95 shrink-0',
        className,
      )}
      title={isDark ? 'الوضع الفاتح' : 'الوضع الداكن'}
      aria-label={isDark ? 'الوضع الفاتح' : 'الوضع الداكن'}
    >
      {isDark ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
    </button>
  )
}
