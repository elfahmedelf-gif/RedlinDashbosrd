'use client'

// ============================================================================
// نافذة تأكيد موحّدة (ConfirmDialog) + مزوّد وخطاف useConfirm()
// ----------------------------------------------------------------------------
// بديل احترافي لنوافذ المتصفح confirm() / alert() — متوافق مع هوية النظام:
//  - RTL كامل + خلفية معتمة بضبابية خفيفة (bg-black/40 backdrop-blur-sm)
//  - بطاقة بيضاء نقية بزوايا دائرية كبيرة (rounded-2xl) وظل ناعم
//  - رأس: عنوان عريض بجانب أيقونة دائرية بخلفية باهطة (حسب variant)
//  - زر إلغاء رمادي فاتح (bg-slate-100 hover:bg-slate-200)
//  - زر تأكيد بلون كامل حسب النوع (rose للحذف، primary للتشغيل، amber للتنبيه)
//  - واجهة Promise: const ok = await confirm({...}) لتحل محل if (!confirm('...'))
//  - يُركّب مرة واحدة في الجذر (Page) ويُستدعى من أي مكان عبر useConfirm()
// ============================================================================

import * as React from 'react'
import {
  AlertTriangle, Info, CheckCircle2, AlertOctagon, Loader2,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// الأنواع — variant يحدّد الألوان والأيقونة
// ---------------------------------------------------------------------------
/** danger: أحمر للحذف | primary: لون هوية النظام للعمليات التشغيلية | warning: للتنبيهات */
export type ConfirmVariant = 'danger' | 'primary' | 'warning'
/** أسماء بديلة متوافقة (تُعالج داخليًا كـ primary) */
export type ConfirmVariantAlias = 'success' | 'info'
export type ConfirmTone = ConfirmVariant | ConfirmVariantAlias

export interface ConfirmOptions {
  /** العنوان الرئيسي للنافذة (مثال: "حذف الطرف"، "تأكيد تسليم مرتجع") */
  title: string
  /** نص التوضيح/الرسالة (يدعم \n للأسطر المتعددة) */
  message?: string
  /** نوع التأكيد: danger (حذف) | primary (تشغيلي) | warning (تنبيه) — افتراضي: primary */
  variant?: ConfirmTone
  /** نص زر التأكيد (افتراضي: "تأكيد") */
  confirmText?: string
  /** نص زر الإلغاء (افتراضي: "إلغاء") */
  cancelText?: string
  /** هل نُلغي النافذة تلقائيًا عند الضغط خارجها أو Escape؟ (افتراضي: true) */
  dismissible?: boolean
}

type Resolver = (ok: boolean) => void

interface DialogState extends ConfirmOptions {
  open: boolean
  resolver: Resolver | null
}

/** تطبيع الأسماء البديلة إلى الأنماط الثلاثة الرسمية */
function normalizeVariant(v?: ConfirmTone): ConfirmVariant {
  if (v === 'danger' || v === 'warning') return v
  return 'primary' // primary + success + info
}

// ---------------------------------------------------------------------------
// جداول الأنماط (variants) — أيقونة دائرية بخلفية باهطة + زر تأكيد بلون كامل
// ---------------------------------------------------------------------------
const VARIANT_CONFIG: Record<ConfirmVariant, {
  icon: LucideIcon
  /** الدائرة الباهطة حول الأيقونة */
  iconWrap: string
  /** زر التأكيد بلون كامل + hover سلس */
  confirmBtn: string
}> = {
  danger: {
    icon: AlertOctagon,
    iconWrap: 'bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400',
    confirmBtn: 'bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-600/25',
  },
  primary: {
    icon: CheckCircle2,
    iconWrap: 'bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary',
    confirmBtn: 'bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/25',
  },
  warning: {
    icon: AlertTriangle,
    iconWrap: 'bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400',
    confirmBtn: 'bg-amber-600 hover:bg-amber-700 text-white shadow-md shadow-amber-600/25',
  },
}

// ---------------------------------------------------------------------------
// السياق (Context) — يحمل دالة confirm() المتاحة عبر useConfirm()
// ---------------------------------------------------------------------------
interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  /** تأكيد سريع للحذف (variant=danger، نص زر: "حذف") */
  confirmDelete: (opts: Omit<ConfirmOptions, 'variant'> & Partial<Pick<ConfirmOptions, 'variant'>>) => Promise<boolean>
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
        variant: opts.variant,
        confirmText: opts.confirmText,
        cancelText: opts.cancelText,
        dismissible: opts.dismissible ?? true,
        resolver: resolve,
      })
    })
  }, [])

  // اختصار لتأكيد الحذف (variant=danger، نص زر افتراضي: "حذف")
  const confirmDelete = React.useCallback(
    (opts: Omit<ConfirmOptions, 'variant'> & Partial<Pick<ConfirmOptions, 'variant'>>): Promise<boolean> => {
      return confirm({ variant: 'danger', confirmText: 'حذف', ...opts })
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
        variant={state.variant}
        confirmText={state.confirmText}
        cancelText={state.cancelText}
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
  variant,
  confirmText = 'تأكيد',
  cancelText = 'إلغاء',
  dismissible = true,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message?: string
  variant?: ConfirmTone
  confirmText?: string
  cancelText?: string
  dismissible?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const v = normalizeVariant(variant)
  const cfg = VARIANT_CONFIG[v]
  const Icon = cfg.icon

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 anim-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={dismissible ? onCancel : undefined}
    >
      {/* بطاقة بيضاء نقية بزوايا دائرية كبيرة + ظل ناعم */}
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full p-6 text-right border border-slate-200 dark:border-slate-800 anim-zoom-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* رأس: الأيقونة الدائرية الباهطة + العنوان العريض */}
        <div className="flex items-start gap-3.5 mb-4">
          <div className={cn(
            'flex items-center justify-center size-12 rounded-full shrink-0',
            cfg.iconWrap,
          )}>
            <Icon className="size-5.5" />
          </div>
          <div className="flex-1 min-w-0 pt-1">
            <h3 id="confirm-dialog-title" className="text-lg font-bold text-slate-900 dark:text-white leading-tight">
              {title}
            </h3>
          </div>
        </div>

        {/* نص الرسالة — رمادي مريح للقراءة */}
        {message && (
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-6 whitespace-pre-line">
            {message}
          </p>
        )}

        {/* الأزرار: إلغاء رمادي فاتح + تأكيد بلون كامل */}
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-lg transition-colors shadow-sm',
              cfg.confirmBtn,
            )}
          >
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
    (opts: Omit<ConfirmOptions, 'variant'> & Partial<Pick<ConfirmOptions, 'variant'>>) =>
      confirm({
        variant: 'primary',
        confirmText: 'موافق',
        cancelText: '',
        ...opts,
      }),
    [confirm],
  )
}

// الإشارة إلى Info لتفادي تحذير الاستيراد غير المستخدم (متاحة للتوسعات المستقبلية)
void Info
