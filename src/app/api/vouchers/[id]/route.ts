import { handle, readBody } from '@/lib/server/http'
import { requirePerm, requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { deleteVoucher, patchVoucher } from '@/lib/server/vouchers'
import { getVoucher } from '@/lib/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    // كانت قراءة الإذن الواحد تتطلب جلسة فقط (تعداد سندات ممكن لأي مستخدم) —
    // الآن نفس صلاحية القائمة (vouchers.view)
    const user = await requirePerm(req, 'vouchers.view')
    const { id } = await params
    return getVoucher(id, user)
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
