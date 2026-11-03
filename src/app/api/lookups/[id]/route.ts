import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'settings.manage')
    const { id } = await params
    const b = await readBody(req)
    const lk = await db.lookupItem.findUnique({ where: { id } })
    if (!lk) throw new ApiError(404, 'القيمة غير موجودة')
    const { id: _d, createdAt: _c, updatedAt: _u, ...rest } = b
    await db.lookupItem.update({ where: { id }, data: rest })
    return { ok: true }
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'settings.manage')
    const { id } = await params
    const lk = await db.lookupItem.findUnique({ where: { id } })
    if (!lk) return null
    await db.lookupItem.delete({ where: { id } })
    await logAudit(db, { action: 'delete', entity: 'setting', entityId: id, notes: `حذف قيمة قائمة: ${lk.label}`, user: { userId: user.userId, username: user.username } })
    return null
  })
}
