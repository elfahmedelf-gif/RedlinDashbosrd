import { handle } from '@/lib/server/http'
import { requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { db } from '@/lib/db'
import { canSeePrices } from '@/lib/server/prices'

export const dynamic = 'force-dynamic'

/**
 * جدول أسعار النولون للاختيار في إنشاء الشحنة — التكاليف تُخفى
 * لغير المصرح لهم (prices.view)؛ أسماء الوجهات والمسافات متاحة للجميع
 */
export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requireUser(req)
    const canPrices = canSeePrices(user)
    const rows = await db.freightPrice.findMany({ where: { active: true }, orderBy: { routeName: 'asc' } })
    return {
      rates: rows.map((f) => ({
        id: f.id,
        regionAr: f.regionAr,
        regionEn: f.regionEn,
        distanceKm: f.distanceKm,
        cost: canPrices ? f.cost : null,
        sellPrice: canPrices ? f.sellPrice : null,
        sellPrice2: canPrices ? f.sellPrice2 : null,
        loadType: f.loadType,
        routeName: f.routeName,
      })),
      filters: null,
    }
  })
}
