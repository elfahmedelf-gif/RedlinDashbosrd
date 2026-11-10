import { handle, readBody } from '@/lib/server/http'
import { requirePerm, requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'
import { listParties } from '@/lib/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'parties.view')
    return listParties(new URL(req.url).searchParams, user)
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'parties.manage')
    const b = await readBody(req)
    const prefix = b.isContractor ? 'K' : b.isSupplier ? 'S' : 'C'
    const count = await db.party.count()
    const p = await db.party.create({
      data: {
        code: `${prefix}-${String(count + 1).padStart(4, '0')}`,
        name: b.name, nameEn: b.nameEn ?? null,
        isCustomer: !!b.isCustomer, isContractor: !!b.isContractor, isSupplier: !!b.isSupplier,
        phone: b.phone ?? null, address: b.address ?? null, city: b.city ?? null,
        branchId: b.branchId || null, notes: b.notes ?? null,
      },
    })
    await logAudit(db, { action: 'create', entity: 'party', entityId: p.id, notes: `إضافة طرف: ${p.name}`, user: { userId: user.userId, username: user.username } })
    return { id: p.id }
  })
}
