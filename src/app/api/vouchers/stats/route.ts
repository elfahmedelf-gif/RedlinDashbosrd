import { handle } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { voucherStats } from '@/lib/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'vouchers.view')
    return voucherStats()
  })
}
