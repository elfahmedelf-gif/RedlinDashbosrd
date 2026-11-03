import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.status')
    const b = await readBody(req)
    const ids: string[] = Array.isArray(b.ids) ? b.ids : []
    if (!ids.length) throw new ApiError(400, 'اختر الشحنات المراد تحديثها')
    if (!b.status) throw new ApiError(400, 'اختر الحالة الجديدة')
    let count = 0
    for (const id of ids) {
      const s = await db.shipment.findUnique({ where: { id } })
      if (!s) continue
      await db.shipment.update({
        where: { id },
        data: { status: b.status, statusHistory: { create: { fromStatus: s.status, toStatus: b.status, notes: b.notes ?? 'تحديث جماعي', userName: user.username } } },
      })
      count += 1
    }
    await logAudit(db, { action: 'bulk_update', entity: 'shipment', entityId: null, notes: `تحديث حالة ${count} شحنة إلى ${b.status}`, user: { userId: user.userId, username: user.username } })
    return { ok: true, count }
  })
}
