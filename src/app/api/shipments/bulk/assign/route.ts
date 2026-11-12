import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** إسناد مجموعة شحنات لمقاول — داخل معاملة + سجل حالات لكل شحنة + تدقيق */
export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.assign')
    const b = await readBody(req)
    const ids: string[] = Array.isArray(b.ids) ? b.ids : []
    if (!ids.length) throw new ApiError(400, 'اختر الشحنات المراد إسنادها')
    if (!b.contractorId) throw new ApiError(400, 'اختر المقاول')

    const result = await db.$transaction(async (tx) => {
      const contractor = await tx.party.findUnique({ where: { id: b.contractorId } })
      if (!contractor) throw new ApiError(400, 'المقاول المحدد غير موجود')
      if (!contractor.isContractor) throw new ApiError(400, `"${contractor.name}" ليس مقاول نقل — اختر مقاولًا من قائمة المقاولين`)
      if (!contractor.active) throw new ApiError(409, `"${contractor.name}" موقوف — فعّل الحساب أولًا`)

      const rows = await tx.shipment.findMany({ where: { id: { in: ids } }, select: { id: true, shipmentNo: true, status: true, contractorId: true } })
      const found = rows.map((r) => r.id)
      let count = 0
      if (found.length) {
        const res = await tx.shipment.updateMany({ where: { id: { in: found } }, data: { contractorId: b.contractorId } })
        count = res.count
        // سجل حالات لكل شحنة أُسندت (كان الإسناد الجماعي بلا أثر تاريخي)
        await tx.shipmentStatusHistory.createMany({
          data: rows.map((r) => ({
            shipmentId: r.id,
            fromStatus: r.status,
            toStatus: r.status,
            notes: `إسناد للمقاول ${contractor.name}${r.contractorId && r.contractorId !== b.contractorId ? ' (تغيير مقاول)' : ''}`,
            userName: user.username,
          })),
        })
      }
      await logAudit(tx, {
        action: 'bulk_update', entity: 'shipment', entityId: null,
        notes: `إسناد ${count} شحنة للمقاول ${contractor.name}`,
        user: { userId: user.userId, username: user.username },
        after: { ids: found, contractorId: b.contractorId, count },
      })
      return { ok: true, count, total: ids.length }
    })
    return result
  })
}
