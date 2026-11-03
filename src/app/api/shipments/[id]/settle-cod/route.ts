import { handle, readBody, withIdempotency } from '@/lib/server/http'
import { settleShipmentCOD } from '@/lib/server/vouchers'
import { requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requireUser(req)
    const { id } = await params
    const body = await readBody(req)
    return withIdempotency(req, `settle-cod:${id}`, () => settleShipmentCOD(user, id, body))
  })
}
