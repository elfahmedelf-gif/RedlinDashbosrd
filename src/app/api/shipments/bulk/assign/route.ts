import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.assign')
    const b = await readBody(req)
    const ids: string[] = Array.isArray(b.ids) ? b.ids : []
    if (!ids.length) throw new ApiError(400, 'اختر الشحنات المراد إسنادها')
    if (!b.contractorId) throw new ApiError(400, 'اختر المقاول')
    const contractor = await db.party.findUnique({ where: { id: b.contractorId } })
    await db.shipment.updateMany({ where: { id: { in: ids } }, data: { contractorId: b.contractorId } })
    await logAudit(db, { action: 'bulk_update', entity: 'shipment', entityId: null, notes: `إسناد ${ids.length} شحنة للمقاول ${contractor?.name ?? b.contractorId}`, user: { userId: user.userId, username: user.username } })
    return { ok: true, count: ids.length }
  })
}
