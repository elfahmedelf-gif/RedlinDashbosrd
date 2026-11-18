// ============================================================================
// مزامنة كتالوج الصلاحيات مع قاعدة البيانات الحية (idempotent)
// تُستدعى عند إقلاع الخادم وعند تحميل شاشة الصلاحيات — تضيف ما ينقص فقط:
//   • لا تكرر صلاحيات موجودة، ولا تمسح تخصيصات الأدوار الحالية
//   • تمنح دور admin كل الصلاحيات الجديدة تلقائيًا (عبر '*')
//   • تمنح الأدوار المعروفة (operations / accountant / viewer …) افتراضيات معقولة
// ============================================================================
import { db } from '@/lib/db'
import { parsePerms } from './passwords'
import { logAudit } from './audit'

/**
 * الإضافات الافتراضية لكل دور معروف — تُضاف فوق صلاحياته الحالية (لا تُطرح أبدًا).
 * المفتاح = اسم الدور في قاعدة البيانات.
 */
export const ROLE_PERMISSION_DEFAULTS: Record<string, string[]> = {
  // المالك — كل الصلاحيات عبر النمط الشامل
  admin: ['*'],
  // المدير المالي (المحاسب): اعتماد المبيت والمرتجعات، متابعة الدفعات وعكسها، متابعة الإدارة، تصدير التقارير
  finance_manager: [
    'executive.view', 'receipts.view', 'payments.view', 'payments.cancel',
    'extra_costs.view', 'extra_costs.approve', 'returns.view', 'reports.export',
    'invoices.view', 'invoices.create', 'invoices.issue', 'invoices.cancel',
  ],
  // مدير الفرع: إدارة أذونات التسليم والبنود والدفعات والمرتجعات + متابعة الإدارة
  branch_manager: [
    'executive.view', 'receipts.view', 'receipts.manage',
    'extra_costs.view', 'extra_costs.create', 'extra_costs.approve', 'extra_costs.delete',
    'payments.view', 'payments.create', 'returns.view', 'returns.manage', 'reports.export',
    'invoices.view', 'invoices.create',
  ],
  // موظف العمليات: تسجيل أذونات التسليم ✓ والبنود الإضافية والمرتجعات + عرض الدفعات
  operations: [
    'receipts.view', 'receipts.manage',
    'extra_costs.view', 'extra_costs.create',
    'payments.view', 'returns.view', 'returns.manage',
    'invoices.view', 'invoices.create',
  ],
  // كاتب الأذونات: عرض أذونات التسليم والبنود والمرتجعات
  voucher_clerk: ['receipts.view', 'extra_costs.view', 'returns.view', 'invoices.view'],
  // عارض (مشاهدة فقط): كل صلاحيات العرض فقط
  viewer: [
    'executive.view', 'receipts.view', 'extra_costs.view',
    'payments.view', 'returns.view', 'invoices.view',
  ],
  // رؤية الأسعار (خاص): تصدير التقارير المالية المسوح بها
  prices_viewer: ['reports.export'],
  // المحاسب: مثل المدير المالي — اعتماد البنود ومتابعة الدفعات وعكسها
  accountant: [
    'executive.view', 'receipts.view', 'payments.view', 'payments.cancel',
    'extra_costs.view', 'extra_costs.approve', 'returns.view', 'reports.export',
    'invoices.view', 'invoices.create', 'invoices.issue', 'invoices.cancel',
  ],
  // موظف المخزن: عرض أذونات التسليم والبنود والمرتجعات
  warehouse_clerk: ['receipts.view', 'extra_costs.view', 'returns.view'],
  // موظف الشحن: تسجيل أذونات التسليم والبنود والمرتجعات + عرض الدفعات
  shipping_clerk: [
    'receipts.view', 'receipts.manage',
    'extra_costs.view', 'extra_costs.create',
    'payments.view', 'returns.view', 'returns.manage',
  ],
  // المندوب/العامل: عرض أذونات التسليم والمرتجعات
  rep: ['receipts.view', 'returns.view'],
  // المدقق (قراءة فقط): كل صلاحيات العرض + تصدير التقارير للمراجعة
  auditor: [
    'executive.view', 'receipts.view', 'extra_costs.view',
    'payments.view', 'returns.view', 'reports.view', 'reports.export',
    'invoices.view',
  ],
}

export interface PermSyncResult {
  rolesChecked: number
  rolesUpdated: string[]
  addedKeys: number
}

/**
 * مزامنة كتالوج الصلاحيات مع الأدوار الموجودة في قاعدة البيانات.
 * idempotent 100% — الاستدعاء المتكرر لا يغير شيئًا بعد أول تطبيق.
 */
export async function syncPermissionsCatalog(): Promise<PermSyncResult> {
  const roles = await db.role.findMany({ select: { id: true, name: true, label: true, permissions: true } })
  const updatedNames: string[] = []
  let addedKeys = 0

  for (const role of roles) {
    const defaults = ROLE_PERMISSION_DEFAULTS[role.name]
    if (!defaults) continue // أدوار مخصصة من الواجهة — لا تُلمس تلقائيًا

    const current = parsePerms(role.permissions)
    const set = new Set(current)
    let changed = false

    for (const key of defaults) {
      if (!set.has(key)) {
        set.add(key)
        changed = true
        addedKeys++
      }
    }

    if (changed) {
      await db.role.update({
        where: { id: role.id },
        data: { permissions: JSON.stringify(Array.from(set)) },
      })
      updatedNames.push(role.label || role.name)
      await logAudit(db, {
        action: 'update',
        entity: 'role',
        entityId: role.id,
        notes: `مزامنة كتالوج الصلاحيات — إضافة الصلاحيات الجديدة تلقائيًا للدور "${role.label || role.name}"`,
        user: { userId: 'system', username: 'permissions-sync' },
      }).catch(() => {})
    }
  }

  return { rolesChecked: roles.length, rolesUpdated: updatedNames, addedKeys }
}
