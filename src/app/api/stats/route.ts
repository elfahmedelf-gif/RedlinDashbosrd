import { handle } from '@/lib/server/http'
import { requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { dashboardStats } from '@/lib/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requireUser(req)
    return dashboardStats()
  })
}
