import { handle, readBody, withIdempotency } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { approveExtraCost } from '@/lib/server/extras'

export const dynamic = 'force-dynamic'

/**
 * اعتماد بند إضافي (مبيت/مرتجعات) بموافقة الشركة — يُرحّل القيد المزدوج:
 * مدين تكلفة النقل 5101 / دائن مستحقات المقاول 2102 — ويُضاف لمستحقاته.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'extra_costs.approve')
    const { id } = await params
    const body = await readBody(req)
    return withIdempotency(req, `extra_cost:approve:${id}`, () =>
      approveExtraCost(
        { userId: user.userId, username: user.username },
        id,
        body?.notes ? String(body.notes).slice(0, 500) : undefined,
      ),
    )
  })
}
