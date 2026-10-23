// ============================================================================
// Client-side in-memory API — ZERO network requests.
// All data is bundled statically from mock-data.json and served synchronously
// from memory. Mutations (create/update/delete) operate on the in-memory DB so
// the whole UI stays fully interactive without any server round-trip.
// ============================================================================

import mockJson from '../../mock-data.json'

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

  // ---- Seed: vouchers (each conceptually linked to a journal entry) ----
  const V = (n: number) => `V-${String(n).padStart(4, '0')}`
  const voucherDefs: any[] = [
    { type: 'receipt', partyName: 'ADEL HASSAN', amount: 5000, day: 8, desc: 'تحصيل دفعة نولون' },
    { type: 'payment', contractor: 'السيد ربيع', amount: 120000, day: 15, desc: 'دفعة مستحقات نقل' },
    { type: 'receipt', partyName: 'Abd al hakeim', amount: 3500, day: 17, desc: 'تحصيل جزئي' },
    { type: 'payment', contractor: 'المنسي', amount: 80000, day: 19, desc: 'دفعة مستحقات نقل' },
    { type: 'receipt', partyName: 'Abdelaziz', amount: 2500, day: 24, desc: 'تحصيل نولون شحنات' },
    { type: 'payment', contractor: 'جعلص', amount: 50000, day: 26, desc: 'دفعة على الحساب' },
  ]
  db.vouchers = voucherDefs.map((v, i) => {
    const party = v.type === 'receipt' ? customer(v.partyName) : contractor(v.contractor)
    return {
      id: `seed-vc-${i + 1}`,
      voucherNo: V(i + 1),
      type: v.type,
      date: d(v.day),
      partyId: party?.id ?? null,
      party: party ? { id: party.id, name: party.name } : null,
      amount: v.amount,
      description: v.desc,
      accountName: 'الصندوق',
      journalEntryNo: J(v.type === 'receipt' ? 2 : 3),
      userName: 'admin',
      createdAt: d(v.day),
    }
  })

  // ---- Seed: extra audit entries (in addition to the import record) ----
  const extraAudit: any[] = [
    { action: 'create', entity: 'journal_entry', entityId: db.journal[0]?.id, notes: 'قيد افتتاحي رأس المال', day: 1, userName: 'admin' },
    { action: 'create', entity: 'voucher', entityId: db.vouchers[0]?.id, notes: 'سند قبض V-0001', day: 8, userName: 'admin' },
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

const db = buildDB()

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
  return st
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
    const page = Math.max(1, parseInt(qs('page') || '1', 10))
    const pageSize = Math.min(200, Math.max(1, parseInt(qs('pageSize') || '20', 10)))
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
  if (p === '/api/users') return { items: db.users, total: db.users.length }
  if (p === '/api/roles') return { items: db.roles, total: db.roles.length }
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

  // ----- vouchers -----
  if (p === '/api/vouchers') {
    const type = qs('type')
    let items = db.vouchers.map((v: any) => ({ ...v, party: partyRef(v.partyId) }))
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
    if (type) items = items.filter((v: any) => v.type === type)
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
        const paid = db.vouchers.filter((v: any) => v.type === 'payment' && v.partyId === c.id).reduce((s: number, v: any) => s + (v.amount || 0), 0)
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
    }
    db.shipments.unshift(s)
    addAudit('create', 'shipment', s.id, `إنشاء شحنة ${nextNo}`, b.userName)
    return { id: s.id, shipmentNo: nextNo }
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

  // ---- vouchers ----
  if (p === '/api/vouchers' && method === 'POST') {
    const v = {
      id: uid('vc'), voucherNo: `V-${String(db.vouchers.length + 1).padStart(4, '0')}`,
      type: b.type ?? 'receipt', date: b.date ? new Date(b.date).toISOString() : nowISO,
      partyId: b.partyId || null, party: partyRef(b.partyId || null),
      amount: Number(b.amount) || 0, description: b.description ?? null,
      accountName: b.accountName ?? 'الصندوق',
      journalEntryNo: `JE-${String(db.journal.length + 1).padStart(4, '0')}`,
      userName: b.userName ?? 'admin', createdAt: nowISO,
    }
    if (!v.partyId) throw new Error('اختر الطرف')
    db.vouchers.unshift(v)
    // auto journal entry (receipt: cash D / customer C — payment: contractor D / cash C)
    const cashAcc = db.accounts.find((a: any) => a.code === '1101')
    const partyAcc = v.type === 'receipt'
      ? db.accounts.find((a: any) => a.code === '1103')
      : db.accounts.find((a: any) => a.code === '2102')
    if (cashAcc && partyAcc) {
      db.journal.unshift({
        id: uid('je'), entryNo: v.journalEntryNo, date: v.date,
        description: `${v.type === 'receipt' ? 'سند قبض' : 'سند صرف'} ${v.voucherNo} — ${v.party?.name ?? ''}`,
        reference: v.voucherNo, branchId: null, status: 'posted',
        totalDebit: v.amount, totalCredit: v.amount,
        lines: v.type === 'receipt'
          ? [
              { id: uid('jl'), accountId: cashAcc.id, account: { id: cashAcc.id, code: cashAcc.code, name: cashAcc.name }, debit: v.amount, credit: 0, description: 'نقدية مستلمة', partyId: v.partyId, party: v.party },
              { id: uid('jl'), accountId: partyAcc.id, account: { id: partyAcc.id, code: partyAcc.code, name: partyAcc.name }, debit: 0, credit: v.amount, description: 'تحصيل من العميل', partyId: v.partyId, party: v.party },
            ]
          : [
              { id: uid('jl'), accountId: partyAcc.id, account: { id: partyAcc.id, code: partyAcc.code, name: partyAcc.name }, debit: v.amount, credit: 0, description: 'مستحقات مقاول', partyId: v.partyId, party: v.party },
              { id: uid('jl'), accountId: cashAcc.id, account: { id: cashAcc.id, code: cashAcc.code, name: cashAcc.name }, debit: 0, credit: v.amount, description: 'نقدية مدفوعة', partyId: v.partyId, party: v.party },
            ],
        createdAt: nowISO, updatedAt: nowISO,
      })
    }
    addAudit('create', 'voucher', v.id, `${v.type === 'receipt' ? 'سند قبض' : 'سند صرف'} ${v.voucherNo} بمبلغ ${v.amount}`, b.userName)
    return { id: v.id, voucherNo: v.voucherNo }
  }
  m = p.match(/^\/api\/vouchers\/([^/]+)$/)
  if (m && method === 'DELETE') {
    const v = findIn(db.vouchers, m[1])
    if (v) {
      db.vouchers = db.vouchers.filter((x: any) => x.id !== m[1])
      addAudit('delete', 'voucher', m[1], `حذف سند ${v.voucherNo}`, b?.userName)
    }
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

  // ---- users ----
  if (p === '/api/users' && method === 'POST') {
    const usr = { id: uid('usr'), username: b.username, name: b.name ?? b.username, email: b.email ?? null, phone: b.phone ?? null, branchId: b.branchId || null, roleId: b.roleId || null, active: 1, createdAt: nowISO, password: undefined }
    if (db.users.some((x: any) => x.username === usr.username)) throw new Error('اسم المستخدم موجود بالفعل')
    db.users.push(usr)
    addAudit('create', 'user', usr.id, `إضافة مستخدم: ${usr.username}`, b.userName)
    return { id: usr.id }
  }
  m = p.match(/^\/api\/users\/([^/]+)$/)
  if (m) {
    const usr = findIn(db.users, m[1])
    if (!usr) throw new Error('المستخدم غير موجود')
    if (method === 'PATCH') { Object.assign(usr, { ...b, id: usr.id, password: undefined }); addAudit('update', 'user', usr.id, `تعديل مستخدم: ${usr.username}`, b.userName); return { ok: true } }
    if (method === 'DELETE') { db.users = db.users.filter((x: any) => x.id !== m[1]); addAudit('delete', 'user', m[1], `حذف مستخدم: ${usr.username}`, b.userName); return null }
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
