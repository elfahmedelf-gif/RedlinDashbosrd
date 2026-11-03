import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm, requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'
import { listAccounts } from '@/lib/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'accounting.view')
    return listAccounts()
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'accounting.journal')
    const b = await readBody(req)
    const count = await db.account.count()
    const code = b.code || String(count + 1)
    if (await db.account.findUnique({ where: { code } })) throw new ApiError(409, 'رمز الحساب موجود بالفعل')
    const acc = await db.account.create({ data: { code, name: b.name, nameEn: b.nameEn ?? null, type: b.type ?? 'asset', parentId: b.parentId || null, isDetail: b.isDetail !== false } })
    await logAudit(db, { action: 'create', entity: 'account', entityId: acc.id, notes: `إضافة حساب: ${acc.name}`, user: { userId: user.userId, username: user.username } })
    return { id: acc.id }
  })
}
