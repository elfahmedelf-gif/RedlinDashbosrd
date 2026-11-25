import { ApiError, handle, withIdempotency } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { postJournal } from '@/lib/server/accounting'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'accounting.journal')
    const { id } = await params
    return withIdempotency(req, `journal-post:${id}`, () =>
      db.$transaction(async (tx) => {
        const updated = await postJournal(tx, id, { userId: user.userId, username: user.username })
        return { ok: true, status: updated.status }
      }),
    )
  })
}
