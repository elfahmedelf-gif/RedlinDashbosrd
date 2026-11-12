import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/server/passwords'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'users.manage')
    const rows = await db.user.findMany({ include: { roles: { include: { role: true } }, branch: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } })
    return {
      items: rows.map((u) => ({
        id: u.id, username: u.username, name: u.name, email: u.email ?? null, phone: u.phone ?? null,
        branchId: u.branchId ?? null, active: u.active, createdAt: u.createdAt,
        role: u.roles[0] ? { id: u.roles[0].role.id, name: u.roles[0].role.name, label: u.roles[0].role.label } : null,
        roleId: u.roles[0]?.role.id ?? null,
        branch: u.branch ? { id: u.branch.id, name: u.branch.name } : null,
      })),
      total: rows.length,
    }
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'users.manage')
    const b = await readBody(req)
    const username = String(b.username ?? '').trim()
    if (!username) throw new ApiError(400, 'اسم المستخدم مطلوب')
    if (String(b.password ?? '').length < 4) throw new ApiError(400, 'كلمة المرور يجب أن تكون 4 أحرف على الأقل')

    const result = await db.$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { username } })) throw new ApiError(409, 'اسم المستخدم موجود بالفعل')
      // التحقق من وجود الدور والفرع (كانا يُقبلان بأي معرف → خطأ 500)
      if (b.roleId && !(await tx.role.findUnique({ where: { id: b.roleId } }))) throw new ApiError(400, 'الدور المحدد غير موجود')
      if (b.branchId && !(await tx.branch.findUnique({ where: { id: b.branchId } }))) throw new ApiError(400, 'الفرع المحدد غير موجود')
      const usr = await tx.user.create({
        data: {
          username, name: b.name ?? username, email: b.email ?? null, phone: b.phone ?? null,
          branchId: b.branchId || null, active: b.active !== false, password: hashPassword(String(b.password)),
          ...(b.roleId ? { roles: { create: { roleId: b.roleId } } } : {}),
        },
      })
      await logAudit(tx, {
        action: 'create', entity: 'user', entityId: usr.id,
        notes: `إضافة مستخدم: ${usr.username}`,
        user: { userId: user.userId, username: user.username },
        after: { username, roleId: b.roleId ?? null, branchId: b.branchId ?? null },
      })
      return { id: usr.id }
    })
    return result
  })
}
