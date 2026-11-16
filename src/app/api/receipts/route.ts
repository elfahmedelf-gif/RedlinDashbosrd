import { handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { listReceipts, dailyShipmentKpis, createDeliveryReceipt } from '@/lib/server/receipts'

export const dynamic = 'force-dynamic'

/**
 * أذونات التسليم (الديليفري) — لكل مقاول على حدة.
 * GET /api/receipts?contractorId&view=all|undelivered|delivered|overdue&q&page&pageSize
 * + عدّادات اليوم: kpis (إجمالي شحنات اليوم / خرجت / متبقية) لتاريخ محدد.
 * POST — إضافة إذن تسليم جديد (شحنة مسندة لمقاول برقم ديليفري) — يُرحّل القيد عند «تم التسليم».
 */
export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.view')
    const q = new URL(req.url).searchParams
    const [list, kpis] = await Promise.all([
      listReceipts(q, user),
      dailyShipmentKpis(q.get('date'), q.get('contractorId')),
    ])
    return { ...list, kpis }
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.create')
    const body = await readBody(req)
    return createDeliveryReceipt(user, body)
  })
}
