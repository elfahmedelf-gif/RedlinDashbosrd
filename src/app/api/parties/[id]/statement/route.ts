// ============================================================================
// كشف حساب تفصيلي للطرف (عميل/مقاول/مورد) — كل الحركات الفعلية مرتبة زمنيًا
// مع رصيد تراكمي (Running Balance) بعد كل حركة:
//   الرصيد الافتتاحي (سالب إذا كان دائن) + Σ(مدين − دائن) من القيود المرحّلة
// الحركات تُعرض على حسابات التحكم الفرعية للطرف فقط (العملاء 1103 / الموردون 2101 /
// مقاولو النقل 2102 / عهد المندوبين 2104) — سطور الإيراد/المصروف/النقدية المقابلة
// ليست حركات على حساب الطرف ولا تدخل الرصيد.
// يتضمن: قيود تسليم الشحنات، سندات القبض/الصرف، تسويات المندوبين، القيود اليدوية.
// المنطق في src/lib/server/statement.ts (مشترك مع تصدير Excel).
// ============================================================================
import { ApiError, handle } from '@/lib/server/http'
import { requireUser } from '@/lib/server/session'
import { matchPermission, partyViewKeys } from '@/lib/permissions'
import { ensureSeeded } from '@/lib/server/seed'
import { db } from '@/lib/db'
import { getPartyStatement } from '@/lib/server/statement'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requireUser(req)
    const { id } = await params
    // صلاحية العرض حسب صفات الطرف الفعلية (عميل/مقاول/مورد)
    const party = await db.party.findUnique({ where: { id }, select: { isCustomer: true, isContractor: true, isSupplier: true } })
    if (!party) throw new ApiError(404, 'الطرف غير موجود')
    if (!partyViewKeys(party).some((k) => matchPermission(user.permissions, k))) {
      throw new ApiError(403, `غير مصرح — هذه العملية تتطلب إحدى الصلاحيات: ${partyViewKeys(party).map((k) => `"${k}"`).join(' أو ')}`)
    }
    const q = new URL(req.url).searchParams
    return getPartyStatement(id, q.get('from'), q.get('to'))
  })
}
