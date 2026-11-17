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
import { handle } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { getPartyStatement } from '@/lib/server/statement'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'parties.view')
    const { id } = await params
    const q = new URL(req.url).searchParams
    return getPartyStatement(id, q.get('from'), q.get('to'))
  })
}
