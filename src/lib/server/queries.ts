// ============================================================================
// طبقة الاستعلامات (GET) — تعيد نفس أشكال الاستجابة السابقة تمامًا
// لكن مستمدة من قاعدة البيانات الحقيقية (Prisma)
// + فلترة الأسعار/المبالغ على الخادم لغير المصرح لهم (prices.view)
// ============================================================================
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ApiError, num, round2 } from './http'
import { accountBalancesMap, ACC, reversalOriginalSources, summarizeContractorLedgerLines } from './accounting'
import { VOUCHER_CATEGORIES, VOUCHER_STATES, VOUCHER_TYPES } from '../voucher-catalog'
import { EXTRA_COST_SOURCE, extraCostTypeLabel } from '../extra-cost-catalog'
import { enrichVoucherRows, voucherInclude } from './vouchers-queries'
import { canSeePrices, reportRequiresPrices, stripDashboardStats, stripParties, stripShipmentPrices, stripVoucherPrices, stripVoucherStats } from './prices'

const SHIPMENT_INCLUDE = {
  customer: { select: { id: true, name: true } },
  contractor: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true } },
  statusHistory: { orderBy: { changedAt: 'asc' } },
} satisfies Prisma.ShipmentInclude

type ShipmentRow = Prisma.ShipmentGetPayload<{ include: typeof SHIPMENT_INCLUDE }>

export function inRange(dateISO: string | null | undefined, from: string | null, to: string | null): boolean {
  if (!from && !to) return true
  if (!dateISO) return false
  const t = new Date(dateISO).getTime()
  if (from && t < new Date(from + 'T00:00:00').getTime()) return false
  if (to && t > new Date(to + 'T23:59:59').getTime()) return false
  return true
}

export function paginate<T>(arr: T[], page: number, pageSize: number) {
  const total = arr.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const p = Math.min(Math.max(1, page), totalPages)
  const start = (p - 1) * pageSize
  return { items: arr.slice(start, start + pageSize), total, page: p, pageSize, totalPages }
}

function ref(r?: { id: string; name: string } | null) {
  return r ? { id: r.id, name: r.name } : null
}

export function enrichShipment(s: ShipmentRow, voucherLinks?: Map<string, { id: string; voucherNo: string; type: string; status: string; createdAt: Date; amount: number | null; notes: string | null }[]>, canPrices: boolean = true) {
  const sell = Number(s.freightTotal ?? 0)
  const cost = Number(s.totalSuppliers ?? 0)
  const history = (s.statusHistory ?? []).map((h) => ({ status: h.toStatus, notes: h.notes ?? null, date: h.changedAt, userName: h.userName ?? null }))
  const vh = voucherLinks?.get(s.id) ?? []
  const base: any = {
    ...s,
    customer: ref(s.customer),
    contractor: ref(s.contractor),
    branch: ref(s.branch),
    warehouse: ref(s.warehouse),
    margin: round2(sell - cost),
    statusHistory: history.length
      ? history
      : [{ status: s.status, notes: 'استيراد أولي', date: s.updatedAt ?? s.createdAt ?? null, userName: 'system' }],
    vouchers: [...vh].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()),
  }
  // إخفاء روابط الإذن التي تحمل مبالغ لو المستخدم لا يملك صلاحية الأسعار
  // (روابط السندات المالية تكشف المبلغ — نُفرّغها)
  if (!canPrices) {
    base.vouchers = base.vouchers.map((v: any) => ({ ...v, amount: null, notes: v.notes }))
  }
  return stripShipmentPrices(base, canPrices)
}

/** روابط إذن↔شحنة لدفعة معرفات (لتفادي N+1) */
export async function voucherLinksForShipments(shipments: { id: string }[]) {
  const map = new Map<string, { id: string; voucherNo: string; type: string; status: string; createdAt: Date; amount: number | null; notes: string | null }[]>()
  if (!shipments.length) return map
  const ids = shipments.map((s) => s.id)
  const links = await db.opVoucherItem.findMany({
    where: { shipmentId: { in: ids } },
    include: { voucher: { select: { id: true, voucherNo: true, type: true, status: true, createdAt: true, amount: true, notes: true } } },
  })
  for (const l of links) {
    if (!l.voucher) continue
    const arr = map.get(l.shipmentId) ?? []
    arr.push({ ...l.voucher, createdAt: l.voucher.createdAt, amount: l.voucher.amount, notes: l.voucher.notes })
    map.set(l.shipmentId, arr)
  }
  return map
}

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------
export async function listShipments(q: URLSearchParams, user?: { permissions: string[] } | null) {
  const canPrices = canSeePrices(user)
  const search = (q.get('q') ?? '').trim().toLowerCase()
  const status = q.get('status')
  const dest = q.get('destination')
  const contractor = q.get('contractor')
  const province = q.get('province')
  const idsParam = q.get('ids')
  const where: Prisma.ShipmentWhereInput = {}
  if (status && status !== 'all') where.status = status
  if (dest && dest !== 'all') where.destination = dest
  if (contractor && contractor !== 'all') where.contractorId = contractor
  if (province && province !== 'all') where.routeCode = { contains: province }
  if (idsParam) {
    const idSet = idsParam.split(',').filter(Boolean)
    where.id = { in: idSet }
  }
  let rows = await db.shipment.findMany({
    where,
    include: SHIPMENT_INCLUDE,
    orderBy: { date: 'desc' },
  })
  if (search) {
    rows = rows.filter((s) =>
      [s.shipmentNo, s.deliveryNumber, s.billNo, s.recipientName, s.destination, s.destinationEn, s.routeCode, s.deliveryPhones]
        .some((f) => String(f ?? '').toLowerCase().includes(search)))
  }
  // روابط الإذن↔شحنة لكل الصفوف المفلترة (كانت للصفين الـ60 الأول فقط)
  const links = await voucherLinksForShipments(rows)
  const items = rows.map((s) => enrichShipment(s, links, canPrices))
  const page = Math.max(1, parseInt(q.get('page') || '1', 10))
  const pageSize = Math.min(500, Math.max(1, parseInt(q.get('pageSize') || '20', 10)))
  return paginate(items, page, pageSize)
}

export async function getShipment(id: string, user?: { permissions: string[] } | null) {
  const canPrices = canSeePrices(user)
  const s = await db.shipment.findUnique({ where: { id }, include: SHIPMENT_INCLUDE })
  if (!s) throw new ApiError(404, 'الشحنة غير موجودة')
  const links = await voucherLinksForShipments([s])
  return enrichShipment(s, links, canPrices)
}

export async function shipmentVouchers(id: string, user?: { permissions: string[] } | null) {
  const canPrices = canSeePrices(user)
  const rows = await db.opVoucher.findMany({
    where: { items: { some: { shipmentId: id } } },
    include: voucherInclude(),
    orderBy: { createdAt: 'desc' },
  })
  return enrichVoucherRows(rows).map((v: any) => stripVoucherPrices(v, canPrices))
}



// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------
export async function listParties(q: URLSearchParams, user?: { permissions: string[] } | null) {
  const canPrices = canSeePrices(user)
  const type = q.get('type')
  const search = (q.get('q') ?? '').trim().toLowerCase()
  const where: Prisma.PartyWhereInput = {}
  if (type === 'customer') where.isCustomer = true
  if (type === 'contractor') where.isContractor = true
  if (type === 'supplier') where.isSupplier = true
  let rows = await db.party.findMany({ where, include: { branch: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } })
  if (search) rows = rows.filter((x) => String(x.name ?? '').toLowerCase().includes(search))
  const ids = rows.map((r) => r.id)
  // حسابات التحكم الفرعية للأطراف — الرصيد يتكوّن منها فقط:
  //   1103 العملاء + 2104 عهد المندوبين (طبيعية مدينة): صافي = مدين − دائن
  //   2101 الموردون + 2102 مقاولو النقل (طبيعية دائنة): صافي = دائن − مدين
  // سطور الإيراد/المصروف/النقدية المقابلة لا تدخل الرصيد (وإلا تلغى المديونية رياضيًا)
  const controlAccounts = await db.account.findMany({ where: { code: { in: ['1103', '2101', '2102', '2104'] } }, select: { id: true, code: true } })
  const controlSign = new Map(controlAccounts.map((a) => [a.id, a.code === '1103' || a.code === '2104' ? 1 : -1]))
  const controlIds = controlAccounts.map((a) => a.id)
  const [asCustomer, asContractor, controlRows] = await Promise.all([
    db.shipment.groupBy({ by: ['customerId'], where: { customerId: { in: ids } }, _count: { _all: true }, _sum: { freightTotal: true, totalSuppliers: true, customerPay: true } }),
    db.shipment.groupBy({ by: ['contractorId'], where: { contractorId: { in: ids } }, _count: { _all: true }, _sum: { freightTotal: true, totalSuppliers: true, customerPay: true } }),
    // الرصيد الحيّ من دفتر الأستاذ الفعلي — سطور حسابات التحكم المرحّلة فقط
    db.journalLine.groupBy({ by: ['partyId', 'accountId'], where: { partyId: { in: ids }, entry: { status: 'posted' }, accountId: { in: controlIds } }, _sum: { debit: true, credit: true } }),
  ])
  const ledgerMap = new Map<string, number>()
  for (const g of controlRows) {
    if (!g.partyId) continue
    const signed = ((g._sum.debit ?? 0) - (g._sum.credit ?? 0)) * (controlSign.get(g.accountId) ?? 1)
    ledgerMap.set(g.partyId, round2((ledgerMap.get(g.partyId) ?? 0) + signed))
  }
  const agg = new Map<string, { shipments: number; freightTotal: number; totalSuppliers: number; customerPay: number }>()
  for (const g of asCustomer) {
    if (!g.customerId) continue
    agg.set(g.customerId, { shipments: g._count._all, freightTotal: g._sum.freightTotal ?? 0, totalSuppliers: g._sum.totalSuppliers ?? 0, customerPay: g._sum.customerPay ?? 0 })
  }
  for (const g of asContractor) {
    if (!g.contractorId) continue
    const cur = agg.get(g.contractorId) ?? { shipments: 0, freightTotal: 0, totalSuppliers: 0, customerPay: 0 }
    cur.shipments += g._count._all
    cur.freightTotal += g._sum.freightTotal ?? 0
    cur.totalSuppliers += g._sum.totalSuppliers ?? 0
    agg.set(g.contractorId, cur)
  }
  const items = rows.map((p) => {
    const a = agg.get(p.id) ?? { shipments: 0, freightTotal: 0, totalSuppliers: 0, customerPay: 0 }
    // الرصيد الحالي = الرصيد الافتتاحي (سالب إذا كان دائن) + مدين − دائن من القيود المرحّلة
    const openingSign = p.openingBalanceType === 'credit' ? -1 : 1
    const ledger = ledgerMap.get(p.id) ?? 0
    const currentBalance = round2(openingSign * Number(p.openingBalance ?? 0) + ledger)
    return {
      ...p,
      branch: ref(p.branch),
      _count: { shipments: a.shipments },
      _sum: { freightTotal: round2(a.freightTotal), totalSuppliers: round2(a.totalSuppliers), customerPay: round2(a.customerPay) },
      currentBalance,
    }
  })
  const stripped = stripParties(items, canPrices)
  return { items: stripped, total: stripped.length }
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------
export async function listJournal(q: URLSearchParams) {
  const status = q.get('status')
  const rows = await db.journalEntry.findMany({
    where: status ? { status } : undefined,
    include: {
      branch: { select: { id: true, name: true } },
      lines: { include: { account: true, party: { select: { id: true, name: true } }, shipment: { select: { shipmentNo: true } } } },
    },
    orderBy: { date: 'desc' },
  })
  const items = rows.map((e) => ({
    id: e.id,
    entryNo: e.entryNo,
    date: e.date,
    description: e.description,
    reference: e.reference,
    branchId: e.branchId,
    branch: ref(e.branch),
    status: e.status,
    totalDebit: e.totalDebit,
    totalCredit: e.totalCredit,
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    reversalOfId: e.reversalOfId,
    postedAt: e.postedAt,
    lines: e.lines.map((l) => ({
      id: l.id,
      accountId: l.accountId,
      account: { id: l.account.id, code: l.account.code, name: l.account.name },
      debit: l.debit,
      credit: l.credit,
      description: l.description,
      partyId: l.partyId,
      party: ref(l.party),
      // ربط سطر القيد بالشحنة (للتتبع من القيد إلى الشحنة والعكس)
      shipmentId: l.shipmentId ?? null,
      shipmentNo: l.shipment?.shipmentNo ?? null,
    })),
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }))
  return { items, total: items.length }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
export async function listAccounts() {
  const [accounts, bal] = await Promise.all([
    db.account.findMany({ orderBy: { code: 'asc' } }),
    accountBalancesMap(db),
  ])
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const items = accounts.map((a) => {
    const b = bal.get(a.id) ?? { debit: 0, credit: 0 }
    const parent = a.parentId ? byId.get(a.parentId) : null
    return { ...a, parent: ref(parent), debit: b.debit, credit: b.credit, balance: round2(b.debit - b.credit) }
  })
  return { items }
}

// ---------------------------------------------------------------------------
// Items / Movements
// ---------------------------------------------------------------------------
export async function listItems(q: URLSearchParams) {
  const [rows, movements] = await Promise.all([
    db.item.findMany({ include: { warehouse: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } }),
    db.inventoryMovement.groupBy({ by: ['itemId', 'type'], _sum: { quantity: true } }),
  ])
  const bal = new Map<string, number>()
  for (const g of movements) {
    if (!g.itemId) continue
    const qty = g._sum.quantity ?? 0
    bal.set(g.itemId, round2((bal.get(g.itemId) ?? 0) + (g.type === 'transfer' ? 0 : qty)))
  }
  let items = rows.map((it) => {
    const balance = bal.get(it.id) ?? 0
    return {
      ...it,
      warehouse: ref(it.warehouse),
      balance,
      isLowStock: balance <= (it.reorderLevel ?? 0),
      stockValue: round2(balance * (it.cost ?? 0)),
    }
  })
  if (q.get('lowStock') === '1') items = items.filter((i) => i.isLowStock)
  return { items, total: items.length }
}

export async function listMovements() {
  const rows = await db.inventoryMovement.findMany({
    include: {
      item: { select: { id: true, name: true, code: true, unit: true } },
      warehouse: { select: { id: true, name: true } },
    },
    orderBy: { date: 'desc' },
  })
  const items = rows.map((m) => ({
    ...m,
    warehouse: ref(m.warehouse),
    toWarehouse: null,
  }))
  return { items, total: items.length }
}

// ---------------------------------------------------------------------------
// Vouchers (operational unified)
// ---------------------------------------------------------------------------
export async function listVouchers(q: URLSearchParams, user?: { permissions: string[] } | null) {
  const canPrices = canSeePrices(user)
  const type = q.get('type')
  const status = q.get('status')
  const branchId = q.get('branchId')
  const employeeId = q.get('employeeId')
  const courierId = q.get('courierId')
  const shipmentId = q.get('shipmentId')
  const from = q.get('from')
  const to = q.get('to')
  const search = (q.get('q') ?? '').trim().toLowerCase()
  const where: Prisma.OpVoucherWhereInput = {}
  if (type && type !== 'all') where.type = type
  if (status && status !== 'all') where.status = status
  if (employeeId && employeeId !== 'all') where.employeeId = employeeId
  if (courierId && courierId !== 'all') where.courierId = courierId
  if (branchId && branchId !== 'all') where.OR = [{ sourceBranchId: branchId }, { destBranchId: branchId }]
  if (shipmentId) where.items = { some: { shipmentId } }
  const rows = await db.opVoucher.findMany({ where, include: voucherInclude(), orderBy: { createdAt: 'desc' } })
  let enriched = enrichVoucherRows(rows)
  if (from) enriched = enriched.filter((v: any) => inRange(v.createdAt, from, null))
  if (to) enriched = enriched.filter((v: any) => inRange(v.createdAt, null, to))
  if (search) {
    enriched = enriched.filter((v: any) =>
      (v.voucherNo || '').toLowerCase().includes(search) ||
      (v.party?.name || '').toLowerCase().includes(search) ||
      (v.notes || '').toLowerCase().includes(search) ||
      (v.typeLabel || '').toLowerCase().includes(search))
  }
  // إخفاء المبالغ لغير المصرح لهم
  enriched = enriched.map((v: any) => stripVoucherPrices(v, canPrices))
  return { items: enriched, total: enriched.length }
}

export async function getVoucher(id: string, user?: { permissions: string[] } | null) {
  const canPrices = canSeePrices(user)
  const rows = await db.opVoucher.findMany({ where: { id }, include: voucherInclude() })
  if (!rows.length) throw new ApiError(404, 'الإذن غير موجود')
  return stripVoucherPrices(enrichVoucherRows(rows)[0], canPrices)
}

export async function voucherStats(user?: { permissions: string[] } | null) {
  const canPrices = canSeePrices(user)
  const rows = await db.opVoucher.findMany({ select: { status: true, type: true, sourceBranchId: true, employeeId: true, amount: true, items: { select: { shipmentId: true } } } })
  const byStatus: Record<string, number> = {}
  const byType: Record<string, number> = {}
  const byBranch: Record<string, number> = {}
  const byEmployee: Record<string, number> = {}
  const shipmentIds = new Set<string>()
  for (const v of rows) {
    byStatus[v.status] = (byStatus[v.status] ?? 0) + 1
    byType[v.type] = (byType[v.type] ?? 0) + 1
    const br = v.sourceBranchId ?? '_none'
    byBranch[br] = (byBranch[br] ?? 0) + 1
    const em = v.employeeId ?? '_none'
    byEmployee[em] = (byEmployee[em] ?? 0) + 1
    for (const it of v.items) shipmentIds.add(it.shipmentId)
  }
  const completedFin = rows.filter((v) => v.status === 'completed')
  const stats = {
    total: rows.length,
    byStatus, byType, byBranch, byEmployee,
    draft: byStatus.draft ?? 0,
    pendingApproval: byStatus.pending ?? 0,
    approved: byStatus.approved ?? 0,
    inProgress: byStatus.in_progress ?? 0,
    completed: byStatus.completed ?? 0,
    rejected: byStatus.rejected ?? 0,
    cancelled: byStatus.cancelled ?? 0,
    collectionTotal: round2(completedFin.filter((v) => v.type === 'collection').reduce((s, v) => s + (v.amount || 0), 0)),
    disbursementTotal: round2(completedFin.filter((v) => v.type === 'cash_disbursement').reduce((s, v) => s + (v.amount || 0), 0)),
    shipmentsLinked: shipmentIds.size,
  }
  return stripVoucherStats(stats, canPrices)
}

export function voucherTypesCatalog() {
  return { types: VOUCHER_TYPES, states: VOUCHER_STATES, categories: VOUCHER_CATEGORIES }
}

// ---------------------------------------------------------------------------
// Reports — كلها مشتقة من البيانات المحاسبية الفعلية
// ---------------------------------------------------------------------------
export async function report(type: string, q: URLSearchParams, user?: { permissions: string[] } | null) {
  const from = q.get('from')
  const to = q.get('to')
  const canPrices = canSeePrices(user)

  // التقارير التي تكشف أسعارًا تتطلب صلاحية prices.view (فرض من الخادم)
  if (reportRequiresPrices(type) && !canPrices) {
    throw new ApiError(403, 'هذا التقرير يكشف أسعارًا/مبالغ — يتطلب صلاحية "prices.view"')
  }

  if (type === 'pending-returns') {
    // تقرير المرتجعات التي لم تُستلم بعد — مع المندوب، لا يكشف أسعارًا
    const rows = await db.shipment.findMany({
      where: { status: 'returned' },
      include: {
        customer: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'asc' },
    })
    const shipmentIds = rows.map((s) => s.id)
    // ابحث عن إذن المرتجع المكتمل المرتبط بكل شحنة
    const returnLinks = await db.opVoucherItem.findMany({
      where: { shipmentId: { in: shipmentIds }, voucher: { type: 'return', status: 'completed' } },
      include: {
        voucher: {
          select: {
            id: true, voucherNo: true, courierId: true, createdAt: true, notes: true,
            courier: { select: { id: true, name: true } },
          },
        },
      },
    })
    // ابحث عن أي إذن استلام مرتجعات مكتمل مرتبط بنفس الشحنة (للاستبعاد)
    const receivedLinks = await db.opVoucherItem.findMany({
      where: { shipmentId: { in: shipmentIds }, voucher: { type: 'returned_receiving', status: 'completed' } },
      select: { shipmentId: true },
    })
    const receivedSet = new Set(receivedLinks.map((r) => r.shipmentId))
    const linkMap = new Map<string, any>()
    for (const l of returnLinks) {
      const arr = linkMap.get(l.shipmentId) ?? []
      arr.push(l.voucher)
      linkMap.set(l.shipmentId, arr)
    }
    const items = rows
      .filter((s) => !receivedSet.has(s.id))
      .map((s) => {
        const vs = linkMap.get(s.id) ?? []
        const returnVoucher = vs[0]
        const courier = returnVoucher?.courier
        const daysOutstanding = returnVoucher?.createdAt
          ? Math.floor((Date.now() - new Date(returnVoucher.createdAt).getTime()) / 86400000)
          : null
        return {
          shipmentId: s.id,
          shipmentNo: s.shipmentNo,
          recipientName: s.recipientName,
          destination: s.destination,
          customerName: s.customer?.name ?? null,
          branchName: s.branch?.name ?? null,
          returnVoucherNo: returnVoucher?.voucherNo ?? null,
          returnVoucherId: returnVoucher?.id ?? null,
          courierId: courier?.id ?? null,
          courierName: courier?.name ?? null,
          returnDate: returnVoucher?.createdAt ?? null,
          daysOutstanding,
        }
      })
    // ملخص حسب المندوب (مسؤولية السائق)
    const byCourier = new Map<string, { courierId: string; courierName: string; count: number; oldestDays: number }>()
    for (const it of items) {
      const key = it.courierId ?? '_unknown'
      const cur = byCourier.get(key) ?? {
        courierId: it.courierId ?? '',
        courierName: it.courierName ?? 'غير محدد',
        count: 0,
        oldestDays: 0,
      }
      cur.count += 1
      cur.oldestDays = Math.max(cur.oldestDays, it.daysOutstanding ?? 0)
      byCourier.set(key, cur)
    }
    return {
      items,
      byCourier: [...byCourier.values()].sort((a, b) => b.count - a.count),
      total: items.length,
    }
  }

  if (type === 'shipments' || type === 'freight-margin') {
    const rows = await db.shipment.findMany({ where: dateWhere('date', from, to), include: SHIPMENT_INCLUDE, orderBy: { date: 'desc' } })
    const items = rows.map((s) => enrichShipment(s, undefined, canPrices)).map((s: any) => {
      // هامش موحّد في كل النظام: نولون البيع − تكلفة المقاول
      const sell = s.salePrice ?? s.freightTotal ?? 0
      return { ...s, sell, margin: round2(sell - (s.totalSuppliers ?? 0)) }
    })
    return { items: type === 'shipments' ? items.map(({ sell, margin, ...rest }: any) => rest) : items }
  }

  if (type === 'contractor-dues') {
    const rows = await db.shipment.findMany({ where: dateWhere('date', from, to), include: SHIPMENT_INCLUDE })
    const map = new Map<string, any>()
    for (const s of rows) {
      if (!s.contractorId) continue
      const cur = map.get(s.contractorId) ?? { id: s.contractorId, name: s.contractor?.name ?? '-', shipments: 0, freight: 0, totalSuppliers: 0 }
      cur.shipments += 1
      cur.freight += s.freightTotal ?? 0
      cur.totalSuppliers += s.totalSuppliers ?? 0
      map.set(s.contractorId, cur)
    }
    // البنود الإضافية المعتمدة تدخل مستحقات المقاول (تم ترحيلها محاسبيًا عند الاعتماد)
    // والمعلقة تُعرض منفصلة — لا تُحسب قبل موافقة الشركة
    const ecWhere: any = { contractorId: { in: [...map.keys()] } }
    if (from || to) {
      ecWhere.date = {}
      if (from) ecWhere.date.gte = new Date(from + 'T00:00:00')
      if (to) ecWhere.date.lte = new Date(to + 'T23:59:59')
    }
    const [ecRows, contractorsAcc] = await Promise.all([
      map.size ? db.extraCost.groupBy({ by: ['contractorId', 'approvalStatus'], where: ecWhere, _count: { _all: true }, _sum: { amount: true } }) : Promise.resolve([] as any[]),
      db.account.findUnique({ where: { code: ACC.CONTRACTORS }, select: { id: true } }),
    ])
    // المسحوبات الفعلية = سطور مدين 2102 المصدرها سندات صرف/قيد يدوي — مشتقة من
    // دفتر الأستاذ نفسه (متسقة مع كشف الحساب ومتابعة الإدارة والتقرير الشهري)
    // مع نسبة القيود العكسية لأثرها الأصلي: عكس دفعة يُخرجها من المسحوبات فورًا
    const paidLines = contractorsAcc
      ? await db.journalLine.findMany({
          where: { accountId: contractorsAcc.id, partyId: { in: [...map.keys()] }, entry: { status: 'posted', sourceType: { in: ['op_voucher', 'manual', 'journal_reversal'] } } },
          select: { partyId: true, debit: true, credit: true, entry: { select: { sourceType: true, sourceId: true } } },
        })
      : []
    const reversalIds = paidLines
      .filter((l) => l.entry?.sourceType === 'journal_reversal' && l.entry?.sourceId)
      .map((l) => l.entry.sourceId as string)
    const paidOriginalSources = await reversalOriginalSources(db, [...new Set(reversalIds)])
    const paidSummary = summarizeContractorLedgerLines(paidLines, paidOriginalSources)
    const paidMap = new Map<string, number>()
    for (const [pid, s] of paidSummary) paidMap.set(pid, s.paidFromVouchers)
    const ecMap = new Map<string, { approved: number; approvedCount: number; pending: number; pendingCount: number }>()
    for (const g of ecRows) {
      if (!g.contractorId) continue
      const cur = ecMap.get(g.contractorId) ?? { approved: 0, approvedCount: 0, pending: 0, pendingCount: 0 }
      if (g.approvalStatus === 'approved') { cur.approved += g._sum.amount ?? 0; cur.approvedCount += g._count._all }
      if (g.approvalStatus === 'pending') { cur.pending += g._sum.amount ?? 0; cur.pendingCount += g._count._all }
      ecMap.set(g.contractorId, cur)
    }
    const items = [...map.values()].map((c) => {
      const paid = round2(paidMap.get(c.id) ?? 0)
      const ec = ecMap.get(c.id) ?? { approved: 0, approvedCount: 0, pending: 0, pendingCount: 0 }
      const work = round2(c.totalSuppliers)
      const extrasApproved = round2(ec.approved)
      return {
        ...c,
        freight: round2(c.freight),
        totalSuppliers: work,
        extrasApproved,
        extrasApprovedCount: ec.approvedCount,
        extrasPending: round2(ec.pending),
        extrasPendingCount: ec.pendingCount,
        paid,
        // المتبقي = قيمة الشغل + البنود المعتمدة − المسحوبات (المعلقة غير محسوبة)
        due: round2(work + extrasApproved - paid),
      }
    }).sort((a, b) => b.due - a.due)
    return { items }
  }

  // ------------------------------------------------------------------
  // التقرير الشهري الموحد للمقاول — مستمد بالكامل من دفتر الأستاذ (2102)
  // كل حركة: شغل شحنات (قيد تسليم) / بنود إضافية معتمدة / مسحوبات (سندات صرف)
  // مرتبة زمنيًا مع رصيد تراكمي + إجماليات نهائية — بلا أي تكرار للبيانات
  // ------------------------------------------------------------------
  if (type === 'contractor-monthly') {
    const contractorId = q.get('contractorId')
    if (!contractorId) throw new ApiError(400, 'حدد المقاول (contractorId)')
    const nowD = new Date()
    const year = Math.min(Math.max(parseInt(q.get('year') || String(nowD.getFullYear()), 10) || nowD.getFullYear(), 2000), 2100)
    const month = Math.min(Math.max(parseInt(q.get('month') || String(nowD.getMonth() + 1), 10) || nowD.getMonth() + 1, 1), 12)
    const fromDate = new Date(year, month - 1, 1)
    const toDate = new Date(year, month, 0, 23, 59, 59, 999)
    const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' })

    const contractor = await db.party.findUnique({ where: { id: contractorId }, select: { id: true, code: true, name: true, openingBalance: true, openingBalanceType: true } })
    if (!contractor) throw new ApiError(404, 'المقاول غير موجود')

    const contractorsAcc = await db.account.findUnique({ where: { code: ACC.CONTRACTORS }, select: { id: true } })
    if (!contractorsAcc) throw new ApiError(500, 'حساب مقاولي النقل (2102) غير موجود في دليل الحسابات')

    // الرصيد الافتتاحي للمقاول (في صالحه إذا كان دائن) + الحركات قبل بداية الشهر
    const openingSign = contractor.openingBalanceType === 'credit' ? -1 : 1
    let openingForHim = round2(-openingSign * Number(contractor.openingBalance ?? 0))
    {
      const before = await db.journalLine.aggregate({
        where: { accountId: contractorsAcc.id, partyId: contractorId, entry: { status: 'posted', date: { lt: fromDate } } },
        _sum: { debit: true, credit: true },
      })
      openingForHim = round2(openingForHim + (before._sum.credit ?? 0) - (before._sum.debit ?? 0))
    }

    const lines = await db.journalLine.findMany({
      where: { accountId: contractorsAcc.id, partyId: contractorId, entry: { status: 'posted', date: { gte: fromDate, lte: toDate } } },
      include: {
        entry: { select: { id: true, entryNo: true, date: true, description: true, reference: true, sourceType: true, sourceId: true, reversalOfId: true } },
        shipment: { select: { id: true, shipmentNo: true, deliveryNumber: true, destination: true } },
      },
      orderBy: [{ entry: { date: 'asc' } }, { id: 'asc' }],
    })

    // استكمال المراجع: البنود الإضافية (بالنوع) والسندات المالية (برقمها)
    const ecIds = lines.filter((l) => l.entry.sourceType === EXTRA_COST_SOURCE && l.entry.sourceId).map((l) => l.entry.sourceId as string)
    const voucherIds = lines.filter((l) => l.entry.sourceType === 'op_voucher' && l.entry.sourceId).map((l) => l.entry.sourceId as string)
    const [ecRows, voucherRows] = await Promise.all([
      ecIds.length ? db.extraCost.findMany({ where: { id: { in: ecIds } }, select: { id: true, ref: true, type: true, notes: true } }) : Promise.resolve([]),
      voucherIds.length ? db.opVoucher.findMany({ where: { id: { in: voucherIds } }, select: { id: true, voucherNo: true, type: true } }) : Promise.resolve([]),
    ])
    const ecMap = new Map<string, { id: string; ref: string | null; type: string; notes: string | null }>(
      ecRows.map((x) => [x.id, x] as [string, typeof x]),
    )
    const voucherMap = new Map<string, { id: string; voucherNo: string; type: string }>(
      voucherRows.map((x) => [x.id, x] as [string, typeof x]),
    )

    let running = openingForHim
    const items: any[] = []
    const totals = { work: 0, taateeq: 0, mabeet: 0, return: 0, extrasTotal: 0, payments: 0, other: 0, reversal: 0 }
    for (const l of lines) {
      // في صالح المقاول: دائن 2102 موجب — المسحوبات (مدين) سالب
      const amount = round2((l.credit || 0) - (l.debit || 0))
      running = round2(running + amount)
      const src = l.entry.sourceType ?? 'manual'
      let kind = 'other'
      let label = l.entry.description ?? 'حركة محاسبية'
      let refNo: string | null = l.entry.reference ?? null
      const extra: Record<string, any> = {}
      if (src === 'shipment_delivery' && amount > 0) {
        kind = 'work'; label = 'قيمة شغل شحنة'
        totals.work = round2(totals.work + amount)
      } else if (src === EXTRA_COST_SOURCE) {
        const ec = ecMap.get(l.entry.sourceId as string)
        const t = ec?.type ?? 'other'
        kind = `extra_${t}`
        label = `بند إضافي — ${extraCostTypeLabel(t)}`
        refNo = ec?.ref ?? l.entry.reference ?? null
        extra.ecNotes = ec?.notes ?? null
        if (t === 'taateeq') totals.taateeq = round2(totals.taateeq + amount)
        else if (t === 'mabeet') totals.mabeet = round2(totals.mabeet + amount)
        else if (t === 'return') totals.return = round2(totals.return + amount)
        else totals.other = round2(totals.other + amount)
        totals.extrasTotal = round2(totals.extrasTotal + amount)
      } else if (src === 'op_voucher') {
        const v = voucherMap.get(l.entry.sourceId as string)
        if (v?.type === 'cash_disbursement' && amount < 0) {
          kind = 'payment'; label = 'دفعة/عهدة صرفت للمقاول'
          refNo = v.voucherNo
          totals.payments = round2(totals.payments + Math.abs(amount))
        } else {
          totals.other = round2(totals.other + amount)
        }
      } else if (src === 'journal_reversal') {
        kind = 'reversal'; label = `قيد عكسي${l.entry.reference ? ` (${l.entry.reference})` : ''}`
        totals.reversal = round2(totals.reversal + amount)
      } else {
        totals.other = round2(totals.other + amount)
      }
      items.push({
        id: l.id,
        date: l.entry.date,
        entryNo: l.entry.entryNo,
        kind,
        label,
        refNo,
        notes: l.description ?? null,
        shipment: l.shipment ? { id: l.shipment.id, shipmentNo: l.shipment.shipmentNo, deliveryNumber: l.shipment.deliveryNumber, destination: l.shipment.destination } : null,
        amount,
        balance: running,
      })
    }

    return {
      contractor: { id: contractor.id, code: contractor.code, name: contractor.name },
      period: { year, month, from: fromDate.toISOString(), to: toDate.toISOString(), label: monthLabel },
      opening: openingForHim,
      items,
      totals: { ...totals, net: running },
    }
  }

  if (type === 'customer-debts') {
    const rows = await db.shipment.findMany({ where: dateWhere('date', from, to), include: SHIPMENT_INCLUDE })
    const map = new Map<string, any>()
    for (const s of rows) {
      if (!s.customerId) continue
      const cur = map.get(s.customerId) ?? { id: s.customerId, name: s.customer?.name ?? '-', shipments: 0, total: 0, paid: 0 }
      cur.shipments += 1
      cur.total += s.freightTotal ?? 0
      cur.paid += s.customerPay ?? 0
      map.set(s.customerId, cur)
    }
    // المدفوع الفعلي = سندات التحصيل المكتملة (باستثناء دفعات الشحنات التي سُوّيت بسندات)
    const paidRows = await db.opVoucher.groupBy({
      by: ['partyId'],
      where: { type: 'collection', status: 'completed', partyId: { in: [...map.keys()] } },
      _sum: { amount: true },
    })
    const voucherLinkedShipments = await db.opVoucherItem.findMany({
      where: { voucher: { type: 'collection', status: 'completed' } },
      select: { shipmentId: true },
    })
    const linkedSet = new Set(voucherLinkedShipments.map((x) => x.shipmentId))
    // استبعاد customerPay للشحنات المسوّة بسندات (تفادي الازدواج)
    for (const s of rows) {
      if (s.customerId && linkedSet.has(s.id)) {
        const cur = map.get(s.customerId)
        if (cur) cur.paid -= s.customerPay ?? 0
      }
    }
    const paidMap = new Map(paidRows.map((p) => [p.partyId, p._sum.amount ?? 0]))
    const items = [...map.values()].map((c) => {
      const paid = round2((paidMap.get(c.id) ?? 0) + c.paid)
      return { ...c, total: round2(c.total), paid, due: round2(c.total - paid) }
    }).sort((a, b) => b.due - a.due)
    return { items }
  }

  if (type === 'trial-balance') {
    const [accounts, bal] = await Promise.all([
      db.account.findMany({ where: { isDetail: true }, orderBy: { code: 'asc' } }),
      accountBalancesMap(db),
    ])
    const items = accounts.map((a) => {
      const b = bal.get(a.id) ?? { debit: 0, credit: 0 }
      return { ...a, parent: null, debit: b.debit, credit: b.credit, balance: round2(b.debit - b.credit) }
    })
    return { items }
  }

  if (type === 'income-statement') {
    const accounts = await db.account.findMany({ where: { isDetail: true } })
    const bal = await accountBalancesMap(db)
    const revenue = accounts.filter((a) => a.code.startsWith('4')).map((a) => {
      const b = bal.get(a.id) ?? { debit: 0, credit: 0 }
      return { id: a.id, code: a.code, name: a.name, amount: round2(b.credit - b.debit) }
    }).filter((x) => x.amount !== 0)
    const expenses = accounts.filter((a) => a.code.startsWith('5')).map((a) => {
      const b = bal.get(a.id) ?? { debit: 0, credit: 0 }
      return { id: a.id, code: a.code, name: a.name, amount: round2(b.debit - b.credit) }
    }).filter((x) => x.amount !== 0)
    const totalRevenue = round2(revenue.reduce((s, x) => s + x.amount, 0))
    const totalExpenses = round2(expenses.reduce((s, x) => s + x.amount, 0))
    return { revenue, expenses, totalRevenue, totalExpenses, netProfit: round2(totalRevenue - totalExpenses) }
  }

  if (type === 'account-statement') {
    const accountId = q.get('accountId')
    if (!accountId) throw new ApiError(400, 'حدد الحساب (accountId)')
    const acc = await db.account.findUnique({ where: { id: accountId } })
    if (!acc) throw new ApiError(404, 'الحساب غير موجود')
    // الرصيد الافتتاحي = مجموع (مدين − دائن) للقيود المرحّلة السابقة على بداية الفترة
    let opening = 0
    if (from) {
      const beforeLines = await db.journalLine.findMany({
        where: { accountId, entry: { status: 'posted', date: { lt: new Date(from + 'T00:00:00') } } },
        select: { debit: true, credit: true },
      })
      opening = round2(beforeLines.reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0))
    }
    const where: Prisma.JournalLineWhereInput = { accountId, entry: { status: 'posted' } }
    const range = dateRange(from, to)
    if (range) where.entry = { status: 'posted', date: range }
    const lines = await db.journalLine.findMany({
      where,
      include: { entry: true, party: { select: { id: true, name: true } } },
      orderBy: { entry: { date: 'asc' } },
    })
    let running = opening
    const items = lines.map((l) => {
      running = round2(running + (l.debit || 0) - (l.credit || 0))
      return {
        id: l.id, date: l.entry.date, entryNo: l.entry.entryNo, description: l.entry.description,
        reference: l.entry.reference, party: ref(l.party),
        debit: l.debit, credit: l.credit, balance: running,
      }
    })
    return { account: { id: acc.id, code: acc.code, name: acc.name }, opening, items }
  }

  if (type === 'inventory-movements') {
    const rows = await db.inventoryMovement.findMany({
      where: { date: dateRange(from, to) },
      include: { item: { select: { id: true, name: true, code: true, unit: true } }, warehouse: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
    })
    return { items: rows.map((m) => ({ ...m, warehouse: ref(m.warehouse), toWarehouse: null })) }
  }

  if (type === 'low-stock') {
    const r = await listItems(new URLSearchParams({ lowStock: '1' }))
    return { items: r.items }
  }

  throw new ApiError(404, `تقرير غير معروف: ${type}`)
}

function dateWhere(field: 'date', from: string | null, to: string | null): Prisma.ShipmentWhereInput {
  const range = dateRange(from, to)
  return range ? { [field]: range } as Prisma.ShipmentWhereInput : {}
}

function dateRange(from: string | null, to: string | null) {
  if (!from && !to) return undefined
  const gte = from ? new Date(from + 'T00:00:00') : undefined
  const lte = to ? new Date(to + 'T23:59:59') : undefined
  if (gte && lte) return { gte, lte }
  if (gte) return { gte }
  if (lte) return { lte }
  return undefined
}

// ---------------------------------------------------------------------------
// Dashboard stats — محسوبة من قاعدة البيانات
// ---------------------------------------------------------------------------
export async function dashboardStats(q: URLSearchParams | null, user?: { permissions: string[] } | null) {
  const canPrices = canSeePrices(user)
  const from = q?.get('from') ?? null
  const to = q?.get('to') ?? null
  const dateFilter = dateWhere('date', from, to)
  const [agg, statusGroup, dailyRows, contractorRows, destRows, codRows, pendingGroup] = await Promise.all([
    db.shipment.aggregate({
      where: dateFilter,
      _count: { _all: true },
      _sum: { policyQty: true, freightTotal: true, customerPay: true, totalSuppliers: true, salePrice: true, aging: true, overnight: true, returns: true, transfer: true, other: true, drop: true, ton15: true, ton3: true, m6: true },
    }),
    db.shipment.groupBy({ by: ['status'], where: dateFilter, _count: { _all: true } }),
    db.shipment.findMany({ where: dateFilter, select: { date: true, freightTotal: true, totalSuppliers: true, customerPay: true }, orderBy: { date: 'asc' } }),
    db.shipment.groupBy({ by: ['contractorId'], where: { contractorId: { not: null }, ...dateFilter }, _count: { _all: true }, _sum: { freightTotal: true, totalSuppliers: true } }),
    db.shipment.groupBy({ by: ['destination'], where: { destination: { not: null }, ...dateFilter }, _count: { _all: true }, _sum: { freightTotal: true, totalSuppliers: true } }),
    db.shipment.groupBy({ by: ['routeCode'], where: { routeCode: { not: null }, ...dateFilter }, _count: { _all: true }, _sum: { freightTotal: true } }),
    db.shipment.groupBy({ by: ['collectionStatus'], where: dateFilter, _count: { _all: true } }),
  ])
  const sum = agg._sum
  const statusCounts: Record<string, number> = {}
  for (const g of statusGroup) statusCounts[g.status] = g._count._all
  const contractorIds = contractorRows.map((c) => c.contractorId).filter(Boolean) as string[]
  const contractors = contractorIds.length ? await db.party.findMany({ where: { id: { in: contractorIds } }, select: { id: true, name: true } }) : []
  const contractorName = new Map(contractors.map((c) => [c.id, c.name]))
  const dailyMap = new Map<string, { count: number; freight: number; suppliers: number; customerPay: number }>()
  for (const s of dailyRows) {
    if (!s.date) continue
    const key = String(Math.floor(new Date(s.date).getTime() / 1000))
    const cur = dailyMap.get(key) ?? { count: 0, freight: 0, suppliers: 0, customerPay: 0 }
    cur.count += 1
    cur.freight += s.freightTotal ?? 0
    cur.suppliers += s.totalSuppliers ?? 0
    cur.customerPay += s.customerPay ?? 0
    dailyMap.set(key, cur)
  }
  const daily = [...dailyMap.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([date, v]) => ({ date, ...v }))
  const dates = dailyRows.map((s) => s.date).filter(Boolean) as Date[]
  const totalFreight = sum.freightTotal ?? 0
  const totalSale = sum.salePrice ?? 0
  const collectionCounts: Record<string, number> = {}
  for (const g of pendingGroup) collectionCounts[g.collectionStatus] = g._count._all
  // صافي هامش النولون — صيغة موحّدة في كل النظام: نولون البيع − تكلفة المقاول
  // المتأخرة = مؤجلة + فشل تسليم (أرقام حقيقية من قاعدة البيانات)
  return stripDashboardStats({
    summary: {
      totalShipments: agg._count._all,
      totalUnits: round2(sum.policyQty ?? 0),
      totalFreight: round2(totalFreight),
      totalCustomerPay: round2(sum.customerPay ?? 0),
      totalSuppliers: round2(sum.totalSuppliers ?? 0),
      totalSale: round2(totalSale),
      netFreightMargin: round2(totalFreight - (sum.totalSuppliers ?? 0)),
      totalAging: round2(sum.aging ?? 0),
      totalOvernight: round2(sum.overnight ?? 0),
      totalReturns: round2(sum.returns ?? 0),
      totalTransfer: round2(sum.transfer ?? 0),
      totalOther: round2(sum.other ?? 0),
      totalDrop: round2(sum.drop ?? 0),
      ton15Total: round2(sum.ton15 ?? 0),
      ton3Total: round2(sum.ton3 ?? 0),
      m6Total: round2(sum.m6 ?? 0),
      inTransit: (statusCounts.in_transit ?? 0) + (statusCounts.loaded ?? 0),
      delivered: statusCounts.delivered ?? 0,
      returned: statusCounts.returned ?? 0,
      delayed: (statusCounts.postponed ?? 0) + (statusCounts.failed ?? 0),
      codUncollected: (collectionCounts.uncollected ?? 0) + (collectionCounts.partial ?? 0),
      statusCounts,
    },
    daily,
    destinations: destRows
      .map((g) => ({ name: g.destination ?? '-', count: g._count._all, freight: round2(g._sum.freightTotal ?? 0), suppliers: round2(g._sum.totalSuppliers ?? 0) }))
      .sort((a, b) => b.count - a.count),
    codings: codRows
      .map((g) => ({ name: g.routeCode ?? '-', count: g._count._all, freight: round2(g._sum.freightTotal ?? 0) }))
      .sort((a, b) => b.count - a.count),
    contractors: contractorRows
      .map((c) => ({ name: contractorName.get(c.contractorId ?? '') ?? '-', count: c._count._all, freight: round2(c._sum.freightTotal ?? 0), suppliers: round2(c._sum.totalSuppliers ?? 0) }))
      .sort((a, b) => b.count - a.count),
    dateRange: {
      from: dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))).toISOString() : null,
      to: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString() : null,
    },
  }, canPrices)
}

void num
