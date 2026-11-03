import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'parties.manage')
    const { id } = await params
    const b = await readBody(req)
    const party = await db.party.findUnique({ where: { id } })
    if (!party) throw new ApiError(404, 'الطرف غير موجود')
    const { id: _drop, createdAt: _c, updatedAt: _u, ...rest } = b
    const data: any = {}
    for (const [k, v] of Object.entries(rest)) if (typeof v !== 'object') data[k] = v
    await db.party.update({ where: { id }, data })
    await logAudit(db, { action: 'update', entity: 'party', entityId: id, notes: `تعديل طرف: ${party.name}`, user: { userId: user.userId, username: user.username } })
    return { ok: true }
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'parties.manage')
    const { id } = await params
    const party = await db.party.findUnique({ where: { id } })
    if (!party) return null
    const linked = await db.shipment.findFirst({ where: { OR: [{ customerId: id }, { contractorId: id }] } })
    if (linked) throw new ApiError(409, 'لا يمكن حذف طرف مرتبط بشحنات — عالجه وفق سياسة التصحيح')
    const linkedVoucher = await db.opVoucher.findFirst({ where: { OR: [{ partyId: id }, { courierId: id }] } })
    if (linkedVoucher) throw new ApiError(409, 'لا يمكن حذف طرف مرتبط بسندات مالية/أذونات')
    const linkedJournal = await db.journalLine.findFirst({ where: { partyId: id } })
    if (linkedJournal) throw new ApiError(409, 'لا يمكن حذف طرف مرتبط بقيود محاسبية')
    await db.party.delete({ where: { id } })
    await logAudit(db, { action: 'delete', entity: 'party', entityId: id, notes: `حذف طرف: ${party.name}`, user: { userId: user.userId, username: user.username } })
    return null
  })
}
