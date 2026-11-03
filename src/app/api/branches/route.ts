import { handle, readBody } from '@/lib/server/http'
import { requirePerm, requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requireUser(req)
    const rows = await db.branch.findMany({ orderBy: { createdAt: 'asc' } })
    return { items: rows, total: rows.length }
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'structure.manage')
    const b = await readBody(req)
    const count = await db.branch.count()
    const br = await db.branch.create({ data: { code: b.code || `BR-${count + 1}`, name: b.name, nameEn: b.nameEn ?? null, manager: b.manager ?? null, phone: b.phone ?? null, address: b.address ?? null, region: b.region ?? null } })
    await logAudit(db, { action: 'create', entity: 'branch', entityId: br.id, notes: `إضافة فرع: ${br.name}`, user: { userId: user.userId, username: user.username } })
    return { id: br.id }
  })
}
