// ============================================================================
// تغيير كلمة المرور الذاتي — أي مستخدم مسجّل دخوله يغيّر كلمة مروره بنفسه
// POST /api/auth/change-password { currentPassword, newPassword }
// تحقق: كلمة المرور الحالية صحيحة + الجديدة ≥ 4 حروف + ليست نفس القديمة.
// ============================================================================

import { ApiError, handle, readBody } from '@/lib/server/http'
import { requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/server/passwords'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requireUser(req)
    const b = await readBody(req)
    const current = String(b.currentPassword ?? '')
    const next = String(b.newPassword ?? '')

    if (!current) throw new ApiError(400, 'أدخل كلمة المرور الحالية')
    if (next.length < 4) throw new ApiError(400, 'كلمة المرور الجديدة يجب أن تكون 4 حروف على الأقل')
    if (next === current) throw new ApiError(400, 'كلمة المرور الجديدة يجب أن تختلف عن الحالية')

    const row = await db.user.findUnique({ where: { id: user.userId }, select: { id: true, username: true, password: true } })
    if (!row) throw new ApiError(404, 'المستخدم غير موجود')
    if (row.password !== hashPassword(current)) throw new ApiError(400, 'كلمة المرور الحالية غير صحيحة')

    await db.user.update({ where: { id: row.id }, data: { password: hashPassword(next) } })
    await logAudit(db, {
      action: 'update', entity: 'password', entityId: row.id,
      notes: 'تغيير كلمة المرور الذاتي — بواسطة المستخدم نفسه',
      user: { userId: user.userId, username: user.username },
    })
    return { ok: true }
  })
}
