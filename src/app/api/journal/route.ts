import { handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { createJournal, postJournal } from '@/lib/server/accounting'
import { db } from '@/lib/db'
import { listJournal } from '@/lib/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'accounting.view')
    return listJournal(new URL(req.url).searchParams)
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'accounting.journal')
    const b = await readBody(req)
    const u = { userId: user.userId, username: user.username }
    const entry = await db.$transaction(async (tx) => {
      // مركز التكلفة (كان يُسقط من الطلب رغم وجود العمود والعلاقة)
      if (b.costCenterId && !(await tx.costCenter.findUnique({ where: { id: b.costCenterId } }))) {
        throw new Error('INVALID_COST_CENTER')
      }
      const created = await createJournal(tx, {
        date: b.date ?? null,
        description: b.description ?? '',
        reference: b.reference ?? null,
        branchId: b.branchId || null,
        sourceType: 'manual',
        lines: (b.lines ?? []).map((l: any) => ({
          accountId: l.accountId,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          description: l.description ?? '',
          partyId: l.partyId || null,
          shipmentId: l.shipmentId || null,
          costCenterId: l.costCenterId || b.costCenterId || null,
        })),
        user: u,
      })
      if (b.autoPost) await postJournal(tx, created.id, u)
      return created
    }).catch((e: any) => {
      if (e?.message === 'INVALID_COST_CENTER') throw new Error('مركز التكلفة المحدد غير موجود')
      throw e
    })
    return { id: entry.id, entryNo: entry.entryNo }
  })
}
