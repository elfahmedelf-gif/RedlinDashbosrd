import { handle, readBody, withIdempotency } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { rejectExtraCost } from '@/lib/server/extras'

export const dynamic = 'force-dynamic'

/**
 * رفض بند إضافي — لو كان معتمدًا سابقًا يُعكس قيده المحاسبي تلقائيًا
 * (يخرج المبلغ من مستحقات المقاول فورًا بنفس محرك القيود العكسية).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'parties.extras.approve')
    const { id } = await params
    const body = await readBody(req)
    return withIdempotency(req, `extra_cost:reject:${id}`, () =>
      rejectExtraCost(
        { userId: user.userId, username: user.username },
        id,
        body?.notes ? String(body.notes).slice(0, 500) : undefined,
      ),
    )
  })
}
