// ============================================================================
// دفعات وعهد المقاولين — تسجيل سريع بإثراء محاسبي فوري (قيد مزدوج تلقائي)
// POST: تسجيل دفعة جديدة (مدين 2102 / دائن الصندوق أو البنك)
// GET:  قائمة الدفعات مع أثر القيود
// ============================================================================

import { handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { listContractorPayments, recordContractorPayment } from '@/lib/server/payments'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'parties.extras.view')
    return listContractorPayments(new URL(req.url).searchParams, user)
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'vouchers.create')
    const body = await readBody(req)
    return recordContractorPayment(user, body)
  })
}
