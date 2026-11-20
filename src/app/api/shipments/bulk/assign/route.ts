import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'
import { getActiveDeliveryJournal, postShipmentDeliveryJournal } from '@/lib/server/shipment-accounting'
import { reverseJournal } from '@/lib/server/accounting'
import { clearSyncedExtras, extrasFromShipment, syncShipmentExtras } from '@/lib/server/shipment-extras-sync'

export const dynamic = 'force-dynamic'

/**
 * إسناد مجموعة شحنات لمقاول — داخل معاملة واحدة، بنفس منطق التعديل الفردي (PATCH):
 * لكل شحنة يتغيّر مقاولها فعليًا:
 *   1) عكس القيد النشط (قيد التسليم على 2102) إن وجد
 *   2) تغيير المقاول + سجل حالات
 *   3) إعادة إثبات القيد على المقاول الجديد (نقل المستحقات من القديم للجديد تلقائيًا)
 *   4) سحب بنود المقاول القديم المتزامنة وإعادة مزامنتها بالمقاول الجديد
 * الشحنات التي مقاولها هو المطلوب أصلًا تُتخطى بلا تغيير.
 */
export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.assign')
    const b = await readBody(req)
    const ids: string[] = Array.isArray(b.ids) ? b.ids : []
    if (!ids.length) throw new ApiError(400, 'اختر الشحنات المراد إسنادها')
    if (!b.contractorId) throw new ApiError(400, 'اختر المقاول')

    const u = { userId: user.userId, username: user.username }
    const result = await db.$transaction(async (tx) => {
      const contractor = await tx.party.findUnique({ where: { id: b.contractorId } })
      if (!contractor) throw new ApiError(400, 'المقاول المحدد غير موجود')
      if (!contractor.isContractor) throw new ApiError(400, `"${contractor.name}" ليس مقاول نقل — اختر مقاولًا من قائمة المقاولين`)
      if (!contractor.active) throw new ApiError(409, `"${contractor.name}" موقوف — فعّل الحساب أولًا`)

      const rows = await tx.shipment.findMany({
        where: { id: { in: ids } },
        include: { customer: { select: { id: true, name: true } }, contractor: { select: { id: true, name: true } } },
      })
      let count = 0
      let journalsReposted = 0
      const skippedSame = rows.filter((r) => r.contractorId === contractor.id).length

      for (const s of rows) {
        // نفس المقاول المطلوب — لا تغيير ولا أثر مالي
        if (s.contractorId === contractor.id) continue

        // 1) عكس القيد النشط قبل نقل الشحنة للمقاول الجديد (اتساق مع PATCH)
        const activeJE = await getActiveDeliveryJournal(tx, s.id)
        let reversalNo: string | null = null
        if (activeJE) {
          const reversal = await reverseJournal(tx, activeJE.id, u, `إسناد جماعي — نقل الشحنة ${s.shipmentNo ?? ''} للمقاول ${contractor.name}`)
          reversalNo = reversal.entryNo
        }

        // 2) تغيير المقاول + سجل حالات موثّق
        await tx.shipment.update({
          where: { id: s.id },
          data: {
            contractorId: contractor.id,
            statusHistory: {
              create: {
                fromStatus: s.status,
                toStatus: s.status,
                notes: `إسناد للمقاول ${contractor.name}${s.contractor?.name ? ` (تغيير مقاول من ${s.contractor.name})` : ''}`,
                userName: user.username,
              },
            },
          },
        })

        // 3) إعادة إثبات القيد على المقاول الجديد
        if (reversalNo) {
          const fresh = await tx.shipment.findUnique({
            where: { id: s.id },
            include: { customer: { select: { id: true, name: true } }, contractor: { select: { id: true, name: true } } },
          })
          if (fresh) {
            const posted = await postShipmentDeliveryJournal(tx, fresh, u)
            if (posted) journalsReposted += 1
          }
        }

        // 4) بنود المقاول القديم تُسحب بالكامل ثم تُعاد المزامنة بالمقاول الجديد
        const prevExtras = extrasFromShipment(s)
        const cleared = await clearSyncedExtras(tx, s.id, u, `تغيير مقاول الشحنة ${s.shipmentNo ?? ''} (إسناد جماعي)`)
        const fresh = await tx.shipment.findUnique({
          where: { id: s.id },
          include: { customer: { select: { id: true, name: true } }, contractor: { select: { id: true, name: true } } },
        })
        if (fresh) {
          await syncShipmentExtras(tx, fresh, extrasFromShipment(fresh), u, prevExtras)
        }

        await logAudit(tx, {
          action: 'update', entity: 'shipment', entityId: s.id,
          notes: `إسناد جماعي للشحنة ${s.shipmentNo} للمقاول ${contractor.name}${reversalNo ? ` — عكس القيد ${reversalNo}` : ''}${cleared.length ? ` — سحب بنود: ${cleared.join('، ')}` : ''}`,
          user: u,
          before: { contractorId: s.contractorId },
          after: { contractorId: contractor.id },
        })
        count += 1
      }

      await logAudit(tx, {
        action: 'bulk_update', entity: 'shipment', entityId: null,
        notes: `إسناد ${count} شحنة للمقاول ${contractor.name} — مزامنة محاسبية كاملة (قيد/بنود) لكل شحنة مُرحّلة${skippedSame ? ` — متطابقة أصلًا: ${skippedSame}` : ''}`,
        user: u,
        after: { ids: rows.map((r) => r.id), contractorId: contractor.id, count },
      })
      return { ok: true, count, total: ids.length, journalsReposted }
    })
    return result
  })
}
