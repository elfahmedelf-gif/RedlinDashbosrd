import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/server/passwords'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'users.manage')
    const { id } = await params
    const b = await readBody(req)
    const usr = await db.user.findUnique({ where: { id }, include: { roles: true } })
    if (!usr) throw new ApiError(404, 'المستخدم غير موجود')
    const data: any = {}
    if (b.password != null && b.password !== '') {
      if (String(b.password).length < 4) throw new ApiError(400, 'كلمة المرور قصيرة جدًا (4 أحرف على الأقل)')
      data.password = hashPassword(String(b.password))
    }
    if (b.username && b.username !== usr.username) {
      if (await db.user.findUnique({ where: { username: b.username } })) throw new ApiError(409, 'اسم المستخدم موجود بالفعل')
      data.username = b.username
    }
    if (usr.username === 'admin' && b.active === false) throw new ApiError(403, 'لا يمكن إيقاف حساب مدير النظام الأساسي')
    for (const k of ['name', 'email', 'phone', 'branchId'] as const) if (b[k] !== undefined) data[k] = b[k]
    if (b.active !== undefined) data.active = !!b.active
    await db.user.update({ where: { id }, data })
    // إعادة إسناد الأدوار داخل معاملة واحدة (كان الحذف والإنشاء منفصلين —
    // فشل منتصفًا يترك مستخدمًا بلا صلاحيات)
    if (b.roleId !== undefined || Array.isArray(b.roleIds)) {
      await db.$transaction(async (tx) => {
        await tx.userRole.deleteMany({ where: { userId: id } })
        if (b.roleId) {
          if (!(await tx.role.findUnique({ where: { id: b.roleId } }))) throw new ApiError(400, 'الدور المحدد غير موجود')
          await tx.userRole.create({ data: { userId: id, roleId: b.roleId } })
        } else if (Array.isArray(b.roleIds)) {
          for (const rid of b.roleIds) {
            if (!rid) continue
            if (!(await tx.role.findUnique({ where: { id: rid } }))) throw new ApiError(400, 'أحد الأدوار المحددة غير موجود')
            await tx.userRole.create({ data: { userId: id, roleId: rid } })
          }
        }
      })
    }
    await logAudit(db, { action: 'update', entity: 'user', entityId: id, notes: `تعديل مستخدم: ${usr.username}${b.password ? ' — تغيير كلمة المرور' : ''}`, user: { userId: user.userId, username: user.username } })
    return { ok: true }
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'users.manage')
    const { id } = await params
    const usr = await db.user.findUnique({ where: { id } })
    if (!usr) return null
    if (usr.username === 'admin') throw new ApiError(403, 'لا يمكن حذف حساب مدير النظام الأساسي')
    if (usr.id === user.userId) throw new ApiError(403, 'لا يمكن حذف حسابك الحالي')
    const createdVouchers = await db.opVoucher.count({ where: { userId: id } })
    if (createdVouchers) throw new ApiError(409, 'لا يمكن حذف مستخدم أنشأ أذونات — أوقف الحساب بدلًا من حذفه')
    await db.user.delete({ where: { id } })
    await logAudit(db, { action: 'delete', entity: 'user', entityId: id, notes: `حذف مستخدم: ${usr.username}`, user: { userId: user.userId, username: user.username } })
    return null
  })
}
