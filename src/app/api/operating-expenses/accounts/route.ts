import { handle } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * خيارات حسابات وفروع نموذج المصروفات العمومية — لا تتطلب صلاحية المحاسبة الكاملة،
 * فقط صلاحية opex.view (حتى يستطيع مدير الفرع فتح النموذج دون صلاحية شجرة الحسابات).
 * ترجع: حسابات المصروف (مدين) + حسابات الدفع (الصندوق/البنك) + الفروع النشطة.
 */
export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'opex.view')
    const [accs, branches] = await Promise.all([
      db.account.findMany({ where: { active: true, isDetail: true }, select: { id: true, code: true, name: true, type: true }, orderBy: { code: 'asc' } }),
      db.branch.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ])
    const expenseAccounts = accs
      .filter((a) => a.type === 'expense')
      .map((a) => ({ id: a.id, code: a.code, name: a.name }))
    // حسابات الدفع: الصندوق (1101) والبنوك (1102) — الأصول السائلة فقط
    const payAccounts = accs
      .filter((a) => a.type === 'asset' && (a.code === '1101' || a.code === '1102'))
      .map((a) => ({ id: a.id, code: a.code, name: a.name }))
    return { expenseAccounts, payAccounts, branches }
  })
}
