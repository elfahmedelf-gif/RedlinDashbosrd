// ============================================================================
// Client-side in-memory API — ZERO network requests.
// All data is bundled statically from mock-data.json and served synchronously
// from memory. Mutations (create/update/delete) operate on the in-memory DB so
// the whole UI stays fully interactive without any server round-trip.
// ============================================================================

import mockJson from '../../mock-data.json'
import type { SessionUser } from './permissions'

// ============================================================================
// كتالوج الأذونات التشغيلية (16 نوعًا) + دورة الحياة (7 حالات)
// يجمع الأذونات التشغيلية والمالية والجرد والخاصة في نموذج موحد
// ============================================================================
export interface VoucherTypeDef {
  code: string
  label: string
  labelEn: string
  category: 'operational' | 'financial' | 'inventory' | 'special'
  prefix: string
  requiresCourier: boolean
  requiresDestBranch: boolean
  requiresParty: boolean
  requiresEmployee: boolean
  isFinancial: boolean
  requiresShipments: boolean
  preStatuses: string[] | null
  postStatus: string | null
  color: string
  icon: string
}

export const VOUCHER_TYPES: VoucherTypeDef[] = [
  { code: 'receiving', label: 'إذن استلام شحنات', labelEn: 'Receiving Voucher', category: 'operational', prefix: 'RCV', requiresCourier: false, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: ['new','preparing'], postStatus: 'received', color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300', icon: 'PackageCheck' },
  { code: 'loading', label: 'إذن تحميل شحنات', labelEn: 'Loading Voucher', category: 'operational', prefix: 'LDG', requiresCourier: false, requiresDestBranch: true, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: ['received','preparing'], postStatus: 'loaded', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', icon: 'Truck' },
  { code: 'unloading', label: 'إذن تفريغ شحنات', labelEn: 'Unloading Voucher', category: 'operational', prefix: 'UNL', requiresCourier: false, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: ['in_transit','loaded'], postStatus: 'arrived', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', icon: 'PackageMinus' },
  { code: 'branch_transfer', label: 'إذن تحويل بين الفروع', labelEn: 'Branch Transfer', category: 'operational', prefix: 'TRN', requiresCourier: false, requiresDestBranch: true, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: ['received','loaded'], postStatus: 'in_transit', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300', icon: 'ArrowRightLeft' },
  { code: 'courier_assignment', label: 'إذن تسليم لمندوب', labelEn: 'Courier Assignment', category: 'operational', prefix: 'CRA', requiresCourier: true, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: ['arrived','received','preparing'], postStatus: 'assigned_courier', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300', icon: 'UserCheck' },
  { code: 'courier_receiving', label: 'إذن استلام من مندوب', labelEn: 'Courier Receiving', category: 'operational', prefix: 'CRV', requiresCourier: true, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: ['assigned_courier','out_for_delivery'], postStatus: 'received', color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300', icon: 'Hand' },
  { code: 'delivery', label: 'إذن تسليم شحنات', labelEn: 'Delivery Voucher', category: 'operational', prefix: 'DLV', requiresCourier: true, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: ['assigned_courier','out_for_delivery'], postStatus: 'delivered', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', icon: 'CheckCircle2' },
  { code: 'return', label: 'إذن مرتجع شحنات', labelEn: 'Return Voucher', category: 'operational', prefix: 'RET', requiresCourier: true, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: ['delivered','out_for_delivery','failed','postponed','assigned_courier'], postStatus: 'returned', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300', icon: 'Undo2' },
  { code: 'returned_receiving', label: 'إذن استلام مرتجعات', labelEn: 'Returned Receiving', category: 'operational', prefix: 'RTR', requiresCourier: false, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: ['returned'], postStatus: 'received_returned', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', icon: 'Undo2' },
  { code: 'collection', label: 'إذن تحصيل نقدية', labelEn: 'Collection Voucher', category: 'financial', prefix: 'COL', requiresCourier: false, requiresDestBranch: false, requiresParty: true, requiresEmployee: true, isFinancial: true, requiresShipments: false, preStatuses: null, postStatus: null, color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', icon: 'Banknote' },
  { code: 'cash_deposit', label: 'إذن توريد خزينة', labelEn: 'Cash Deposit', category: 'financial', prefix: 'DEP', requiresCourier: false, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: true, requiresShipments: false, preStatuses: null, postStatus: null, color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300', icon: 'Landmark' },
  { code: 'cash_disbursement', label: 'إذن صرف نقدية', labelEn: 'Cash Disbursement', category: 'financial', prefix: 'CSH', requiresCourier: false, requiresDestBranch: false, requiresParty: true, requiresEmployee: true, isFinancial: true, requiresShipments: false, preStatuses: null, postStatus: null, color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300', icon: 'BanknoteArrowDown' },
  { code: 'courier_settlement', label: 'إذن تسوية عهدة مندوب', labelEn: 'Courier Settlement', category: 'financial', prefix: 'STL', requiresCourier: true, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: true, requiresShipments: false, preStatuses: null, postStatus: null, color: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300', icon: 'Scale' },
  { code: 'inventory_count', label: 'إذن جرد مخزون', labelEn: 'Inventory Count', category: 'inventory', prefix: 'INV', requiresCourier: false, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: false, preStatuses: null, postStatus: null, color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300', icon: 'ClipboardCheck' },
  { code: 'waybill_amendment', label: 'إذن تعديل بوليصة', labelEn: 'Waybill Amendment', category: 'special', prefix: 'AMD', requiresCourier: false, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: null, postStatus: null, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', icon: 'FileEdit' },
  { code: 'write_off', label: 'إذن شطب/إتلاف شحنة', labelEn: 'Write-off Voucher', category: 'special', prefix: 'WOF', requiresCourier: false, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: null, postStatus: 'written_off', color: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300', icon: 'Trash2' },
]

export const VOUCHER_STATES = [
  { key: 'draft', label: 'مسودة', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  { key: 'pending', label: 'بانتظار الاعتماد', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  { key: 'approved', label: 'معتمد', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  { key: 'in_progress', label: 'قيد التنفيذ', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
  { key: 'completed', label: 'مكتمل', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  { key: 'rejected', label: 'مرفوض', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  { key: 'cancelled', label: 'ملغي', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
] as const

export const VOUCHER_CATEGORIES = [
  { key: 'operational', label: 'أذونات تشغيلية', color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  { key: 'financial', label: 'أذونات مالية', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  { key: 'inventory', label: 'أذونات جرد', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
  { key: 'special', label: 'أذونات خاصة', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const raw = mockJson as any

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

let idSeq = 0
function uid(prefix = 'mock'): string {
  idSeq += 1
  return `${prefix}-${Date.now().toString(36)}-${idSeq.toString(36)}`
}

/** Demo-grade deterministic password hash (sync, no deps) — suitable for the in-memory mock system. */
export function hashPassword(pwd: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  const s = `shipping::${pwd}::v1`
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + '.' + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)
}

/** Convert epoch-millis numbers to ISO strings so date formatters work. */
function isoDates<T extends Record<string, any>>(obj: T, keys: string[]): T {
  for (const k of keys) {
    const v = (obj as any)[k]
    if (typeof v === 'number' && v > 1e11) (obj as any)[k] = new Date(v).toISOString()
  }
  return obj
}

const DATE_KEYS = ['date', 'date2', 'shippingDate', 'expectedDeliveryDate', 'actualDeliveryDate', 'createdAt', 'updatedAt']

// ---------------------------------------------------------------------------
// In-memory database (built once at module load)
// ---------------------------------------------------------------------------
function buildDB() {
  const db: any = {
    shipments: raw.shipments.map((s: any) => isoDates({ ...s }, DATE_KEYS)),
    parties: raw.parties.map((p: any) => isoDates({ ...p }, ['createdAt'])),
    accounts: raw.accounts.map((a: any) => isoDates({ ...a }, ['createdAt'])),
    lookups: raw.lookups.map((l: any) => isoDates({ ...l }, ['createdAt', 'updatedAt'])),
    freight: raw.freight.map((f: any) => isoDates({ ...f }, ['createdAt', 'updatedAt', 'validFrom', 'validTo'])),
    branches: raw.branches.map((b: any) => isoDates({ ...b }, ['createdAt'])),
    warehouses: raw.warehouses.map((w: any) => isoDates({ ...w }, ['createdAt'])),
    users: raw.users.map((u: any) => ({ ...isoDates({ ...u }, ['createdAt']), password: undefined })),
    roles: deepClone(raw.roles),
    settings: deepClone(raw.settings),
    audit: raw.audit.map((a: any) => isoDates({ ...a }, ['date'])),
    // seeded below
    items: [],
    movements: [],
    journal: [],
    vouchers: [],
  }

  const mainBranch = db.branches[0] ?? null
  const mainWh = db.warehouses[0] ?? null
  const acc = (code: string) => db.accounts.find((a: any) => a.code === code)
  const contractor = (name: string) => db.parties.find((p: any) => p.isContractor && p.name === name)
  const customer = (name: string) => db.parties.find((p: any) => p.isCustomer && String(p.name).includes(name))

  // ---- Seed: inventory items ----
  const itemDefs: any[] = [
    { code: 'IT-001', name: 'كرتون تغليف مقاس كبير', nameEn: 'Large Carton Box', unit: 'قطعة', reorderLevel: 200, cost: 18, price: 25, balance: 1450 },
    { code: 'IT-002', name: 'لفائف سترتش', nameEn: 'Stretch Roll', unit: 'لفة', reorderLevel: 100, cost: 55, price: 70, balance: 320 },
    { code: 'IT-003', name: 'شريط لاصق شفاف', nameEn: 'Transparent Tape', unit: 'قطعة', reorderLevel: 150, cost: 8, price: 12, balance: 85 },
    { code: 'IT-004', name: 'أسطوانة فريون', nameEn: 'Freon Gas Cylinder', unit: 'أسطوانة', reorderLevel: 20, cost: 350, price: 420, balance: 46 },
    { code: 'IT-005', name: 'زيت محركات 20W-50', nameEn: 'Engine Oil 20W-50', unit: 'جالون', reorderLevel: 30, cost: 260, price: 310, balance: 72 },
    { code: 'IT-006', name: 'باليت خشبي', nameEn: 'Wooden Pallet', unit: 'قطعة', reorderLevel: 50, cost: 95, price: 130, balance: 180 },
    { code: 'IT-007', name: 'حزام تثبيت (شد)', nameEn: 'Lashing Belt', unit: 'قطعة', reorderLevel: 40, cost: 180, price: 240, balance: 22 },
    { code: 'IT-008', name: 'غطاء بلاستيك للشحن', nameEn: 'Plastic Shipping Cover', unit: 'قطعة', reorderLevel: 300, cost: 6, price: 10, balance: 640 },
  ]
  db.items = itemDefs.map((it, i) => ({
    id: `seed-item-${i + 1}`,
    ...it,
    name: it.name,
    warehouseId: mainWh?.id ?? null,
    notes: null,
    active: 1,
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
  }))

  // ---- Seed: stock movements ----
  const d = (day: number) => `2026-09-${String(day).padStart(2, '0')}T10:00:00.000Z`
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
  db.movements = mvDefs.map((m, i) => ({
    id: `seed-mv-${i + 1}`,
    type: m.type,
    date: d(m.day),
    itemId: db.items[m.itemId - 1].id,
    warehouseId: mainWh?.id ?? null,
    toWarehouseId: m.type === 'transfer' ? (mainWh?.id ?? null) : null,
    quantity: m.qty,
    unitCost: m.unitCost,
    totalCost: Math.abs(m.qty) * m.unitCost,
    notes: m.notes,
    userName: 'admin',
    createdAt: d(m.day),
  }))

  // ---- Seed: journal entries (double-entry, balanced) ----
  const J = (n: number) => `JE-${String(n).padStart(4, '0')}`
  const mkLines = (ls: any[]) =>
    ls.map((l, i) => {
      const a = acc(l.code)
      return {
        id: `seed-jl-${l.code}-${i}`,
        accountId: a?.id ?? null,
        account: a ? { id: a.id, code: a.code, name: a.name } : null,
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
        description: l.description ?? '',
        partyId: l.partyId ?? null,
        party: l.partyId ? { id: l.partyId, name: db.parties.find((p: any) => p.id === l.partyId)?.name ?? null } : null,
      }
    })
  const entryDefs: any[] = [
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
      entryNo: J(3), date: d(15), description: 'صرف مستحقات مقاولي النقل', reference: 'PAY-CONTR', status: 'posted',
      lines: [
        { code: '5101', debit: 250000, credit: 0, description: 'تكلفة نقل مستحقة', partyId: contractor('السيد ربيع')?.id },
        { code: '2102', debit: 0, credit: 250000, description: 'مستحقات المقاولين', partyId: contractor('السيد ربيع')?.id },
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
  db.journal = entryDefs.map((e, i) => {
    const lines = mkLines(e.lines)
    return {
      id: `seed-je-${i + 1}`,
      entryNo: e.entryNo,
      date: e.date,
      description: e.description,
      reference: e.reference,
      branchId: mainBranch?.id ?? null,
      status: e.status,
      totalDebit: lines.reduce((s, l) => s + (l.debit || 0), 0),
      totalCredit: lines.reduce((s, l) => s + (l.credit || 0), 0),
      lines,
      createdAt: e.date,
      updatedAt: e.date,
    }
  })

  // ---- Seed: vouchers (unified operational + financial model) ----
  // (1) حالات شحن جديدة تخدم دورة الأذونات التشغيلية
  const opStatusDefs: any[] = [
    { key: 'received', label: 'مستلمة بالفرع', tone: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300', sortOrder: 12 },
    { key: 'loaded', label: 'محمّلة على المركبة', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', sortOrder: 13 },
    { key: 'in_transit', label: 'في الطريق بين الفروع', tone: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300', sortOrder: 14 },
    { key: 'arrived', label: 'وصلت فرع الوجهة', tone: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', sortOrder: 15 },
    { key: 'assigned_courier', label: 'مُسلّمة لمندوب التوصيل', tone: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300', sortOrder: 16 },
    { key: 'received_returned', label: 'مرتجعة مستلمة بالفرع', tone: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', sortOrder: 17 },
    { key: 'written_off', label: 'شطبت من المخزون', tone: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300', sortOrder: 18 },
  ]
  const opCreatedAt = d(1)
  for (const os of opStatusDefs) {
    if (!db.lookups.find((l: any) => l.category === 'shipment_status' && l.key === os.key)) {
      db.lookups.push({ id: uid('lk'), category: 'shipment_status', key: os.key, label: os.label, labelEn: null, tone: os.tone, icon: null, active: 1, sortOrder: os.sortOrder, isSystem: 1, createdAt: opCreatedAt, updatedAt: opCreatedAt })
    }
  }
  // (2) بناء الأذونات الموحدة
  const adminId = 'seed-user-admin'
  const mkApproval = (action: string, at: string, notes?: string): any => ({ action, userId: adminId, userName: 'admin', at, notes: notes ?? null })
  const branchId = mainBranch?.id ?? null
  const contractorId = db.parties.find((p: any) => p.isContractor)?.id ?? null
  const byStatus = (st: string, n: number, offset = 0) => db.shipments.slice(offset, offset + n).map((s: any) => s.id)
  const mkItems = (ids: string[], at: string) => ids.map((sid) => ({ id: uid('it'), shipmentId: sid, notes: null, addedAt: at, addedBy: 'admin' }))
  const sumFreight = (ids: string[]) => ids.reduce((acc, sid) => acc + (Number(db.shipments.find((s: any) => s.id === sid)?.freightTotal ?? 0)), 0)
  const newShip = byStatus('new', 3, 0), prepShip = byStatus('preparing', 3, 10), ofdShip = byStatus('out_for_delivery', 3, 20), delShip = byStatus('delivered', 4, 30), retShip = byStatus('returned', 2, 40)
  const mkV = (o: any) => ({
    id: o.id, voucherNo: o.voucherNo, type: o.type, status: o.status,
    sourceBranchId: branchId, destBranchId: o.dest ?? branchId,
    employeeId: adminId, courierId: o.courier ?? null, partyId: o.party ?? null,
    party: o.party ? { id: o.party, name: db.parties.find((p: any) => p.id === o.party)?.name ?? null } : null,
    items: o.items ?? [], totalValue: o.total ?? 0, amount: o.amount ?? null, notes: o.notes ?? null, attachments: [],
    accountName: o.account ?? null, journalEntryNo: o.je ?? null,
    createdBy: adminId, createdByName: 'admin', createdAt: o.date, updatedBy: null, updatedAt: o.date,
    approvalLog: o.log ?? [mkApproval('create', o.date)],
  })
  db.vouchers = []
  // أذونات تشغيلية مكتملة بأطوار مختلفة
  if (newShip.length) db.vouchers.push(mkV({ id: 'seed-ovc-1', voucherNo: 'RCV-0001', type: 'receiving', status: 'completed', date: d(2), items: mkItems(newShip.slice(0, 3), d(2)), total: sumFreight(newShip.slice(0, 3)), log: [mkApproval('create', d(2)), mkApproval('submit', d(2)), mkApproval('approve', d(2)), mkApproval('execute', d(2)), mkApproval('complete', d(2))] }))
  if (prepShip.length) db.vouchers.push(mkV({ id: 'seed-ovc-2', voucherNo: 'LDG-0001', type: 'loading', status: 'completed', dest: branchId, date: d(4), items: mkItems(prepShip.slice(0, 3), d(4)), total: sumFreight(prepShip.slice(0, 3)), log: [mkApproval('create', d(4)), mkApproval('submit', d(4)), mkApproval('approve', d(4)), mkApproval('execute', d(4)), mkApproval('complete', d(4))] }))
  if (ofdShip.length) db.vouchers.push(mkV({ id: 'seed-ovc-3', voucherNo: 'CRA-0001', type: 'courier_assignment', status: 'completed', courier: contractorId, date: d(6), items: mkItems(ofdShip.slice(0, 3), d(6)), total: sumFreight(ofdShip.slice(0, 3)), log: [mkApproval('create', d(6)), mkApproval('submit', d(6)), mkApproval('approve', d(6)), mkApproval('execute', d(6)), mkApproval('complete', d(6))] }))
  if (delShip.length) db.vouchers.push(mkV({ id: 'seed-ovc-4', voucherNo: 'DLV-0001', type: 'delivery', status: 'completed', courier: contractorId, date: d(8), items: mkItems(delShip.slice(0, 4), d(8)), total: sumFreight(delShip.slice(0, 4)), log: [mkApproval('create', d(8)), mkApproval('submit', d(8)), mkApproval('approve', d(8)), mkApproval('execute', d(8)), mkApproval('complete', d(8))] }))
  // إذن قيد الاعتماد
  if (prepShip.length) db.vouchers.push(mkV({ id: 'seed-ovc-5', voucherNo: 'LDG-0002', type: 'loading', status: 'pending', dest: branchId, date: d(20), items: mkItems(prepShip.slice(0, 2), d(20)), total: sumFreight(prepShip.slice(0, 2)), notes: 'دفعة تحميل مسائية', log: [mkApproval('create', d(20)), mkApproval('submit', d(20))] }))
  // إذن مسودة
  if (retShip.length) db.vouchers.push(mkV({ id: 'seed-ovc-6', voucherNo: 'RTR-0001', type: 'returned_receiving', status: 'draft', date: d(22), items: mkItems(retShip.slice(0, 2), d(22)), total: sumFreight(retShip.slice(0, 2)), notes: 'استلام مرتجعات من المندوب' }))
  // إذن معتمد بانتظار التنفيذ
  if (ofdShip.length) db.vouchers.push(mkV({ id: 'seed-ovc-7', voucherNo: 'RET-0001', type: 'return', status: 'approved', courier: contractorId, date: d(24), items: mkItems(ofdShip.slice(0, 2), d(24)), total: sumFreight(ofdShip.slice(0, 2)), notes: 'مرتجع فشل التسليم', log: [mkApproval('create', d(24)), mkApproval('submit', d(24)), mkApproval('approve', d(24))] }))
  // 6 سندات مالية (مهاجرة من النموذج القديم)
  const finDefs: any[] = [
    { type: 'collection', party: customer('ADEL HASSAN')?.id ?? null, amount: 5000, day: 8, notes: 'تحصيل دفعة نولون', je: 'JE-0002' },
    { type: 'cash_disbursement', party: contractor('السيد ربيع')?.id ?? null, amount: 120000, day: 15, notes: 'دفعة مستحقات نقل', je: 'JE-0003' },
    { type: 'collection', party: customer('Abd al hakeim')?.id ?? null, amount: 3500, day: 17, notes: 'تحصيل جزئي', je: 'JE-0002' },
    { type: 'cash_disbursement', party: contractor('المنسي')?.id ?? null, amount: 80000, day: 19, notes: 'دفعة مستحقات نقل', je: 'JE-0003' },
    { type: 'collection', party: customer('Abdelaziz')?.id ?? null, amount: 2500, day: 24, notes: 'تحصيل نولون شحنات', je: 'JE-0002' },
    { type: 'cash_disbursement', party: contractor('جعلص')?.id ?? null, amount: 50000, day: 26, notes: 'دفعة على الحساب', je: 'JE-0003' },
  ]
  finDefs.forEach((f, i) => {
    const tdef = VOUCHER_TYPES.find((t) => t.code === f.type)!
    db.vouchers.push(mkV({ id: `seed-ovc-fin-${i + 1}`, voucherNo: `${tdef.prefix}-${String(i + 1).padStart(4, '0')}`, type: f.type, status: 'completed', party: f.party, amount: f.amount, total: f.amount, account: 'الصندوق', je: f.je, date: d(f.day), notes: f.notes, log: [mkApproval('create', d(f.day)), mkApproval('submit', d(f.day)), mkApproval('approve', d(f.day)), mkApproval('execute', d(f.day)), mkApproval('complete', d(f.day))] }))
  })

  // ---- Seed: roles normalization + defaults ----
  const parsePerms = (r: any): string[] => {
    if (Array.isArray(r?.permissions)) return r.permissions
    try { const arr = JSON.parse(String(r?.permissions ?? '[]')); return Array.isArray(arr) ? arr : [] } catch { return [] }
  }
  const now0 = '2026-09-01T09:00:00.000Z'
  const ensureRole = (name: string, label: string, permissions: string[]) => {
    let role = db.roles.find((r: any) => r.name === name)
    if (!role) {
      role = { id: `seed-role-${name}`, name, label, permissions: JSON.stringify(permissions), createdAt: now0 }
      db.roles.push(role)
    } else {
      role.label = role.label || label
      // إجبار تحديث صلاحيات الأدوار النظامية المعرفة هنا (تتجاوز بذور mock-data القديمة)
      role.permissions = JSON.stringify(permissions)
    }
    return role
  }
  ensureRole('admin', 'مدير النظام', ['*'])
  ensureRole('finance_manager', 'مدير مالي', ['accounting.*', 'reports.*', 'shipments.read', 'parties.*', 'audit.view', 'dashboard.view', 'vouchers.view', 'vouchers.view.all', 'vouchers.create', 'vouchers.approve', 'vouchers.reject', 'vouchers.execute', 'vouchers.cancel', 'vouchers.print', 'vouchers.export'])
  ensureRole('branch_manager', 'مدير فرع', ['shipments.*', 'parties.*', 'inventory.*', 'structure.view', 'dashboard.view', 'vouchers.view', 'vouchers.create', 'vouchers.edit', 'vouchers.submit', 'vouchers.approve', 'vouchers.execute', 'vouchers.cancel', 'vouchers.print', 'vouchers.export'])
  ensureRole('operations', 'موظف عمليات', ['shipments.view', 'shipments.create', 'shipments.edit', 'shipments.status', 'shipments.assign', 'shipments.print', 'shipments.export', 'parties.view', 'inventory.view', 'dashboard.view', 'vouchers.view', 'vouchers.create', 'vouchers.edit', 'vouchers.submit', 'vouchers.print', 'vouchers.export'])
  ensureRole('voucher_clerk', 'كاتب أذونات', ['dashboard.view', 'shipments.view', 'parties.view', 'structure.view', 'vouchers.view', 'vouchers.create', 'vouchers.edit', 'vouchers.submit', 'vouchers.print'])
  ensureRole('viewer', 'عارض (مشاهدة فقط)', ['dashboard.view', 'shipments.view', 'parties.view', 'inventory.view', 'accounting.view', 'reports.view', 'vouchers.view'])
  // توحيد الصلاحيات كمصفوفات
  db.roles.forEach((r: any) => { r.permissions = parsePerms(r) })

  // ---- Seed: users with credentials ----
  const ensureUser = (username: string, name: string, password: string, roleName: string) => {
    const role = db.roles.find((r: any) => r.name === roleName)
    let u = db.users.find((x: any) => x.username === username)
    if (!u) {
      u = { id: `seed-user-${username}`, username, name, email: null, phone: null, branchId: mainBranch?.id ?? null, active: 1, passwordHash: hashPassword(password), lastLoginAt: null, createdAt: now0 }
      db.users.push(u)
    } else {
      u.passwordHash = hashPassword(password)
      u.active = u.active ?? 1
    }
    u.roleId = role?.id ?? u.roleId ?? null
    return u
  }
  ensureUser('admin', 'مدير النظام', 'admin123', 'admin')
  ensureUser('finance', 'حسن — المدير المالي', 'fin123', 'finance_manager')
  ensureUser('ops', 'محمود — العمليات', 'ops123', 'branch_manager')
  ensureUser('viewer', 'سارة — مشاهدة فقط', 'view123', 'viewer')

  // ---- Seed: extra audit entries (in addition to the import record) ----
  const extraAudit: any[] = [
    { action: 'create', entity: 'journal_entry', entityId: db.journal[0]?.id, notes: 'قيد افتتاحي رأس المال', day: 1, userName: 'admin' },
    { action: 'create', entity: 'voucher', entityId: db.vouchers[0]?.id, notes: 'إذن استلام شحنات RCV-0001', day: 8, userName: 'admin' },
    { action: 'create', entity: 'inventory_movement', entityId: db.movements[0]?.id, notes: 'توريد افتتاحي للمخزن', day: 1, userName: 'admin' },
    { action: 'post', entity: 'journal_entry', entityId: db.journal[1]?.id, notes: 'ترحيل قيد تحصيل النولون', day: 9, userName: 'admin' },
    { action: 'update', entity: 'freight_price', entityId: db.freight[0]?.id, notes: 'تحديث أسعار خط القاهرة 1', day: 12, userName: 'admin' },
    { action: 'create', entity: 'user', entityId: db.users[0]?.id, notes: 'إنشاء مستخدم مدير النظام', day: 1, userName: 'system' },
  ]
  for (const a of extraAudit) {
    db.audit.push({
      id: uid('audit'), date: a.day ? `2026-09-${String(a.day).padStart(2, '0')}T11:30:00.000Z` : new Date().toISOString(),
      userId: null, userName: a.userName, action: a.action, entity: a.entity, entityId: a.entityId,
      beforeData: null, afterData: null, notes: a.notes,
    })
  }
  db.audit.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return db
}

const db = buildDB() as any

// تسلسل أرقام الأذونات (لكل نوع بادئة خاصة) — يمنع تكرار الأرقام بعد الحذف
db.seq = { voucher: db.vouchers.length }
const __vcCounters: Record<string, number> = {}
function nextVoucherNo(type: string): string {
  const tdef = VOUCHER_TYPES.find((t) => t.code === type)
  const prefix = tdef?.prefix ?? 'VCH'
  const existing = db.vouchers.filter((v: any) => v.type === type).length
  __vcCounters[prefix] = Math.max(__vcCounters[prefix] ?? 0, existing) + 1
  return `${prefix}-${String(__vcCounters[prefix]).padStart(4, '0')}`
}

// ---------------------------------------------------------------------------
// Lookup maps + enrichment
// ---------------------------------------------------------------------------
const partyById = new Map<string, any>(db.parties.map((p: any) => [p.id, p]))
const branchById = new Map<string, any>(db.branches.map((b: any) => [b.id, b]))
const whById = new Map<string, any>(db.warehouses.map((w: any) => [w.id, w]))
const itemById = new Map<string, any>(db.items.map((i: any) => [i.id, i]))

function partyRef(id: string | null) {
  if (!id) return null
  const p = partyById.get(id)
  return p ? { id: p.id, name: p.name } : null
}

function enrichShipment(s: any) {
  const st = { ...s }
  st.customer = partyRef(s.customerId)
  st.contractor = partyRef(s.contractorId)
  st.branch = s.branchId ? (branchById.get(s.branchId) ? { id: s.branchId, name: branchById.get(s.branchId).name } : null) : null
  st.warehouse = s.warehouseId ? (whById.get(s.warehouseId) ? { id: s.warehouseId, name: whById.get(s.warehouseId).name } : null) : null
  if (!Array.isArray(st.statusHistory)) {
    st.statusHistory = [{
      status: s.status,
      notes: 'استيراد أولي من ملف مبيعات العاشر 3',
      date: st.updatedAt ?? st.createdAt ?? null,
      userName: 'system',
    }]
  }
  // Profit margin = customer freight (sell) - contractor freight (cost)
  const sell = Number(st.freightTotal ?? 0)
  const cost = Number(st.totalSuppliers ?? 0)
  st.margin = Math.round((sell - cost) * 100) / 100
  // Linked vouchers (operational model: items-based linkage)
  st.vouchers = db.vouchers
    .filter((v: any) => Array.isArray(v.items) && v.items.some((it: any) => it.shipmentId === s.id))
    .map((v: any) => ({ id: v.id, voucherNo: v.voucherNo, type: v.type, status: v.status, date: v.createdAt, amount: v.amount, notes: v.notes ?? null }))
    .sort((a: any, b: any) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime())
  return st
}

// ============================================================================
// محرك الأذونات التشغيلية: الانتقالات، الإثراء، تأثيرات الشحنة، القيود
// ============================================================================
const TRANSITIONS: Record<string, { action: string; to: string; perm: string }[]> = {
  draft: [
    { action: 'submit', to: 'pending', perm: 'vouchers.submit' },
    { action: 'cancel', to: 'cancelled', perm: 'vouchers.cancel' },
  ],
  pending: [
    { action: 'approve', to: 'approved', perm: 'vouchers.approve' },
    { action: 'reject', to: 'rejected', perm: 'vouchers.reject' },
    { action: 'cancel', to: 'cancelled', perm: 'vouchers.cancel' },
  ],
  rejected: [
    { action: 'resubmit', to: 'draft', perm: 'vouchers.edit' },
  ],
  approved: [
    { action: 'execute', to: 'in_progress', perm: 'vouchers.execute' },
    { action: 'cancel', to: 'cancelled', perm: 'vouchers.cancel' },
  ],
  in_progress: [
    { action: 'complete', to: 'completed', perm: 'vouchers.execute' },
    { action: 'cancel', to: 'cancelled', perm: 'vouchers.cancel' },
  ],
  completed: [],
  cancelled: [],
}

function actionLabel(action: string): string {
  const map: Record<string, string> = { submit: 'رفع', approve: 'اعتماد', reject: 'رفض', execute: 'تنفيذ', complete: 'إكمال', cancel: 'إلغاء', resubmit: 'إعادة', edit: 'تعديل', create: 'إنشاء' }
  return map[action] ?? action
}

function enrichOpVoucher(v: any, full = false): any {
  const tdef = VOUCHER_TYPES.find((t) => t.code === v.type)
  const stateDef = VOUCHER_STATES.find((s) => s.key === v.status)
  const srcBranch = v.sourceBranchId ? (branchById.get(v.sourceBranchId) ? { id: v.sourceBranchId, name: branchById.get(v.sourceBranchId).name } : null) : null
  const dstBranch = v.destBranchId ? (branchById.get(v.destBranchId) ? { id: v.destBranchId, name: branchById.get(v.destBranchId).name } : null) : null
  const emp = v.employeeId ? (db.users.find((u: any) => u.id === v.employeeId) ? { id: v.employeeId, name: db.users.find((u: any) => u.id === v.employeeId).name } : null) : null
  const courier = v.courierId ? partyRef(v.courierId) : null
  const party = v.partyId ? partyRef(v.partyId) : null
  const items = (v.items ?? []).map((it: any) => {
    const s = db.shipments.find((sh: any) => sh.id === it.shipmentId)
    return { ...it, shipment: s ? { id: s.id, shipmentNo: s.shipmentNo, status: s.status, destination: s.destination, recipientName: s.recipientName, freightTotal: s.freightTotal, customer: partyRef(s.customerId) } : null }
  })
  const itemCount = items.length
  const totalValue = tdef?.isFinancial ? (v.amount ?? 0) : (v.totalValue ?? items.reduce((acc: number, it: any) => acc + (Number(it.shipment?.freightTotal ?? 0)), 0))
  return {
    ...v,
    typeLabel: tdef?.label ?? v.type,
    typeLabelEn: tdef?.labelEn ?? v.type,
    typeCategory: tdef?.category ?? 'operational',
    typeColor: tdef?.color ?? '',
    typeIcon: tdef?.icon ?? 'FileText',
    typePrefix: tdef?.prefix ?? 'VCH',
    isFinancial: tdef?.isFinancial ?? false,
    requiresShipments: tdef?.requiresShipments ?? false,
    statusLabel: stateDef?.label ?? v.status,
    statusColor: stateDef?.color ?? '',
    sourceBranch: srcBranch,
    destBranch: dstBranch,
    employee: emp,
    courier,
    party,
    items: items.map((it: any) => ({ id: it.id, shipmentId: it.shipmentId, shipment: it.shipment, notes: it.notes, addedAt: it.addedAt, addedBy: it.addedBy })),
    itemCount,
    totalValue: Math.round(totalValue * 100) / 100,
  }
}

function postVoucherJournal(v: any, kind: 'receipt' | 'payment'): void {
  const cashAcc = db.accounts.find((a: any) => a.code === '1101')
  const partyAcc = kind === 'receipt'
    ? db.accounts.find((a: any) => a.code === '1103')
    : db.accounts.find((a: any) => a.code === '2102')
  if (!cashAcc || !partyAcc || !v.amount) return
  const entryNo = `JE-${String(db.journal.length + 1).padStart(4, '0')}`
  v.journalEntryNo = entryNo
  const party = partyRef(v.partyId)
  const linkedNos = (v.items ?? []).map((it: any) => db.shipments.find((s: any) => s.id === it.shipmentId)?.shipmentNo).filter(Boolean)
  db.journal.unshift({
    id: uid('je'), entryNo, date: v.createdAt,
    description: `${kind === 'receipt' ? 'سند قبض' : 'سند صرف'} ${v.voucherNo} — ${party?.name ?? ''}${linkedNos.length ? ` (شحنات: ${linkedNos.join('، ')})` : ''}`,
    reference: v.voucherNo, branchId: null, status: 'posted', totalDebit: v.amount, totalCredit: v.amount,
    lines: kind === 'receipt'
      ? [
        { id: uid('jl'), accountId: cashAcc.id, account: { id: cashAcc.id, code: cashAcc.code, name: cashAcc.name }, debit: v.amount, credit: 0, description: 'نقدية مستلمة', partyId: v.partyId, party },
        { id: uid('jl'), accountId: partyAcc.id, account: { id: partyAcc.id, code: partyAcc.code, name: partyAcc.name }, debit: 0, credit: v.amount, description: 'تحصيل', partyId: v.partyId, party },
      ]
      : [
        { id: uid('jl'), accountId: partyAcc.id, account: { id: partyAcc.id, code: partyAcc.code, name: partyAcc.name }, debit: v.amount, credit: 0, description: 'مستحقات', partyId: v.partyId, party },
        { id: uid('jl'), accountId: cashAcc.id, account: { id: cashAcc.id, code: cashAcc.code, name: cashAcc.name }, debit: 0, credit: v.amount, description: 'نقدية مدفوعة', partyId: v.partyId, party },
      ],
    createdAt: nowISO, updatedAt: nowISO,
  })
}

function itemBalance(itemId: string): number {
  let bal = 0
  for (const m of db.movements) {
    if (m.itemId !== itemId) continue
    if (m.type === 'receipt') bal += m.quantity
    else if (m.type === 'issue') bal += m.quantity // stored negative
    else if (m.type === 'adjustment') bal += m.quantity // signed
    // transfer keeps total balance
  }
  return Math.round(bal * 100) / 100
}

function enrichItem(it: any) {
  const balance = itemBalance(it.id)
  return {
    ...it,
    balance,
    isLowStock: balance <= (it.reorderLevel ?? 0),
    warehouse: it.warehouseId ? (whById.get(it.warehouseId) ? { id: it.warehouseId, name: whById.get(it.warehouseId).name } : null) : null,
    stockValue: Math.round(balance * (it.cost ?? 0) * 100) / 100,
  }
}

function enrichMovement(m: any) {
  const it = itemById.get(m.itemId)
  return {
    ...m,
    item: it ? { id: it.id, name: it.name, code: it.code, unit: it.unit } : null,
    warehouse: m.warehouseId ? (whById.get(m.warehouseId) ? { id: m.warehouseId, name: whById.get(m.warehouseId).name } : null) : null,
    toWarehouse: m.toWarehouseId ? (whById.get(m.toWarehouseId) ? { id: m.toWarehouseId, name: whById.get(m.toWarehouseId).name } : null) : null,
  }
}

/** Account balances derived from posted journal lines. */
function accountBalances(): Map<string, { debit: number; credit: number }> {
  const map = new Map<string, { debit: number; credit: number }>()
  for (const e of db.journal) {
    if (e.status !== 'posted') continue
    for (const l of e.lines) {
      if (!l.accountId) continue
      const cur = map.get(l.accountId) ?? { debit: 0, credit: 0 }
      cur.debit += l.debit || 0
      cur.credit += l.credit || 0
      map.set(l.accountId, cur)
    }
  }
  return map
}

function enrichAccount(a: any, balances: Map<string, { debit: number; credit: number }>) {
  const b = balances.get(a.id) ?? { debit: 0, credit: 0 }
  const parent = a.parentId ? db.accounts.find((x: any) => x.id === a.parentId) : null
  return { ...a, parent: parent ? { id: parent.id, name: parent.name } : null, debit: b.debit, credit: b.credit, balance: b.debit - b.credit }
}

/** Deterministic party aggregates from shipments + vouchers. */
function partyAggregates(): Map<string, { shipments: number; freightTotal: number; totalSuppliers: number; customerPay: number }> {
  const map = new Map<string, any>()
  const get = (id: string) => {
    if (!map.has(id)) map.set(id, { shipments: 0, freightTotal: 0, totalSuppliers: 0, customerPay: 0 })
    return map.get(id)
  }
  for (const s of db.shipments) {
    if (s.customerId) {
      const a = get(s.customerId)
      a.shipments += 1
      a.freightTotal += s.freightTotal ?? 0
      a.totalSuppliers += s.totalSuppliers ?? 0
      a.customerPay += s.customerPay ?? 0
    }
    if (s.contractorId && s.contractorId !== s.customerId) {
      const a = get(s.contractorId)
      a.shipments += 1
      a.freightTotal += s.freightTotal ?? 0
      a.totalSuppliers += s.totalSuppliers ?? 0
    }
  }
  return map
}

function addAudit(action: string, entity: string, entityId: string | null, notes: string, userName = 'admin') {
  db.audit.unshift({
    id: uid('audit'), date: new Date().toISOString(), userId: null, userName,
    action, entity, entityId, beforeData: null, afterData: null, notes,
  })
}

function paginate<T>(arr: T[], page: number, pageSize: number) {
  const total = arr.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const p = Math.min(Math.max(1, page), totalPages)
  const start = (p - 1) * pageSize
  return { items: arr.slice(start, start + pageSize), total, page: p, pageSize, totalPages }
}

function inRange(dateISO: string | null | undefined, from: string | null, to: string | null): boolean {
  if (!from && !to) return true
  if (!dateISO) return false
  const t = new Date(dateISO).getTime()
  if (from && t < new Date(from + 'T00:00:00').getTime()) return false
  if (to && t > new Date(to + 'T23:59:59').getTime()) return false
  return true
}

// ---------------------------------------------------------------------------
// GET router (mirrors every API route's response shape)
// ---------------------------------------------------------------------------
function handleGet(url: string): any {
  const u = new URL(url, 'http://local')
  const p = u.pathname.replace(/\/+$/, '')
  const q = u.searchParams
  const qs = (k: string) => q.get(k)?.trim() ?? ''
  let m: RegExpMatchArray | null = null

  // ----- stats -----
  if (p === '/api/stats') {
    const stats = deepClone(raw.stats)
    // daily/dateRange dates are epoch-seconds strings → ISO
    stats.daily = (stats.daily ?? []).map((d: any) => ({ ...d, date: new Date(Number(d.date) * 1000).toISOString() }))
    if (stats.dateRange) {
      stats.dateRange = {
        from: stats.dateRange.from ? new Date(Number(stats.dateRange.from) * 1000).toISOString() : null,
        to: stats.dateRange.to ? new Date(Number(stats.dateRange.to) * 1000).toISOString() : null,
      }
    }
    // contractor ids → names
    stats.contractors = (stats.contractors ?? []).map((c: any) => ({ ...c, name: partyById.get(c.name)?.name ?? c.name }))
    return stats
  }

  // ----- shipments list -----
  if (p === '/api/shipments') {
    let items = db.shipments.map(enrichShipment).sort((a: any, b: any) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime())
    const search = qs('q').toLowerCase()
    if (search) {
      items = items.filter((s: any) =>
        [s.shipmentNo, s.billNo, s.recipientName, s.destination, s.destinationEn, s.routeCode, s.deliveryPhones]
          .some((f: any) => String(f ?? '').toLowerCase().includes(search)))
    }
    const status = qs('status')
    if (status && status !== 'all') items = items.filter((s: any) => s.status === status)
    const dest = qs('destination')
    if (dest && dest !== 'all') items = items.filter((s: any) => s.destination === dest)
    const contractor = qs('contractor')
    if (contractor && contractor !== 'all') items = items.filter((s: any) => s.contractorId === contractor)
    const province = qs('province')
    if (province && province !== 'all') items = items.filter((s: any) => (s.routeCode ?? '').includes(province))
    const idsParam = qs('ids')
    if (idsParam) {
      const idSet = new Set(idsParam.split(',').filter(Boolean))
      items = items.filter((s: any) => idSet.has(s.id))
    }
    const page = Math.max(1, parseInt(qs('page') || '1', 10))
    const pageSize = Math.min(500, Math.max(1, parseInt(qs('pageSize') || '20', 10)))
    return paginate(items, page, pageSize)
  }

  // ----- shipment detail -----
  const mShip = p.match(/^\/api\/shipments\/([^/]+)$/)
  if (mShip) {
    const s = db.shipments.find((x: any) => x.id === mShip[1])
    if (!s) throw new Error('الشحنة غير موجودة')
    return enrichShipment(s)
  }

  // ----- parties -----
  if (p === '/api/parties') {
    const agg = partyAggregates()
    let items = db.parties.map((party: any) => {
      const a = agg.get(party.id) ?? { shipments: 0, freightTotal: 0, totalSuppliers: 0, customerPay: 0 }
      return {
        ...party,
        branch: party.branchId && branchById.get(party.branchId) ? { id: party.branchId, name: branchById.get(party.branchId).name } : null,
        _count: { shipments: a.shipments },
        _sum: { freightTotal: Math.round(a.freightTotal), totalSuppliers: Math.round(a.totalSuppliers), customerPay: Math.round(a.customerPay) },
      }
    })
    const type = qs('type')
    if (type === 'customer') items = items.filter((x: any) => x.isCustomer)
    if (type === 'contractor') items = items.filter((x: any) => x.isContractor)
    if (type === 'supplier') items = items.filter((x: any) => x.isSupplier)
    const search = qs('q').toLowerCase()
    if (search) items = items.filter((x: any) => String(x.name ?? '').toLowerCase().includes(search))
    return { items, total: items.length }
  }

  // ----- simple collections -----
  if (p === '/api/branches') return { items: db.branches, total: db.branches.length }
  if (p === '/api/warehouses') {
    return { items: db.warehouses.map((w: any) => ({ ...w, branch: w.branchId && branchById.get(w.branchId) ? { id: w.branchId, name: branchById.get(w.branchId).name } : null })), total: db.warehouses.length }
  }
  if (p === '/api/users') {
    return {
      items: db.users.map((u: any) => {
        const role = db.roles.find((r: any) => r.id === u.roleId) ?? null
        return { ...u, passwordHash: undefined, role: role ? { id: role.id, name: role.name, label: role.label } : null }
      }),
      total: db.users.length,
    }
  }
  if (p === '/api/roles') {
    return {
      items: db.roles.map((r: any) => ({
        ...r,
        permissions: Array.isArray(r.permissions) ? r.permissions : [],
        _count: { users: db.users.filter((u: any) => u.roleId === r.id).length },
      })),
      total: db.roles.length,
    }
  }
  if (p === '/api/settings') return { items: db.settings, total: db.settings.length }

  // ----- audit -----
  if (p === '/api/audit') {
    const entity = qs('entity')
    const search = qs('q').toLowerCase()
    let items = db.audit
    if (entity) items = items.filter((a: any) => a.entity === entity)
    if (search) items = items.filter((a: any) => [a.userName, a.action, a.entity, a.notes].some((f: any) => String(f ?? '').toLowerCase().includes(search)))
    return { items: items.slice(0, 200), total: items.length }
  }

  // ----- items -----
  if (p === '/api/items') {
    let items = db.items.map(enrichItem)
    if (qs('lowStock') === '1') items = items.filter((i: any) => i.isLowStock)
    return { items, total: items.length }
  }

  // ----- movements -----
  if (p === '/api/movements') {
    const items = db.movements.map(enrichMovement).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
    return { items, total: items.length }
  }

  // ----- accounts -----
  if (p === '/api/accounts') {
    const bal = accountBalances()
    return { items: db.accounts.map((a: any) => enrichAccount(a, bal)) }
  }

  // ----- journal -----
  if (p === '/api/journal') {
    const status = qs('status')
    let items = db.journal.map((e: any) => ({
      ...e,
      branch: e.branchId && branchById.get(e.branchId) ? { id: e.branchId, name: branchById.get(e.branchId).name } : null,
    })).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
    if (status) items = items.filter((e: any) => e.status === status)
    return { items, total: items.length }
  }

  // ----- vouchers (unified operational + financial) -----
  if (p === '/api/vouchers/stats') {
    const all = db.vouchers
    const byStatus: Record<string, number> = {}
    const byType: Record<string, number> = {}
    const byBranch: Record<string, number> = {}
    const byEmployee: Record<string, number> = {}
    for (const v of all) {
      byStatus[v.status] = (byStatus[v.status] ?? 0) + 1
      byType[v.type] = (byType[v.type] ?? 0) + 1
      const br = v.sourceBranchId ?? '_none'
      byBranch[br] = (byBranch[br] ?? 0) + 1
      const em = v.employeeId ?? '_none'
      byEmployee[em] = (byEmployee[em] ?? 0) + 1
    }
    return {
      total: all.length,
      byStatus, byType, byBranch, byEmployee,
      draft: byStatus.draft ?? 0,
      pendingApproval: byStatus.pending ?? 0,
      approved: byStatus.approved ?? 0,
      inProgress: byStatus.in_progress ?? 0,
      completed: byStatus.completed ?? 0,
      rejected: byStatus.rejected ?? 0,
      cancelled: byStatus.cancelled ?? 0,
      collectionTotal: all.filter((v: any) => v.status === 'completed' && v.type === 'collection').reduce((s: number, v: any) => s + (v.amount || 0), 0),
      disbursementTotal: all.filter((v: any) => v.status === 'completed' && v.type === 'cash_disbursement').reduce((s: number, v: any) => s + (v.amount || 0), 0),
      shipmentsLinked: new Set(all.flatMap((v: any) => (v.items ?? []).map((it: any) => it.shipmentId))).size,
    }
  }
  if (p === '/api/vouchers/types') {
    return { types: VOUCHER_TYPES, states: VOUCHER_STATES, categories: VOUCHER_CATEGORIES }
  }
  if (p === '/api/vouchers') {
    const type = qs('type')
    const status = qs('status')
    const branchId = qs('branchId')
    const employeeId = qs('employeeId')
    const courierId = qs('courierId')
    const shipmentId = qs('shipmentId')
    const from = q.get('from')
    const to = q.get('to')
    const search = qs('q').toLowerCase()
    let items = db.vouchers.map((v: any) => enrichOpVoucher(v))
    if (type && type !== 'all') items = items.filter((v: any) => v.type === type)
    if (status && status !== 'all') items = items.filter((v: any) => v.status === status)
    if (branchId && branchId !== 'all') items = items.filter((v: any) => v.sourceBranchId === branchId || v.destBranchId === branchId)
    if (employeeId && employeeId !== 'all') items = items.filter((v: any) => v.employeeId === employeeId)
    if (courierId && courierId !== 'all') items = items.filter((v: any) => v.courierId === courierId)
    if (shipmentId) items = items.filter((v: any) => Array.isArray(v.items) && v.items.some((it: any) => it.shipmentId === shipmentId))
    if (from) items = items.filter((v: any) => inRange(v.createdAt, from, null))
    if (to) items = items.filter((v: any) => inRange(v.createdAt, null, to))
    if (search) items = items.filter((v: any) => (v.voucherNo || '').toLowerCase().includes(search) || (v.party?.name || '').toLowerCase().includes(search) || (v.notes || '').toLowerCase().includes(search) || (v.typeLabel || '').toLowerCase().includes(search))
    items.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return { items, total: items.length }
  }
  m = p.match(/^\/api\/vouchers\/([^/]+)$/)
  if (m && !['stats', 'types'].includes(m[1])) {
    const v = db.vouchers.find((x: any) => x.id === m[1])
    if (!v) throw new Error('الإذن غير موجود')
    return enrichOpVoucher(v, true)
  }
  m = p.match(/^\/api\/shipments\/([^/]+)\/vouchers$/)
  if (m) {
    const sid = m[1]
    const items = db.vouchers
      .filter((v: any) => Array.isArray(v.items) && v.items.some((it: any) => it.shipmentId === sid))
      .map((v: any) => enrichOpVoucher(v))
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return { items, total: items.length }
  }

  // ----- freight -----
  if (p === '/api/freight') {
    let items = db.freight
    const search = qs('q').toLowerCase()
    if (search) {
      items = items.filter((r: any) => [r.regionAr, r.regionEn, r.routeName].some((f: any) => String(f ?? '').toLowerCase().includes(search)))
    }
    return { items, total: items.length }
  }

  // ----- lookups -----
  if (p === '/api/lookups') {
    const category = qs('category')
    const activeOnly = q.get('active') === '1'
    let items = db.lookups
    if (category) items = items.filter((i: any) => i.category === category)
    if (activeOnly) items = items.filter((i: any) => i.active)
    const byCategory: Record<string, any[]> = {}
    for (const it of items) {
      if (!byCategory[it.category]) byCategory[it.category] = []
      byCategory[it.category].push(it)
    }
    return { items, byCategory, total: items.length }
  }

  // ----- reports -----
  const mReport = p.match(/^\/api\/reports\/([^/]+)$/)
  if (mReport) {
    const type = mReport[1]
    const from = q.get('from')
    const to = q.get('to')
    const shipments = db.shipments
      .filter((s: any) => inRange(s.date, from, to))
      .map(enrichShipment)
      .sort((a: any, b: any) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime())

    if (type === 'shipments') return { items: shipments }

    if (type === 'freight-margin') {
      return {
        items: shipments.map((s: any) => {
          const sell = s.salePrice ?? s.freightTotal ?? 0
          return { ...s, sell, margin: sell - (s.freightCost ?? 0) }
        }),
      }
    }

    if (type === 'contractor-dues') {
      const map = new Map<string, any>()
      for (const s of shipments) {
        if (!s.contractorId) continue
        const cur = map.get(s.contractorId) ?? { id: s.contractorId, name: s.contractor?.name ?? '-', shipments: 0, freight: 0, totalSuppliers: 0 }
        cur.shipments += 1
        cur.freight += s.freightTotal ?? 0
        cur.totalSuppliers += s.totalSuppliers ?? 0
        map.set(s.contractorId, cur)
      }
      const items = [...map.values()].map((c: any) => {
        const paid = db.vouchers.filter((v: any) => v.type === 'cash_disbursement' && v.status === 'completed' && v.partyId === c.id).reduce((s: number, v: any) => s + (v.amount || 0), 0)
        return { ...c, paid, due: c.totalSuppliers - paid }
      }).sort((a: any, b: any) => b.due - a.due)
      return { items }
    }

    if (type === 'customer-debts') {
      const map = new Map<string, any>()
      for (const s of shipments) {
        if (!s.customerId) continue
        const cur = map.get(s.customerId) ?? { id: s.customerId, name: s.customer?.name ?? '-', shipments: 0, total: 0, paid: 0 }
        cur.shipments += 1
        cur.total += s.freightTotal ?? 0
        cur.paid += s.customerPay ?? 0
        map.set(s.customerId, cur)
      }
      const items = [...map.values()].map((c: any) => ({ ...c, due: c.total - c.paid })).sort((a: any, b: any) => b.due - a.due)
      return { items }
    }

    if (type === 'trial-balance') {
      const bal = accountBalances()
      return { items: db.accounts.filter((a: any) => a.isDetail).map((a: any) => enrichAccount(a, bal)) }
    }

    if (type === 'inventory-movements') {
      const items = db.movements.map(enrichMovement)
        .filter((m: any) => inRange(m.date, from, to))
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
      return { items }
    }

    if (type === 'low-stock') {
      return { items: db.items.map(enrichItem).filter((i: any) => i.isLowStock) }
    }

    return { items: [] }
  }

  // unknown route → empty response (never hit the network)
  return { items: [], total: 0 }
}

// ---------------------------------------------------------------------------
// Public fetcher — instant, in-memory, no network
// ---------------------------------------------------------------------------
export const fetcher = (url: string): Promise<any> => {
  try {
    return Promise.resolve(handleGet(url))
  } catch (e: any) {
    return Promise.reject(new Error(e?.message ?? 'خطأ في قراءة البيانات'))
  }
}

// ---------------------------------------------------------------------------
// Mutation router
// ---------------------------------------------------------------------------
function handleMutation(method: 'POST' | 'PATCH' | 'DELETE', url: string, body: any): any {
  const u = new URL(url, 'http://local')
  const p = u.pathname.replace(/\/+$/, '')
  const b = body ?? {}
  const nowISO = new Date().toISOString()

  const findIn = (arr: any[], id: string) => arr.find((x: any) => x.id === id)

  // ---- shipments ----
  if (p === '/api/shipments' && method === 'POST') {
    const nextNo = 'SH-' + String(db.shipments.length + 1).padStart(5, '0')
    const s: any = {
      id: uid('sh'), shipmentNo: nextNo, billNo: b.billNo ?? null,
      customerId: b.customerId || null, recipientName: b.recipientName ?? '', shipToParty: b.recipientName ?? '',
      deliveryPhones: b.deliveryPhones ?? null, destination: b.destination ?? null, destinationEn: null, routeCode: b.routeCode ?? null,
      branchId: b.branchId || null, warehouseId: b.warehouseId || null,
      loadType: b.loadType ?? null, contractorId: b.contractorId || null, vehicleNo: null,
      freightCost: Number(b.freightCost) || 0, freightTotal: Number(b.freightTotal) || 0,
      salePrice: null, customerPay: 0, aging: null, overnight: null, returns: null, transfer: null, other: null,
      totalSuppliers: Number(b.freightCost) || 0, status: 'new', collectionStatus: 'uncollected',
      date: b.date ? new Date(b.date).toISOString() : nowISO,
      notes: b.notes ?? null, createdAt: nowISO, updatedAt: nowISO,
      statusHistory: [{ status: 'new', notes: 'إنشاء شحنة جديدة', date: nowISO, userName: b.userName ?? 'admin' }],
      createdBy: b.userName ?? 'admin',
    }
    db.shipments.unshift(s)
    addAudit('create', 'shipment', s.id, `إنشاء شحنة ${nextNo}`, b.userName)
    return { id: s.id, shipmentNo: nextNo }
  }
  // ---- bulk status update ---- (must be checked BEFORE the {id}/status regex)
  if (p === '/api/shipments/bulk/status' && method === 'POST') {
    const ids: string[] = Array.isArray(b.ids) ? b.ids : []
    if (!ids.length) throw new Error('اختر الشحنات المراد تحديثها')
    if (!b.status) throw new Error('اختر الحالة الجديدة')
    const updated: string[] = []
    for (const id of ids) {
      const s = findIn(db.shipments, id)
      if (!s) continue
      s.statusHistory = s.statusHistory ?? []
      s.statusHistory.push({ status: b.status, notes: b.notes ?? 'تحديث جماعي', date: nowISO, userName: b.userName ?? 'admin' })
      s.status = b.status
      s.updatedAt = nowISO
      updated.push(s.shipmentNo ?? id)
    }
    addAudit('bulk_update', 'shipment', null, `تحديث حالة ${updated.length} شحنة إلى ${b.status}`, b.userName)
    return { ok: true, count: updated.length }
  }

  // ---- bulk assign contractor ----
  if (p === '/api/shipments/bulk/assign' && method === 'POST') {
    const ids: string[] = Array.isArray(b.ids) ? b.ids : []
    if (!ids.length) throw new Error('اختر الشحنات المراد إسنادها')
    if (!b.contractorId) throw new Error('اختر المقاول')
    const contractor = partyById.get(b.contractorId)
    const updated: string[] = []
    for (const id of ids) {
      const s = findIn(db.shipments, id)
      if (!s) continue
      s.contractorId = b.contractorId
      s.updatedAt = nowISO
      updated.push(s.shipmentNo ?? id)
    }
    addAudit('bulk_update', 'shipment', null, `إسناد ${updated.length} شحنة للمقاول ${contractor?.name ?? b.contractorId}`, b.userName)
    return { ok: true, count: updated.length }
  }

  let m = p.match(/^\/api\/shipments\/([^/]+)\/status$/)
  if (m && method === 'POST') {
    const s = findIn(db.shipments, m[1])
    if (!s) throw new Error('الشحنة غير موجودة')
    s.statusHistory = s.statusHistory ?? []
    s.statusHistory.push({ status: b.status, notes: b.notes ?? '', date: nowISO, userName: b.userName ?? 'admin' })
    s.status = b.status
    s.updatedAt = nowISO
    addAudit('update', 'shipment', s.id, `تحديث حالة الشحنة ${s.shipmentNo} إلى ${b.status}`, b.userName)
    return { ok: true }
  }

  // ---- settle COD (cash on delivery): create collection + cash_disbursement vouchers ----
  let mSettle = p.match(/^\/api\/shipments\/([^/]+)\/settle-cod$/)
  if (mSettle && method === 'POST') {
    const s = findIn(db.shipments, mSettle[1])
    if (!s) throw new Error('الشحنة غير موجودة')
    if (!s.customerId && !s.contractorId) throw new Error('الشحنة لا تحتوي على عميل أو مقاول')
    const created: any = {}
    const uname = b.userName ?? 'admin'
    // 1) collection voucher (from customer)
    const customerAmount = Number(b.customerAmount ?? s.freightTotal ?? 0)
    if (s.customerId && customerAmount > 0) {
      const v1: any = {
        id: uid('vc'), voucherNo: nextVoucherNo('collection'), type: 'collection', status: 'completed',
        sourceBranchId: s.branchId ?? null, destBranchId: null, employeeId: null, courierId: null, partyId: s.customerId,
        items: [{ id: uid('it'), shipmentId: s.id, notes: 'تسوية COD', addedAt: nowISO, addedBy: uname }],
        totalValue: customerAmount, amount: customerAmount, notes: `تسوية COD — تحصيل من العميل ضد الشحنة ${s.shipmentNo}`,
        attachments: [], accountName: 'الصندوق', journalEntryNo: null,
        createdBy: null, createdByName: uname, createdAt: nowISO, updatedBy: null, updatedAt: nowISO,
        approvalLog: [
          { action: 'create', userId: null, userName: uname, at: nowISO, notes: 'إنشاء' },
          { action: 'submit', userId: null, userName: uname, at: nowISO, notes: null },
          { action: 'approve', userId: null, userName: uname, at: nowISO, notes: 'اعتماد تلقائي للتسوية' },
          { action: 'execute', userId: null, userName: uname, at: nowISO, notes: null },
          { action: 'complete', userId: null, userName: uname, at: nowISO, notes: 'إكمال تلقائي للتسوية' },
        ],
      }
      db.vouchers.unshift(v1)
      postVoucherJournal(v1, 'receipt')
      created.receiptVoucherNo = v1.voucherNo
    }
    // 2) cash_disbursement voucher (to contractor)
    const contractorAmount = Number(b.contractorAmount ?? s.totalSuppliers ?? s.freightCost ?? 0)
    if (s.contractorId && contractorAmount > 0) {
      const v2: any = {
        id: uid('vc'), voucherNo: nextVoucherNo('cash_disbursement'), type: 'cash_disbursement', status: 'completed',
        sourceBranchId: s.branchId ?? null, destBranchId: null, employeeId: null, courierId: null, partyId: s.contractorId,
        items: [{ id: uid('it'), shipmentId: s.id, notes: 'تسوية COD', addedAt: nowISO, addedBy: uname }],
        totalValue: contractorAmount, amount: contractorAmount, notes: `تسوية COD — صرف للمقاول مقابل نقل الشحنة ${s.shipmentNo}`,
        attachments: [], accountName: 'الصندوق', journalEntryNo: null,
        createdBy: null, createdByName: uname, createdAt: nowISO, updatedBy: null, updatedAt: nowISO,
        approvalLog: [
          { action: 'create', userId: null, userName: uname, at: nowISO, notes: 'إنشاء' },
          { action: 'submit', userId: null, userName: uname, at: nowISO, notes: null },
          { action: 'approve', userId: null, userName: uname, at: nowISO, notes: 'اعتماد تلقائي للتسوية' },
          { action: 'execute', userId: null, userName: uname, at: nowISO, notes: null },
          { action: 'complete', userId: null, userName: uname, at: nowISO, notes: 'إكمال تلقائي للتسوية' },
        ],
      }
      db.vouchers.unshift(v2)
      postVoucherJournal(v2, 'payment')
      created.paymentVoucherNo = v2.voucherNo
    }
    // 3) mark collection status as settled
    s.collectionStatus = 'collected'
    s.statusHistory = s.statusHistory ?? []
    s.statusHistory.push({ status: s.status, notes: `تسوية COD — قبض ${created.receiptVoucherNo ?? '—'} / صرف ${created.paymentVoucherNo ?? '—'}`, date: nowISO, userName: uname })
    s.updatedAt = nowISO
    addAudit('settle', 'shipment', s.id, `تسوية COD للشحنة ${s.shipmentNo}`, uname)
    return { ok: true, ...created }
  }

  m = p.match(/^\/api\/shipments\/([^/]+)$/)
  if (m && method === 'DELETE') {
    const idx = db.shipments.findIndex((x: any) => x.id === m[1])
    if (idx >= 0) {
      addAudit('delete', 'shipment', m[1], `حذف شحنة ${db.shipments[idx].shipmentNo}`, b?.userName)
      db.shipments.splice(idx, 1)
    }
    return null
  }

  // ---- parties ----
  if (p === '/api/parties' && method === 'POST') {
    const prefix = b.isContractor ? 'K' : b.isSupplier ? 'S' : 'C'
    const party = {
      id: uid('party'), code: `${prefix}-${String(db.parties.length + 1).padStart(4, '0')}`,
      name: b.name, nameEn: b.nameEn ?? null,
      isCustomer: b.isCustomer ? 1 : 0, isContractor: b.isContractor ? 1 : 0, isSupplier: b.isSupplier ? 1 : 0,
      phone: b.phone ?? null, phones: null, email: null, address: b.address ?? null, city: b.city ?? null, region: null,
      taxNumber: null, paymentTerms: null, creditLimit: null, openingBalance: 0,
      branchId: b.branchId || null, active: 1, notes: b.notes ?? null,
      createdAt: nowISO, updatedAt: nowISO,
    }
    db.parties.unshift(party)
    partyById.set(party.id, party)
    addAudit('create', 'party', party.id, `إضافة طرف: ${party.name}`, b.userName)
    return { id: party.id }
  }
  m = p.match(/^\/api\/parties\/([^/]+)$/)
  if (m) {
    const party = findIn(db.parties, m[1])
    if (!party) throw new Error('الطرف غير موجود')
    if (method === 'PATCH') {
      Object.assign(party, { ...b, id: party.id }, { updatedAt: nowISO })
      addAudit('update', 'party', party.id, `تعديل طرف: ${party.name}`, b.userName)
      return { ok: true }
    }
    if (method === 'DELETE') {
      db.parties = db.parties.filter((x: any) => x.id !== m[1])
      partyById.delete(m[1])
      addAudit('delete', 'party', m[1], `حذف طرف: ${party.name}`, b.userName)
      return null
    }
  }

  // ---- branches ----
  if (p === '/api/branches' && method === 'POST') {
    const br = { id: uid('br'), code: b.code || `BR-${db.branches.length + 1}`, name: b.name, nameEn: b.nameEn ?? null, manager: b.manager ?? null, phone: b.phone ?? null, address: b.address ?? null, region: b.region ?? null, balance: 0, active: 1, createdAt: nowISO }
    db.branches.push(br)
    branchById.set(br.id, br)
    addAudit('create', 'branch', br.id, `إضافة فرع: ${br.name}`, b.userName)
    return { id: br.id }
  }
  m = p.match(/^\/api\/branches\/([^/]+)$/)
  if (m) {
    const br = findIn(db.branches, m[1])
    if (!br) throw new Error('الفرع غير موجود')
    if (method === 'PATCH') { Object.assign(br, { ...b, id: br.id }); addAudit('update', 'branch', br.id, `تعديل فرع: ${br.name}`, b.userName); return { ok: true } }
    if (method === 'DELETE') { db.branches = db.branches.filter((x: any) => x.id !== m[1]); branchById.delete(m[1]); addAudit('delete', 'branch', m[1], `حذف فرع: ${br.name}`, b.userName); return null }
  }

  // ---- warehouses ----
  if (p === '/api/warehouses' && method === 'POST') {
    const w = { id: uid('wh'), code: b.code || `WH-${db.warehouses.length + 1}`, name: b.name, branchId: b.branchId || null, manager: b.manager ?? null, phone: null, address: b.address ?? null, balance: 0, active: 1, createdAt: nowISO }
    db.warehouses.push(w)
    whById.set(w.id, w)
    addAudit('create', 'warehouse', w.id, `إضافة مخزن: ${w.name}`, b.userName)
    return { id: w.id }
  }
  m = p.match(/^\/api\/warehouses\/([^/]+)$/)
  if (m) {
    const w = findIn(db.warehouses, m[1])
    if (!w) throw new Error('المخزن غير موجود')
    if (method === 'PATCH') { Object.assign(w, { ...b, id: w.id }); addAudit('update', 'warehouse', w.id, `تعديل مخزن: ${w.name}`, b.userName); return { ok: true } }
    if (method === 'DELETE') { db.warehouses = db.warehouses.filter((x: any) => x.id !== m[1]); whById.delete(m[1]); addAudit('delete', 'warehouse', m[1], `حذف مخزن: ${w.name}`, b.userName); return null }
  }

  // ---- items ----
  if (p === '/api/items' && method === 'POST') {
    const it = { id: uid('item'), code: b.code ?? null, name: b.name, nameEn: b.nameEn ?? null, unit: b.unit ?? null, reorderLevel: Number(b.reorderLevel) || 0, cost: b.cost != null ? Number(b.cost) : null, price: b.price != null ? Number(b.price) : null, warehouseId: b.warehouseId || null, notes: b.notes ?? null, active: 1, createdAt: nowISO, updatedAt: nowISO }
    db.items.push(it)
    itemById.set(it.id, it)
    addAudit('create', 'item', it.id, `إضافة صنف: ${it.name}`, b.userName)
    return { id: it.id }
  }
  m = p.match(/^\/api\/items\/([^/]+)$/)
  if (m) {
    const it = findIn(db.items, m[1])
    if (!it) throw new Error('الصنف غير موجود')
    if (method === 'PATCH') { Object.assign(it, { ...b, id: it.id }, { updatedAt: nowISO }); addAudit('update', 'item', it.id, `تعديل صنف: ${it.name}`, b.userName); return { ok: true } }
    if (method === 'DELETE') { db.items = db.items.filter((x: any) => x.id !== m[1]); itemById.delete(m[1]); addAudit('delete', 'item', m[1], `حذف صنف: ${it.name}`, b.userName); return null }
  }

  // ---- movements ----
  if (p === '/api/movements' && method === 'POST') {
    const it = b.itemId ? itemById.get(b.itemId) : null
    if (!it) throw new Error('اختر الصنف أولًا')
    let qty = Number(b.quantity) || 0
    if (b.type === 'issue') qty = -Math.abs(qty)
    if (b.type === 'receipt') qty = Math.abs(qty)
    const bal = itemBalance(it.id)
    if ((b.type === 'issue' || b.type === 'adjustment') && bal + qty < 0) {
      throw new Error(`الرصيد غير كافٍ — الرصيد الحالي ${bal} ${it.unit ?? ''}`)
    }
    const mv = {
      id: uid('mv'), type: b.type, date: nowISO, itemId: it.id, warehouseId: b.warehouseId || null,
      toWarehouseId: b.type === 'transfer' ? (b.toWarehouseId || null) : null,
      quantity: qty, unitCost: b.unitCost != null ? Number(b.unitCost) : null,
      totalCost: b.unitCost != null ? Math.abs(qty) * Number(b.unitCost) : null,
      notes: b.notes ?? null, userName: b.userName ?? 'admin', createdAt: nowISO,
    }
    db.movements.unshift(mv)
    addAudit('create', 'inventory_movement', mv.id, `حركة ${b.type} للصنف ${it.name} بكمية ${qty}`, b.userName)
    return { id: mv.id, balance: itemBalance(it.id) }
  }

  // ---- accounts ----
  if (p === '/api/accounts' && method === 'POST') {
    const accNew = { id: uid('acc'), code: b.code || String(db.accounts.length + 1), name: b.name, nameEn: b.nameEn ?? null, type: b.type ?? 'asset', parentId: b.parentId || null, isDetail: b.isDetail !== false ? 1 : 0, active: 1, createdAt: nowISO }
    db.accounts.push(accNew)
    addAudit('create', 'account', accNew.id, `إضافة حساب: ${accNew.name}`, b.userName)
    return { id: accNew.id }
  }

  // ---- journal ----
  if (p === '/api/journal' && method === 'POST') {
    const lines = (b.lines ?? []).filter((l: any) => l.accountId && ((l.debit || 0) > 0 || (l.credit || 0) > 0))
    if (lines.length < 2) throw new Error('القيد يحتاج سطرين على الأقل')
    const totalDebit = lines.reduce((s: number, l: any) => s + (Number(l.debit) || 0), 0)
    const totalCredit = lines.reduce((s: number, l: any) => s + (Number(l.credit) || 0), 0)
    if (Math.abs(totalDebit - totalCredit) > 0.001) throw new Error('القيد غير متوازن')
    const entry = {
      id: uid('je'), entryNo: `JE-${String(db.journal.length + 1).padStart(4, '0')}`,
      date: b.date ? new Date(b.date).toISOString() : nowISO,
      description: b.description ?? '', reference: b.reference ?? null,
      branchId: b.branchId || null, status: b.autoPost ? 'posted' : 'draft',
      totalDebit, totalCredit,
      lines: lines.map((l: any) => {
        const a = db.accounts.find((x: any) => x.id === l.accountId)
        return {
          id: uid('jl'), accountId: l.accountId, account: a ? { id: a.id, code: a.code, name: a.name } : null,
          debit: Number(l.debit) || 0, credit: Number(l.credit) || 0,
          description: l.description ?? '', partyId: l.partyId || null, party: partyRef(l.partyId || null),
        }
      }),
      createdAt: nowISO, updatedAt: nowISO,
    }
    db.journal.unshift(entry)
    addAudit('create', 'journal_entry', entry.id, `إنشاء قيد ${entry.entryNo}`, b.userName)
    return { id: entry.id, entryNo: entry.entryNo }
  }
  m = p.match(/^\/api\/journal\/([^/]+)\/post$/)
  if (m && method === 'POST') {
    const e = findIn(db.journal, m[1])
    if (!e) throw new Error('القيد غير موجود')
    if (e.status === 'posted') throw new Error('القيد مرحّل بالفعل')
    e.status = 'posted'
    e.updatedAt = nowISO
    addAudit('post', 'journal_entry', e.id, `ترحيل قيد ${e.entryNo}`, b.userName)
    return { ok: true }
  }
  m = p.match(/^\/api\/journal\/([^/]+)$/)
  if (m && method === 'DELETE') {
    const e = findIn(db.journal, m[1])
    if (!e) throw new Error('القيد غير موجود')
    if (e.status === 'posted') throw new Error('لا يمكن حذف قيد مرحّل — استخدم قيدًا عكسيًا')
    db.journal = db.journal.filter((x: any) => x.id !== m[1])
    addAudit('delete', 'journal_entry', m[1], `حذف قيد ${e.entryNo}`, b.userName)
    return null
  }

  // ---- vouchers (unified operational + financial) ----
  if (p === '/api/vouchers' && method === 'POST') {
    const type = b.type ?? 'receiving'
    const tdef = VOUCHER_TYPES.find((t) => t.code === type)
    if (!tdef) throw new Error('نوع الإذن غير معروف')
    const branchId = b.sourceBranchId || null
    const shipmentIds: string[] = Array.isArray(b.shipmentIds) ? b.shipmentIds : (b.shipmentId ? [b.shipmentId] : [])
    if (tdef.requiresShipments && shipmentIds.length === 0) throw new Error('هذا الإذن يتطلب شحنة واحدة على الأقل')
    if (tdef.requiresParty && !b.partyId) throw new Error('هذا الإذن يتطلب تحديد الطرف (العميل/المورد)')
    if (tdef.requiresCourier && !b.courierId) throw new Error('هذا الإذن يتطلب تحديد المندوب')
    if (tdef.requiresEmployee && !b.employeeId) throw new Error('هذا الإذن يتطلب تحديد الموظف المسؤول')
    if (tdef.isFinancial && (!b.amount || Number(b.amount) <= 0)) throw new Error('المبلغ مطلوب للأذونات المالية')
    const items: any[] = []
    for (const sid of shipmentIds) {
      const s = db.shipments.find((sh: any) => sh.id === sid)
      if (!s) throw new Error(`الشحنة ${sid} غير موجودة`)
      if (tdef.preStatuses && !tdef.preStatuses.includes(s.status)) throw new Error(`الشحنة ${s.shipmentNo} حالتها "${s.status}" لا تصلح لهذا الإذن — المطلوب: ${tdef.preStatuses.join(' أو ')}`)
      if (items.some((it) => it.shipmentId === sid)) throw new Error(`الشحنة ${s.shipmentNo} مضافة مرتين`)
      items.push({ id: uid('it'), shipmentId: sid, notes: null, addedAt: nowISO, addedBy: b.userName ?? 'admin' })
    }
    const amount = tdef.isFinancial ? (Number(b.amount) || 0) : null
    const totalValue = tdef.isFinancial ? (amount ?? 0) : items.reduce((acc, it) => {
      const s = db.shipments.find((sh: any) => sh.id === it.shipmentId)
      return acc + (Number(s?.freightTotal ?? 0))
    }, 0)
    const v: any = {
      id: uid('vc'), voucherNo: nextVoucherNo(type), type, status: 'draft',
      sourceBranchId: branchId, destBranchId: tdef.requiresDestBranch ? (b.destBranchId || branchId) : null,
      employeeId: b.employeeId ?? null, courierId: b.courierId ?? null, partyId: b.partyId ?? null,
      items, totalValue: Math.round(totalValue * 100) / 100, amount, notes: b.notes ?? null, attachments: [],
      accountName: tdef.isFinancial ? (b.accountName ?? 'الصندوق') : null, journalEntryNo: null,
      createdBy: null, createdByName: b.userName ?? 'admin', createdAt: nowISO, updatedBy: null, updatedAt: nowISO,
      approvalLog: [{ action: 'create', userId: null, userName: b.userName ?? 'admin', at: nowISO, notes: 'إنشاء الإذن' }],
    }
    db.vouchers.unshift(v)
    addAudit('create', 'voucher', v.id, `إنشاء ${tdef.label} ${v.voucherNo}${items.length ? ` (${items.length} شحنة)` : ''}${amount ? ` بمبلغ ${amount}` : ''}`, b.userName)
    return { id: v.id, voucherNo: v.voucherNo }
  }
  m = p.match(/^\/api\/vouchers\/([^/]+)\/items$/)
  if (m && method === 'POST') {
    const v = findIn(db.vouchers, m[1])
    if (!v) throw new Error('الإذن غير موجود')
    if (v.status !== 'draft') throw new Error('لا يمكن إضافة شحنات إلا في إذن مسودة')
    const tdef = VOUCHER_TYPES.find((t: any) => t.code === v.type)
    const sid = b.shipmentId
    const s = db.shipments.find((sh: any) => sh.id === sid)
    if (!s) throw new Error('الشحنة غير موجودة')
    if (v.items.some((it: any) => it.shipmentId === sid)) throw new Error('الشحنة مضافة لهذا الإذن بالفعل')
    if (tdef?.preStatuses && !tdef.preStatuses.includes(s.status)) throw new Error(`حالة الشحنة ${s.shipmentNo} (${s.status}) لا تصلح — المطلوب: ${tdef.preStatuses.join(' أو ')}`)
    v.items.push({ id: uid('it'), shipmentId: sid, notes: b.notes ?? null, addedAt: nowISO, addedBy: b.userName ?? 'admin' })
    v.totalValue = Math.round((v.items.reduce((acc: number, it: any) => { const sh = db.shipments.find((x: any) => x.id === it.shipmentId); return acc + Number(sh?.freightTotal ?? 0) }, 0)) * 100) / 100
    v.updatedAt = nowISO
    addAudit('update', 'voucher', v.id, `إضافة شحنة ${s.shipmentNo} للإذن ${v.voucherNo}`, b.userName)
    return { ok: true, itemCount: v.items.length }
  }
  m = p.match(/^\/api\/vouchers\/([^/]+)\/items\/([^/]+)$/)
  if (m && method === 'DELETE') {
    const v = findIn(db.vouchers, m[1])
    if (!v) throw new Error('الإذن غير موجود')
    if (v.status !== 'draft') throw new Error('لا يمكن حذف شحنات إلا من إذن مسودة')
    v.items = v.items.filter((it: any) => it.id !== m[2])
    v.totalValue = Math.round((v.items.reduce((acc: number, it: any) => { const sh = db.shipments.find((x: any) => x.id === it.shipmentId); return acc + Number(sh?.freightTotal ?? 0) }, 0)) * 100) / 100
    v.updatedAt = nowISO
    return { ok: true, itemCount: v.items.length }
  }
  m = p.match(/^\/api\/vouchers\/([^/]+)\/transition$/)
  if (m && method === 'POST') {
    const v = findIn(db.vouchers, m[1])
    if (!v) throw new Error('الإذن غير موجود')
    const action = b.action
    const allowed = TRANSITIONS[v.status] ?? []
    const tr = allowed.find((t: any) => t.action === action)
    if (!tr) throw new Error(`الإجراء "${action}" غير مسموح للحالة "${v.status}"`)
    if (action === 'approve' && v.createdByName === (b.userName ?? 'admin')) throw new Error('لا يمكن اعتماد إذن أنشأته بنفسك (فصل المهام)')
    const tdef = VOUCHER_TYPES.find((t: any) => t.code === v.type)
    v.status = tr.to
    v.updatedAt = nowISO
    v.approvalLog = v.approvalLog ?? []
    v.approvalLog.push({ action, userId: null, userName: b.userName ?? 'admin', at: nowISO, notes: b.notes ?? null })
    addAudit(action, 'voucher', v.id, `${actionLabel(action)} ${v.voucherNo} → ${tr.to}`, b.userName)
    if (action === 'complete') {
      if (tdef?.postStatus && v.items?.length) {
        for (const it of v.items) {
          const s = db.shipments.find((sh: any) => sh.id === it.shipmentId)
          if (s) {
            s.status = tdef.postStatus
            s.statusHistory = s.statusHistory ?? []
            s.statusHistory.push({ status: tdef.postStatus, notes: `${tdef.label} ${v.voucherNo} — اكتمل`, date: nowISO, userName: b.userName ?? 'admin' })
            if (v.type === 'delivery') s.collectionStatus = 'collected'
            s.updatedAt = nowISO
          }
        }
      }
      if (tdef?.isFinancial && v.type === 'collection' && v.amount) postVoucherJournal(v, 'receipt')
      else if (tdef?.isFinancial && v.type === 'cash_disbursement' && v.amount) postVoucherJournal(v, 'payment')
    }
    return { ok: true, status: v.status }
  }
  m = p.match(/^\/api\/vouchers\/([^/]+)$/)
  if (m && method === 'PATCH') {
    const v = findIn(db.vouchers, m[1])
    if (!v) throw new Error('الإذن غير موجود')
    if (v.status !== 'draft' && v.status !== 'rejected') throw new Error('لا يمكن تعديل إذن بهذه الحالة')
    if (b.type && b.type !== v.type) throw new Error('لا يمكن تغيير نوع الإذن بعد الإنشاء')
    const tdef = VOUCHER_TYPES.find((t: any) => t.code === v.type)
    if (tdef?.isFinancial && b.amount != null) v.amount = Number(b.amount)
    if (b.notes != null) v.notes = b.notes
    if (b.partyId != null) v.partyId = b.partyId || null
    if (b.courierId != null) v.courierId = b.courierId || null
    if (b.employeeId != null) v.employeeId = b.employeeId || null
    if (b.sourceBranchId != null) v.sourceBranchId = b.sourceBranchId || null
    if (b.destBranchId != null) v.destBranchId = b.destBranchId || null
    if (b.accountName != null) v.accountName = b.accountName
    if (tdef && !tdef.isFinancial) v.totalValue = Math.round((v.items.reduce((acc: number, it: any) => { const sh = db.shipments.find((x: any) => x.id === it.shipmentId); return acc + Number(sh?.freightTotal ?? 0) }, 0)) * 100) / 100
    else if (tdef?.isFinancial && v.amount != null) v.totalValue = v.amount
    v.updatedAt = nowISO
    v.approvalLog.push({ action: 'edit', userId: null, userName: b.userName ?? 'admin', at: nowISO, notes: 'تعديل بيانات الإذن' })
    addAudit('update', 'voucher', v.id, `تعديل الإذن ${v.voucherNo}`, b.userName)
    return { ok: true }
  }
  if (m && method === 'DELETE') {
    const v = findIn(db.vouchers, m[1])
    if (!v) return null
    if (v.status !== 'draft' && v.status !== 'cancelled') throw new Error('لا يمكن حذف إذن إلا في حالة المسودة أو الملغي')
    db.vouchers = db.vouchers.filter((x: any) => x.id !== m[1])
    addAudit('delete', 'voucher', m[1], `حذف الإذن ${v.voucherNo}`, b?.userName)
    return null
  }

  // ---- freight ----
  if (p === '/api/freight' && method === 'POST') {
    const f = { id: uid('fr'), regionAr: b.regionAr ?? '', regionEn: b.regionEn ?? null, routeName: b.routeName ?? b.regionAr ?? '', distanceKm: b.distanceKm != null ? Number(b.distanceKm) : null, loadType: b.loadType ?? null, cost: Number(b.cost) || 0, sellPrice: b.sellPrice != null ? Number(b.sellPrice) : null, sellPrice2: null, validFrom: null, validTo: null, notes: b.notes ?? null, active: 1, createdAt: nowISO, updatedAt: nowISO }
    db.freight.unshift(f)
    addAudit('create', 'freight_price', f.id, `إضافة سعر نولون: ${f.routeName}`, b.userName)
    return { id: f.id }
  }
  m = p.match(/^\/api\/freight\/([^/]+)$/)
  if (m) {
    const f = findIn(db.freight, m[1])
    if (!f) throw new Error('السعر غير موجود')
    if (method === 'PATCH') { Object.assign(f, { ...b, id: f.id }, { updatedAt: nowISO }); addAudit('update', 'freight_price', f.id, `تعديل سعر نولون: ${f.routeName}`, b.userName); return { ok: true } }
    if (method === 'DELETE') { db.freight = db.freight.filter((x: any) => x.id !== m[1]); addAudit('delete', 'freight_price', m[1], `حذف سعر نولون: ${f.routeName}`, b.userName); return null }
  }

  // ---- lookups ----
  if (p === '/api/lookups' && method === 'POST') {
    const cat = b.category
    const maxOrder = Math.max(0, ...db.lookups.filter((l: any) => l.category === cat).map((l: any) => l.sortOrder || 0))
    const lk = { id: uid('lk'), category: cat, key: b.key || b.label, label: b.label ?? b.key, labelEn: b.labelEn ?? null, tone: b.tone ?? null, icon: b.icon ?? null, active: b.active !== false ? 1 : 0, sortOrder: (b.sortOrder ?? maxOrder + 1), isSystem: 0, createdAt: nowISO, updatedAt: nowISO }
    db.lookups.push(lk)
    addAudit('create', 'setting', lk.id, `إضافة قيمة قائمة منسدلة: ${lk.label}`, b.userName)
    return { id: lk.id }
  }
  m = p.match(/^\/api\/lookups\/([^/]+)$/)
  if (m) {
    const lk = findIn(db.lookups, m[1])
    if (!lk) throw new Error('القيمة غير موجودة')
    if (method === 'PATCH') { Object.assign(lk, { ...b, id: lk.id }, { updatedAt: nowISO }); return { ok: true } }
    if (method === 'DELETE') { db.lookups = db.lookups.filter((x: any) => x.id !== m[1]); addAudit('delete', 'setting', m[1], `حذف قيمة قائمة: ${lk.label}`, b?.userName); return null }
  }

  // ---- roles ----
  if (p === '/api/roles' && method === 'POST') {
    if (!String(b.name ?? '').trim()) throw new Error('اسم الدور مطلوب')
    if (db.roles.some((r: any) => r.name === b.name)) throw new Error('اسم الدور موجود بالفعل')
    const role = { id: uid('role'), name: String(b.name).trim(), label: b.label || b.name, permissions: Array.isArray(b.permissions) ? b.permissions : [], createdAt: nowISO }
    db.roles.push(role)
    addAudit('create', 'role', role.id, `إضافة دور: ${role.label} (${Array.isArray(b.permissions) ? b.permissions.length : 0} صلاحية)`, b.userName)
    return { id: role.id }
  }
  m = p.match(/^\/api\/roles\/([^/]+)$/)
  if (m) {
    const role = findIn(db.roles, m[1])
    if (!role) throw new Error('الدور غير موجود')
    if (method === 'PATCH') {
      if (role.name === 'admin' && b.permissions !== undefined) throw new Error('صلاحيات دور مدير النظام ثابتة (كل الصلاحيات)')
      if (b.name && b.name !== role.name && db.roles.some((r: any) => r.name === b.name)) throw new Error('اسم الدور موجود بالفعل')
      Object.assign(role, { ...b, id: role.id, name: b.name || role.name, permissions: Array.isArray(b.permissions) ? b.permissions : role.permissions })
      addAudit('update', 'role', role.id, `تعديل دور: ${role.label} (${Array.isArray(role.permissions) ? role.permissions.length : 0} صلاحية)`, b.userName)
      return { ok: true }
    }
    if (method === 'DELETE') {
      if (role.name === 'admin') throw new Error('لا يمكن حذف دور مدير النظام')
      if (db.users.some((u: any) => u.roleId === role.id)) throw new Error('لا يمكن حذف دور مرتبط بمستخدمين — انقل المستخدمين لدور آخر أولًا')
      db.roles = db.roles.filter((r: any) => r.id !== m[1])
      addAudit('delete', 'role', m[1], `حذف دور: ${role.label}`, b.userName)
      return null
    }
  }

  // ---- users ----
  if (p === '/api/users' && method === 'POST') {
    const username = String(b.username ?? '').trim()
    if (!username) throw new Error('اسم المستخدم مطلوب')
    if (String(b.password ?? '').length < 4) throw new Error('كلمة المرور يجب أن تكون 4 أحرف على الأقل')
    if (db.users.some((x: any) => x.username === username)) throw new Error('اسم المستخدم موجود بالفعل')
    const usr = { id: uid('usr'), username, name: b.name ?? username, email: b.email ?? null, phone: b.phone ?? null, branchId: b.branchId || null, roleId: b.roleId || null, active: b.active === false ? 0 : 1, passwordHash: hashPassword(String(b.password)), lastLoginAt: null, createdAt: nowISO }
    db.users.push(usr)
    addAudit('create', 'user', usr.id, `إضافة مستخدم: ${usr.username}`, b.userName)
    return { id: usr.id }
  }
  m = p.match(/^\/api\/users\/([^/]+)$/)
  if (m) {
    const usr = findIn(db.users, m[1])
    if (!usr) throw new Error('المستخدم غير موجود')
    if (method === 'PATCH') {
      const { password, ...rest } = b
      if (password != null && password !== '') {
        if (String(password).length < 4) throw new Error('كلمة المرور قصيرة جدًا (4 أحرف على الأقل)')
        usr.passwordHash = hashPassword(String(password))
      }
      if (rest.username && rest.username !== usr.username) {
        if (db.users.some((x: any) => x.username === rest.username)) throw new Error('اسم المستخدم موجود بالفعل')
      }
      if (usr.username === 'admin' && rest.active === false) throw new Error('لا يمكن إيقاف حساب مدير النظام الأساسي')
      delete rest.roleIds
      Object.assign(usr, { ...rest, id: usr.id })
      addAudit('update', 'user', usr.id, `تعديل مستخدم: ${usr.username}${password ? ' — تغيير كلمة المرور' : ''}`, b.userName)
      return { ok: true }
    }
    if (method === 'DELETE') {
      if (usr.username === 'admin') throw new Error('لا يمكن حذف حساب مدير النظام الأساسي')
      if (usr.id === b?.currentUserId) throw new Error('لا يمكن حذف حسابك الحالي')
      db.users = db.users.filter((x: any) => x.id !== m[1])
      addAudit('delete', 'user', m[1], `حذف مستخدم: ${usr.username}`, b.userName)
      return null
    }
  }

  // ---- settings ----
  if (p === '/api/settings' && method === 'PATCH') {
    const updates = b.updates ?? {}
    const apply = (key: string, value: any) => {
      const s = db.settings.find((x: any) => x.key === key)
      if (s) { s.value = String(value); s.updatedAt = nowISO }
    }
    if (Array.isArray(updates)) updates.forEach((u: any) => apply(u.key, u.value))
    else Object.entries(updates).forEach(([k, v]) => apply(k, v))
    addAudit('update', 'setting', null, 'تحديث إعدادات النظام', b.userName)
    return { ok: true }
  }

  // ---- import wizard ----
  if (p === '/api/import/preview' && method === 'POST') {
    return {
      sheets: [{
        name: 'مبيعات 8-2026',
        headers: ['المخزن', 'Name of the ship-to party', 'Destination', 'policy QTY', '1.5 TON', '3 TON', '6 M', 'Date', 'المقاول', 'تكويد', 'النولون', 'اجمالى النولون'],
        sampleRows: [
          ['المخزن الرئيسي', 'القلوبيه /مدينه العبور', 'العبور', '1', '1', '', '', '2026-09-30', 'السيد ربيع', 'القاهرة 1', '980', '980'],
          ['المخزن الرئيسي', 'شركه عبد الحكم حجازي', 'العبور', '1', '', '1', '', '2026-09-30', 'المنسي', 'القاهرة 2', '1805', '1805'],
          ['المخزن الرئيسي', 'ADEL HASSAN MOHAMED', 'مدينة نصر', '2', '2', '', '', '2026-10-01', 'جعلص', 'القاهرة 1', '1960', '1960'],
        ],
        totalRows: 184,
        columns: 32,
      }],
      suggestedMapping: {},
      fileName: 'مبيعات العاشر 3.xlsx',
    }
  }
  if (p === '/api/import/commit' && method === 'POST') {
    addAudit('import', 'shipment', null, `استيراد ملف ${b.fileName ?? ''} — ورقة ${b.sheetName ?? ''}`, b.userName)
    return { imported: 184, skipped: 0, errors: 0, total: 184 }
  }

  // unknown mutation → optimistic ok
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Public mutation helpers (same signatures as before — no network)
// ---------------------------------------------------------------------------
export async function apiPost(url: string, body?: any) {
  return handleMutation('POST', url, body)
}

export async function apiPatch(url: string, body?: any) {
  return handleMutation('PATCH', url, body)
}

export async function apiDelete(url: string) {
  return handleMutation('DELETE', url, undefined)
}

// ---------------------------------------------------------------------------
// المصادقة — تسجيل الدخول/الخروج والتحقق من الجلسة
// ---------------------------------------------------------------------------
export function authLogin(username: string, password: string): SessionUser {
  const uname = String(username ?? '').trim()
  const u = db.users.find((x: any) => x.username === uname)
  if (!u) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة')
  if (u.passwordHash !== hashPassword(String(password ?? ''))) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة')
  if (!u.active) throw new Error('هذا الحساب موقوف — راجع مدير النظام')
  const role = db.roles.find((r: any) => r.id === u.roleId) ?? null
  const perms: string[] = role ? (Array.isArray(role.permissions) ? role.permissions : []) : []
  if (!perms.length && role?.name === 'admin') perms.push('*')
  u.lastLoginAt = new Date().toISOString()
  addAudit('login', 'user', u.id, `تسجيل دخول المستخدم ${u.name} (${u.username})`, u.username)
  return {
    userId: u.id,
    username: u.username,
    name: u.name,
    roleId: role?.id ?? null,
    roleName: role?.name ?? null,
    roleLabel: role?.label ?? null,
    permissions: perms,
    loginAt: u.lastLoginAt,
  }
}

/** التحقق من صلاحية الجلسة المحفوظة — يُلغي تلقائيًا إذا حُذف المستخدم أو أُوقف */
export function authValidate(session: any): SessionUser | null {
  if (!session?.userId || !session?.loginAt) return null
  const u = db.users.find((x: any) => x.id === session.userId)
  if (!u || !u.active) return null
  const role = db.roles.find((r: any) => r.id === u.roleId) ?? null
  const perms: string[] = role ? (Array.isArray(role.permissions) ? role.permissions : []) : []
  if (!perms.length && role?.name === 'admin') perms.push('*')
  return {
    userId: u.id,
    username: u.username,
    name: u.name,
    roleId: role?.id ?? null,
    roleName: role?.name ?? null,
    roleLabel: role?.label ?? null,
    permissions: perms,
    loginAt: session.loginAt,
  }
}

export function authLogout(user: SessionUser | null) {
  if (user) addAudit('logout', 'user', user.userId, `تسجيل خروج المستخدم ${user.name} (${user.username})`, user.username)
}
