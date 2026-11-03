// ============================================================================
// نظام الصلاحيات — كتالوج الصلاحيات + المطابقة بالأنماط (wildcards)
// أنماط الأدوار: '*' (الكل) أو 'module.*' (كل وحدة) أو 'module.action' (صلاحية محددة)
// ============================================================================

export interface PermissionDef {
  key: string
  label: string
  group: string
}

/** كتالوج الصلاحيات الكامل — يُستخدم في مصفوفة الصلاحيات ووحدة الأدوار */
export const PERMISSION_CATALOG: PermissionDef[] = [
  // لوحة المؤشرات
  { key: 'dashboard.view', label: 'عرض لوحة المؤشرات', group: 'الرئيسية' },
  // الشحنات
  { key: 'shipments.view', label: 'عرض الشحنات', group: 'الشحنات' },
  { key: 'shipments.create', label: 'إضافة شحنة', group: 'الشحنات' },
  { key: 'shipments.edit', label: 'تعديل شحنة', group: 'الشحنات' },
  { key: 'shipments.delete', label: 'حذف شحنة', group: 'الشحنات' },
  { key: 'shipments.status', label: 'تغيير حالة الشحنة', group: 'الشحنات' },
  { key: 'shipments.assign', label: 'تعيين مقاول', group: 'الشحنات' },
  { key: 'shipments.settle', label: 'تسوية COD', group: 'الشحنات' },
  { key: 'shipments.print', label: 'طباعة بوليصة', group: 'الشحنات' },
  { key: 'shipments.export', label: 'تصدير الشحنات', group: 'الشحنات' },
  // الأطراف
  { key: 'parties.view', label: 'عرض العملاء والمقاولين', group: 'الأطراف' },
  { key: 'parties.manage', label: 'إضافة/تعديل الأطراف', group: 'الأطراف' },
  // الهيكل
  { key: 'structure.view', label: 'عرض الفروع والمخازن', group: 'الهيكل' },
  { key: 'structure.manage', label: 'إدارة الفروع والمخازن', group: 'الهيكل' },
  // المخزون
  { key: 'inventory.view', label: 'عرض الأصناف والأرصدة', group: 'المخزون' },
  { key: 'inventory.movements', label: 'تسجيل حركات المخزون', group: 'المخزون' },
  { key: 'inventory.freight', label: 'إدارة أسعار النولون', group: 'المخزون' },
  { key: 'inventory.manage', label: 'إدارة الأصناف', group: 'المخزون' },
  // المحاسبة
  { key: 'accounting.view', label: 'عرض شجرة الحسابات', group: 'المحاسبة' },
  { key: 'accounting.journal', label: 'القيود اليومية والترحيل', group: 'المحاسبة' },
  { key: 'accounting.vouchers', label: 'عرض الأذونات (السندات)', group: 'المحاسبة' },
  { key: 'accounting.vouchers.create', label: 'تسجيل إذن قبض/صرف', group: 'المحاسبة' },
  { key: 'accounting.vouchers.delete', label: 'حذف الإذونات', group: 'المحاسبة' },
  // التقارير
  { key: 'reports.view', label: 'عرض التقارير', group: 'التقارير' },
  { key: 'reports.export', label: 'تصدير التقارير', group: 'التقارير' },
  // النظام
  { key: 'import.manage', label: 'استيراد البيانات', group: 'النظام' },
  { key: 'users.manage', label: 'إدارة المستخدمين', group: 'النظام' },
  { key: 'roles.manage', label: 'إدارة الصلاحيات والأدوار', group: 'النظام' },
  { key: 'settings.manage', label: 'الإعدادات والقوائم', group: 'النظام' },
  { key: 'audit.view', label: 'عرض سجل التدقيق', group: 'النظام' },
]

export const PERMISSION_GROUPS: string[] = Array.from(
  new Set(PERMISSION_CATALOG.map((p) => p.group)),
)

/** تطبيع الأنماط القديمة (shipments.read / branch.read) إلى المفاتيح الجديدة */
function normalizePattern(p: string): string {
  if (!p) return ''
  let s = String(p).trim()
  if (s === 'shipments.read') return 'shipments.view'
  if (s === 'branch.read') return 'structure.view'
  if (s === 'parties.read') return 'parties.view'
  if (s === 'inventory.read') return 'inventory.view'
  if (s === 'reports.read') return 'reports.view'
  if (s === 'accounting.read') return 'accounting.view'
  return s
}

export interface SessionUser {
  userId: string
  username: string
  name: string
  roleId: string | null
  roleName: string | null
  roleLabel: string | null
  permissions: string[]
  loginAt: string
}

/** هل يمتلك المستخدم (أنماط) الصلاحية المطلوبة؟ */
export function matchPermission(patterns: string[] | null | undefined, key: string): boolean {
  if (!patterns || !patterns.length) return false
  for (const raw of patterns) {
    const p = normalizePattern(raw)
    if (p === '*') return true
    if (p.endsWith('.*') && key.startsWith(p.slice(0, -1))) return true
    if (p === key) return true
  }
  return false
}

export function hasAnyPermission(patterns: string[] | null | undefined): boolean {
  return !!patterns && patterns.length > 0
}

/** توسيع الأنماط إلى قائمة صلاحيات صريحة (للعرض في المصفوفة) */
export function expandPermissions(patterns: string[] | null | undefined): Set<string> {
  const out = new Set<string>()
  if (!patterns) return out
  for (const def of PERMISSION_CATALOG) {
    if (matchPermission(patterns, def.key)) out.add(def.key)
  }
  return out
}
