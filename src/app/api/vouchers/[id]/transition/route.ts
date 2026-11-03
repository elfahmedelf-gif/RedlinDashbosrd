import { handle, readBody, withIdempotency } from '@/lib/server/http'
import { requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { transitionVoucher } from '@/lib/server/vouchers'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requireUser(req)
    const { id } = await params
    const body = await readBody(req)
    const action = String(body.action ?? 'unknown')
    return withIdempotency(req, `voucher-transition:${id}:${action}`, () => transitionVoucher(user, id, body))
  })
}
