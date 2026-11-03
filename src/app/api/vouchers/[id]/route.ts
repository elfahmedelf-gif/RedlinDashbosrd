import { handle, readBody } from '@/lib/server/http'
import { requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { deleteVoucher, patchVoucher } from '@/lib/server/vouchers'
import { getVoucher } from '@/lib/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    await requireUser(req)
    const { id } = await params
    return getVoucher(id)
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requireUser(req)
    const { id } = await params
    const body = await readBody(req)
    return patchVoucher(user, id, body)
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requireUser(req)
    const { id } = await params
    return deleteVoucher(user, id)
  })
}
