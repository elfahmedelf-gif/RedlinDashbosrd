import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.status')
    const { id } = await params
    const b = await readBody(req)
    const s = await db.shipment.findUnique({ where: { id } })
    if (!s) throw new ApiError(404, 'الشحنة غير موجودة')
    if (!b.status) throw new ApiError(400, 'الحالة الجديدة مطلوبة')
    await db.shipment.update({
      where: { id },
      data: {
        status: b.status,
        statusHistory: { create: { fromStatus: s.status, toStatus: b.status, notes: b.notes ?? '', userName: user.username } },
      },
    })
    await logAudit(db, { action: 'update', entity: 'shipment', entityId: id, notes: `تحديث حالة الشحنة ${s.shipmentNo} إلى ${b.status}`, user: { userId: user.userId, username: user.username } })
    return { ok: true }
  })
}
