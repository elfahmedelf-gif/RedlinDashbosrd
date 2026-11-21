'use client'

// ============================================================================
// دليل الاستخدام السريع — زر «كيف أستخدم النظام؟» في هيدر التطبيق.
// يفتح نافذة مختصرة فيها 4 خطوات بتلخّص الشغل اليومي في 30 ثانية:
// تسجيل الشحنة ← تعليم إذن التسليم ← البنود الإضافية ← متابعة حسابات المقاولين.
// نسختين للزر: دسكتوب (أيقونة + نص) وموبايل (أيقونة فقط بنفس ستايل الهيدر).
// ============================================================================

import * as React from 'react'
import { HelpCircle, PackagePlus, ClipboardCheck, Layers, Wallet, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface QuickTourStep {
  n: number
  icon: LucideIcon
  /** كلاسات اللون (فاتح + داكن) لدائرة الرقم وشريحة الأيقونة */
  tone: string
  title: string
  text: string
}

const QUICK_TOUR_STEPS: QuickTourStep[] = [
  {
    n: 1,
    icon: PackagePlus,
    tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    title: 'سجّل الشحنة',
    text: 'من شاشة «الشحنات» اضغط «تسجيل شحنة جديدة» — اكتب رقم الديليفري واختر المقاول والوجهة وخلاص.',
  },
  {
    n: 2,
    icon: ClipboardCheck,
    tone: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    title: 'علّم على الإذن ✓',
    text: 'لما الإذن الورقي يرجع من المقاول، افتح «أذونات التسليم» — ابحث برقم الديليفري واضغط علامة ✓ فورًا.',
  },
  {
    n: 3,
    icon: Layers,
    tone: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
    title: 'سجّل البنود الإضافية',
    text: 'لو في تعتيق أو مبيت أو مرتجع، ضيفه من «المصاريف والبنود» — المبيت والمرتجع بيتسمعوا في الحساب بعد موافقة الشركة.',
  },
  {
    n: 4,
    icon: Wallet,
    tone: 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
    title: 'تابع حسابات المقاولين',
    text: 'افتح «حسابات المقاولين» أو «متابعة الإدارة» من الموبايل في أي وقت — كل مقاول ليه كام شغل وكام اتسحب وكام متبقي له.',
  },
]

export function QuickTourButton({ variant }: { variant?: 'desktop' | 'mobile' }) {
  const [open, setOpen] = React.useState(false)
  const isMobile = variant === 'mobile'

  return (
    <>
      {isMobile ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-all hover:bg-accent hover:scale-105 active:scale-95"
          title="دليل الاستخدام السريع"
          aria-label="دليل الاستخدام السريع"
        >
          <HelpCircle className="size-4" />
        </button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 px-2.5 text-xs"
          onClick={() => setOpen(true)}
          title="دليل الاستخدام السريع"
          aria-label="دليل الاستخدام السريع"
        >
          <HelpCircle className="size-4" />
          <span className="hidden xl:inline">كيف أستخدم النظام؟</span>
          <span className="xl:hidden sr-only">كيف أستخدم النظام؟</span>
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[95vw] sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>دليل الاستخدام السريع</DialogTitle>
            <DialogDescription>خلاصة الشغل اليومي في 30 ثانية — 4 خطوات بس</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {QUICK_TOUR_STEPS.map((step) => {
              const Icon = step.icon
              return (
                <div key={step.n} className="rounded-2xl border border-border bg-card p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                        step.tone,
                      )}
                    >
                      {step.n}
                    </span>
                    <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', step.tone)}>
                      <Icon className="size-4" />
                    </span>
                    <div className="text-sm font-bold">{step.title}</div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{step.text}</p>
                </div>
              )
            })}
          </div>

          <p className="text-[11px] text-muted-foreground">
            نصيحة: الأزرار الكبيرة في الصفحة الرئيسية بتوصلك لأهم العمليات مباشرة — ومفيش حاجة تتسبب فيها بالغلط، كل خطوة حساسة ليها تأكيد قبل التنفيذ.
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}
