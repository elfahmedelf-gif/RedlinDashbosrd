import { handle, withIdempotency } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { restoreJournal } from '@/lib/server/accounting'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** استعادة قيد ملغي إلى مسودة — سيناريو «ألغيت القيد بالخطأ» ثم أعدّله وأرحّله */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'accounting.journal')
    const { id } = await params
    return withIdempotency(req, `journal-restore:${id}`, () =>
      db.$transaction(async (tx) =>
        restoreJournal(tx, id, { userId: user.userId, username: user.username }),
      ),
    )
  })
}
