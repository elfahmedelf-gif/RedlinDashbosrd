import { handle, readBody, withIdempotency } from '@/lib/server/http'
import { requirePerm, requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { createVoucher } from '@/lib/server/vouchers'
import { listVouchers } from '@/lib/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'vouchers.view')
    return listVouchers(new URL(req.url).searchParams)
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requireUser(req)
    const body = await readBody(req)
    return withIdempotency(req, 'voucher-create', () => createVoucher(user, body))
  })
}
