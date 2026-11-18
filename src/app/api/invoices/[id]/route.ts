import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { getInvoice, updateInvoiceDraft, deleteInvoiceDraft } from '@/lib/server/invoices'

export const dynamic = 'force-dynamic'

/** تفاصيل فاتورة — بنود + دفعات + القيد المحاسبي المرتبط */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'invoices.view')
    const { id } = await params
    return getInvoice(id)
  })
}

/** تعديل مسودة — استبدال كامل للبنود والبيانات (المسودات فقط) */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'invoices.create')
    const { id } = await params
    const body = await readBody(req)
    return updateInvoiceDraft(user, id, body)
  })
}

/** حذف مسودة — بلا أي أثر محاسبي */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'invoices.create')
    const { id } = await params
    if (!id) throw new ApiError(400, 'معرف الفاتورة مطلوب')
    return deleteInvoiceDraft(user, id)
  })
}
