import { ApiError, handle } from '@/lib/server/http'
import { getSessionUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { report } from '@/lib/server/queries'
import { matchPermission } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ type: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const { type } = await params
    // نمرر المستخدم كاملًا للطبقة السفلية لتفعيل فلتر الأسعار
    const user = await getSessionUser(req)
    if (!user) {
      throw new ApiError(401, 'غير مصرح — سجّل الدخول أولًا')
    }
    // تقرير المرتجعات يتطلب returns.view (توافقًا: vouchers.view القديمة تكافئه)؛ بقية التقارير تتطلب reports.view
    // التقارير التي تكشف أسعارًا (freight-margin, contractor-dues, customer-debts, shipments)
    // تتطلب أيضًا prices.view — يُفرض داخل report()
    const perm = type === 'pending-returns' ? 'returns.view' : 'reports.view'
    if (!matchPermission(user.permissions, perm)) {
      throw new ApiError(403, `غير مصرح — هذه العملية تتطلب صلاحية "${perm}"`)
    }
    return report(type, new URL(req.url).searchParams, user)
  })
}
