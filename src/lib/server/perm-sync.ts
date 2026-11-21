// ============================================================================
// مزامنة كتالوج الصلاحيات مع قاعدة البيانات الحية (idempotent 100%)
// تُستدعى عند إقلاع الخادم (ensureSeeded) وعند فتح شاشة الصلاحيات (/api/roles GET):
//   1) جدول Permission: upsert لكل صلاحية في الكتالوج (66 صلاحية × 25 موديول 1:1 مع الشريط)
//      — يضيف الجديد ويحدّث التسميات ولا يمسح الصلاحيات المرجعية القديمة (مرجع تدقيقي).
//   2) الأدوار المعروفة: تُمنح إضافاتها الافتراضية فوق صلاحياتها الحالية (لا تُطرح أبدًا).
//   3) دور admin: يُمنح 100% من الصلاحيات عبر النمط الشامل '*'.
//   4) هجرة أحادية المرة (cols.v1): تمنح كل دور أعمدة جدول الشحنات المناسبة
//      بناءً على صلاحيات الفئة (shipments.view / shipments.extras.view / prices.view)
//      — حتى لا تنكسر الواجهة الحالية للأدوار القائمة. تُشغَّل مرة واحدة فقط
//      (محمية بعلم Setting `perms.cols.v1`)؛ بعدها يتحكم المدير صراحةً في كل عمود.
// ============================================================================
import { db } from '@/lib/db'
import { parsePerms } from './passwords'
import { logAudit } from './audit'
import { PERMISSION_CATALOG, GROUP_MODULE_KEY, matchPermission } from '@/lib/permissions'

/** مفاتيح أعمدة جدول الشحنات (النطاق الجديد shipcols.*) — تُستخدم في الهجرة */
export const SHIPMENTS_COL_KEYS_BASELINE = [
  'shipcols.shipmentNo',
  'shipcols.customer',
  'shipcols.destination',
  'shipcols.pieces',
  'shipcols.loadType',
  'shipcols.contractor',
  'shipcols.date',
  'shipcols.status',
  'shipcols.actions',
] as const

export const SHIPMENTS_COL_KEYS_EXTRAS = [
  'shipcols.aging',
  'shipcols.overnight',
  'shipcols.transfer',
  'shipcols.drop',
] as const

export const SHIPMENTS_COL_KEYS_PRICES = [
  'shipcols.freight',
  'shipcols.suppliers',
  'shipcols.margin',
  'shipcols.grand',
] as const

/**
 * خريطة إعادة التسمية من النطاق القديم (shipments.cols.*) إلى الجديد (shipcols.*).
 * السبب: النطاق القديم كان يقع تحت نمط `shipments.*` الشامل — أي دور يملك
 * `shipments.*` كان سيحصل على كل أعمدة الأسعار ضمنيًا دون تصريح صريح،
 * وهذا يكسر سياسة «نولون العميل لمن يُصرَّح له فقط». النطاق الجديد معزول.
 */
export const SHIPMENTS_COL_RENAME: Record<string, string> = Object.fromEntries([
  ...SHIPMENTS_COL_KEYS_BASELINE,
  ...SHIPMENTS_COL_KEYS_EXTRAS,
  ...SHIPMENTS_COL_KEYS_PRICES,
].map((k) => [`shipments.cols.${k.replace('shipcols.', '')}`, k]))

/**
 * الإضافات الافتراضية لكل دور معروف — تُضاف فوق صلاحياته الحالية (لا تُطرح أبدًا).
 * المفتاح = اسم الدور في قاعدة البيانات.
 */
export const ROLE_PERMISSION_DEFAULTS: Record<string, string[]> = {
  // المالك — كل الصلاحيات عبر النمط الشامل (100% من الكتالوج)
  admin: ['*'],
  // المدير المالي (المحاسب): اعتماد المبيت والمرتجعات، متابعة الدفعات وعكسها، متابعة الإدارة، تصدير التقارير
  finance_manager: [
    'executive.view', 'receipts.view', 'receipts.print', 'payments.view', 'payments.cancel',
    'extra_costs.view', 'extra_costs.approve', 'returns.view', 'reports.export',
    'customers.view', 'invoices.view', 'invoices.create', 'invoices.issue', 'invoices.cancel',
    'invoices.print', 'invoices.export',
  ],
  // مدير الفرع: إدارة الأطراف وأذونات التسليم والبنود والدفعات والمرتجعات + متابعة الإدارة
  branch_manager: [
    'executive.view', 'receipts.view', 'receipts.manage', 'receipts.print',
    'customers.view', 'customers.manage', 'contractors.view', 'contractors.manage',
    'suppliers.view', 'suppliers.manage', 'branches.view', 'warehouses.view',
    'extra_costs.view', 'extra_costs.create', 'extra_costs.approve', 'extra_costs.delete',
    'payments.view', 'payments.create', 'returns.view', 'returns.manage', 'reports.export',
    'invoices.view', 'invoices.create', 'invoices.print', 'invoices.export',
  ],
  // موظف العمليات: تسجيل أذونات التسليم ✓ والبنود الإضافية والمرتجعات + عرض الدفعات
  operations: [
    'receipts.view', 'receipts.manage', 'receipts.print',
    'customers.view', 'customers.manage', 'contractors.view',
    'extra_costs.view', 'extra_costs.create',
    'payments.view', 'returns.view', 'returns.manage',
    'invoices.view', 'invoices.create', 'invoices.print', 'invoices.export',
  ],
  // كاتب الأذونات: عرض أذونات التسليم والبنود والمرتجعات والهيكل
  voucher_clerk: [
    'receipts.view', 'extra_costs.view', 'returns.view', 'invoices.view',
    'customers.view', 'contractors.view', 'branches.view', 'warehouses.view',
  ],
  // عارض (مشاهدة فقط): كل صلاحيات العرض فقط — بلا أي إضافة/تعديل/حذف
  viewer: [
    'dashboard.view', 'executive.view', 'shipments.view',
    'receipts.view', 'extra_costs.view', 'payments.view', 'returns.view',
    'customers.view', 'contractors.view', 'suppliers.view',
    'branches.view', 'warehouses.view', 'inventory.view',
    'accounting.view', 'vouchers.view', 'reports.view', 'audit.view',
    'invoices.view', 'invoices.print',
  ],
  // رؤية الأسعار (خاص): تصدير التقارير المالية المسوح بها
  prices_viewer: ['reports.export'],
  // المحاسب: مثل المدير المالي — اعتماد البنود ومتابعة الدفعات وعكسها
  accountant: [
    'executive.view', 'receipts.view', 'receipts.print', 'payments.view', 'payments.cancel',
    'extra_costs.view', 'extra_costs.approve', 'returns.view', 'reports.export',
    'customers.view', 'invoices.view', 'invoices.create', 'invoices.issue', 'invoices.cancel',
    'invoices.print', 'invoices.export',
  ],
  // موظف المخزن: عرض أذونات التسليم والبنود والمرتجعات والأطراف
  warehouse_clerk: ['receipts.view', 'extra_costs.view', 'returns.view', 'customers.view', 'contractors.view'],
  // موظف الشحن: تسجيل أذونات التسليم والبنود والمرتجعات + عرض الدفعات والأطراف
  shipping_clerk: [
    'receipts.view', 'receipts.manage', 'receipts.print',
    'customers.view', 'customers.manage', 'contractors.view',
    'extra_costs.view', 'extra_costs.create',
    'payments.view', 'returns.view', 'returns.manage',
  ],
  // المندوب/العامل: عرض أذونات التسليم والمرتجعات
  rep: ['receipts.view', 'returns.view'],
  // المدقق (قراءة فقط): كل صلاحيات العرض + تصدير التقارير للمراجعة
  auditor: [
    'executive.view', 'receipts.view', 'extra_costs.view',
    'customers.view', 'contractors.view', 'suppliers.view',
    'payments.view', 'returns.view', 'reports.view', 'reports.export',
    'invoices.view', 'invoices.print', 'invoices.export',
  ],
}

export interface PermSyncResult {
  rolesChecked: number
  rolesUpdated: string[]
  addedKeys: number
  permissionsSynced: number
  colsMigrated: boolean
}

/**
 * مزامنة كتالوج الصلاحيات مع قاعدة البيانات والأدوار الموجودة.
 * idempotent 100% — الاستدعاء المتكرر لا يغير شيئًا بعد أول تطبيق.
 */
export async function syncPermissionsCatalog(): Promise<PermSyncResult> {
  // 1) جدول Permission — مرآة الكتالوج الكامل (66 صلاحية × 25 موديول)
  let permissionsSynced = 0
  for (const def of PERMISSION_CATALOG) {
    const data = { label: def.label, group: def.group, module: GROUP_MODULE_KEY[def.group] ?? null }
    const existing = await db.permission.findUnique({ where: { key: def.key } })
    if (!existing) {
      await db.permission.create({ data: { key: def.key, ...data } })
      permissionsSynced++
    } else if (existing.label !== def.label || existing.group !== def.group || (existing.module ?? null) !== data.module) {
      await db.permission.update({ where: { key: def.key }, data })
      permissionsSynced++
    }
  }

  // 2) الأدوار — الإضافات الافتراضية فوق صلاحياتها الحالية
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

  // 3) هجرة v2 لأعمدة جدول الشحنات — تجري بعد تطبيق الإضافات الافتراضية
  //    حتى تستقر صلاحيات الفئة (shipments.view / extras.view / prices.view) للأدوار المعروفة
  //    (تعيد قراءة الأدوار من DB لالتقاط صلاحيات الفئة المُضافة للتو)
  const colsMigration = await migrateShipmentColumnsOnce()
  if (colsMigration.migrated) {
    updatedNames.push(...colsMigration.rolesUpdated)
    addedKeys += colsMigration.addedKeys
  }

  return { rolesChecked: roles.length, rolesUpdated: updatedNames, addedKeys, permissionsSynced, colsMigrated: colsMigration.migrated }
}

/**
 * هجرة v2 لأعمدة جدول الشحنات — تُشغَّل مرة واحدة فقط (علم Setting `perms.cols.v2`):
 *   (أ) إعادة تسمية المفاتيح القديمة `shipments.cols.*` → `shipcols.*` مع الحفاظ 1:1
 *       على ما منحه المدير يدويًا (لا يُفقد ولا يُعاد إضافته ما حُذف عمدًا).
 *   (ب) للأدوار التي لا تملك أي مفاتيح أعمدة (قواعد بيانات جديدة أو أدوار جديدة
 *       لم تُلمس الهجرة): تُمنح الأعمدة المناسبة بناءً على صلاحيات الفئة —
 *       shipments.view ← الأساسية، shipments.extras.view ← البنود الإضافية، prices.view ← المبالغ.
 *
 * بعد ضبط العلم لا تُعاد الهجرة أبدًا — التحكم في الأعمدة يصبح صريحًا بيد المدير بالكامل.
 */
async function migrateShipmentColumnsOnce(): Promise<{ migrated: boolean; rolesUpdated: string[]; addedKeys: number }> {
  // علم الهجرة — يمنع إعادة التشغيل
  const flag = await db.setting.findUnique({ where: { key: 'perms.cols.v2' } }).catch(() => null)
  if (flag) return { migrated: false, rolesUpdated: [], addedKeys: 0 }

  // إعادة قراءة الأدوار من DB لالتقاط أي صلاحيات فئة أُضيفت للتو في مرحلة الإضافات الافتراضية
  const roles = await db.role.findMany({ select: { id: true, name: true, label: true, permissions: true } })

  const rolesUpdated: string[] = []
  let addedKeys = 0
  let anyChange = false

  for (const role of roles) {
    // admin لا يُلمس — صلاحياته الشاملة '*' تغطي كل الأعمدة تلقائيًا
    if (role.name === 'admin') continue

    const current = parsePerms(role.permissions)
    const set = new Set(current)
    let changed = false

    // (أ) إعادة تسمية المفاتيح القديمة إلى النطاق المعزول الجديد
    for (const [oldKey, newKey] of Object.entries(SHIPMENTS_COL_RENAME)) {
      if (set.has(oldKey)) {
        set.delete(oldKey)
        set.add(newKey)
        changed = true
      }
    }

    // (ب) للأدوار بلا أي أعمدة — منح أولي بحسب صلاحيات الفئة
    const hasAnyCol = Object.values(SHIPMENTS_COL_RENAME).some((k) => set.has(k))
    if (!hasAnyCol) {
      const permsNow = Array.from(set)
      const grant = (keys: readonly string[]) => {
        for (const k of keys) {
          if (!set.has(k)) {
            set.add(k)
            changed = true
            addedKeys++
          }
        }
      }
      if (matchPermission(permsNow, 'shipments.view')) grant(SHIPMENTS_COL_KEYS_BASELINE)
      if (matchPermission(permsNow, 'shipments.extras.view')) grant(SHIPMENTS_COL_KEYS_EXTRAS)
      if (matchPermission(permsNow, 'prices.view')) grant(SHIPMENTS_COL_KEYS_PRICES)
    }

    if (changed) {
      anyChange = true
      await db.role.update({
        where: { id: role.id },
        data: { permissions: JSON.stringify(Array.from(set)) },
      })
      rolesUpdated.push(role.label || role.name)
      await logAudit(db, {
        action: 'update',
        entity: 'role',
        entityId: role.id,
        notes: `هجرة أعمدة جدول الشحنات v2 — نقل مفاتيح الأعمدة إلى النطاق المعزول shipcols.* للدور "${role.label || role.name}"`,
        user: { userId: 'system', username: 'permissions-cols-migrate' },
      }).catch(() => {})
    }
  }

  // ضبط علم الهجرة دائمًا (حتى لو لم يحدث تغيير — يثبت أن الهجرة جرت)
  await db.setting.upsert({
    where: { key: 'perms.cols.v2' },
    update: { value: 'done' },
    create: { key: 'perms.cols.v2', value: 'done', label: 'هجرة أعمدة جدول الشحنات v2 (نطاق shipcols)', category: 'permissions' },
  }).catch(() => {})

  return { migrated: anyChange, rolesUpdated, addedKeys }
}
