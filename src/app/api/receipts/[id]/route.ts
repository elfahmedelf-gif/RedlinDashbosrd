import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { updateDeliveryReceipt, deleteDeliveryReceipt } from '@/lib/server/receipts'

export const dynamic = 'force-dynamic'

/**
 * إذن تسليم واحد — تعديل/حذف بمزامنة محاسبية متتالية:
 *   PATCH  — تعديل (الديليفري/المقاول/النولون/الحالة/البيانات) — عكس القيد وإعادة إثباته تلقائيًا
 *   DELETE — حذف نظيف: عكس القيود المرحّلة + حذف البنود المعلقة (المعتمدة تمنع بتحذير)
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.edit')
    const { id } = await params
    const body = await readBody(req)
    return updateDeliveryReceipt(user, id, body)
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.delete')
    const { id } = await params
    if (!id) throw new ApiError(400, 'معرف الإذن مطلوب')
    return deleteDeliveryReceipt(user, id)
  })
}
