import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'inventory.freight')
    const { id } = await params
    const b = await readBody(req)
    const f = await db.freightPrice.findUnique({ where: { id } })
    if (!f) throw new ApiError(404, 'السعر غير موجود')
    const { id: _d, createdAt: _c, updatedAt: _u, ...rest } = b
    await db.freightPrice.update({ where: { id }, data: rest })
    await logAudit(db, { action: 'update', entity: 'freight_price', entityId: id, notes: `تعديل سعر نولون: ${f.routeName}`, user: { userId: user.userId, username: user.username } })
    return { ok: true }
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'inventory.freight')
    const { id } = await params
    const f = await db.freightPrice.findUnique({ where: { id } })
    if (!f) return null
    await db.freightPrice.delete({ where: { id } })
    await logAudit(db, { action: 'delete', entity: 'freight_price', entityId: id, notes: `حذف سعر نولون: ${f.routeName}`, user: { userId: user.userId, username: user.username } })
    return null
  })
}
