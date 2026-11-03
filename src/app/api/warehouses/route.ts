import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm, requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requireUser(req)
    const rows = await db.warehouse.findMany({ include: { branch: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } })
    return { items: rows, total: rows.length }
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'structure.manage')
    const b = await readBody(req)
    if (!b.branchId) throw new ApiError(400, 'اختر الفرع التابع له المخزن')
    const count = await db.warehouse.count()
    const w = await db.warehouse.create({ data: { code: b.code || `WH-${count + 1}`, name: b.name, branchId: b.branchId, manager: b.manager ?? null } })
    await logAudit(db, { action: 'create', entity: 'warehouse', entityId: w.id, notes: `إضافة مخزن: ${w.name}`, user: { userId: user.userId, username: user.username } })
    return { id: w.id }
  })
}
