// ============================================================================
// نظام الصلاحيات — كتالوج الصلاحيات الكامل + المطابقة بالأنماط (wildcards)
// أنماط الأدوار: '*' (الكل) أو 'module.*' (كل وحدة) أو 'module.action' (صلاحية محددة)
// + خريطة توافق: الصلاحيات القديمة تمنح المفاتيح الجديدة تلقائيًا (legacy equivalence)
// ============================================================================

export interface PermissionDef {
  key: string
  label: string
  group: string
}

/** كتالوج الصلاحيات الكامل — يُستخدم في مصفوفة الصلاحيات ووحدة الأدوار */
export const PERMISSION_CATALOG: PermissionDef[] = [
  // الرئيسية
  { key: 'dashboard.view', label: 'عرض لوحة المؤشرات', group: 'الرئيسية' },
  // متابعة الإدارة — ملخص أرصدة المقاولين من دفتر الأستاذ 2102
  { key: 'executive.view', label: 'عرض لوحة متابعة الإدارة وملخص أرصدة المقاولين', group: 'متابعة الإدارة' },
  // العمليات الرئيسية — الشحنات
  { key: 'shipments.view', label: 'عرض الشحنات', group: 'العمليات الرئيسية' },
  { key: 'shipments.create', label: 'إضافة شحنة', group: 'العمليات الرئيسية' },
  { key: 'shipments.edit', label: 'تعديل شحنة', group: 'العمليات الرئيسية' },
  { key: 'shipments.delete', label: 'حذف شحنة', group: 'العمليات الرئيسية' },
  { key: 'shipments.status', label: 'تغيير حالة الشحنة', group: 'العمليات الرئيسية' },
  { key: 'shipments.assign', label: 'تعيين مقاول', group: 'العمليات الرئيسية' },
  { key: 'shipments.settle', label: 'تسوية COD', group: 'العمليات الرئيسية' },
  { key: 'shipments.print', label: 'طباعة بوليصة', group: 'العمليات الرئيسية' },
  { key: 'shipments.export', label: 'تصدير الشحنات', group: 'العمليات الرئيسية' },
  // الأطراف — العملاء والمقاولون والموردون
  { key: 'parties.view', label: 'عرض العملاء والمقاولين', group: 'الأطراف' },
  { key: 'parties.manage', label: 'إضافة/تعديل الأطراف', group: 'الأطراف' },
  { key: 'parties.delete', label: 'حذف طرف', group: 'الأطراف' },
  // أذونات التسليم (الديليفري / POD)
  { key: 'receipts.view', label: 'عرض أذونات التسليم والأذونات المتأخرة', group: 'أذونات التسليم' },
  { key: 'receipts.manage', label: 'التأشير بتسليم الإذن ✓ أو إلغاء التسليم', group: 'أذونات التسليم' },
  // الفواتير الرسمية للعملاء — فاتورة ضريبية مرتبطة بالشحنات والقيد المزدوج
  { key: 'invoices.view', label: 'عرض الفواتير وتفاصيلها وتقاريرها', group: 'الفواتير' },
  { key: 'invoices.create', label: 'إنشاء وتعديل مسودات الفواتير وتسجيل دفعات التحصيل', group: 'الفواتير' },
  { key: 'invoices.issue', label: 'إصدار الفواتير (الاعتماد والترحيل المحاسبي)', group: 'الفواتير' },
  { key: 'invoices.cancel', label: 'إلغاء الفواتير وعكس دفعات التحصيل', group: 'الفواتير' },
  // البنود الإضافية على حساب المقاولين (تعتيق/مبيت/مرتجعات)
  { key: 'extra_costs.view', label: 'عرض البنود الإضافية', group: 'البنود الإضافية' },
  { key: 'extra_costs.create', label: 'إضافة وتعديل البنود الإضافية', group: 'البنود الإضافية' },
  { key: 'extra_costs.approve', label: 'اعتماد أو رفض بنود المبيت والمرتجعات', group: 'البنود الإضافية' },
  { key: 'extra_costs.delete', label: 'حذف البنود الإضافية', group: 'البنود الإضافية' },
  // دفعات وعهد المقاولين
  { key: 'payments.view', label: 'عرض دفعات ومسحوبات المقاولين', group: 'دفعات المقاولين' },
  { key: 'payments.create', label: 'تسجيل دفعة أو عهدة لمقاول', group: 'دفعات المقاولين' },
  { key: 'payments.cancel', label: 'عكس أو إلغاء دفعة مقاول', group: 'دفعات المقاولين' },
  // المرتجعات
  { key: 'returns.view', label: 'عرض المرتجعات وحالة استلامها', group: 'المرتجعات' },
  { key: 'returns.manage', label: 'تسجيل واستلام المرتجعات', group: 'المرتجعات' },
  // الهيكل
  { key: 'structure.view', label: 'عرض الفروع والمخازن', group: 'الهيكل' },
  { key: 'structure.manage', label: 'إدارة الفروع والمخازن', group: 'الهيكل' },
  // المخزون
  { key: 'inventory.view', label: 'عرض الأصناف والأرصدة', group: 'المخزون' },
  { key: 'inventory.movements', label: 'تسجيل حركات المخزون', group: 'المخزون' },
  { key: 'inventory.freight', label: 'إدارة أسعار النولون', group: 'المخزون' },
  { key: 'inventory.manage', label: 'إدارة الأصناف', group: 'المخزون' },
  // المحاسبة — شجرة الحسابات والقيود والسندات المالية
  { key: 'accounting.view', label: 'عرض شجرة الحسابات ودفتر الأستاذ', group: 'المحاسبة' },
  { key: 'accounting.accounts.manage', label: 'إضافة/تعديل/حذف حسابات', group: 'المحاسبة' },
  { key: 'accounting.journal', label: 'القيود اليومية والترحيل والعكس', group: 'المحاسبة' },
  { key: 'accounting.vouchers', label: 'عرض الأذونات (السندات المالية)', group: 'المحاسبة' },
  { key: 'accounting.vouchers.create', label: 'تسجيل إذن قبض/صرف مالي', group: 'المحاسبة' },
  { key: 'accounting.vouchers.delete', label: 'حذف السندات المالية', group: 'المحاسبة' },
  // الأذونات التشغيلية (Vouchers) — 12 صلاحية عمل + نطاق الفرع
  { key: 'vouchers.view', label: 'عرض الأذونات التشغيلية', group: 'الأذونات التشغيلية' },
  { key: 'vouchers.view.all', label: 'عرض أذونات كل الفروع', group: 'الأذونات التشغيلية' },
  { key: 'vouchers.create', label: 'إنشاء إذن تشغيلي', group: 'الأذونات التشغيلية' },
  { key: 'vouchers.edit', label: 'تعديل إذن (في المسودة)', group: 'الأذونات التشغيلية' },
  { key: 'vouchers.delete', label: 'حذف إذن', group: 'الأذونات التشغيلية' },
  { key: 'vouchers.submit', label: 'رفع إذن للاعتماد', group: 'الأذونات التشغيلية' },
  { key: 'vouchers.approve', label: 'اعتماد إذن', group: 'الأذونات التشغيلية' },
  { key: 'vouchers.reject', label: 'رفض إذن', group: 'الأذونات التشغيلية' },
  { key: 'vouchers.execute', label: 'تنفيذ/إكمال إذن', group: 'الأذونات التشغيلية' },
  { key: 'vouchers.cancel', label: 'إلغاء إذن', group: 'الأذونات التشغيلية' },
  { key: 'vouchers.print', label: 'طباعة إذن', group: 'الأذونات التشغيلية' },
  { key: 'vouchers.export', label: 'تصدير الأذونات', group: 'الأذونات التشغيلية' },
  // رؤية الأسعار/المبالغ — يُمنح فقط لمن يحق له رؤية التكلفة/البيع/التحصيل
  { key: 'prices.view', label: 'رؤية الأسعار والمبالغ (تكلفة/بيع/تحصيل)', group: 'الأذونات التشغيلية' },
  // التقارير
  { key: 'reports.view', label: 'عرض التقارير والتقرير الشهري الموحد', group: 'التقارير' },
  { key: 'reports.export', label: 'تصدير Excel وطباعة كشوف الحساب والتقارير', group: 'التقارير' },
  // الإعدادات والنسخ الاحتياطي
  { key: 'settings.manage', label: 'إدارة إعدادات النظام والقوائم', group: 'الإعدادات والنسخ الاحتياطي' },
  { key: 'backup.export', label: 'تحميل نسخة احتياطية كاملة من قاعدة البيانات', group: 'الإعدادات والنسخ الاحتياطي' },
  // النظام
  { key: 'import.manage', label: 'استيراد البيانات', group: 'النظام' },
  { key: 'users.manage', label: 'إدارة المستخدمين', group: 'النظام' },
  { key: 'roles.manage', label: 'إدارة الصلاحيات والأدوار', group: 'النظام' },
  { key: 'audit.view', label: 'عرض سجل التدقيق', group: 'النظام' },
]

export const PERMISSION_GROUPS: string[] = Array.from(
  new Set(PERMISSION_CATALOG.map((p) => p.group)),
)

/**
 * خريطة التوافق مع الصلاحيات القديمة — المفتاح الجديد ← الأنماط القديمة التي تكافئه.
 * تضمن أن الأدوار المحفوظة بالمفاتيح القديمة (parties.extras.manage …) تظل تعمل
 * بعد إعادة توجيه الحماية على المفاتيح الجديدة، دون فقدان أي وصول قائم.
 */
export const LEGACY_PERMISSION_EQUIV: Record<string, string[]> = {
  'receipts.view': ['shipments.view'],
  'receipts.manage': ['shipments.receipts', 'shipments.edit', 'shipments.create'],
  'parties.delete': ['parties.manage'],
  'extra_costs.view': ['parties.extras.view'],
  'extra_costs.create': ['parties.extras.manage'],
  'extra_costs.delete': ['parties.extras.manage'],
  'extra_costs.approve': ['parties.extras.approve'],
  'payments.view': ['parties.extras.view'],
  'payments.create': ['vouchers.create'],
  'payments.cancel': ['vouchers.cancel'],
  'returns.view': ['parties.extras.view', 'vouchers.view'],
  'returns.manage': ['parties.extras.manage'],
  'backup.export': ['settings.manage'],
  'accounting.accounts.manage': ['accounting.journal'],
}

/** تطبيع الأنماط القديمة (shipments.read / branch.read) إلى المفاتيح الجديدة */
function normalizePattern(p: string): string {
  if (!p) return ''
  let s = String(p).trim()
  if (s === 'shipments.read') return 'shipments.view'
  if (s === 'shipments.update_status') return 'shipments.status'
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

/** هل يمتلك المستخدم (أنماط) الصلاحية المطلوبة؟ — مع توافق الصلاحيات القديمة */
export function matchPermission(patterns: string[] | null | undefined, key: string): boolean {
  if (!patterns || !patterns.length) return false
  const legacy = LEGACY_PERMISSION_EQUIV[key] ?? []
  for (const raw of patterns) {
    const p = normalizePattern(raw)
    if (p === '*') return true
    // النمط القديم "*.read" = قراءة شاملة — يمنح كل صلاحيات العرض (.view) فقط
    if (p === '*.read' && key.endsWith('.view')) return true
    if (p.endsWith('.*') && key.startsWith(p.slice(0, -1))) return true
    if (p === key) return true
    if (legacy.includes(p)) return true
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
