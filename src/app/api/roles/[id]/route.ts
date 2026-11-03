import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'roles.manage')
    const { id } = await params
    const b = await readBody(req)
    const role = await db.role.findUnique({ where: { id } })
    if (!role) throw new ApiError(404, 'الدور غير موجود')
    if (role.name === 'admin' && b.permissions !== undefined) throw new ApiError(403, 'صلاحيات دور مدير النظام ثابتة (كل الصلاحيات)')
    if (b.name && b.name !== role.name && (await db.role.findUnique({ where: { name: b.name } }))) throw new ApiError(409, 'اسم الدور موجود بالفعل')
    const data: any = { name: b.name || role.name, label: b.label ?? role.label }
    if (Array.isArray(b.permissions)) data.permissions = JSON.stringify(b.permissions)
    await db.role.update({ where: { id }, data })
    const perms = data.permissions ? JSON.parse(data.permissions) : []
    await logAudit(db, { action: 'update', entity: 'role', entityId: id, notes: `تعديل دور: ${data.label} (${Array.isArray(perms) ? perms.length : 0} صلاحية)`, user: { userId: user.userId, username: user.username } })
    return { ok: true }
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'roles.manage')
    const { id } = await params
    const role = await db.role.findUnique({ where: { id }, include: { users: true } })
    if (!role) return null
    if (role.name === 'admin') throw new ApiError(403, 'لا يمكن حذف دور مدير النظام')
    if (role.users.length) throw new ApiError(409, 'لا يمكن حذف دور مرتبط بمستخدمين — انقل المستخدمين لدور آخر أولًا')
    await db.role.delete({ where: { id } })
    await logAudit(db, { action: 'delete', entity: 'role', entityId: id, notes: `حذف دور: ${role.label}`, user: { userId: user.userId, username: user.username } })
    return null
  })
}
