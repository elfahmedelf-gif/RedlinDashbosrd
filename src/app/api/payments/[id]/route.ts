// ============================================================================
// إرجاع/عكس دفعة مقاول — يعكس القيد المزدوج تلقائيًا ويُلغي السند
// DELETE /api/payments/[id]
// ============================================================================

import { handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { reverseContractorPayment } from '@/lib/server/payments'

export const dynamic = 'force-dynamic'

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'payments.cancel')
    const { id } = await params
    const body = await readBody(req)
    return reverseContractorPayment(user, id, body)
  })
}
