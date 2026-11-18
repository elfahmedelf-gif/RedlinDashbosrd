import { handle } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { listUninvoicedShipments } from '@/lib/server/invoices'

export const dynamic = 'force-dynamic'

/**
 * الشحنات غير المفوترة لعميل محدد — جاهزة للاستيراد داخل فاتورة.
 * GET /api/invoices/uninvoiced-shipments?customerId=...
 * مستبعد: المفوترة (فاتورة نشطة)، المحصّلة، الملغاة/المشطوبة.
 */
export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'invoices.create')
    return listUninvoicedShipments(new URL(req.url).searchParams)
  })
}
