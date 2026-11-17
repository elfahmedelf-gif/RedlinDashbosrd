import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { voidJournal, updateJournalDraft } from '@/lib/server/accounting'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

const ref = (r?: { id: string; name: string } | null) => (r ? { id: r.id, name: r.name } : null)

export const dynamic = 'force-dynamic'

/** قراءة قيد واحد بسطوره الكاملة — للتتبع من السند المالي إلى القيد والعكس */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'accounting.view')
    const { id } = await params
    const e = await db.journalEntry.findUnique({
      where: { id },
      include: {
        branch: { select: { id: true, name: true } },
        lines: {
          include: {
            account: true,
            party: { select: { id: true, name: true } },
            shipment: { select: { id: true, shipmentNo: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
    })
    if (!e) throw new ApiError(404, 'القيد غير موجود')
    return {
      id: e.id,
      entryNo: e.entryNo,
      date: e.date,
      description: e.description,
      reference: e.reference,
      branchId: e.branchId,
      branch: ref(e.branch),
      status: e.status,
      totalDebit: e.totalDebit,
      totalCredit: e.totalCredit,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      reversalOfId: e.reversalOfId,
      postedAt: e.postedAt,
      lines: e.lines.map((l) => ({
        id: l.id,
        accountId: l.accountId,
        account: { id: l.account.id, code: l.account.code, name: l.account.name },
        debit: l.debit,
        credit: l.credit,
        description: l.description,
        partyId: l.partyId,
        party: ref(l.party),
        shipmentId: l.shipmentId ?? null,
        shipmentNo: l.shipment?.shipmentNo ?? null,
      })),
    }
  })
}

/** تعديل قيد مسودة — استبدال كامل للترويسة والسطور بعد التحقق من التوازن */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'accounting.journal')
    const { id } = await params
    const b = await readBody(req)
    const updated = await db.$transaction(async (tx) => {
      return updateJournalDraft(tx, id, {
        date: b.date ?? null,
        description: b.description ?? '',
        reference: b.reference ?? null,
        branchId: b.branchId || null,
        lines: (b.lines ?? []).map((l: any) => ({
          accountId: l.accountId,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          description: l.description ?? '',
          partyId: l.partyId || null,
          shipmentId: l.shipmentId || null,
          costCenterId: l.costCenterId || null,
        })),
        user: { userId: user.userId, username: user.username },
      })
    })
    return { id: updated.id, entryNo: updated.entryNo }
  })
}

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
