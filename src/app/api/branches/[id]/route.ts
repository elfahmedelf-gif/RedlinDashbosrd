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
    const br = await db.branch.findUnique({ where: { id } })
    if (!br) throw new ApiError(404, 'الفرع غير موجود')
    const { id: _d, createdAt: _c, ...rest } = b
    await db.branch.update({ where: { id }, data: rest })
    await logAudit(db, { action: 'update', entity: 'branch', entityId: id, notes: `تعديل فرع: ${br.name}`, user: { userId: user.userId, username: user.username } })
    return { ok: true }
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'structure.manage')
    const { id } = await params
    const br = await db.branch.findUnique({ where: { id } })
    if (!br) return null
    const used = await db.shipment.findFirst({ where: { branchId: id } })
    if (used) throw new ApiError(409, 'لا يمكن حذف فرع مرتبط بشحنات أو مستخدمين')
    await db.branch.delete({ where: { id } })
    await logAudit(db, { action: 'delete', entity: 'branch', entityId: id, notes: `حذف فرع: ${br.name}`, user: { userId: user.userId, username: user.username } })
    return null
  })
}
