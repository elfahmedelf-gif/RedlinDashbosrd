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

/**
 * كتالوج الصلاحيات الكامل — مجموعة لكل موديول في الشريط الجانبي (1:1 بلا استثناء)
 * الترتيب مطابق تمامًا لترتيب موديولات sidebar.tsx (MODULES) — 25 موديول.
 * يُستخدم في مصفوفة الصلاحيات ووحدة الأدوار ويُمَرسَل لقاعدة البيانات عبر
 * syncPermissionsCatalog() (جدول Permission) عند الإقلاع وعند فتح شاشة الصلاحيات.
 */
export const PERMISSION_CATALOG: PermissionDef[] = [
  // 1) الرئيسية (overview)
  { key: 'dashboard.view', label: 'عرض لوحة المؤشرات', group: 'الرئيسية' },
  // 2) متابعة الإدارة (executive)
  { key: 'executive.view', label: 'عرض لوحة متابعة الإدارة وملخص أرصدة المقاولين', group: 'متابعة الإدارة' },
  // 3) الشحنات (shipments)
  { key: 'shipments.view', label: 'عرض الشحنات', group: 'الشحنات' },
  { key: 'shipments.create', label: 'إضافة شحنة', group: 'الشحنات' },
  { key: 'shipments.edit', label: 'تعديل شحنة', group: 'الشحنات' },
  { key: 'shipments.delete', label: 'حذف شحنة', group: 'الشحنات' },
  { key: 'shipments.status', label: 'تغيير حالة الشحنة', group: 'الشحنات' },
  { key: 'shipments.assign', label: 'تعيين مقاول', group: 'الشحنات' },
  { key: 'shipments.settle', label: 'تسوية COD', group: 'الشحنات' },
  { key: 'shipments.print', label: 'طباعة بوليصة', group: 'الشحنات' },
  { key: 'shipments.export', label: 'تصدير الشحنات', group: 'الشحنات' },
  { key: 'shipments.extras.view', label: 'رؤية بنود النقلة الإضافية (تعتيق/مبيت/تحويلة/دروب) — دون الأسعار', group: 'الشحنات' },
  // 3ب) أعمدة جدول الشحنات — صلاحيات مستقلة لكل عمود (إظهار/إخفاء لكل دور)
  // ملاحظة مهمة: المفاتيح تحت البادئة `shipcols.` (وليس `shipments.`) عمدًا —
  // حتى لا يمنحها نمط `shipments.*` الشامل ضمنيًا (فعرض الأسعار يُتحكم فيه صراحةً فقط).
  // المدير (admin عبر '*') يرى الكل. الأدوار الأخرى تُمنح الأعمدة المناسبة عبر
  // الهجرة (perms.cols.v2) ثم يتحكم المدير في كل عمود صراحةً من المصفوفة.
  // صلاحية العمود لوحدها كافية لإظهار العمود وقيمه في جدول الشحنات
  // (الخادم يمرّر القيمة إذا وُجدت صلاحية العمود أو صلاحية الفئة الأوسع).
  { key: 'shipcols.shipmentNo', label: 'عمود: رقم الشحنة', group: 'أعمدة جدول الشحنات' },
  { key: 'shipcols.customer', label: 'عمود: العميل / المستلم', group: 'أعمدة جدول الشحنات' },
  { key: 'shipcols.destination', label: 'عمود: الجهة', group: 'أعمدة جدول الشحنات' },
  { key: 'shipcols.pieces', label: 'عمود: القطع (كام قطعة)', group: 'أعمدة جدول الشحنات' },
  { key: 'shipcols.loadType', label: 'عمود: أدوات التحميل', group: 'أعمدة جدول الشحنات' },
  { key: 'shipcols.contractor', label: 'عمود: المقاول', group: 'أعمدة جدول الشحنات' },
  { key: 'shipcols.date', label: 'عمود: التاريخ', group: 'أعمدة جدول الشحنات' },
  { key: 'shipcols.status', label: 'عمود: الحالة', group: 'أعمدة جدول الشحنات' },
  { key: 'shipcols.aging', label: 'عمود: التعتيق', group: 'أعمدة جدول الشحنات' },
  { key: 'shipcols.overnight', label: 'عمود: المبيت', group: 'أعمدة جدول الشحنات' },
  { key: 'shipcols.transfer', label: 'عمود: التحويلة', group: 'أعمدة جدول الشحنات' },
  { key: 'shipcols.drop', label: 'عمود: الدروب', group: 'أعمدة جدول الشحنات' },
  { key: 'shipcols.freight', label: 'عمود: نولون العميل', group: 'أعمدة جدول الشحنات' },
  { key: 'shipcols.suppliers', label: 'عمود: نولون المقاول', group: 'أعمدة جدول الشحنات' },
  { key: 'shipcols.margin', label: 'عمود: هامش الربح', group: 'أعمدة جدول الشحنات' },
  { key: 'shipcols.grand', label: 'عمود: الإجمالي النقلة', group: 'أعمدة جدول الشحنات' },
  { key: 'shipcols.actions', label: 'عمود: إجراءات', group: 'أعمدة جدول الشحنات' },
  // 4) أذونات التسليم (receipts) — الديليفري / POD
  { key: 'receipts.view', label: 'عرض أذونات التسليم والأذونات المتأخرة', group: 'أذونات التسليم' },
  { key: 'receipts.manage', label: 'التأشير بتسليم الإذن ✓ أو إلغاء التسليم', group: 'أذونات التسليم' },
  { key: 'receipts.print', label: 'طباعة أذونات التسليم', group: 'أذونات التسليم' },
  // 5) الفواتير الرسمية للعملاء (invoices) — فاتورة ضريبية مرتبطة بالشحنات والقيد المزدوج
  { key: 'invoices.view', label: 'عرض الفواتير وتفاصيلها وتقاريرها', group: 'الفواتير' },
  { key: 'invoices.create', label: 'إنشاء وتعديل مسودات الفواتير وتسجيل دفعات التحصيل', group: 'الفواتير' },
  { key: 'invoices.issue', label: 'إصدار الفواتير (الاعتماد والترحيل المحاسبي)', group: 'الفواتير' },
  { key: 'invoices.cancel', label: 'إلغاء الفواتير وعكس دفعات التحصيل', group: 'الفواتير' },
  { key: 'invoices.print', label: 'طباعة الفاتورة الضريبية A4', group: 'الفواتير' },
  { key: 'invoices.export', label: 'تصدير الفواتير Excel', group: 'الفواتير' },
  // 6) البنود الإضافية على حساب المقاولين (extra-costs) — تعتيق/مبيت/مرتجعات + دفعات وعهد المقاولين
  { key: 'extra_costs.view', label: 'عرض البنود الإضافية', group: 'البنود الإضافية' },
  { key: 'extra_costs.create', label: 'إضافة وتعديل البنود الإضافية', group: 'البنود الإضافية' },
  { key: 'extra_costs.approve', label: 'اعتماد أو رفض بنود المبيت والمرتجعات', group: 'البنود الإضافية' },
  { key: 'extra_costs.delete', label: 'حذف البنود الإضافية', group: 'البنود الإضافية' },
  { key: 'payments.view', label: 'عرض دفعات وعهد المقاولين', group: 'البنود الإضافية' },
  { key: 'payments.create', label: 'تسجيل دفعة/عهدة لمقاول (نقدي أو بنكي)', group: 'البنود الإضافية' },
  { key: 'payments.cancel', label: 'إرجاع/عكس دفعة مسجلة للمقاول', group: 'البنود الإضافية' },
  // 7) المرتجعات لم تُستلم (pending-returns)
  { key: 'returns.view', label: 'عرض المرتجعات وحالة استلامها', group: 'المرتجعات' },
  { key: 'returns.manage', label: 'تسجيل واستلام المرتجعات', group: 'المرتجعات' },
  // 8) العملاء (customers)
  { key: 'customers.view', label: 'عرض ملفات العملاء وكشوف حساباتهم', group: 'العملاء' },
  { key: 'customers.manage', label: 'إضافة/تعديل عميل', group: 'العملاء' },
  { key: 'customers.delete', label: 'حذف عميل', group: 'العملاء' },
  // 9) المقاولون (contractors) — الناقلون
  { key: 'contractors.view', label: 'عرض ملفات المقاولين وكشوف حساباتهم', group: 'المقاولون' },
  { key: 'contractors.manage', label: 'إضافة/تعديل مقاول', group: 'المقاولون' },
  { key: 'contractors.delete', label: 'حذف مقاول', group: 'المقاولون' },
  // 10) الموردون (suppliers)
  { key: 'suppliers.view', label: 'عرض ملفات الموردين وكشوف حساباتهم', group: 'الموردون' },
  { key: 'suppliers.manage', label: 'إضافة/تعديل مورد', group: 'الموردون' },
  { key: 'suppliers.delete', label: 'حذف مورد', group: 'الموردون' },
  // 11) الفروع (branches)
  { key: 'branches.view', label: 'عرض الفروع', group: 'الفروع' },
  { key: 'branches.manage', label: 'إضافة/تعديل/حذف فرع', group: 'الفروع' },
  // 12) المخازن (warehouses)
  { key: 'warehouses.view', label: 'عرض المخازن', group: 'المخازن' },
  { key: 'warehouses.manage', label: 'إضافة/تعديل/حذف مخزن', group: 'المخازن' },
  // 13) المخزون — الأصناف (inventory)
  { key: 'inventory.view', label: 'عرض الأصناف والأرصدة', group: 'المخزون' },
  { key: 'inventory.manage', label: 'إدارة الأصناف', group: 'المخزون' },
  // 14) حركة المخزون (movements)
  { key: 'inventory.movements', label: 'تسجيل حركات المخزون', group: 'حركة المخزون' },
  // 15) أسعار النولون (freight)
  { key: 'inventory.freight', label: 'إدارة أسعار النولون', group: 'أسعار النولون' },
  // 16) شجرة الحسابات (accounts)
  { key: 'accounting.view', label: 'عرض شجرة الحسابات ودفتر الأستاذ', group: 'شجرة الحسابات' },
  { key: 'accounting.accounts.manage', label: 'إضافة/تعديل/حذف حسابات', group: 'شجرة الحسابات' },
  // 17) القيود اليومية (journal) — القيد المزدوج
  { key: 'accounting.journal', label: 'القيود اليومية والترحيل والعكس', group: 'القيود اليومية' },
  // 18) الأذونات التشغيلية (vouchers) — 12 صلاحية عمل + نطاق الفرع + رؤية الأسعار
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
  { key: 'prices.view', label: 'رؤية الأسعار والمبالغ (تكلفة/بيع/تحصيل)', group: 'الأذونات التشغيلية' },
  // 19) التقارير (reports)
  { key: 'reports.view', label: 'عرض التقارير والتقرير الشهري الموحد', group: 'التقارير' },
  { key: 'reports.export', label: 'تصدير Excel وطباعة كشوف الحساب والتقارير', group: 'التقارير' },
  // 20) استيراد البيانات (import)
  { key: 'import.manage', label: 'استيراد البيانات (معاينة وتنفيذ)', group: 'استيراد البيانات' },
  // 21) المستخدمون (users)
  { key: 'users.manage', label: 'إدارة المستخدمين', group: 'المستخدمون' },
  // 22) الصلاحيات والأدوار (roles)
  { key: 'roles.manage', label: 'إدارة الصلاحيات والأدوار', group: 'الصلاحيات والأدوار' },
  // 23) القوائم المنسدلة (lookups)
  { key: 'lookups.manage', label: 'إدارة قوائم النظام المنسدلة', group: 'القوائم المنسدلة' },
  // 24) الإعدادات (settings) + النسخ الاحتياطي
  { key: 'settings.manage', label: 'إدارة إعدادات النظام', group: 'الإعدادات' },
  { key: 'backup.export', label: 'تحميل نسخة احتياطية كاملة من قاعدة البيانات', group: 'الإعدادات' },
  // 25) سجل التدقيق (audit)
  { key: 'audit.view', label: 'عرض سجل التدقيق', group: 'سجل التدقيق' },
]

export const PERMISSION_GROUPS: string[] = Array.from(
  new Set(PERMISSION_CATALOG.map((p) => p.group)),
)

/** مفتاح موديول الشريط الجانبي لكل مجموعة صلاحيات — لربط 1:1 مع MODULES في sidebar */
export const GROUP_MODULE_KEY: Record<string, string> = {
  'الرئيسية': 'overview',
  'متابعة الإدارة': 'executive',
  'الشحنات': 'shipments',
  'أعمدة جدول الشحنات': 'shipments',
  'أذونات التسليم': 'receipts',
  'الفواتير': 'invoices',
  'البنود الإضافية': 'extra-costs',
  'المرتجعات': 'pending-returns',
  'العملاء': 'customers',
  'المقاولون': 'contractors',
  'الموردون': 'suppliers',
  'الفروع': 'branches',
  'المخازن': 'warehouses',
  'المخزون': 'inventory',
  'حركة المخزون': 'movements',
  'أسعار النولون': 'freight',
  'شجرة الحسابات': 'accounts',
  'القيود اليومية': 'journal',
  'الأذونات التشغيلية': 'vouchers',
  'التقارير': 'reports',
  'استيراد البيانات': 'import',
  'المستخدمون': 'users',
  'الصلاحيات والأدوار': 'roles',
  'القوائم المنسدلة': 'lookups',
  'الإعدادات': 'settings',
  'سجل التدقيق': 'audit',
}

/**
 * خريطة التوافق مع الصلاحيات القديمة — المفتاح الجديد ← الأنماط القديمة التي تكافئه.
 * تضمن أن الأدوار المحفوظة بالمفاتيح القديمة (parties.view / structure.manage …) تظل
 * تعمل بعد إعادة توجيه الحماية على المفاتيح الجديدة، دون فقدان أي وصول قائم.
 */
export const LEGACY_PERMISSION_EQUIV: Record<string, string[]> = {
  'receipts.view': ['shipments.view'],
  'receipts.manage': ['shipments.receipts', 'shipments.edit', 'shipments.create'],
  'receipts.print': ['shipments.print', 'shipments.view'],
  'customers.view': ['parties.view', 'parties.*'],
  'customers.manage': ['parties.manage', 'parties.*'],
  'customers.delete': ['parties.delete', 'parties.manage', 'parties.*'],
  'contractors.view': ['parties.view', 'parties.*'],
  'contractors.manage': ['parties.manage', 'parties.*'],
  'contractors.delete': ['parties.delete', 'parties.manage', 'parties.*'],
  'suppliers.view': ['parties.view', 'parties.*'],
  'suppliers.manage': ['parties.manage', 'parties.*'],
  'suppliers.delete': ['parties.delete', 'parties.manage', 'parties.*'],
  'branches.view': ['structure.view', 'structure.*'],
  'branches.manage': ['structure.manage', 'structure.*'],
  'warehouses.view': ['structure.view', 'structure.*'],
  'warehouses.manage': ['structure.manage', 'structure.*'],
  'extra_costs.view': ['parties.extras.view'],
  'shipments.extras.view': ['extra_costs.view'],
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
  'accounting.vouchers': ['vouchers.view'],
  'accounting.vouchers.create': ['vouchers.create'],
  'accounting.vouchers.delete': ['vouchers.delete'],
  'invoices.print': ['invoices.view'],
  'invoices.export': ['invoices.view'],
  'lookups.manage': ['settings.manage'],
  'import.manage': ['settings.manage'],
  'users.manage': ['settings.manage'],
  'roles.manage': ['settings.manage'],
  'audit.view': ['settings.manage'],
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

// ----------------------------------------------------------------------------
// الأطراف: مفاتيح الصلاحية لكل نوع طرف (عميل / مقاول / مورد) —
// الطرف الواحد قد يجمع أكثر من صفة، لذا تُعاد قوائم المفاتيح المحتملة
// ويُكفي تحقق أيٍّ منها (any-of) عبر requireAnyPerm في الخادم.
// ----------------------------------------------------------------------------
export interface PartyFlags {
  isCustomer?: boolean | null
  isContractor?: boolean | null
  isSupplier?: boolean | null
}

/** مفاتيح العرض المحتملة لطرف بحسب صفاته */
export function partyViewKeys(p: PartyFlags): string[] {
  const keys: string[] = []
  if (p.isContractor) keys.push('contractors.view')
  if (p.isSupplier) keys.push('suppliers.view')
  if (p.isCustomer || !keys.length) keys.push('customers.view')
  return keys
}

/** مفاتيح الإضافة/التعديل المحتملة لطرف بحسب صفاته المطلوبة */
export function partyManageKeys(p: PartyFlags): string[] {
  const keys: string[] = []
  if (p.isContractor) keys.push('contractors.manage')
  if (p.isSupplier) keys.push('suppliers.manage')
  if (p.isCustomer || !keys.length) keys.push('customers.manage')
  return keys
}

/** مفاتيح الحذف المحتملة لطرف بحسب صفاته */
export function partyDeleteKeys(p: PartyFlags): string[] {
  const keys: string[] = []
  if (p.isContractor) keys.push('contractors.delete')
  if (p.isSupplier) keys.push('suppliers.delete')
  if (p.isCustomer || !keys.length) keys.push('customers.delete')
  return keys
}

/** مفتاح العرض لكل نوع مطلوب في قائمة الأطراف (?type=customer|contractor|supplier) */
export function partyTypeViewKey(type: string | null | undefined): string[] {
  switch (type) {
    case 'customer': return ['customers.view']
    case 'contractor': return ['contractors.view']
    case 'supplier': return ['suppliers.view']
    default: return ['customers.view', 'contractors.view', 'suppliers.view']
  }
}

/** مفتاح الإدارة لكل نوع مطلوب عند إنشاء طرف جديد */
export function partyTypeManageKeys(type: string | null | undefined, flags?: PartyFlags): string[] {
  if (flags && (flags.isCustomer || flags.isContractor || flags.isSupplier)) return partyManageKeys(flags)
  switch (type) {
    case 'customer': return ['customers.manage']
    case 'contractor': return ['contractors.manage']
    case 'supplier': return ['suppliers.manage']
    default: return ['customers.manage', 'contractors.manage', 'suppliers.manage']
  }
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
