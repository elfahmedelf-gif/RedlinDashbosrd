import { handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { recordInvoicePayment } from '@/lib/server/invoices'

export const dynamic = 'force-dynamic'

/**
 * تسجيل دفعة تحصيل للفاتورة — سند قبض مكتمل + قيد مزدوج فوري
 * (مدين الصندوق/البنك / دائن العملاء) + تحديث حالة السداد تلقائيًا.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'invoices.create')
    const { id } = await params
    const body = await readBody(req)
    return recordInvoicePayment(user, id, body)
  })
}
