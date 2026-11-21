import { handle, readBody, withIdempotency } from '@/lib/server/http'
import { requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { markReturnReceived } from '@/lib/server/vouchers'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requireUser(req)
    const { id } = await params
    const body = await readBody(req)
    return withIdempotency(req, `voucher-mark-received:${id}`, () => markReturnReceived(user, id, body))
  })
}
