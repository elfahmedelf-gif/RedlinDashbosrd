import { ApiError, handle, readBody, withIdempotency } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { reverseJournal } from '@/lib/server/accounting'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'accounting.journal')
    const { id } = await params
    const b = await readBody(req)
    return withIdempotency(req, `journal-reverse:${id}`, () =>
      db.$transaction(async (tx) => {
        const reversal = await reverseJournal(tx, id, { userId: user.userId, username: user.username }, b?.reason)
        return { ok: true, reversalId: reversal.id, reversalNo: reversal.entryNo }
      }),
    )
  })
}
