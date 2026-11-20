// ============================================================================
// نظام تصميم Excel الموحّد على الخادم — مصدر واحد للألوان والأنماط
// يستخدمه: تصدير الشحنات / قالب الاستيراد / كشف الحساب / التقرير الشهري
// الهوية البصرية نفسها المستخدمة في باقي تصديرات النظام (سلايت + زمردي + كهرماني)
// ============================================================================
import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'

// ---- لوحة الألوان (ARGB) — مطابقة لهوية النظام ----
export const XL = {
  DARK: 'FF0F172A',        // slate-900 — النصوص الرئيسية وشريط العنوان
  GRAY: 'FF64748B',        // slate-500 — الملاحظات الثانوية
  SLATE_HEADER: 'FF334155',// slate-700 — رأس الجدول
  GREEN: 'FF047857',       // emerald-700 — المبالغ/النجاح
  GREEN_LIGHT: 'FFD1FAE5', // emerald-100 — تعبئة القوائم المنسدلة
  RED: 'FFB91C1C',         // red-700 — السالب/التحذير
  RED_LIGHT: 'FFFEE2E2',   // red-100
  AMBER: 'FFB45309',       // amber-700 — الإلزامي
  AMBER_LIGHT: 'FFFEF3C7', // amber-100 — تعبئة الإلزامي
  AMBER_EX: 'FFFEF9C3',    // yellow-100 — صفوف المثال
  FILL_HEAD: 'FFF1F5F9',   // slate-100 — رؤوس ثانوية/الإجمالي
  FILL_ALT: 'FFFAFAFA',    // zebra
  BORDER: 'FF94A3B8',      // slate-400
  WHITE: 'FFFFFFFF',
} as const

export const xfont = (spec: Partial<ExcelJS.Font>): ExcelJS.Font => spec as ExcelJS.Font
export const xborders = (spec: Partial<ExcelJS.Borders>): ExcelJS.Borders => spec as ExcelJS.Borders

export const XTHIN = xborders({
  top: { style: 'thin', color: { argb: XL.BORDER } },
  bottom: { style: 'thin', color: { argb: XL.BORDER } },
  left: { style: 'thin', color: { argb: XL.BORDER } },
  right: { style: 'thin', color: { argb: XL.BORDER } },
})
export const XTOTAL = xborders({
  top: { style: 'double', color: { argb: XL.DARK } },
  bottom: { style: 'thin', color: { argb: XL.BORDER } },
  left: { style: 'thin', color: { argb: XL.BORDER } },
  right: { style: 'thin', color: { argb: XL.BORDER } },
})

export const xfill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
export const XCENTER = { horizontal: 'center' as const, vertical: 'middle' as const }

/** تاريخ محلي YYYY-MM-DD — بدون انحراف UTC */
export const xlsDateStr = (d: Date | string) => {
  const dt = d instanceof Date ? d : new Date(d)
  if (isNaN(dt.getTime())) return ''
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/** تنسيق رقم موحّد للمبالغ والكميات */
export const MONEY_FMT = '#,##0.00'
export const QTY_FMT = '#,##0'

// ---- ألوان حالات الشحنة في Excel (تعبئة فاتحة + نص داكن — نفس دلالات شارات الواجهة) ----
export const SHIPMENT_STATUS_STYLE: Record<string, { fill: string; text: string }> = {
  new: { fill: 'FFE0F2FE', text: 'FF0369A1' },
  preparing: { fill: 'FFECFEFF', text: 'FF0E7490' },
  received: { fill: 'FFCCFBF1', text: 'FF0F766E' },
  loaded: { fill: 'FFFEF3C7', text: 'FFB45309' },
  in_transit: { fill: 'FFEDE9FE', text: 'FF6D28D9' },
  arrived: { fill: 'FFFFEDD5', text: 'FFC2410C' },
  assigned_courier: { fill: 'FFE0E7FF', text: 'FF4338CA' },
  out_for_delivery: { fill: 'FFDBEAFE', text: 'FF1D4ED8' },
  delivered: { fill: 'FFD1FAE5', text: 'FF047857' },
  mabeit: { fill: 'FFFEF3C7', text: 'FFB45309' },
  taateeq: { fill: 'FFE0F2FE', text: 'FF0369A1' },
  postponed: { fill: 'FFFEF9C3', text: 'FFA16207' },
  failed: { fill: 'FFFFEDD5', text: 'FFC2410C' },
  returned: { fill: 'FFFFE4E6', text: 'FFE11D48' },
  received_returned: { fill: 'FFFEE2E2', text: 'FFB91C1C' },
  cancelled: { fill: 'FFE2E8F0', text: 'FF475569' },
  written_off: { fill: 'FFF1F5F9', text: 'FF64748B' },
}

/** استجابة تنزيل .xlsx — اسم عربي UTF-8 + اسم لاتيني احتياطي */
export function xlsxResponse(buf: ExcelJS.Buffer, latinName: string, arabicName: string): NextResponse {
  return new NextResponse(buf as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${latinName}.xlsx"; filename*=UTF-8''${encodeURIComponent(`${arabicName}.xlsx`)}`,
    },
  })
}
