import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { voidJournal } from '@/lib/server/accounting'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** إلغاء قيد مسودة (void) أو حذفه نهائيًا — القيود المرحّلة تُعالج بالقيد العكسي فقط */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'accounting.journal')
    const { id } = await params
    const e = await db.journalEntry.findUnique({ where: { id } })
    if (!e) throw new ApiError(404, 'القيد غير موجود')
    if (e.status === 'posted') throw new ApiError(409, 'لا يمكن حذف قيد مرحّل — استخدم القيد العكسي')
    if (e.sourceType === 'op_voucher') throw new ApiError(409, 'القيد مرتبط بسند — عالج السند أولًا')
    await db.journalEntry.delete({ where: { id } })
    await logAudit(db, { action: 'delete', entity: 'journal_entry', entityId: id, notes: `حذف قيد ${e.entryNo}`, user: { userId: user.userId, username: user.username } })
    return null
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'accounting.journal')
    const { id } = await params
    const b = await readBody(req)
    return db.$transaction(async (tx) => voidJournal(tx, id, { userId: user.userId, username: user.username }, b?.reason))
  })
}
