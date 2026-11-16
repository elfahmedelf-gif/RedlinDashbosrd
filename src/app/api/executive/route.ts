import { handle } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { executiveSummary } from '@/lib/server/executive'

export const dynamic = 'force-dynamic'

/**
 * ملخص متابعة الإدارة — لكل مقاول: الشغل المعتمد / المسحوبات / المتبقي له
 * (من دفتر الأستاذ 2102 حتى نهاية التاريخ المحدد) + أذونات التسليم المعلقة
 * + البنود بانتظار الاعتماد + عدّادات شحنات اليوم.
 * GET /api/executive?asOf=YYYY-MM-DD
 */
export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'dashboard.view')
    return executiveSummary(new URL(req.url).searchParams, user)
  })
}
