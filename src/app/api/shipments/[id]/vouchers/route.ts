import { handle } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { shipmentVouchers } from '@/lib/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'vouchers.view')
    const { id } = await params
    return shipmentVouchers(id)
  })
}
