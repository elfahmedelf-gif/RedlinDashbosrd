import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'inventory.manage')
    const { id } = await params
    const b = await readBody(req)
    const it = await db.item.findUnique({ where: { id } })
    if (!it) throw new ApiError(404, 'الصنف غير موجود')
    const { id: _d, createdAt: _c, ...rest } = b
    await db.item.update({ where: { id }, data: rest })
    await logAudit(db, { action: 'update', entity: 'item', entityId: id, notes: `تعديل صنف: ${it.name}`, user: { userId: user.userId, username: user.username } })
    return { ok: true }
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'inventory.manage')
    const { id } = await params
    const it = await db.item.findUnique({ where: { id } })
    if (!it) return null
    const used = await db.inventoryMovement.findFirst({ where: { itemId: id } })
    if (used) throw new ApiError(409, 'لا يمكن حذف صنف له حركات مخزون')
    await db.item.delete({ where: { id } })
    await logAudit(db, { action: 'delete', entity: 'item', entityId: id, notes: `حذف صنف: ${it.name}`, user: { userId: user.userId, username: user.username } })
    return null
  })
}
