import { ApiError, handle, num, readBody } from '@/lib/server/http'
import { requirePerm, requireUser } from '@/lib/server/session'
import { ensureSeeded, nextShipmentNo } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'
import { listShipments } from '@/lib/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.view')
    return listShipments(new URL(req.url).searchParams, user)
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.create')
    const b = await readBody(req)
    const shipmentNo = await nextShipmentNo()
    const s = await db.shipment.create({
      data: {
        shipmentNo, billNo: b.billNo ?? null,
        customerId: b.customerId || null, recipientName: b.recipientName ?? '', shipToParty: b.recipientName ?? '',
        deliveryPhones: b.deliveryPhones ?? null, destination: b.destination ?? null, routeCode: b.routeCode ?? null,
        branchId: b.branchId || null, warehouseId: b.warehouseId || null,
        loadType: b.loadType ?? null, contractorId: b.contractorId || null,
        freightCost: num(b.freightCost) ?? 0, freightTotal: num(b.freightTotal) ?? 0,
        totalSuppliers: num(b.freightCost) ?? 0, status: 'new', collectionStatus: 'uncollected',
        date: b.date ? new Date(b.date) : new Date(),
        notes: b.notes ?? null,
        statusHistory: { create: { fromStatus: null, toStatus: 'new', notes: 'إنشاء شحنة جديدة', userName: user.username } },
      },
    })
    await logAudit(db, { action: 'create', entity: 'shipment', entityId: s.id, notes: `إنشاء شحنة ${shipmentNo}`, user: { userId: user.userId, username: user.username }, after: { shipmentNo } })
    return { id: s.id, shipmentNo }
  })
}
