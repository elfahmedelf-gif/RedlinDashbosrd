// Comprehensive seed script
// Run: bun run scripts/seed.ts
import { db } from '../src/lib/db'
import fs from 'fs'
import path from 'path'

function num(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return isFinite(n) ? n : null
}
function str(v: any): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
function safeDate(v: any): Date | null {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

async function main() {
  const dataPath = path.join(__dirname, '..', 'seed-data.json')
  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))

  // 1. Settings defaults
  console.log('Seeding settings...')
  const settings = [
    { key: 'currency', value: 'EGP', label: 'العملة', category: 'general' },
    { key: 'currency_symbol', value: 'ج.م', label: 'رمز العملة', category: 'general' },
    { key: 'inventory_valuation', value: 'weighted_average', label: 'طريقة تقييم المخزون', category: 'inventory' },
    { key: 'col_date1_label', value: 'تاريخ الشحن', label: 'معنى عمود Date', category: 'import' },
    { key: 'col_date2_label', value: 'تاريخ التسليم المتوقع', label: 'معنى عمود Date 2', category: 'import' },
    { key: 'col_customer_pay_label', value: 'تحصيل العميل', label: 'معنى عمود العميل', category: 'import' },
    { key: 'col_total_suppliers_label', value: 'إجمالي تكاليف الموردين/المقاولين', label: 'معنى عمود اجمالى الموردين', category: 'import' },
    { key: 'col_freight_label', value: 'النولون (تكلفة الوحدة)', label: 'معنى عمود النولون', category: 'import' },
    { key: 'col_freight_total_label', value: 'إجمالي النولون', label: 'معنى عمود اجمالى النولون', category: 'import' },
    { key: 'col_m1_label', value: 'كود 1 (غير محدد المعنى)', label: 'معنى عمود م 1', category: 'import' },
    { key: 'col_m2_label', value: 'كود 2 (غير محدد المعنى)', label: 'معنى عمود م 2', category: 'import' },
    { key: 'col_x_label', value: 'حقل x (غير محدد المعنى)', label: 'معنى عمود x', category: 'import' },
    { key: 'col_s_label', value: 'حقل s (غير محدد المعنى)', label: 'معنى عمود s', category: 'import' },
    { key: 'col_card_label', value: 'الكارتة (غير محدد المعنى)', label: 'معنى عمود الكارتة', category: 'import' },
    { key: 'col_drop_label', value: 'عدد نقاط Drop الإضافية', label: 'معنى عمود Drop', category: 'import' },
    { key: 'col_worker_label', value: 'العامل/المندوب', label: 'معنى عمود Worker', category: 'import' },
    { key: 'auto_post_shipments', value: 'false', label: 'ترحيل قيود الشحن تلقائيًا', category: 'accounting' },
    { key: 'company_name', value: 'شركة النقل والشحن', label: 'اسم الشركة', category: 'general' },
  ]
  for (const s of settings) {
    await db.setting.create({ data: s })
  }

  // 2. Roles
  console.log('Seeding roles...')
  const roleDefs = [
    { name: 'admin', label: 'مدير النظام', permissions: JSON.stringify(['*']) },
    { name: 'finance_manager', label: 'مدير مالي', permissions: JSON.stringify(['accounting.*', 'reports.*', 'shipments.read', 'parties.*']) },
    { name: 'branch_manager', label: 'مدير فرع', permissions: JSON.stringify(['shipments.*', 'parties.*', 'inventory.*', 'branch.read']) },
    { name: 'warehouse_clerk', label: 'موظف مخزن', permissions: JSON.stringify(['inventory.*', 'shipments.read']) },
    { name: 'shipping_clerk', label: 'موظف شحن', permissions: JSON.stringify(['shipments.*', 'parties.read']) },
    { name: 'accountant', label: 'محاسب', permissions: JSON.stringify(['accounting.*', 'reports.read']) },
    { name: 'rep', label: 'مندوب/عامل', permissions: JSON.stringify(['shipments.read', 'shipments.update_status']) },
    { name: 'auditor', label: 'مدقق (قراءة فقط)', permissions: JSON.stringify(['*.read']) },
  ]
  for (const r of roleDefs) {
    await db.role.create({ data: r })
  }

  // 3. Default Branch + Warehouse
  console.log('Seeding branch + warehouse...')
  const branch = await db.branch.create({
    data: { code: 'BR-01', name: 'الفرع الرئيسي', nameEn: 'Main Branch', manager: 'المدير العام', region: 'القاهرة', balance: 0 },
  })
  const warehouse = await db.warehouse.create({
    data: { code: 'WH-01', name: 'المخزن الرئيسي', branchId: branch.id, manager: 'أمين المخزن', balance: 0 },
  })

  // 4. Chart of Accounts (standard skeleton)
  console.log('Seeding chart of accounts...')
  const accountsDef = [
    // assets
    { code: '1', name: 'الأصول', type: 'asset', isDetail: false },
    { code: '11', name: 'الأصول المتداولة', type: 'asset', isDetail: false, parent: '1' },
    { code: '1101', name: 'الصندوق', type: 'asset' },
    { code: '1102', name: 'البنوك', type: 'asset' },
    { code: '1103', name: 'العملاء (مدينون)', type: 'asset' },
    { code: '1104', name: 'المخزون', type: 'asset' },
    { code: '12', name: 'الأصول الثابتة', type: 'asset', isDetail: false, parent: '1' },
    { code: '1201', name: 'سيارات ومركبات', type: 'asset' },
    // liabilities
    { code: '2', name: 'الخصوم', type: 'liability', isDetail: false },
    { code: '21', name: 'الخصوم المتداولة', type: 'liability', isDetail: false, parent: '2' },
    { code: '2101', name: 'الموردون (دائنون)', type: 'liability' },
    { code: '2102', name: 'مقاولو النقل', type: 'liability' },
    { code: '2103', name: 'ضريبة القيمة المضافة', type: 'liability' },
    // equity
    { code: '3', name: 'حقوق الملكية', type: 'equity', isDetail: false },
    { code: '3101', name: 'رأس المال', type: 'equity' },
    { code: '3102', name: 'الأرباح المحتجزة', type: 'equity' },
    // revenue
    { code: '4', name: 'الإيرادات', type: 'revenue', isDetail: false },
    { code: '4101', name: 'إيراد الشحن', type: 'revenue' },
    { code: '4102', name: 'إيراد النولون', type: 'revenue' },
    { code: '4103', name: 'إيرادات متنوعة', type: 'revenue' },
    // expenses
    { code: '5', name: 'المصروفات', type: 'expense', isDetail: false },
    { code: '5101', name: 'تكلفة النقل (النولون)', type: 'expense' },
    { code: '5102', name: 'مرتبات وأجور', type: 'expense' },
    { code: '5103', name: 'إيجارات', type: 'expense' },
    { code: '5104', name: 'مصروفات تشغيلية', type: 'expense' },
  ]
  const acctByCode = new Map<string, any>()
  for (const a of accountsDef) {
    const parent = a.parent ? acctByCode.get(a.parent)?.id : null
    const acc = await db.account.create({
      data: { code: a.code, name: a.name, type: a.type, isDetail: a.isDetail ?? true, parentId: parent },
    })
    acctByCode.set(a.code, acc)
  }

  // 5. Admin user
  console.log('Seeding admin user...')
  const admin = await db.user.create({
    data: {
      username: 'admin',
      password: '$2a$10$placeholder', // NOTE: simple demo. Replace with proper hash for production.
      name: 'مدير النظام',
      branchId: branch.id,
    },
  })
  const adminRole = await db.role.findUnique({ where: { name: 'admin' } })
  if (adminRole) await db.userRole.create({ data: { userId: admin.id, roleId: adminRole.id } })

  // 6. Parties from Excel: unique contractors + unique customers
  console.log('Deriving parties from Excel data...')
  const contractorNames = new Set<string>()
  const customerNames = new Set<string>()
  for (const s of raw.shipments) {
    if (s.contractor) contractorNames.add(String(s.contractor).trim())
    if (s.customerName) customerNames.add(String(s.customerName).trim())
  }

  const partyByName = new Map<string, any>()
  // Contractors first
  for (const name of Array.from(contractorNames).sort()) {
    const p = await db.party.create({
      data: {
        name,
        code: 'C-' + String(partyByName.size + 1).padStart(4, '0'),
        isContractor: true,
        branchId: branch.id,
      },
    })
    partyByName.set(name, p)
  }
  // Customers (merge if same name exists, else new)
  for (const name of Array.from(customerNames).sort()) {
    if (partyByName.has(name)) continue
    const p = await db.party.create({
      data: {
        name,
        code: 'CU-' + String(partyByName.size + 1).padStart(4, '0'),
        isCustomer: true,
        branchId: branch.id,
      },
    })
    partyByName.set(name, p)
  }
  console.log(`Created ${partyByName.size} parties (${contractorNames.size} contractors, ${customerNames.size} customers)`)

  // 7. Shipments
  console.log(`Seeding ${raw.shipments.length} shipments...`)
  let shipmentCount = 0
  for (const s of raw.shipments) {
    const customer = s.customerName ? partyByName.get(String(s.customerName).trim()) : null
    const contractor = s.contractor ? partyByName.get(String(s.contractor).trim()) : null
    const loadType = s.ton15 ? '1.5TON' : s.ton3 ? '3TON' : s.m6 ? '6M' : null
    await db.shipment.create({
      data: {
        shipmentNo: 'SH-' + String(shipmentCount + 1).padStart(5, '0'),
        customerId: customer?.id ?? null,
        recipientName: s.customerName ?? null,
        shipToParty: s.customerName ?? null,
        deliveryPhones: str(s.delivery),
        destination: s.destination ?? null,
        destinationEn: s.destinationEn ?? null,
        routeCode: s.coding ?? null,
        branchId: branch.id,
        warehouseId: warehouse.id,
        loadType,
        ton15: num(s.ton15),
        ton3: num(s.ton3),
        m6: num(s.m6),
        drop: num(s.drop),
        worker: str(s.worker),
        contractorId: contractor?.id ?? null,
        vehicleNo: s.vehicleNo ?? null,
        freightCost: num(s.freight),
        freightTotal: num(s.freightTotal),
        customerPay: num(s.customerPay),
        aging: num(s.aging),
        overnight: num(s.overnight),
        returns: num(s.returns),
        transfer: num(s.transfer),
        other: num(s.other),
        totalSuppliers: num(s.totalSuppliers),
        status: 'delivered', // historical data
        collectionStatus: (num(s.customerPay) ?? 0) > 0 ? 'collected' : 'uncollected',
        date: safeDate(s.date),
        date2: safeDate(s.date2),
        notes: s.notes ?? null,
        note1: s.note1 ?? null,
        sFlag: str(s.s),
        warehouseOrig: str(s.warehouse),
        m1: str(s.m1),
        m2: str(s.m2),
        xCol: str(s.x),
        card: str(s.card),
      },
    })
    shipmentCount++
  }
  console.log(`Seeded ${shipmentCount} shipments`)

  // 8. Freight prices
  console.log(`Seeding ${raw.regions.length} freight rates...`)
  let rateCount = 0
  for (const r of raw.regions) {
    if (!r.regionEn && !r.regionAr) continue
    await db.freightPrice.create({
      data: {
        regionEn: str(r.regionEn),
        regionAr: str(r.regionAr),
        routeName: str(r.distance),
        cost: num(r.cost),
        sellPrice: num(r.sell),
        sellPrice2: num(r.sell2),
      },
    })
    rateCount++
  }
  console.log(`Seeded ${rateCount} freight rates`)

  // 9. Audit log entry for the seed/import
  await db.auditLog.create({
    data: {
      userName: 'system',
      action: 'import',
      entity: 'shipment',
      entityId: 'seed',
      notes: `Initial seed import from مبيعات العاشر 3 (Repaired) - ${shipmentCount} shipments, ${partyByName.size} parties, ${rateCount} freight rates`,
    },
  })
  await db.importLog.create({
    data: {
      fileName: 'مبيعات العاشر 3 (Repaired) - Copy.xlsx',
      sheetName: 'مبيعات 8-2026',
      totalRows: raw.shipments.length,
      importedRows: shipmentCount,
      skippedRows: 0,
      errorRows: 0,
      status: 'completed',
      userName: 'system',
    },
  })

  console.log('Seed completed!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
