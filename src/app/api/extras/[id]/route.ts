import { handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { deleteExtraCost, updateExtraCost } from '@/lib/server/extras'

export const dynamic = 'force-dynamic'

/** تعديل بند إضافي — مسموح فقط وهو «بانتظار الاعتماد» (المعتمد محاسبيًا ولا يُعدل) */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'parties.extras.manage')
    const { id } = await params
    const body = await readBody(req)
    return updateExtraCost({ userId: user.userId, username: user.username }, id, body)
  })
}

/** حذف بند إضافي — المرفوض/المعلق فقط (المعتمد يُرفض أولًا فيُعكس قيده تلقائيًا) */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'parties.extras.manage')
    const { id } = await params
    return deleteExtraCost({ userId: user.userId, username: user.username }, id)
  })
}
