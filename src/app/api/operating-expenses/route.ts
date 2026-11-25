import { handle, readBody, withIdempotency } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { createOperatingExpense, listOperatingExpenses } from '@/lib/server/operating-expenses'

export const dynamic = 'force-dynamic'

/**
 * المصروفات العمومية والتشغيلية (مكتب/بوفية/أدوات/مشتريات...).
 * GET  /api/operating-expenses?category&accountId&branchId&from&to&q&page&pageSize
 * POST /api/operating-expenses — يُرحّل القيد المزدوج فورًا (مدين مصروف / دائن صندوق أو بنك)
 */
export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'opex.view')
    return listOperatingExpenses(new URL(req.url).searchParams, user)
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'opex.manage')
    const body = await readBody(req)
    return withIdempotency(req, 'opex:create', () =>
      createOperatingExpense({ userId: user.userId, username: user.username, permissions: user.permissions }, body),
    )
  })
}
