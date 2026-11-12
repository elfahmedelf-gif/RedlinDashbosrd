import { handle } from '@/lib/server/http'
import { requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { db } from '@/lib/db'
import { canSeePrices } from '@/lib/server/prices'

export const dynamic = 'force-dynamic'

/**
 * محرك التسعير التلقائي — يجلب السعر من جدول النولون حسب الوجهة/المنطقة
 * ونوع الحمولة، مع احترام نافذة الصلاحية (validFrom/validTo — كانت عمودًا ميتًا).
 * يُستخدم في شاشة إنشاء الشحنة للتعبئة التلقائية (مع إتاحة التعديل اليدوي).
 */
export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requireUser(req)
    const canPrices = canSeePrices(user)
    const q = new URL(req.url).searchParams
    const destination = (q.get('destination') ?? '').trim()
    const loadType = (q.get('loadType') ?? '').trim()
    if (!destination) return { matched: false, price: null }

    const now = new Date()
    const candidates = await db.freightPrice.findMany({ where: { active: true } })
    // احترام نافذة الصلاحية: الأسعار المنتهية لا تُقدَّم
    const inWindow = candidates.filter((r) => {
      if (r.validFrom && new Date(r.validFrom) > now) return false
      if (r.validTo && new Date(r.validTo) < now) return false
      return true
    })
    const norm = (s: string) => s.trim().toLowerCase()
    const dest = norm(destination)
    // تطابق: اسم الوجهة/المنطقة/المسار + نوع الحمولة (إن حدد)
    const score = (r: any) => {
      const fields = [r.regionAr, r.regionEn, r.routeName].map((f: string | null) => norm(String(f ?? '')))
      let s = 0
      if (fields.some((f) => f === dest)) s += 10
      else if (fields.some((f) => f && (f.includes(dest) || dest.includes(f)))) s += 6
      if (loadType && norm(String(r.loadType ?? '')) === norm(loadType)) s += 4
      return s
    }
    const matches = inWindow.map((r) => ({ r, s: score(r) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)
    if (!matches.length) return { matched: false, price: null }

    const best = matches[0].r
    return {
      matched: true,
      price: {
        id: best.id,
        routeName: best.routeName,
        regionAr: best.regionAr,
        distanceKm: best.distanceKm,
        loadType: best.loadType,
        // السعر المعروض = سعر البيع (النولون) — التكلفة فقط لمن يملك prices.view
        sellPrice: canPrices ? best.sellPrice : null,
        sellPrice2: canPrices ? best.sellPrice2 : null,
        cost: canPrices ? best.cost : null,
      },
      alternatives: matches.slice(1, 4).map((m) => ({
        id: m.r.id, routeName: m.r.routeName, regionAr: m.r.regionAr, loadType: m.r.loadType,
        sellPrice: canPrices ? m.r.sellPrice : null,
      })),
    }
  })
}
