import { handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { deleteOperatingExpense, updateOperatingExpense } from '@/lib/server/operating-expenses'

export const dynamic = 'force-dynamic'

/** تعديل مصروف — يُعكس القيد ويُعاد إثباته بالبيانات الجديدة تلقائيًا */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'opex.manage')
    const { id } = await params
    const body = await readBody(req)
    return updateOperatingExpense({ userId: user.userId, username: user.username }, id, body)
  })
}

/** حذف مصروف — يُعكس القيد المرتبط ثم يُحذف السجل */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'opex.manage')
    const { id } = await params
    return deleteOperatingExpense({ userId: user.userId, username: user.username }, id)
  })
}
