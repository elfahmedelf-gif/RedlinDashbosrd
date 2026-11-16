// ============================================================================
// طبقة استعلام أذونات التسليم (الديليفري) — لكل مقاول على حدة
// العنصر الأساسي: الشحنات المسندة لمقاول + علامة استلام الإذن (isReceiptDelivered)
// + عدّادات اليوم: إجمالي شحنات اليوم / خرجت / متبقية (برقم الديليفري)
// + تجميع لكل مقاول (أذوناته الخاصة — لا قوائم مختلطة)
// ============================================================================
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ApiError, round2 } from './http'
import { DISPATCHED_STATUSES, RECEIPT_EXCLUDED_STATUSES, RECEIPT_OVERDUE_DAYS } from '../extra-cost-catalog'

const RECEIPT_INCLUDE = {
  contractor: { select: { id: true, name: true, code: true } },
  customer: { select: { id: true, name: true } },
} satisfies Prisma.ShipmentInclude

function dayRange(dateISO: string | null | undefined) {
  const d = dateISO && /^\d{4}-\d{2}-\d{2}$/.test(dateISO) ? dateISO : new Date().toISOString().slice(0, 10)
  return { from: new Date(d + 'T00:00:00'), to: new Date(d + 'T23:59:59.999'), iso: d }
}

/**
 * قائمة أذونات التسليم — الشحنات المسندة لمقاولين فقط (لا إذن لشحنة بلا مقاول).
 * view: all | undelivered | delivered | overdue (متأخرة = غير مسلمة أقدم من 3 أيام)
 */
export async function listReceipts(q: URLSearchParams, user?: { permissions: string[] } | null) {
  void user
  const contractorId = q.get('contractorId')
  const view = q.get('view') ?? 'all'
  const search = (q.get('q') ?? '').trim().toLowerCase()
  const now = Date.now()

  const where: Prisma.ShipmentWhereInput = {
    contractorId: contractorId && contractorId !== 'all' ? contractorId : { not: null },
    status: { notIn: [...RECEIPT_EXCLUDED_STATUSES] },
  }
  if (view === 'undelivered' || view === 'overdue') where.isReceiptDelivered = false
  if (view === 'delivered') where.isReceiptDelivered = true

  const rows = await db.shipment.findMany({
    where,
    include: RECEIPT_INCLUDE,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  })

  const enriched = rows.map((s) => {
    const base = s.date ?? s.createdAt
    const ageDays = base ? Math.max(0, Math.floor((now - new Date(base).getTime()) / 86400000)) : 0
    return {
      id: s.id,
      deliveryNumber: s.deliveryNumber ?? s.shipmentNo,
      shipmentNo: s.shipmentNo,
      billNo: s.billNo,
      destination: s.destination,
      recipientName: s.recipientName,
      date: s.date,
      status: s.status,
      contractor: s.contractor ? { id: s.contractor.id, name: s.contractor.name, code: s.contractor.code } : null,
      customer: s.customer ? { id: s.customer.id, name: s.customer.name } : null,
      isReceiptDelivered: s.isReceiptDelivered,
      receiptDeliveredAt: s.receiptDeliveredAt,
      ageDays,
      overdue: !s.isReceiptDelivered && ageDays > RECEIPT_OVERDUE_DAYS,
    }
  })

  let items = enriched
  if (view === 'overdue') items = items.filter((x) => x.overdue)
  if (search) {
    items = items.filter((x) =>
      [x.deliveryNumber, x.shipmentNo, x.billNo, x.destination, x.recipientName, x.contractor?.name]
        .some((f) => String(f ?? '').toLowerCase().includes(search)))
  }

  // تجميع لكل مقاول — أذوناته الخاصة (شارات التبويبات)
  const byContractorMap = new Map<string, { id: string; name: string; code: string | null; pending: number; overdue: number; delivered: number; total: number }>()
  for (const x of enriched) {
    if (!x.contractor) continue
    const key = x.contractor.id
    const cur = byContractorMap.get(key) ?? { id: key, name: x.contractor.name, code: x.contractor.code, pending: 0, overdue: 0, delivered: 0, total: 0 }
    cur.total += 1
    if (x.isReceiptDelivered) cur.delivered += 1
    else {
      cur.pending += 1
      if (x.overdue) cur.overdue += 1
    }
    byContractorMap.set(key, cur)
  }
  const byContractor = [...byContractorMap.values()].sort((a, b) => b.pending - a.pending || b.overdue - a.overdue)

  const page = Math.max(1, parseInt(q.get('page') || '1', 10))
  const pageSize = Math.min(500, Math.max(1, parseInt(q.get('pageSize') || '20', 10)))
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const p = Math.min(page, totalPages)
  const start = (p - 1) * pageSize

  const totals = {
    all: enriched.length,
    pending: enriched.filter((x) => !x.isReceiptDelivered).length,
    overdue: enriched.filter((x) => x.overdue).length,
    delivered: enriched.filter((x) => x.isReceiptDelivered).length,
  }

  return { items: items.slice(start, start + pageSize), total, page: p, pageSize, totalPages, totals, byContractor }
}

/**
 * عدّادات اليوم — إجمالي شحنات اليوم / التي خرجت / المتبقية
 * (الملغاة والمشطوبة مستبعدة من العدّ — لا تخرج ولا تبقى)
 */
export async function dailyShipmentKpis(dateISO: string | null | undefined, contractorId?: string | null) {
  const { from, to, iso } = dayRange(dateISO)
  const baseWhere: Prisma.ShipmentWhereInput = {
    date: { gte: from, lte: to },
    status: { notIn: [...RECEIPT_EXCLUDED_STATUSES] },
  }
  if (contractorId) baseWhere.contractorId = contractorId

  const [total, dispatched, receiptsPending] = await Promise.all([
    db.shipment.count({ where: baseWhere }),
    db.shipment.count({ where: { ...baseWhere, status: { in: [...DISPATCHED_STATUSES] } } }),
    db.shipment.count({ where: { ...baseWhere, isReceiptDelivered: false } }),
  ])
  return { date: iso, total, dispatched, remaining: Math.max(0, total - dispatched), receiptsPending }
}

/** تسليم/إرجاع علامة إذن التسليم — داخل معاملة + سجل تدقيق (تُستدعى من المسار) */
export async function setReceiptDelivered(
  user: { userId: string; username: string },
  shipmentId: string,
  delivered: boolean,
  notes?: string,
) {
  return db.$transaction(async (tx) => {
    const s = await tx.shipment.findUnique({ where: { id: shipmentId }, include: { contractor: { select: { id: true, name: true } } } })
    if (!s) throw new ApiError(404, 'الشحنة غير موجودة')
    if (!s.contractorId) throw new ApiError(409, 'الشحنة غير مسندة لأي مقاول — عيّن مقاولًا أولًا')
    if (s.isReceiptDelivered === delivered) {
      return { ok: true, unchanged: true, isReceiptDelivered: s.isReceiptDelivered }
    }
    const updated = await tx.shipment.update({
      where: { id: shipmentId },
      data: { isReceiptDelivered: delivered, receiptDeliveredAt: delivered ? new Date() : null },
    })
    await tx.shipmentStatusHistory.create({
      data: {
        shipmentId,
        fromStatus: s.status,
        toStatus: s.status,
        notes: delivered
          ? `تسليم إذن التسليم (الديليفري ${s.deliveryNumber ?? s.shipmentNo ?? ''}) إلى المقاول${notes ? ` — ${notes}` : ''}`
          : `إرجاع علامة تسليم إذن التسليم${notes ? ` — ${notes}` : ''}`,
        userName: user.username,
      },
    })
    await tx.auditLog.create({
      data: {
        action: delivered ? 'receipt_delivered' : 'receipt_undelivered',
        entity: 'shipment',
        entityId: shipmentId,
        notes: `${delivered ? 'تسجيل تسليم' : 'إلغاء تسليم'} إذن التسليم للشحنة ${s.shipmentNo ?? ''} — المقاول: ${s.contractor?.name ?? ''}`,
        userId: user.userId,
        userName: user.username,
        beforeData: JSON.stringify({ isReceiptDelivered: s.isReceiptDelivered, receiptDeliveredAt: s.receiptDeliveredAt }),
        afterData: JSON.stringify({ isReceiptDelivered: delivered, receiptDeliveredAt: updated.receiptDeliveredAt }),
      },
    })
    return { ok: true, unchanged: false, isReceiptDelivered: updated.isReceiptDelivered, receiptDeliveredAt: updated.receiptDeliveredAt }
  })
}

void round2
