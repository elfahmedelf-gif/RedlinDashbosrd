import { handle, readBody, withIdempotency } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { createExtraCost, listExtraCosts } from '@/lib/server/extras'

export const dynamic = 'force-dynamic'

/**
 * البنود الإضافية على حساب المقاولين (تعتيق/مبيت/مرتجعات).
 * GET  /api/extras?contractorId&type&status&shipmentId&from&to&q&page&pageSize
 * POST /api/extras — التعتيق يُعتمد ويُرحّل تلقائيًا، المبيت/المرتجعات بانتظار اعتماد الشركة
 */
export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'extra_costs.view')
    return listExtraCosts(new URL(req.url).searchParams, user)
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'extra_costs.create')
    const body = await readBody(req)
    return withIdempotency(req, 'extra_cost:create', () =>
      createExtraCost({ userId: user.userId, username: user.username, permissions: user.permissions }, body),
    )
  })
}
