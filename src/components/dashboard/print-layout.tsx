'use client'

// ============================================================================
// نظام الطباعة الرسمي — ترويسة وتذييل التقرير القابل للطباعة (A4 Formal Report)
// يظهر فقط أثناء الطباعة (hidden print:block) في أعلى وأسفل كل تقرير.
// - الترويسة: اسم الشركة + الشعار + عنوان التقرير الديناميكي + تاريخ الطباعة + المستخدم
// - التذييل: خانات التوقيع والاعتماد (إعداد / مراجعة / اعتماد)
// ============================================================================

import { Truck } from 'lucide-react'

export interface PrintHeaderProps {
  /** عنوان التقرير (مثال: تقرير المرتجعات لم تُستلم) */
  title: string
  /** وصف أو الفلتر المطبق (مثال: من 01-11-2026 إلى 10-11-2026) */
  subtitle?: string
  /** اسم الفرع إن وُجد */
  branch?: string
  /** اسم المستخدم الذي طبع */
  user?: string
}

function formatPrintDate(): string {
  try {
    return new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

function formatPrintTime(): string {
  try {
    return new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return new Date().toTimeString().slice(0, 5)
  }
}

export function PrintHeader({ title, subtitle, branch, user }: PrintHeaderProps) {
  return (
    <div className="hidden print:block mb-5 pb-3 border-b-2 border-slate-800">
      <div className="flex items-start justify-between gap-6">
        {/* يمين (RTL): الشركة + الشعار */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center justify-center size-11 rounded-lg bg-slate-800 text-white shrink-0">
            <Truck className="size-6" />
          </div>
          <div>
            <div className="font-extrabold text-base leading-tight">شركة النقل والشحن</div>
            <div className="text-[10px] text-slate-500 leading-tight">Redline Transport</div>
            {branch && <div className="text-[11px] text-slate-600 mt-0.5 leading-tight">الفرع: {branch}</div>}
          </div>
        </div>

        {/* وسط: عنوان التقرير */}
        <div className="text-center flex-1 min-w-0">
          <h1 className="text-lg font-extrabold text-slate-900 leading-tight">{title}</h1>
          {subtitle && <div className="text-xs text-slate-600 mt-1 leading-snug">{subtitle}</div>}
        </div>

        {/* يسار: تاريخ الطباعة + المستخدم */}
        <div className="text-left text-[11px] text-slate-700 shrink-0">
          <div>تاريخ الطباعة: <b className="font-bold">{formatPrintDate()}</b></div>
          <div>الوقت: <b className="font-bold">{formatPrintTime()}</b></div>
          {user && <div className="mt-0.5">المستخدم: <b className="font-bold">{user}</b></div>}
        </div>
      </div>
    </div>
  )
}

export interface PrintFooterProps {
  /** إظهار خانات التوقيع (افتراضي: true للتقارير التشغيلية والمالية) */
  signatures?: boolean
  /** نص تذييل إضافي (مثال: ملاحظة سرية) */
  note?: string
}

export function PrintFooter({ signatures = true, note }: PrintFooterProps) {
  return (
    <div className="hidden print:block mt-8 pt-3 border-t border-slate-400">
      {note && (
        <div className="text-[10px] text-slate-500 mb-3 leading-snug">{note}</div>
      )}
      {signatures && (
        <div className="grid grid-cols-3 gap-8 text-center text-[11px] text-slate-700">
          <div>
            <div className="font-bold mb-10">إعداد</div>
            <div className="border-t border-slate-500 pt-1">الاسم والتوقيع</div>
          </div>
          <div>
            <div className="font-bold mb-10">مراجعة</div>
            <div className="border-t border-slate-500 pt-1">الاسم والتوقيع</div>
          </div>
          <div>
            <div className="font-bold mb-10">اعتماد</div>
            <div className="border-t border-slate-500 pt-1">الاسم والتوقيع</div>
          </div>
        </div>
      )}
      <div className="text-center text-[9px] text-slate-400 mt-3 pt-2 border-t border-slate-200">
        شركة النقل والشحن · نظام الإدارة المتكامل — تقرير آلي {new Date().getFullYear()}
      </div>
    </div>
  )
}

/**
 * ملخص طباعة صغير للبطاقات الإحصائية — يظهر فقط في الطباعة، يعرض ملخصًا مدمجًا
 * للبطاقات الـ KPI بحيث لا تُطبَع البطاقات الملونة بل ملخص ورقي نظيف.
 */
export function PrintSummary({ rows }: { rows: { label: string; value: string }[] }) {
  if (!rows.length) return null
  return (
    <div className="hidden print:block mb-4 text-xs">
      <div className="grid grid-cols-4 gap-2 border border-slate-300 rounded p-2 bg-slate-50">
        {rows.map((r, i) => (
          <div key={i} className="text-center">
            <div className="text-[10px] text-slate-500">{r.label}</div>
            <div className="font-bold text-slate-900">{r.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
