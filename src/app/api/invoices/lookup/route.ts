import { handle } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { lookupInvoiceCandidates } from '@/lib/server/invoices'

export const dynamic = 'force-dynamic'

/**
 * البحث الشامل عن أي إذن/عميل لإنشاء الفاتورة — الإدخال الإجباري.
 * GET /api/invoices/lookup?q=رقم-الديليفري-أو-كود-العميل
 * يكفي رقم ديليفري واحد أو كود عميل لإحضار أي إذن في النظام،
 * مع حالة كل إذن (متاح للفوترة / مفوترة برقم فاتورتها / محصّلة).
 */
export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'invoices.create')
    return lookupInvoiceCandidates(new URL(req.url).searchParams)
  })
}
