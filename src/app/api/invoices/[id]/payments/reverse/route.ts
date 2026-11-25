import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { reverseInvoicePayment } from '@/lib/server/invoices'

export const dynamic = 'force-dynamic'

/** عكس دفعة تحصيل — يعكس قيد السند ويُلغيه ويعيد حالة السداد للخلف */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'invoices.cancel')
    const { id } = await params
    const body = await readBody(req)
    const paymentId = String(body?.paymentId ?? '').trim()
    if (!paymentId) throw new ApiError(400, 'معرف الدفعة (paymentId) مطلوب')
    return reverseInvoicePayment(user, id, paymentId, body)
  })
}
