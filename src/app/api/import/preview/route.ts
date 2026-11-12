import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * معاينة استيراد حقيقية: يستقبل الصفوف (من ملف CSV/جدول منسوخ) + خريطة الأعمدة
 * ويعيد عدد الصفوف الصالحة/الخاطئة + عينة الصفوف بعد التحويل.
 * (كانت الواجهة السابقة تعيد بيانات وهمية ثابتة — شاشة معزولة تمامًا)
 */
export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'import.manage')
    const b = await readBody(req)
    const rows: any[] = Array.isArray(b.rows) ? b.rows : []
    const mapping: Record<string, string> = b.mapping ?? {}
    if (!rows.length) throw new ApiError(400, 'لا توجد صفوف لمعاينتها — الصق البيانات أو ارفع ملف CSV أولًا')

    // الحقول المطلوبة لإنشاء شحنة صالحة
    const valid: any[] = []
    const errors: { row: number; reason: string }[] = []
    const mapped = rows.map((r) => {
      const out: Record<string, any> = {}
      for (const [field, col] of Object.entries(mapping)) {
        if (!col) continue
        out[field] = r[col] ?? (Array.isArray(r) ? null : null)
      }
      return out
    })

    const branches = await db.branch.findMany({ select: { id: true, name: true } })
    const branchByName = new Map(branches.map((x) => [x.name, x.id]))
    const customers = await db.party.findMany({ where: { isCustomer: true }, select: { id: true, name: true } })
    const customerByName = new Map(customers.map((x) => [x.name, x.id]))
    const contractors = await db.party.findMany({ where: { isContractor: true }, select: { id: true, name: true } })
    const contractorByName = new Map(contractors.map((x) => [x.name, x.id]))

    mapped.forEach((r, i) => {
      if (!r.recipientName) { errors.push({ row: i + 1, reason: 'اسم المستلم مطلوب' }); return }
      if (!r.destination) { errors.push({ row: i + 1, reason: 'الوجهة مطلوبة' }); return }
      if (r.customerName && !customerByName.has(r.customerName)) {
        errors.push({ row: i + 1, reason: `العميل "${r.customerName}" غير موجود — سيُنشأ تلقائيًا عند الاعتماد` })
      }
      valid.push({
        ...r,
        branchId: r.branchName ? branchByName.get(r.branchName) ?? null : null,
        customerId: r.customerName ? customerByName.get(r.customerName) ?? null : null,
        contractorId: r.contractorName ? contractorByName.get(r.contractorName) ?? null : null,
      })
    })

    return {
      total: rows.length,
      valid: valid.length,
      errors: errors.slice(0, 50),
      errorCount: errors.length,
      sample: valid.slice(0, 10),
      detectedColumns: rows[0] && !Array.isArray(rows[0]) ? Object.keys(rows[0]) : [],
      fileName: b.fileName ?? null,
    }
  })
}
