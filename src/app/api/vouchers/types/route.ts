import { handle } from '@/lib/server/http'
import { requireUser } from '@/lib/server/session'
import { voucherTypesCatalog } from '@/lib/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await requireUser(req)
    return voucherTypesCatalog()
  })
}
