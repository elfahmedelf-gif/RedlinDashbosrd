// ============================================================================
// تهيئة قاعدة البيانات الحقيقية من mock-data.json (مرة واحدة — idempotent)
// الترحيل يشمل: الهيكل + الأطراف + الشحنات + دليل الحسابات + القيود الافتتاحية
// + بذور الأذونات التشغيلية + المستخدمين والأدوار + سجل التدقيق
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'
import { hashPassword, parsePerms } from './passwords'
import { VOUCHER_TYPES } from '../voucher-catalog'
import { syncPermissionsCatalog } from './perm-sync'

let seedPromise: Promise<void> | null = null

/**
 * ربط الحسابات التفصيلية بمجموعاتها في الشجرة — خريطة مرجعية ثابتة للدليل المحاسبي.
 * تُستخدم عند البذر الأول وتُعاد تطبيقها بشكل idempotent عند كل إقلاع (تصحيح قواعد قديمة
 * كان فيها الحسابات التفصيلية بلا أب فتظهر في جذر الشجرة بدل مجموعاتها).
 */
export const ACCOUNT_PARENT_BY_CODE: Record<string, string> = {
  '1101': '11', '1102': '11', '1103': '11', '1104': '11',
  '1201': '12',
  '2101': '21', '2102': '21', '2103': '21', '2104': '21',
  '3101': '3', '3102': '3',
  '4101': '4', '4102': '4', '4103': '4',
  '5101': '5', '5102': '5', '5103': '5', '5104': '5',
}

/** تصحيح شجرة الحسابات: كل حساب تفصيلي معروف الكود يُربط بمجموعته الأم (idempotent) */
export async function ensureAccountTree(): Promise<void> {
  const detached = await db.account.findMany({
    where: { parentId: null, code: { in: Object.keys(ACCOUNT_PARENT_BY_CODE) } },
    select: { id: true, code: true },
  })
  if (!detached.length) return
  const groups = await db.account.findMany({ where: { isDetail: false }, select: { id: true, code: true } })
  const byCode = new Map(groups.map((g) => [g.code, g.id]))
  let fixed = 0
  for (const acc of detached) {
    const pid = byCode.get(ACCOUNT_PARENT_BY_CODE[acc.code])
    if (pid) {
      await db.account.update({ where: { id: acc.id }, data: { parentId: pid } })
      fixed++
    }
  }
  if (fixed) console.log(`[seed] تم ربط ${fixed} حساب تفصيلي بمجموعته في شجرة الحسابات`)
}

/**
 * يُستدعى من كل مسارات API — يزرع البيانات مرة واحدة فقط.
 * يستخدم "قفل تهيئة" عبر قيد فريد في قاعدة البيانات نفسها لمنع
 * تزامن أكثر من نافذة تشغيل (multiple module instances/processes).
 */
export async function ensureSeeded(): Promise<void> {
  if (seedPromise) return seedPromise
  seedPromise = (async () => {
    if (await db.party.count() === 0) {
      // محاولة اقتناء القفل — INSERT فريد: من ينجح يتولى البذر
      try {
        await db.seqCounter.create({ data: { key: '_seed_lock', value: 0 } })
      } catch {
        // آخر يشيّد الآن أو انتهى — انتظر اكتمال البيانات
        for (let i = 0; i < 120; i++) {
          if (await db.party.count() > 0) return
          await new Promise((r) => setTimeout(r, 500))
        }
        throw new Error('انتهت مهلة انتظار تهيئة قاعدة البيانات')
      }
      try {
        await runSeed()
      } catch (e) {
        // أطلق القفل ليُعاد المحاولة لاحقًا
        await db.seqCounter.deleteMany({ where: { key: '_seed_lock' } }).catch(() => {})
        throw e
      }
    }
    // مزامنة كتالوج الصلاحيات مع قاعدة البيانات الحية — كل إقلاع خادم
    // (idempotent: تضيف الصلاحيات الجديدة فقط ولا تمس أي تخصيصات قائمة)
    try {
      const r = await syncPermissionsCatalog()
      if (r.rolesUpdated.length) {
        console.log(`[perm-sync] تمت مزامنة الصلاحيات: ${r.rolesUpdated.join('، ')} (+${r.addedKeys} صلاحية)`)
      }
    } catch (e) {
      console.warn('[perm-sync] فشلت مزامنة الصلاحيات (ستُعاد في الإقلاع القادم):', (e as Error)?.message)
    }
    // تصحيح شجرة الحسابات — يضمن ظهور الحسابات التفصيلية تحت مجموعاتها في كل الإقلاعات
    try {
      await ensureAccountTree()
    } catch (e) {
      console.warn('[seed] فشل تصحيح شجرة الحسابات:', (e as Error)?.message)
    }
    // إعدادات النظام الأساسية (idempotent upserts — تنشئ ما ينقص فقط في كل إقلاع)
    try {
      await ensurePolicySetting()
    } catch (e) {
      console.warn('[seed] فشلت مزامنة إعدادات النظام:', (e as Error)?.message)
    }
  })()
  seedPromise.catch(() => { seedPromise = null })
  return seedPromise
}

const D = (ms: any): Date | null => (typeof ms === 'number' && ms > 1e11 ? new Date(ms) : null)
const d = (day: number) => new Date(`2026-09-${String(day).padStart(2, '0')}T10:00:00.000Z`)
const iso = (day: number) => d(day).toISOString()

async function runSeed(): Promise<void> {
  const existing = await db.party.count()
  if (existing > 0) {
    await ensurePolicySetting()
    return
  }
  console.log('[seed] قاعدة البيانات فارغة — بدء تهيئة البيانات من mock-data.json ...')
  const dataPath = path.join(process.cwd(), 'mock-data.json')
  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))

  await db.$transaction(
    async (tx) => {
      // ---------- الفروع والمخازن ----------
      const branches = raw.branches.map((b: any) => ({
        id: b.id, code: b.code ?? null, name: b.name, nameEn: b.nameEn ?? null,
        manager: b.manager ?? null, phone: b.phone ?? null, address: b.address ?? null,
        region: b.region ?? null, balance: b.balance ?? 0, active: b.active !== 0,
        createdAt: D(b.createdAt) ?? new Date(),
      }))
      await tx.branch.createMany({ data: branches })
      const warehouses = raw.warehouses.map((w: any) => ({
        id: w.id, code: w.code ?? null, name: w.name, branchId: w.branchId,
        manager: w.manager ?? null, balance: w.balance ?? 0, active: w.active !== 0,
        createdAt: D(w.createdAt) ?? new Date(),
      }))
      await tx.warehouse.createMany({ data: warehouses })

      // ---------- الأطراف ----------
      await tx.party.createMany({
        data: raw.parties.map((p: any) => ({
          id: p.id, code: p.code ?? null, name: p.name, nameEn: p.nameEn ?? null,
          isCustomer: !!p.isCustomer, isContractor: !!p.isContractor, isSupplier: !!p.isSupplier,
          phone: p.phone ?? null, phones: p.phones ?? null, email: p.email ?? null,
          address: p.address ?? null, city: p.city ?? null, region: p.region ?? null,
          taxNumber: p.taxNumber ?? null, paymentTerms: p.paymentTerms ?? null,
          creditLimit: p.creditLimit ?? null, openingBalance: p.openingBalance ?? 0,
          openingBalanceType: p.openingBalanceType ?? null, branchId: p.branchId ?? null,
          notes: p.notes ?? null, active: p.active !== 0,
          createdAt: D(p.createdAt) ?? new Date(),
        })),
      })

      // ---------- دليل الحسابات (+ حساب عهد المندوبين المطلوب للتسوية) ----------
      const accounts = raw.accounts.map((a: any) => ({
        id: a.id, code: a.code, name: a.name, nameEn: a.nameEn ?? null, type: a.type,
        parentId: a.parentId ?? null, isDetail: !!a.isDetail, active: a.active !== 0,
        createdAt: D(a.createdAt) ?? new Date(),
      }))
      if (!accounts.some((a: any) => a.code === '2104')) {
        const liabilityGroup = accounts.find((a: any) => a.code === '21')
        accounts.push({
          id: 'acc-2104-courier-custody', code: '2104', name: 'عهد المندوبين (COD)',
          nameEn: 'Courier Custody (COD)', type: 'liability', parentId: liabilityGroup?.id ?? null,
          isDetail: true, active: true, createdAt: new Date(),
        })
      }
      // ربط الحسابات التفصيلية بمجموعاتها (mock-data القديم كان يتركها بلا أب — شجرة مسطحة)
      const groupIds = new Map(accounts.filter((a: any) => !a.isDetail).map((a: any) => [a.code, a.id]))
      for (const a of accounts) {
        if (!a.parentId && ACCOUNT_PARENT_BY_CODE[a.code]) {
          a.parentId = groupIds.get(ACCOUNT_PARENT_BY_CODE[a.code]) ?? null
        }
      }
      await tx.account.createMany({ data: accounts })

      // ---------- القوائم والإعدادات وأسعار النولون ----------
      await tx.lookupItem.createMany({
        data: raw.lookups.map((l: any) => ({
          id: l.id, category: l.category, key: l.key, label: l.label, labelEn: l.labelEn ?? null,
          tone: l.tone ?? null, icon: l.icon ?? null, active: l.active !== 0,
          sortOrder: l.sortOrder ?? 0, isSystem: !!l.isSystem,
          createdAt: D(l.createdAt) ?? new Date(), updatedAt: D(l.updatedAt) ?? new Date(),
        })),
      })
      await tx.setting.createMany({
        data: raw.settings.map((s: any) => ({ id: s.id, key: s.key, value: s.value ?? null, label: s.label ?? null, category: s.category ?? null, updatedAt: new Date() })),
      })
      await tx.freightPrice.createMany({
        data: raw.freight.map((f: any) => ({
          id: f.id, regionAr: f.regionAr ?? null, regionEn: f.regionEn ?? null, routeName: f.routeName ?? null,
          distanceKm: f.distanceKm ?? null, loadType: f.loadType ?? null, cost: f.cost ?? 0,
          sellPrice: f.sellPrice ?? null, sellPrice2: f.sellPrice2 ?? null,
          validFrom: D(f.validFrom), validTo: D(f.validTo), notes: f.notes ?? null, active: f.active !== 0,
          createdAt: D(f.createdAt) ?? new Date(), updatedAt: D(f.updatedAt) ?? new Date(),
        })),
      })

      // ---------- حالات الشحنات التشغيلية (قوائم النظام) ----------
      const opStatuses = [
        { key: 'received', label: 'مستلمة بالفرع', tone: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300', sortOrder: 12 },
        { key: 'loaded', label: 'محمّلة على المركبة', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', sortOrder: 13 },
        { key: 'in_transit', label: 'في الطريق بين الفروع', tone: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300', sortOrder: 14 },
        { key: 'arrived', label: 'وصلت فرع الوجهة', tone: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', sortOrder: 15 },
        { key: 'assigned_courier', label: 'مُسلّمة لمندوب التوصيل', tone: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300', sortOrder: 16 },
        { key: 'received_returned', label: 'مرتجعة مستلمة بالفرع', tone: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', sortOrder: 17 },
        { key: 'written_off', label: 'شطبت من المخزون', tone: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300', sortOrder: 18 },
      ]
      for (const os of opStatuses) {
        await tx.lookupItem.upsert({
          where: { category_key: { category: 'shipment_status', key: os.key } },
          update: {},
          create: { category: 'shipment_status', key: os.key, label: os.label, tone: os.tone, sortOrder: os.sortOrder, isSystem: true },
        })
      }

      // ---------- الأدوار والمستخدمين ----------
      const roleIds = new Map<string, string>()
      for (const r of raw.roles) {
        const created = await tx.role.create({
          data: { id: r.id, name: r.name, label: r.label || r.name, permissions: JSON.stringify(parsePerms(r.permissions)), createdAt: D(r.createdAt) ?? new Date() },
        })
        roleIds.set(created.name, created.id)
      }
      const ensureRole = async (name: string, label: string, permissions: string[]) => {
        let role = await tx.role.findUnique({ where: { name } })
        if (!role) {
          role = await tx.role.create({ data: { name, label, permissions: JSON.stringify(permissions) } })
          roleIds.set(name, role.id)
        } else {
          await tx.role.update({ where: { id: role.id }, data: { label, permissions: JSON.stringify(permissions) } })
          roleIds.set(name, role.id)
        }
        return role
      }
      await ensureRole('admin', 'مدير النظام', ['*'])
      await ensureRole('finance_manager', 'مدير مالي', ['accounting.*', 'reports.*', 'shipments.read', 'customers.*', 'contractors.*', 'suppliers.*', 'audit.view', 'dashboard.view', 'vouchers.view', 'vouchers.view.all', 'vouchers.create', 'vouchers.submit', 'vouchers.approve', 'vouchers.reject', 'vouchers.execute', 'vouchers.cancel', 'vouchers.print', 'vouchers.export'])
      await ensureRole('branch_manager', 'مدير فرع', ['shipments.*', 'customers.*', 'contractors.*', 'suppliers.*', 'inventory.*', 'branches.view', 'warehouses.view', 'dashboard.view', 'vouchers.view', 'vouchers.create', 'vouchers.edit', 'vouchers.submit', 'vouchers.approve', 'vouchers.execute', 'vouchers.cancel', 'vouchers.print', 'vouchers.export'])
      await ensureRole('operations', 'موظف عمليات', ['shipments.view', 'shipments.create', 'shipments.edit', 'shipments.status', 'shipments.assign', 'shipments.receipts', 'shipments.print', 'shipments.export', 'customers.view', 'contractors.view', 'suppliers.view', 'parties.extras.view', 'parties.extras.manage', 'inventory.view', 'dashboard.view', 'vouchers.view', 'vouchers.create', 'vouchers.edit', 'vouchers.submit', 'vouchers.print', 'vouchers.export'])
      await ensureRole('voucher_clerk', 'كاتب أذونات', ['dashboard.view', 'shipments.view', 'customers.view', 'contractors.view', 'branches.view', 'warehouses.view', 'vouchers.view', 'vouchers.create', 'vouchers.edit', 'vouchers.submit', 'vouchers.print'])
      await ensureRole('viewer', 'عارض (مشاهدة فقط)', ['dashboard.view', 'shipments.view', 'customers.view', 'contractors.view', 'suppliers.view', 'parties.extras.view', 'inventory.view', 'accounting.view', 'reports.view', 'vouchers.view'])
      // دور خاص: رؤية الأسعار/المبالغ — يُمنح فقط لمن يحق له رؤية التكلفة/البيع/التحصيل
      // (في هذا النظام: المالك admin عبر '*' + محمود عبر إسناد دور إضافي)
      // يشمل reports.view حتى يتمكن حامل الدور من الوصول لتقارير الأسعار
      await ensureRole('prices_viewer', 'رؤية الأسعار (خاص)', ['prices.view', 'reports.view'])

      const mainBranch = branches[0]?.id ?? null
      const users: { username: string; name: string; password: string; role: string }[] = [
        { username: 'admin', name: 'مدير النظام', password: 'admin123', role: 'admin' },
        { username: 'finance', name: 'حسن — المدير المالي', password: 'fin123', role: 'finance_manager' },
        { username: 'ops', name: 'محمود — العمليات', password: 'ops123', role: 'branch_manager' },
        { username: 'viewer', name: 'سارة — مشاهدة فقط', password: 'view123', role: 'viewer' },
      ]
      const userIds = new Map<string, string>()
      for (const u of users) {
        const existingUser = raw.users.find((x: any) => x.username === u.username)
        const id = existingUser?.id ?? `seed-user-${u.username}`
        const created = await tx.user.upsert({
          where: { username: u.username },
          update: { password: hashPassword(u.password), active: true },
          create: {
            id, username: u.username, name: u.name, password: hashPassword(u.password),
            branchId: existingUser?.branchId ?? mainBranch, active: true, createdAt: D(existingUser?.createdAt) ?? new Date(),
          },
        })
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: created.id, roleId: roleIds.get(u.role)! } },
          update: {},
          create: { userId: created.id, roleId: roleIds.get(u.role)! },
        })
        userIds.set(u.username, created.id)
      }
      // إسناد دور "رؤية الأسعار" لمحمود (ops) — استثناء صريح من المالك
      // محمود فقط (بالإضافة للمالك عبر '*') يرى التكلفة/البيع/التحصيل في كل العمليات
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: userIds.get('ops')!, roleId: roleIds.get('prices_viewer')! } },
        update: {},
        create: { userId: userIds.get('ops')!, roleId: roleIds.get('prices_viewer')! },
      })

      // ---------- الشحنات + سجل الحالات ----------
      await tx.shipment.createMany({
        data: raw.shipments.map((s: any) => ({
          id: s.id, shipmentNo: s.shipmentNo ?? null, billNo: s.billNo ?? null, policyQty: s.policyQty ?? null,
          customerId: s.customerId ?? null, recipientName: s.recipientName ?? null, shipToParty: s.shipToParty ?? null,
          deliveryPhones: s.deliveryPhones ?? null, pickupAddress: s.pickupAddress ?? null, deliveryAddress: s.deliveryAddress ?? null,
          destination: s.destination ?? null, destinationEn: s.destinationEn ?? null, routeCode: s.routeCode ?? null,
          branchId: s.branchId ?? null, warehouseId: s.warehouseId ?? null, loadType: s.loadType ?? null,
          ton15: s.ton15 ?? null, ton3: s.ton3 ?? null, m6: s.m6 ?? null, drop: s.drop ?? null, worker: s.worker ?? null,
          contractorId: s.contractorId ?? null, vehicleNo: s.vehicleNo ?? null,
          freightCost: s.freightCost ?? null, freightTotal: s.freightTotal ?? null, salePrice: s.salePrice ?? null,
          customerPay: s.customerPay ?? 0, aging: s.aging ?? null, overnight: s.overnight ?? null,
          returns: s.returns ?? null, transfer: s.transfer ?? null, other: s.other ?? null, totalSuppliers: s.totalSuppliers ?? null,
          status: s.status ?? 'new', collectionStatus: s.collectionStatus ?? 'uncollected',
          date: D(s.date), shippingDate: D(s.shippingDate), expectedDeliveryDate: D(s.expectedDeliveryDate),
          actualDeliveryDate: D(s.actualDeliveryDate), date2: D(s.date2),
          notes: s.notes ?? null, note1: s.note1 ?? null, attachments: s.attachments ?? null,
          sFlag: s.sFlag ?? null, warehouseOrig: s.warehouseOrig ?? null,
          m1: s.m1 ?? null, m2: s.m2 ?? null, xCol: s.xCol ?? null, card: s.card ?? null,
          createdAt: D(s.createdAt) ?? new Date(), updatedAt: D(s.updatedAt) ?? new Date(),
        })),
      })
      await tx.shipmentStatusHistory.createMany({
        data: raw.shipments.map((s: any) => ({
          shipmentId: s.id, fromStatus: null, toStatus: s.status ?? 'new',
          changedAt: D(s.updatedAt) ?? new Date(), userName: 'system',
          notes: 'استيراد أولي من ملف مبيعات العاشر 3',
        })),
      })

      // ---------- المخزون ----------
      const mainWh = warehouses[0]?.id ?? null
      const itemDefs = [
        { code: 'IT-001', name: 'كرتون تغليف مقاس كبير', nameEn: 'Large Carton Box', unit: 'قطعة', reorderLevel: 200, cost: 18, price: 25 },
        { code: 'IT-002', name: 'لفائف سترتش', nameEn: 'Stretch Roll', unit: 'لفة', reorderLevel: 100, cost: 55, price: 70 },
        { code: 'IT-003', name: 'شريط لاصق شفاف', nameEn: 'Transparent Tape', unit: 'قطعة', reorderLevel: 150, cost: 8, price: 12 },
        { code: 'IT-004', name: 'أسطوانة فريون', nameEn: 'Freon Gas Cylinder', unit: 'أسطوانة', reorderLevel: 20, cost: 350, price: 420 },
        { code: 'IT-005', name: 'زيت محركات 20W-50', nameEn: 'Engine Oil 20W-50', unit: 'جالون', reorderLevel: 30, cost: 260, price: 310 },
        { code: 'IT-006', name: 'باليت خشبي', nameEn: 'Wooden Pallet', unit: 'قطعة', reorderLevel: 50, cost: 95, price: 130 },
        { code: 'IT-007', name: 'حزام تثبيت (شد)', nameEn: 'Lashing Belt', unit: 'قطعة', reorderLevel: 40, cost: 180, price: 240 },
        { code: 'IT-008', name: 'غطاء بلاستيك للشحن', nameEn: 'Plastic Shipping Cover', unit: 'قطعة', reorderLevel: 300, cost: 6, price: 10 },
      ]
      const items = itemDefs.map((it, i) => ({ id: `seed-item-${i + 1}`, ...it, warehouseId: mainWh, active: true, createdAt: d(1) }))
      await tx.item.createMany({ data: items })

      const mvDefs: any[] = [
        { type: 'receipt', itemId: 1, qty: 1500, unitCost: 18, day: 1, notes: 'توريد افتتاحي من مورد التغليف' },
        { type: 'receipt', itemId: 2, qty: 400, unitCost: 55, day: 1, notes: 'توريد لفائف سترتش' },
        { type: 'issue', itemId: 1, qty: -50, unitCost: 18, day: 4, notes: 'صرف لتجهيز شحنات القاهرة' },
        { type: 'issue', itemId: 2, qty: -80, unitCost: 55, day: 6, notes: 'صرف لمخزن العاشر' },
        { type: 'receipt', itemId: 3, qty: 200, unitCost: 8, day: 7, notes: 'توريد شريط لاصق' },
        { type: 'issue', itemId: 3, qty: -115, unitCost: 8, day: 12, notes: 'صرف يومي للتغليف' },
        { type: 'transfer', itemId: 6, qty: 60, unitCost: 95, day: 14, notes: 'تحويل باليتات لفرع الجيزة' },
        { type: 'receipt', itemId: 4, qty: 50, unitCost: 350, day: 16, notes: 'توريد فريون لصيانة الشاحنات' },
        { type: 'issue', itemId: 4, qty: -4, unitCost: 350, day: 20, notes: 'صرف لصيانة تكييف الثلاجات' },
        { type: 'receipt', itemId: 5, qty: 90, unitCost: 260, day: 18, notes: 'توريد زيت محركات لأسطول الشاحنات' },
        { type: 'issue', itemId: 5, qty: -18, unitCost: 260, day: 25, notes: 'صرف زيت لتغيير دوري' },
        { type: 'receipt', itemId: 6, qty: 180, unitCost: 95, day: 2, notes: 'توريد باليتات خشبية' },
        { type: 'receipt', itemId: 7, qty: 40, unitCost: 180, day: 5, notes: 'توريد أحزمة تثبيت' },
        { type: 'adjustment', itemId: 7, qty: -18, unitCost: 180, day: 22, notes: 'تسوية جرد — تالف' },
        { type: 'receipt', itemId: 8, qty: 700, unitCost: 6, day: 24, notes: 'توريد أغطية بلاستيك' },
        { type: 'issue', itemId: 8, qty: -60, unitCost: 6, day: 28, notes: 'صرف أغطية لشحنات الإسكندرية' },
      ]
      await tx.inventoryMovement.createMany({
        data: mvDefs.map((m, i) => ({
          id: `seed-mv-${i + 1}`, type: m.type, date: d(m.day), itemId: `seed-item-${m.itemId}`,
          warehouseId: mainWh!, toWarehouseId: m.type === 'transfer' ? mainWh : null,
          quantity: m.qty, unitCost: m.unitCost, totalCost: Math.abs(m.qty) * m.unitCost,
          notes: m.notes, userName: 'admin', createdAt: d(m.day),
        })),
      })

      // ---------- القيود الافتتاحية (مزدوجة متوازنة) ----------
      const accByCode = (code: string) => accounts.find((a: any) => a.code === code)!
      const partyByName = (name: string) => raw.parties.find((p: any) => p.isContractor && p.name === name)
      const J = (n: number) => `JE-${String(n).padStart(4, '0')}`
      const entryDefs = [
        {
          entryNo: J(1), date: d(1), description: 'قيد افتتاحي — رأس المال النقدي', reference: 'OPEN-001', status: 'posted',
          lines: [
            { code: '1101', debit: 500000, credit: 0, description: 'نقدية بالصندوق' },
            { code: '3101', debit: 0, credit: 500000, description: 'رأس المال المدفوع' },
          ],
        },
        {
          entryNo: J(2), date: d(9), description: 'تحصيل نولون عملاء — دفعة أولى', reference: 'COLL-0909', status: 'posted',
          lines: [
            { code: '1101', debit: 14750, credit: 0, description: 'نقدية محصلة' },
            { code: '4102', debit: 0, credit: 14750, description: 'إيراد نولون محصل' },
          ],
        },
        {
          entryNo: J(3), date: d(15), description: 'إثبات مستحقات مقاولي النقل — استحقاق شغل منفَّذ', reference: 'ACC-CONTR', status: 'posted',
          lines: [
            { code: '5101', debit: 250000, credit: 0, description: 'تكلفة نقل مستحقة', partyId: partyByName('السيد ربيع')?.id ?? null },
            { code: '2102', debit: 0, credit: 250000, description: 'مستحقات المقاولين', partyId: partyByName('السيد ربيع')?.id ?? null },
          ],
        },
        {
          entryNo: J(4), date: d(22), description: 'مصروفات مبيت وتعتيم شحنات', reference: 'OPS-0922', status: 'draft',
          lines: [
            { code: '5104', debit: 27106, credit: 0, description: 'مبيت وتعتيم' },
            { code: '1101', debit: 0, credit: 27106, description: 'نقدية مصروفة' },
          ],
        },
      ]
      const adminId = userIds.get('admin')!
      for (const e of entryDefs) {
        await tx.journalEntry.create({
          data: {
            entryNo: e.entryNo, date: e.date, description: e.description, reference: e.reference,
            branchId: mainBranch, status: e.status,
            totalDebit: e.lines.reduce((s: number, l: any) => s + l.debit, 0),
            totalCredit: e.lines.reduce((s: number, l: any) => s + l.credit, 0),
            userId: adminId, userName: 'admin',
            postedAt: e.status === 'posted' ? e.date : null, postedByUserName: e.status === 'posted' ? 'admin' : null,
            sourceType: 'seed', lines: {
              create: e.lines.map((l: any) => ({
                accountId: accByCode(l.code).id, debit: l.debit, credit: l.credit,
                description: l.description, partyId: l.partyId ?? null,
              })),
            },
          },
        })
      }

      // ---------- بذور الأذونات التشغيلية (نفس بيانات النظام السابق) ----------
      const shipments: string[] = raw.shipments.map((s: any) => s.id)
      const slice = (off: number, n: number) => shipments.slice(off, off + n)
      const shipmentNo = (sid: string) => raw.shipments.find((x: any) => x.id === sid)?.shipmentNo ?? ''
      const freightOf = (sid: string) => Number(raw.shipments.find((x: any) => x.id === sid)?.freightTotal ?? 0)
      const party = (name: string) => raw.parties.find((p: any) => p.name?.includes(name))?.id ?? null
      const contractorId = raw.parties.find((p: any) => p.isContractor)?.id ?? null
      const tdef = (code: string) => VOUCHER_TYPES.find((t) => t.code === code)!
      const mkActions = (days: number[]) => days.map((day, i) => ({
        action: ['create', 'submit', 'approve', 'execute', 'complete'][i] ?? 'create',
        userId: adminId, userName: 'admin', at: d(day),
        notes: i === 0 ? 'إنشاء الإذن (بذرة)' : null,
      }))
      const seedVouchers = [
        { id: 'seed-ovc-1', no: 'RCV-0001', type: 'receiving', status: 'completed', date: 2, items: slice(0, 3) },
        { id: 'seed-ovc-2', no: 'LDG-0001', type: 'loading', status: 'completed', date: 4, items: slice(10, 3), dest: mainBranch, vehicle: 'ق ط ر 1234', driver: 'عبد الله محمود' },
        { id: 'seed-ovc-3', no: 'CRA-0001', type: 'courier_assignment', status: 'completed', date: 6, items: slice(20, 3), courier: contractorId },
        { id: 'seed-ovc-4', no: 'DLV-0001', type: 'delivery', status: 'completed', date: 8, items: slice(30, 4), courier: contractorId },
        { id: 'seed-ovc-5', no: 'LDG-0002', type: 'loading', status: 'pending', date: 20, items: slice(10, 2), dest: mainBranch, notes: 'دفعة تحميل مسائية' },
        { id: 'seed-ovc-6', no: 'RTR-0001', type: 'returned_receiving', status: 'draft', date: 22, items: slice(40, 2), notes: 'استلام مرتجعات من المندوب' },
        { id: 'seed-ovc-7', no: 'RET-0001', type: 'return', status: 'approved', date: 24, items: slice(20, 2), courier: contractorId, notes: 'مرتجع فشل التسليم' },
      ]
      for (const sv of seedVouchers) {
        const actions = sv.status === 'completed' ? mkActions([sv.date, sv.date, sv.date, sv.date, sv.date])
          : sv.status === 'pending' ? mkActions([sv.date, sv.date])
          : sv.status === 'approved' ? mkActions([sv.date, sv.date, sv.date])
          : mkActions([sv.date])
        await tx.opVoucher.create({
          data: {
            id: sv.id, voucherNo: sv.no, type: sv.type, status: sv.status,
            sourceBranchId: mainBranch, destBranchId: sv.dest ?? null,
            employeeId: adminId, courierId: sv.courier ?? null,
            totalValue: sv.items.reduce((s, sid) => s + freightOf(sid), 0),
            notes: sv.notes ?? null,
            vehicleNo: sv.vehicle ?? null, driverName: sv.driver ?? null,
            userId: adminId, userName: 'admin', createdAt: d(sv.date), updatedAt: d(sv.date),
            items: { create: sv.items.map((sid) => ({ shipmentId: sid, addedBy: 'admin', addedAt: d(sv.date) })) },
            actions: { create: actions },
          },
        })
      }
      // السندات المالية: كل سند له قيده المزدوج الخاص المطابق تمامًا لمبلغه
      // (نفس قواعد postFinancialVoucherJournal: قبض 1101/1103 — صرف 2102/1101)
      const finDefs = [
        { type: 'collection', party: party('ADEL HASSAN'), amount: 5000, day: 8, notes: 'تحصيل دفعة نولون' },
        { type: 'cash_disbursement', party: partyByName('السيد ربيع')?.id ?? null, amount: 120000, day: 15, notes: 'دفعة مستحقات نقل' },
        { type: 'collection', party: party('Abd al hakeim'), amount: 3500, day: 17, notes: 'تحصيل جزئي' },
        { type: 'cash_disbursement', party: partyByName('المنسي')?.id ?? null, amount: 80000, day: 19, notes: 'دفعة مستحقات نقل' },
        { type: 'collection', party: party('Abdelaziz'), amount: 2500, day: 24, notes: 'تحصيل نولون شحنات' },
        { type: 'cash_disbursement', party: partyByName('جعلص')?.id ?? null, amount: 50000, day: 26, notes: 'دفعة على الحساب' },
      ]
      const JE_ACC = {
        AR: accByCode('1103').id, CASH: accByCode('1101').id, CONTRACTORS: accByCode('2102').id,
      }
      const finLabels: Record<string, string> = { collection: 'إذن تحصيل نقدية', cash_disbursement: 'إذن صرف نقدية' }
      let jeSeq = entryDefs.length // JE-0004 آخر قيد في entryDefs (الافتتاحية + السردية)
      let typeSeqAcc: Record<string, number> = {}
      for (const f of finDefs) {
        typeSeqAcc[f.type] = (typeSeqAcc[f.type] ?? 0) + 1
        const td = tdef(f.type)
        const no = `${td.prefix}-${String(typeSeqAcc[f.type]).padStart(4, '0')}`
        jeSeq += 1
        const entryNo = J(jeSeq)
        const partyId = f.party ?? null
        const partyName = raw.parties.find((p: any) => p.id === partyId)?.name ?? ''
        // القيد المزدوج الدقيق للسند (مدين/دائن متوازنان على نفس المبلغ)
        const lines = f.type === 'collection'
          ? [
              { accountId: JE_ACC.CASH, debit: f.amount, credit: 0, description: 'نقدية محصلة', partyId },
              { accountId: JE_ACC.AR, debit: 0, credit: f.amount, description: 'تحصيل من العميل', partyId },
            ]
          : [
              { accountId: JE_ACC.CONTRACTORS, debit: f.amount, credit: 0, description: 'صرف مستحقات مقاول', partyId },
              { accountId: JE_ACC.CASH, debit: 0, credit: f.amount, description: 'نقدية مدفوعة', partyId },
            ]
        const je = await tx.journalEntry.create({
          data: {
            entryNo, date: d(f.day), description: `${finLabels[f.type]} ${no}${partyName ? ` — ${partyName}` : ''}${f.notes ? ` — ${f.notes}` : ''}`,
            reference: no, branchId: mainBranch, status: 'posted', sourceType: 'op_voucher',
            totalDebit: f.amount, totalCredit: f.amount,
            userId: adminId, userName: 'admin', postedAt: d(f.day), postedByUserName: 'admin',
            lines: { create: lines },
          },
        })
        await tx.opVoucher.create({
          data: {
            id: `seed-ovc-fin-${typeSeqAcc[f.type]}-${f.type}`, voucherNo: no, type: f.type, status: 'completed',
            sourceBranchId: mainBranch, partyId, employeeId: adminId,
            amount: f.amount, totalValue: f.amount, notes: f.notes, accountName: 'الصندوق',
            journalEntryId: je.id,
            userId: adminId, userName: 'admin', createdAt: d(f.day), updatedAt: d(f.day),
            actions: { create: mkActions([f.day, f.day, f.day, f.day, f.day]) },
          },
        })
      }

      // ---------- سجل التدقيق الافتتاحي ----------
      const auditSeed = [
        { action: 'create', entity: 'journal_entry', entityId: null, notes: 'قيد افتتاحي رأس المال', day: 1 },
        { action: 'create', entity: 'voucher', entityId: 'seed-ovc-1', notes: 'إذن استلام شحنات RCV-0001', day: 8 },
        { action: 'create', entity: 'inventory_movement', entityId: 'seed-mv-1', notes: 'توريد افتتاحي للمخزن', day: 1 },
        { action: 'post', entity: 'journal_entry', entityId: null, notes: 'ترحيل قيد تحصيل النولون', day: 9 },
        { action: 'create', entity: 'user', entityId: adminId, notes: 'إنشاء مستخدم مدير النظام', day: 1 },
        { action: 'seed', entity: 'system', entityId: null, notes: `ترحيل البيانات الأولية (${raw.shipments.length} شحنة، ${raw.parties.length} طرف، ${raw.accounts.length} حساب)`, day: 1 },
      ]
      await tx.auditLog.createMany({
        data: [
          ...(raw.audit ?? []).map((a: any) => ({
            id: a.id, date: D(a.date) ?? new Date(), userId: a.userId ?? null, userName: a.userName ?? null,
            action: a.action, entity: a.entity, entityId: a.entityId ?? null,
            beforeData: a.beforeData ?? null, afterData: a.afterData ?? null, notes: a.notes ?? null,
          })),
          ...auditSeed.map((a, i) => ({
            date: new Date(`2026-09-${String(a.day).padStart(2, '0')}T11:30:00.000Z`),
            userName: 'admin', action: a.action, entity: a.entity, entityId: a.entityId, notes: a.notes,
          })).map((r, i) => ({ ...r, id: `seed-audit-${i}` })),
        ],
      })

      // ---------- العدادات التسلسلية (استمرار الأرقام بعد البذور) ----------
      const counterUpdates: Record<string, number> = { journal: entryDefs.length + finDefs.length }
      // أذونات البذرة التشغيلية: عداد لكل نوع = عددها
      for (const sv of seedVouchers) counterUpdates[`voucher:${sv.type}`] = (counterUpdates[`voucher:${sv.type}`] ?? 0) + 1
      // السندات المالية: أقصى رقم تسلسلي مستخدم لكل نوع (ترقيم لكل نوع)
      for (const [t, v] of Object.entries(typeSeqAcc)) counterUpdates[`voucher:${t}`] = Math.max(counterUpdates[`voucher:${t}`] ?? 0, v)
      // أسماء الشحنات تُكمل تسلسل mock-data
      const maxShipmentNo = raw.shipments.reduce((mx: number, s: any) => {
        const m = /^SH-(\d+)$/.exec(String(s.shipmentNo ?? ''))
        return m ? Math.max(mx, Number(m[1])) : mx
      }, 0)
      counterUpdates['shipment'] = maxShipmentNo
      for (const [key, value] of Object.entries(counterUpdates)) {
        await tx.seqCounter.create({ data: { key, value } })
      }
    },
    { timeout: 60000, maxWait: 10000 },
  )

  await ensurePolicySetting()
  console.log('[seed] تمت تهيئة قاعدة البيانات بنجاح ✓')
}

/** إعدادات النظام الأساسية — idempotent (تُنشأ ما تنقص فقط عند كل إقلاع) */
async function ensurePolicySetting() {
  await db.setting.upsert({
    where: { key: 'policy.self_approval' },
    update: {},
    create: { key: 'policy.self_approval', value: 'deny', label: 'سياسة اعتماد الإذن الذاتي (deny/allow)', category: 'policy' },
  })
  // بيانات الفاتورة الضريبية الرسمية — تظهر في ترويسة طباعة الفواتير
  await db.setting.upsert({
    where: { key: 'company_tax_number' },
    update: {},
    create: { key: 'company_tax_number', value: '', label: 'السجل الضريبي للشركة (يظهر في الفاتورة)', category: 'general' },
  })
}

/** رقم الشحنة التالي من العداد */
export async function nextShipmentNo(): Promise<string> {
  const row = await db.seqCounter.upsert({
    where: { key: 'shipment' },
    update: { value: { increment: 1 } },
    create: { key: 'shipment', value: 1 },
  })
  return `SH-${String(row.value).padStart(5, '0')}`
}

/** رقم الشحنة التالي داخل معاملة قائمة (للاستيراد الجماعي — تفادي deadlock) */
type SeqTx = { seqCounter: { upsert: (args: any) => Promise<{ value: number }> } }
export async function nextShipmentNoTx(tx: SeqTx): Promise<string> {
  const row = await tx.seqCounter.upsert({
    where: { key: 'shipment' },
    update: { value: { increment: 1 } },
    create: { key: 'shipment', value: 1 },
  })
  return `SH-${String(row.value).padStart(5, '0')}`
}
