import { handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { cancelInvoice } from '@/lib/server/invoices'

export const dynamic = 'force-dynamic'

/**
 * إلغاء فاتورة صادرة — قيد عكسي تلقائي + فك ربط الشحنات (تُفوترة من جديد)
 * + إعادة إثبات قيود استحقاق التسليم الأصلية. مرفوضة إذا كانت عليها دفعات.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'invoices.cancel')
    const { id } = await params
    const body = await readBody(req)
    return cancelInvoice(user, id, body?.reason)
  })
}
