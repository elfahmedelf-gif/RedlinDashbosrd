'use client'

// ============================================================================
// PrintStage — منصة طباعة مستقلة عن الـ Dialog
// المشكلة: الـ Dialog محصور في max-h-[95vh] overflow-y-auto فيُقص في الطباعة.
// الحل: نُطلق محتوى الطباعة في عنصر ثابت مرتبط بـ <body> (portal) عبر createPortal،
// ونضيف كلاس "printing-modal" على <body> عند الطباعة فقط — فيُخفي CSS كامل التطبيق
// ويُظهر المنصة وحدها كعنصر انسيابي بعرض A4 كامل.
// على الشاشة: المنصة مخفية (hidden)، يظهر فقط الـ Dialog التفاعلي.
// ============================================================================

import * as React from 'react'
import { createPortal } from 'react-dom'

interface PrintStageProps {
  /** أي معرّف فريد للنافذة (يُستخدم لـ body class عند الحاجة) */
  id?: string
  /** محتوى الطباعة (البوليصة/السند/الإذن) — يُرسم داخل .printable-area */
  children: React.ReactNode
}

export function PrintStage({ id, children }: PrintStageProps) {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return createPortal(
    <div
      id={id}
      className="modal-print-stage hidden print:block"
      aria-hidden="true"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: -1, pointerEvents: 'none' }}
    >
      <div className="printable-area bg-white text-slate-900" dir="rtl" style={{ fontFamily: "'Tahoma','Arial',sans-serif" }}>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/**
 * usePrintModal — هوك لتشغيل وضع طباعة النافذة المنبثقة.
 * يضيف كلاس "printing-modal" على <body> قبل window.print() ويزيله بعدها.
 * الاستخدام:
 *   const { printModal } = usePrintModal()
 *   <Button onClick={printModal}>طباعة</Button>
 */
export function usePrintModal() {
  const printModal = React.useCallback(() => {
    if (typeof document === 'undefined') return
    const cleanup = () => {
      document.body.classList.remove('printing-modal')
      window.removeEventListener('afterprint', cleanup)
    }
    document.body.classList.add('printing-modal')
    window.addEventListener('afterprint', cleanup)
    // دع المتصفح يطبّق الكلاس ثم اطبع
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.print())
    })
  }, [])
  return { printModal }
}
