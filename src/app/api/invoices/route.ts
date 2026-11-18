import { handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { listInvoices, createInvoice } from '@/lib/server/invoices'

export const dynamic = 'force-dynamic'

/**
 * الفواتير الرسمية للعملاء — قائمة بملخصات + إنشاء مسودة جديدة.
 * GET /api/invoices?status&customerId&q&page&pageSize
 * POST — إنشاء مسودة (بلا قيد محاسبي) من بنود شحنات مستوردة و/أو بنود يدوية.
 */
export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'invoices.view')
    return listInvoices(new URL(req.url).searchParams, user)
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'invoices.create')
    const body = await readBody(req)
    return createInvoice(user, body)
  })
}
