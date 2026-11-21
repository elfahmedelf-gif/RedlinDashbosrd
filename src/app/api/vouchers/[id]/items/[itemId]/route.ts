import { handle } from '@/lib/server/http'
import { requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { removeVoucherItem } from '@/lib/server/vouchers'

export const dynamic = 'force-dynamic'

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requireUser(req)
    const { id, itemId } = await params
    return removeVoucherItem(user, id, itemId)
  })
}
