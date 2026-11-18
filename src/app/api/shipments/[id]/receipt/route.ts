import { ApiError, handle, readBody, withIdempotency } from '@/lib/server/http'
import { requireAnyPerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { setReceiptDelivered } from '@/lib/server/receipts'

export const dynamic = 'force-dynamic'

/**
 * تسليم/إرجاع علامة إذن التسليم (الديليفري) لشحنة مسندة لمقاول.
 * POST /api/shipments/{id}/receipt  { delivered: boolean, notes?: string }
 * الصلاحية: receipts.manage (مفتاح الكتالوج الجديد) أو shipments.receipts القديمة
 * (توافقًا مع الأدوار المخزنة بالمفتاح القديم) — يسجل في سجل حالات الشحنة + سجل التدقيق.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requireAnyPerm(req, ['receipts.manage', 'shipments.receipts'])
    const { id } = await params
    const b = await readBody(req)
    const delivered = b?.delivered === true || b?.delivered === 'true'
    if (b?.delivered !== true && b?.delivered !== false && b?.delivered !== 'true' && b?.delivered !== 'false') {
      throw new ApiError(400, 'حدد الحالة (delivered: true/false)')
    }
    return withIdempotency(req, `receipt:${id}:${delivered ? 'delivered' : 'undelivered'}`, async () =>
      setReceiptDelivered(
        { userId: user.userId, username: user.username },
        id,
        delivered,
        b?.notes ? String(b.notes).slice(0, 300) : undefined,
      ),
    )
  })
}
