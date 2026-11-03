import { handle } from '@/lib/server/http'
import { requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requireUser(req)
    const rows = await db.freightPrice.findMany({ where: { active: true }, orderBy: { routeName: 'asc' } })
    return {
      rates: rows.map((f) => ({
        id: f.id,
        regionAr: f.regionAr,
        regionEn: f.regionEn,
        distanceKm: f.distanceKm,
        cost: f.cost,
        sellPrice: f.sellPrice,
        sellPrice2: f.sellPrice2,
        loadType: f.loadType,
        routeName: f.routeName,
      })),
      filters: null,
    }
  })
}
