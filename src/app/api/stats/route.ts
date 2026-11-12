import { handle } from '@/lib/server/http'
import { requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { dashboardStats } from '@/lib/server/queries'

export const dynamic = 'force-dynamic'

/** لوحة المؤشرات — تدعم فلترة التاريخ from/to (كانت تتجاهلها وتحسب كل الجدول) */
export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requireUser(req)
    return dashboardStats(new URL(req.url).searchParams, user)
  })
}
