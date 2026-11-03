import { handle, num, readBody } from '@/lib/server/http'
import { requirePerm, requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requireUser(req)
    const q = (new URL(req.url).searchParams.get('q') ?? '').trim().toLowerCase()
    let rows = await db.freightPrice.findMany({ orderBy: { createdAt: 'desc' } })
    if (q) rows = rows.filter((r) => [r.regionAr, r.regionEn, r.routeName].some((f) => String(f ?? '').toLowerCase().includes(q)))
    return { items: rows, total: rows.length }
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'inventory.freight')
    const b = await readBody(req)
    const f = await db.freightPrice.create({
      data: {
        regionAr: b.regionAr ?? '', regionEn: b.regionEn ?? null, routeName: b.routeName ?? b.regionAr ?? '',
        distanceKm: b.distanceKm != null ? String(b.distanceKm) : null, loadType: b.loadType ?? null,
        cost: num(b.cost) ?? 0, sellPrice: b.sellPrice != null ? num(b.sellPrice) : null, notes: b.notes ?? null,
      },
    })
    await logAudit(db, { action: 'create', entity: 'freight_price', entityId: f.id, notes: `إضافة سعر نولون: ${f.routeName}`, user: { userId: user.userId, username: user.username } })
    return { id: f.id }
  })
}
