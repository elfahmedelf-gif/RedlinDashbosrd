'use client'

// ============================================================================
// مزود المصادقة — سياق React للجلسة الحالية والصلاحيات
// + خطافات مساعدة (useCanPrices) لتقليل التكرار عبر الوحدات
// ============================================================================

import * as React from 'react'
import { login as doLogin, logout as doLogout, restoreSession } from '@/lib/auth'
import { matchPermission, type SessionUser } from '@/lib/permissions'

interface AuthContextValue {
  user: SessionUser | null
  loading: boolean
  login: (username: string, password: string) => Promise<SessionUser>
  logout: () => void
  /** فحص صلاحية — true دائمًا لو مفيش مستخدم (قبل تسجيل الدخول نستخدمها بحذر) */
  has: (permission: string) => boolean
  /** إعادة تحميل الجلسة من الخادم — لتطبيق تعديلات الأدوار فورًا دون إعادة تسجيل دخول */
  refresh: () => Promise<SessionUser | null>
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<SessionUser | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    // استعادة الجلسة المحفوظة عند الإقلاع (تحقق شبكي من الخادم)
    let alive = true
    const t = setTimeout(async () => {
      const u = await restoreSession()
      if (!alive) return
      setUser(u)
      setLoading(false)
    }, 350)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [])

  const login = React.useCallback(async (username: string, password: string) => {
    const u = await doLogin(username, password)
    setUser(u)
    return u
  }, [])

  const logout = React.useCallback(() => {
    void doLogout(user)
    setUser(null)
  }, [user])

  /** إعادة التحقق من الجلسة من الخادم — تلتقط أي تعديل صلاحيات حديث فورًا */
  const refresh = React.useCallback(async () => {
    const u = await restoreSession()
    setUser(u)
    return u
  }, [])

  const has = React.useCallback(
    (permission: string) => (user ? matchPermission(user.permissions, permission) : false),
    [user],
  )

  const value = React.useMemo(
    () => ({ user, loading, login, logout, has, refresh }),
    [user, loading, login, logout, has, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

/**
 * خطاف مختصر لصلاحية رؤية الأسعار/المبالغ (prices.view).
 * استخدمه بدلًا من `const { has } = useAuth(); const canPrices = has('prices.view')`
 * في كل وحدة. يحفظ سطرًا ويزامن السلوك عبر التطبيق.
 *
 * @example
 *   const canPrices = useCanPrices()
 *   {canPrices && <span>{fmtNum(amount)} ج.م</span>}
 */
export function useCanPrices(): boolean {
  const { has } = useAuth()
  return has('prices.view')
}

/**
 * خطاف مختصر لصلاحية رؤية بنود النقلة الإضافية (shipments.extras.view):
 * التعتيق/المبيت/التحويلة/الدروب — صلاحية تشغيلية منفصلة عن الأسعار،
 * تُمنح تلقائيًا لمن يملك extra_costs.view ولا تكشف نولون العميل أو الهامش.
 */
export function useCanExtras(): boolean {
  const { has } = useAuth()
  return has('shipments.extras.view')
}

/**
 * خطاف مختصر لصلاحيات متعددة دفعة واحدة — يُعيد كائن boolean لكل صلاحية.
 * مفيد للأزرار المعقدة (مثلًا: يمكن التنفيذ + الطباعة + التصدير).
 *
 * ملاحظة: نتجنّب useMemo هنا لأن React Compiler يتعامل مع المُحفّظات
 * تلقائيًا، والإشارة إلى `keys` المتبدّلة عبر الاستدعاءات تسبب تحذيرات.
 *
 * @example
 *   const p = usePerms('vouchers.execute', 'vouchers.print', 'vouchers.export')
 *   {p['vouchers.execute'] && <button>تنفيذ</button>}
 */
export function usePerms(...keys: string[]): Record<string, boolean> {
  const { has } = useAuth()
  const out: Record<string, boolean> = {}
  for (const k of keys) out[k] = has(k)
  return out
}

// ============================================================================
// أعمدة جدول الشحنات — رؤية مستقلة لكل عمود (صلاحية shipments.cols.<col>)
// + قيد الفئة: أعمدة البنود الإضافية تتطلب shipments.extras.view،
//              وأعمدة المبالغ تتطلب prices.view (لأن الخادم يفرّغ القيم بدونه).
// المدير (admin عبر '*') يرى الكل. الأدوار الأخرى يتحكم المدير في كل عمود صراحةً.
// ============================================================================

export interface ShipmentColsVisibility {
  /** عمود تحديد (checkbox) — دائمًا ظاهر، لا يُتحكم فيه */
  select: boolean
  shipmentNo: boolean
  customer: boolean
  destination: boolean
  pieces: boolean
  loadType: boolean
  contractor: boolean
  date: boolean
  status: boolean
  aging: boolean
  overnight: boolean
  transfer: boolean
  drop: boolean
  freight: boolean
  suppliers: boolean
  margin: boolean
  grand: boolean
  actions: boolean
  /** عدد الأعمدة الظاهرة في جدول سطح المكتب (يشمل تحديد) — يُستعمل في colSpan */
  count: number
  /** عدد أعمدة البنود الإضافية الظاهرة */
  extrasCount: number
  /** عدد أعمدة المبالغ الظاهرة */
  pricesCount: number
}

/**
 * يُعيد حالة رؤية كل عمود في جدول الشحنات للمستخدم الحالي.
 * القاعدة:
 *  - الأعمدة الأساسية (shipmentNo/customer/destination/pieces/loadType/contractor/date/status/actions):
 *    ظاهرة iff المستخدم يملك صلاحية العمود (shipments.cols.<col>).
 *  - أعمدة البنود الإضافية (aging/overnight/transfer/drop):
 *    ظاهرة iff المستخدم يملك صلاحية العمود AND shipments.extras.view
 *    (الخادم يفرّغ القيم بدون extras.view فلا فائدة من إظهار عمود فارغ).
 *  - أعمدة المبالغ (freight/suppliers/margin/grand):
 *    ظاهرة iff المستخدم يملك صلاحية العمود AND prices.view
 *    (الخادم يفرّغ القيم بدون prices.view).
 *  - تحديد (select): دائمًا ظاهر.
 */
export function useShipmentCols(): ShipmentColsVisibility {
  const { has } = useAuth()
  const canPrices = has('prices.view')
  const canExtras = has('shipments.extras.view')
  const c = (k: string) => has(k)
  const base = (k: string) => c(k)
  const extras = (k: string) => c(k) && canExtras
  const prices = (k: string) => c(k) && canPrices
  const v = {
    select: true,
    shipmentNo: base('shipments.cols.shipmentNo'),
    customer: base('shipments.cols.customer'),
    destination: base('shipments.cols.destination'),
    pieces: base('shipments.cols.pieces'),
    loadType: base('shipments.cols.loadType'),
    contractor: base('shipments.cols.contractor'),
    date: base('shipments.cols.date'),
    status: base('shipments.cols.status'),
    aging: extras('shipments.cols.aging'),
    overnight: extras('shipments.cols.overnight'),
    transfer: extras('shipments.cols.transfer'),
    drop: extras('shipments.cols.drop'),
    freight: prices('shipments.cols.freight'),
    suppliers: prices('shipments.cols.suppliers'),
    margin: prices('shipments.cols.margin'),
    grand: prices('shipments.cols.grand'),
    actions: base('shipments.cols.actions'),
  }
  const extrasArr = [v.aging, v.overnight, v.transfer, v.drop]
  const pricesArr = [v.freight, v.suppliers, v.margin, v.grand]
  const count =
    (v.select ? 1 : 0) +
    (v.shipmentNo ? 1 : 0) +
    (v.customer ? 1 : 0) +
    (v.destination ? 1 : 0) +
    (v.pieces ? 1 : 0) +
    (v.loadType ? 1 : 0) +
    (v.contractor ? 1 : 0) +
    (v.date ? 1 : 0) +
    (v.status ? 1 : 0) +
    extrasArr.filter(Boolean).length +
    pricesArr.filter(Boolean).length +
    (v.actions ? 1 : 0)
  return {
    ...v,
    count,
    extrasCount: extrasArr.filter(Boolean).length,
    pricesCount: pricesArr.filter(Boolean).length,
  }
}
