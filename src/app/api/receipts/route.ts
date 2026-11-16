import { handle } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { listReceipts, dailyShipmentKpis } from '@/lib/server/receipts'

export const dynamic = 'force-dynamic'

/**
 * أذونات التسليم (الديليفري) — لكل مقاول على حدة.
 * GET /api/receipts?contractorId&view=all|undelivered|delivered|overdue&q&page&pageSize
 * + عدّادات اليوم: kpis (إجمالي شحنات اليوم / خرجت / متبقية) لتاريخ محدد.
 */
export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'shipments.view')
    const q = new URL(req.url).searchParams
    const [list, kpis] = await Promise.all([
      listReceipts(q),
      dailyShipmentKpis(q.get('date'), q.get('contractorId')),
    ])
    return { ...list, kpis }
  })
}
