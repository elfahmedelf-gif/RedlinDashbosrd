import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'
import { getShipment } from '@/lib/server/queries'

export const dynamic = 'force-dynamic'

const EDITABLE = ['billNo', 'recipientName', 'deliveryPhones', 'destination', 'routeCode', 'branchId', 'warehouseId', 'loadType', 'contractorId', 'freightCost', 'freightTotal', 'notes', 'vehicleNo'] as const

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.view')
    const { id } = await params
    return getShipment(id, user)
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.edit')
    const { id } = await params
    const b = await readBody(req)
    const s = await db.shipment.findUnique({ where: { id } })
    if (!s) throw new ApiError(404, 'الشحنة غير موجودة')
    const data: any = {}
    for (const k of EDITABLE) if (b[k] !== undefined) data[k] = b[k] === '' ? null : b[k]
    await db.shipment.update({ where: { id }, data })
    await logAudit(db, { action: 'update', entity: 'shipment', entityId: id, notes: `تعديل الشحنة ${s.shipmentNo}`, user: { userId: user.userId, username: user.username }, before: s, after: data })
    return { ok: true }
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.delete')
    const { id } = await params
    const s = await db.shipment.findUnique({ where: { id } })
    if (!s) return null
    const linkedVoucher = await db.opVoucherItem.findFirst({ where: { shipmentId: id }, include: { voucher: { select: { voucherNo: true } } } })
    if (linkedVoucher) throw new ApiError(409, `لا يمكن حذف شحنة مرتبطة بأذونات (${linkedVoucher.voucher.voucherNo}) — اعالجها وفق سياسة التصحيح أولًا`)
    const linkedJournal = await db.journalLine.findFirst({ where: { shipmentId: id } })
    if (linkedJournal) throw new ApiError(409, 'لا يمكن حذف شحنة مرتبطة بقيود محاسبية')
    await db.shipment.delete({ where: { id } })
    await logAudit(db, { action: 'delete', entity: 'shipment', entityId: id, notes: `حذف شحنة ${s.shipmentNo}`, user: { userId: user.userId, username: user.username }, before: { shipmentNo: s.shipmentNo } })
    return null
  })
}
