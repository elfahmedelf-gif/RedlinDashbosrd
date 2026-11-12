import { handle } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** سجل عمليات الاستيراد (كانت الشاشة تستعلم عن سجل التدقيق بفلتر لا يعمل) */
export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'import.manage')
    const rows = await db.importLog.findMany({ orderBy: { date: 'desc' }, take: 50 })
    return { items: rows, total: rows.length }
  })
}
