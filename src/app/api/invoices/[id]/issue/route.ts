import { handle } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { issueInvoice } from '@/lib/server/invoices'

export const dynamic = 'force-dynamic'

/**
 * إصدار الفاتورة (الاعتماد) — داخل معاملة واحدة:
 *   عكس قيود استحقاق التسليم للشحنات المُدخلة + قيد الفاتورة المزدوج
 *   (مدين العملاء 1103 / دائن الإيراد 4101 / دائن الضريبة 2103)
 *   + إعادة إثبات مستحقات المقاول بحساب مستقل + ربط الشحنات بالفاتورة.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'invoices.issue')
    const { id } = await params
    return issueInvoice(user, id)
  })
}
