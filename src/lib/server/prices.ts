// ============================================================================
// فلترة الأسعار/المبالغ على الخادم — إخفاء قوي للحقول المالية لغير المصرح لهم
// صلاحية prices.view تُمنح فقط للمالك (admin عبر '*') ومن يصرّح له المدير.
// هذه الطبقة تضمن أن واجهة المستخدم لن ترى المبالغ حتى لو خُبئت في الواجهة فقط —
// الالتزام بتطبيق السياسة على الخادم (server-side enforcement) وليس في الواجهة فقط.
//
// + رؤية لكل حقل على حدة وفق صلاحيات أعمدة جدول الشحنات (shipcols.*):
//   صلاحية العمود لوحدها (أو صلاحية الفئة الأوسع) كافية لتمرير قيمة الحقل —
//   فيتطابق ما يُعرض في الجدول مع ما يُمرَّر من الخادم تمامًا (بلا تناقض).
// ============================================================================
import { matchPermission, type SessionUser } from '../permissions'

/** هل المستخدم يملك صلاحية رؤية الأسعار/المبالغ؟ */
export function canSeePrices(user: { permissions: string[] } | null | undefined): boolean {
  if (!user) return false
  return matchPermission(user.permissions, 'prices.view')
}

/**
 * هل المستخدم يملك صلاحية رؤية بنود النقلة الإضافية (تعتيق/مبيت/تحويلة/دروب/مرتجع)؟
 * صلاحية تشغيلية منفصلة عن الأسعار — من يتابع البنود الإضافية يوميًا (العمليات/المالي)
 * يراها دون أن يكشف له نولون العميل أو التكلفة أو الهامش.
 */
export function canSeeExtras(user: { permissions: string[] } | null | undefined): boolean {
  if (!user) return false
  return matchPermission(user.permissions, 'shipments.extras.view')
}

// ---------------------------------------------------------------------------
// رؤية حقول الشحنة لكل حقل على حدة (أعمدة الجدول + الحقول الصارمة)
// ---------------------------------------------------------------------------

/**
 * خريطة رؤية حقول الشحنة للمستخدم — تُحسب من صلاحياته مرة واحدة لكل طلب.
 *  - freight/suppliers/margin/grand: صلاحية العمود (shipcols.*) أو prices.view
 *  - aging/overnight/transfer/drop: صلاحية العمود (shipcols.*) أو shipments.extras.view
 *  - strict (salePrice/customerPay/ton15/ton3/m6): prices.view فقط (ليست أعمدة جدول)
 *  - canExtras تتحكم أيضًا في returns/other (بنود إضافية بلا أعمدة مخصصة)
 */
export interface ShipmentFieldVisibility {
  canPrices: boolean
  canExtras: boolean
  /** نولون العميل — freightTotal/freightCost */
  freight: boolean
  /** نولون المقاول — totalSuppliers */
  suppliers: boolean
  /** هامش الربح — margin */
  margin: boolean
  /** الإجمالي النقلة — المجموع المحسوب */
  grand: boolean
  aging: boolean
  overnight: boolean
  transfer: boolean
  drop: boolean
  /** الحقول الصارمة غير المعروضة كأعمدة (salePrice/customerPay/ton15/ton3/m6) */
  strict: boolean
}

export const SHIPMENT_VIS_FULL: ShipmentFieldVisibility = {
  canPrices: true, canExtras: true,
  freight: true, suppliers: true, margin: true, grand: true,
  aging: true, overnight: true, transfer: true, drop: true,
  strict: true,
}

export const SHIPMENT_VIS_NONE: ShipmentFieldVisibility = {
  canPrices: false, canExtras: false,
  freight: false, suppliers: false, margin: false, grand: false,
  aging: false, overnight: false, transfer: false, drop: false,
  strict: false,
}

/** حساب خريطة رؤية حقول الشحنة من صلاحيات المستخدم */
export function shipmentFieldVisibility(user: { permissions: string[] } | null | undefined): ShipmentFieldVisibility {
  const perms = user?.permissions ?? []
  const has = (k: string) => matchPermission(perms, k)
  const canPrices = has('prices.view')
  const canExtras = has('shipments.extras.view')
  return {
    canPrices,
    canExtras,
    freight: canPrices || has('shipcols.freight'),
    suppliers: canPrices || has('shipcols.suppliers'),
    margin: canPrices || has('shipcols.margin'),
    grand: canPrices || has('shipcols.grand'),
    aging: canExtras || has('shipcols.aging'),
    overnight: canExtras || has('shipcols.overnight'),
    transfer: canExtras || has('shipcols.transfer'),
    drop: canExtras || has('shipcols.drop'),
    strict: canPrices,
  }
}

/**
 * يُفرغ حقول الشحنة وفق خريطة الرؤية — يُستعمل في API /api/shipments و /api/shipments/[id]
 * (نُبقي policyQty لأنها كمية لا سعر)
 */
export function stripShipmentPrices<T extends Record<string, any>>(s: T, vis: ShipmentFieldVisibility): T {
  const out: any = { ...s }
  const setNull = (keys: string[]) => {
    for (const k of keys) if (k in out) out[k] = null
  }
  if (!vis.strict) setNull(['salePrice', 'customerPay', 'ton15', 'ton3', 'm6'])
  if (!vis.freight) setNull(['freightCost', 'freightTotal'])
  if (!vis.suppliers) setNull(['totalSuppliers'])
  if (!vis.margin && 'margin' in out) out.margin = null
  if (!vis.aging) setNull(['aging'])
  if (!vis.overnight) setNull(['overnight'])
  if (!vis.transfer) setNull(['transfer'])
  if (!vis.drop) setNull(['drop'])
  if (!vis.canExtras) setNull(['returns', 'other'])
  return out
}

/** يُفرغ الحقول المالية من كائن إذن — amount, totalValue */
export function stripVoucherPrices<T extends Record<string, any>>(v: T, canPrices: boolean): T {
  if (canPrices) return v
  const out: any = { ...v }
  if ('amount' in out) out.amount = null
  if ('totalValue' in out) out.totalValue = 0
  // إخفاء قيمة الشحنة في الأصناف المرتبطة
  if (Array.isArray(out.items)) {
    out.items = out.items.map((it: any) => {
      const itOut = { ...it }
      if (itOut.shipment) {
        itOut.shipment = stripShipmentPrices(itOut.shipment, SHIPMENT_VIS_NONE)
      }
      return itOut
    })
  }
  return out
}

/** يُفرغ الإحصاءات المالية من لوحة مؤشرات الأذونات */
export function stripVoucherStats(stats: Record<string, any>, canPrices: boolean): Record<string, any> {
  if (canPrices) return stats
  return {
    ...stats,
    collectionTotal: 0,
    disbursementTotal: 0,
  }
}

/** يُفرغ الإحصاءات المالية من لوحة المؤشرات الرئيسية */
export function stripDashboardStats(d: Record<string, any>, canPrices: boolean): Record<string, any> {
  if (canPrices) return d
  const s: Record<string, any> = { ...d, summary: { ...d.summary } }
  // إخفاء كل المجاميع المالية من ملخص لوحة المؤشرات
  for (const k of [
    'totalFreight', 'totalCustomerPay', 'totalSuppliers', 'totalSale',
    'netFreightMargin', 'totalAging', 'totalOvernight', 'totalReturns',
    'totalTransfer', 'totalOther', 'totalDrop', 'ton15Total', 'ton3Total', 'm6Total',
  ]) {
    if (k in s.summary) s.summary[k] = 0
  }
  // إخفاء قيم النولون/الموردين من السلاسل اليومية والوجهات والمقاولين
  if (Array.isArray(s.daily)) {
    s.daily = s.daily.map((row: any) => ({ ...row, freight: 0, suppliers: 0, customerPay: 0 }))
  }
  if (Array.isArray(s.destinations)) {
    s.destinations = s.destinations.map((row: any) => ({ ...row, freight: 0, suppliers: 0 }))
  }
  if (Array.isArray(s.codings)) {
    s.codings = s.codings.map((row: any) => ({ ...row, freight: 0 }))
  }
  if (Array.isArray(s.contractors)) {
    s.contractors = s.contractors.map((row: any) => ({ ...row, freight: 0, suppliers: 0 }))
  }
  return s
}

/** يُفرغ الإحصاءات المالية من قوائم الأطراف (العملاء/المقاولين) */
export function stripParties(items: any[], canPrices: boolean): any[] {
  if (canPrices) return items
  return items.map((p) => {
    const out = { ...p }
    if (out._sum) {
      out._sum = {
        freightTotal: 0,
        totalSuppliers: 0,
        customerPay: 0,
      }
    }
    if ('openingBalance' in out) out.openingBalance = 0
    if ('creditLimit' in out) out.creditLimit = null
    if ('currentBalance' in out) out.currentBalance = 0
    return out
  })
}

/** أسماء التقارير التي تكشف الأسعار — تتطلب صلاحية prices.view */
export const PRICE_REPORTS = new Set(['freight-margin', 'contractor-dues', 'customer-debts', 'shipments', 'contractor-monthly'])

/** هل التقرير المطلوب يكشف أسعارًا؟ */
export function reportRequiresPrices(type: string): boolean {
  return PRICE_REPORTS.has(type)
}
