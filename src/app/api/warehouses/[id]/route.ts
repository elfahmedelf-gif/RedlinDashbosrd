import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'structure.manage')
    const { id } = await params
    const b = await readBody(req)
    const w = await db.warehouse.findUnique({ where: { id } })
    if (!w) throw new ApiError(404, 'المخزن غير موجود')
    const { id: _d, createdAt: _c, ...rest } = b
    await db.warehouse.update({ where: { id }, data: rest })
    await logAudit(db, { action: 'update', entity: 'warehouse', entityId: id, notes: `تعديل مخزن: ${w.name}`, user: { userId: user.userId, username: user.username } })
    return { ok: true }
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'structure.manage')
    const { id } = await params
    const w = await db.warehouse.findUnique({ where: { id } })
    if (!w) return null
    const used = await db.shipment.findFirst({ where: { warehouseId: id } })
    if (used) throw new ApiError(409, 'لا يمكن حذف مخزن مرتبط بشحنات أو أصناف')
    await db.warehouse.delete({ where: { id } })
    await logAudit(db, { action: 'delete', entity: 'warehouse', entityId: id, notes: `حذف مخزن: ${w.name}`, user: { userId: user.userId, username: user.username } })
    return null
  })
}
