import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { syncPermissionsCatalog } from '@/lib/server/perm-sync'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'roles.manage')
    // مزامنة الكتالوج عند فتح شاشة الصلاحيات — تضمن مطابقة قاعدة البيانات للكود 1:1
    const sync = await syncPermissionsCatalog()
    const rows = await db.role.findMany({ include: { users: true }, orderBy: { createdAt: 'asc' } })
    return {
      items: rows.map((r) => ({ id: r.id, name: r.name, label: r.label, permissions: JSON.parse(r.permissions ?? '[]'), createdAt: r.createdAt, _count: { users: r.users.length } })),
      total: rows.length,
      permissionsSynced: sync.permissionsSynced,
    }
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'roles.manage')
    const b = await readBody(req)
    const name = String(b.name ?? '').trim()
    if (!name) throw new ApiError(400, 'اسم الدور مطلوب')
    if (await db.role.findUnique({ where: { name } })) throw new ApiError(409, 'اسم الدور موجود بالفعل')
    const role = await db.role.create({ data: { name, label: b.label || name, permissions: JSON.stringify(Array.isArray(b.permissions) ? b.permissions : []) } })
    await logAudit(db, { action: 'create', entity: 'role', entityId: role.id, notes: `إضافة دور: ${role.label}`, user: { userId: user.userId, username: user.username } })
    return { id: role.id }
  })
}
