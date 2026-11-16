// ============================================================================
// فلترة الأسعار/المبالغ على الخادم — إخفاء قوي للحقول المالية لغير المصرح لهم
// صلاحية prices.view تُمنح فقط للمالك (admin عبر '*') ومحمود (ops عبر دور إضافي).
// هذه الطبقة تضمن أن واجهة المستخدم لن ترى المبالغ حتى لو خُبئت في الواجهة فقط —
// الالتزام بتطبيق السياسة على الخادم (server-side enforcement) وليس في الواجهة فقط.
// ============================================================================
import { matchPermission, type SessionUser } from '../permissions'

/** هل المستخدم يملك صلاحية رؤية الأسعار/المبالغ؟ */
export function canSeePrices(user: { permissions: string[] } | null | undefined): boolean {
  if (!user) return false
  return matchPermission(user.permissions, 'prices.view')
}

/**
 * يُفرغ الحقول المالية من كائن شحنة — يُستعمل في API /api/shipments و /api/shipments/[id]
 * الحقول المخفية: freightCost, freightTotal, salePrice, customerPay, totalSuppliers,
 * aging, overnight, returns, transfer, other, drop, ton15*, ton3, m6, margin
 * (نُبقي policyQty لأنها كمية لا سعر)
 */
export function stripShipmentPrices<T extends Record<string, any>>(s: T, canPrices: boolean): T {
  if (canPrices) return s
  const hide = [
    'freightCost', 'freightTotal', 'salePrice', 'customerPay', 'totalSuppliers',
    'aging', 'overnight', 'returns', 'transfer', 'other', 'drop',
    'ton15', 'ton3', 'm6', 'margin',
  ]
  const out: any = { ...s }
  for (const k of hide) {
    if (k in out) out[k] = null
  }
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
        itOut.shipment = stripShipmentPrices(itOut.shipment, false)
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
  const s = { ...d, summary: { ...d.summary } }
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
