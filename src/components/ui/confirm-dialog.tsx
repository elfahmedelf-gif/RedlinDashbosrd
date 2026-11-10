'use client'

// ============================================================================
// نافذة تأكيد موحّدة (ConfirmDialog) + مزوّد وخطاف useConfirm()
// ----------------------------------------------------------------------------
// بديل احترافي لنوافذ المتصفح confirm() / alert() — متوافق مع هوية النظام:
//  - RTL افتراضيًا + خلفية ضبابية معتمة (backdrop blur)
//  - زر تأكيد بلون أساسي (Primary) متغيّر حسب النوع (danger/warning/info)
//  - زر إلغاء ثانوي (Secondary)
//  - أيقونة توضيحية لكل نوع إجراء
//  - واجهة Promise: const ok = await confirm({...}) لتحل محل if (!confirm('...'))
//  - يُركّب مرة واحدة في الجذر (Page) ويُستدعى من أي مكان
// ============================================================================

import * as React from 'react'
import {
  AlertTriangle, Info, CheckCircle2, AlertOctagon, Loader2,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// الأنواع
// ---------------------------------------------------------------------------
export type ConfirmTone = 'danger' | 'warning' | 'info' | 'success'

export interface ConfirmOptions {
  /** العنوان الرئيسي للنافذة */
  title: string
  /** نص الرسالة التفصيلي (يدعم \n للأسطر المتعددة) */
  message?: string
  /** نوع/لون النافذة — يحدّد الأيقونة ولون زر التأكيد */
  tone?: ConfirmTone
  /** نص زر التأكيد (افتراضي: "تأكيد") */
  confirmText?: string
  /** نص زر الإلغاء (افتراضي: "إلغاء") */
  cancelText?: string
  /** هل نُلغي النافذة تلقائيًا عند الضغط خارجها؟ (افتراضي: true) */
  dismissible?: boolean
}

type Resolver = (ok: boolean) => void

interface DialogState extends ConfirmOptions {
  open: boolean
  loading?: boolean
  resolver: Resolver | null
}

// ---------------------------------------------------------------------------
// جداول الأنماط (tones) — أيقونة + لون زر التأكيد + لون الأيقونة
// ---------------------------------------------------------------------------
const TONE_CONFIG: Record<ConfirmTone, {
  icon: LucideIcon
  iconWrap: string
  confirmBtn: string
}> = {
  danger: {
    icon: AlertOctagon,
    iconWrap: 'bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400',
    confirmBtn: 'bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-600/20',
  },
  warning: {
    icon: AlertTriangle,
    iconWrap: 'bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400',
    confirmBtn: 'bg-amber-600 hover:bg-amber-700 text-white shadow-md shadow-amber-600/20',
  },
  info: {
    icon: Info,
    iconWrap: 'bg-sky-100 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400',
    confirmBtn: 'bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/20',
  },
  success: {
    icon: CheckCircle2,
    iconWrap: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400',
    confirmBtn: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20',
  },
}

// ---------------------------------------------------------------------------
// السياق (Context) — يحمل دالة confirm() المتاحة عبر useConfirm()
// ---------------------------------------------------------------------------
interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  /** تأكيد سريع للحذف (tone=danger، نص زر: "حذف") */
  confirmDelete: (opts: Omit<ConfirmOptions, 'tone'> & Partial<Pick<ConfirmOptions, 'tone'>>) => Promise<boolean>
}

const ConfirmContext = React.createContext<ConfirmContextValue | null>(null)

// ---------------------------------------------------------------------------
// المزوّد — يُركّب مرة واحدة في الجذر، يعرض النافذة عند الطلب
// ---------------------------------------------------------------------------
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<DialogState>({
    open: false,
    title: '',
    resolver: null,
  })

  // عرض النافذة — يُعيد Promise يحلّ true/false حسب اختيار المستخدم
  const confirm = React.useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setState({
        open: true,
        title: opts.title,
        message: opts.message,
        tone: opts.tone ?? 'info',
        confirmText: opts.confirmText,
        cancelText: opts.cancelText,
        dismissible: opts.dismissible ?? true,
        resolver: resolve,
      })
    })
  }, [])

  // اختصار لتأكيد الحذف (tone=danger، نص زر افتراضي: "حذف")
  const confirmDelete = React.useCallback(
    (opts: Omit<ConfirmOptions, 'tone'> & Partial<Pick<ConfirmOptions, 'tone'>>): Promise<boolean> => {
      return confirm({
        tone: 'danger',
        confirmText: 'حذف',
        cancelText: 'إلغاء',
        ...opts,
        tone: opts.tone ?? 'danger',
      } as ConfirmOptions)
    },
    [confirm],
  )

  // حلّ الـ Promise
  const resolve = React.useCallback((ok: boolean) => {
    setState((prev) => {
      prev.resolver?.(ok)
      return { ...prev, open: false, resolver: null }
    })
  }, [])

  // إغلاق بـ Escape
  React.useEffect(() => {
    if (!state.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state.dismissible !== false) {
        resolve(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.open, state.dismissible, resolve])

  const value = React.useMemo(
    () => ({ confirm, confirmDelete }),
    [confirm, confirmDelete],
  )

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={state.open}
        title={state.title}
        message={state.message}
        tone={state.tone ?? 'info'}
        confirmText={state.confirmText}
        cancelText={state.cancelText}
        loading={state.loading}
        dismissible={state.dismissible !== false}
        onConfirm={() => resolve(true)}
        onCancel={() => resolve(false)}
      />
    </ConfirmContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// الخطاف useConfirm() — للوصول إلى دالة confirm() من أي مكون داخل المزوّد
// ---------------------------------------------------------------------------
export function useConfirm(): ConfirmContextValue {
  const ctx = React.useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider')
  return ctx
}

// ---------------------------------------------------------------------------
// مكوّن النافذة نفسه — لا يُستخدم مباشرة عادةً (المزوّد يتحكم به)
// ---------------------------------------------------------------------------
function ConfirmDialog({
  open,
  title,
  message,
  tone,
  confirmText = 'تأكيد',
  cancelText = 'إلغاء',
  loading = false,
  dismissible = true,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message?: string
  tone: ConfirmTone
  confirmText?: string
  cancelText?: string
  loading?: boolean
  dismissible?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const cfg = TONE_CONFIG[tone] ?? TONE_CONFIG.info
  const Icon = cfg.icon

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 anim-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={dismissible ? onCancel : undefined}
    >
      <div
        className="bg-background rounded-2xl shadow-2xl max-w-md w-full p-6 text-right border border-border anim-zoom-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* رأس: الأيقونة + العنوان */}
        <div className="flex items-start gap-3 mb-4">
          <div className={cn(
            'flex items-center justify-center size-11 rounded-xl shrink-0',
            cfg.iconWrap,
          )}>
            <Icon className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 id="confirm-dialog-title" className="text-lg font-bold text-foreground leading-tight">
              {title}
            </h3>
          </div>
        </div>

        {/* الرسالة */}
        {message && (
          <p className="text-sm text-muted-foreground leading-relaxed mb-6 whitespace-pre-line">
            {message}
          </p>
        )}

        {/* الأزرار */}
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-foreground bg-secondary hover:bg-secondary/80 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-lg transition-colors shadow-md flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed',
              cfg.confirmBtn,
            )}
            autoFocus
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// (اختياري) خطاف لعرض نافذة معلومات فقط (بديل alert) — زر واحد "موافق"
// ---------------------------------------------------------------------------
export function useAlert() {
  const { confirm } = useConfirm()
  return React.useCallback(
    (opts: Omit<ConfirmOptions, 'tone'> & Partial<Pick<ConfirmOptions, 'tone'>>) =>
      confirm({
        tone: 'info',
        confirmText: 'موافق',
        cancelText: '',
        dismissible: true,
        ...opts,
        tone: opts.tone ?? 'info',
      } as ConfirmOptions),
    [confirm],
  )
}
