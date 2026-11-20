import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'
import { ACTIVE_VOUCHER_STATUSES } from '@/lib/voucher-catalog'
import {
  canTransitionShipment,
  isKnownShipmentStatus,
  isShipmentStoppedNextDay,
  shipmentStatusLabel,
  shipmentTransitionError,
  SHIPMENT_STOPPED_BLOCKED_TARGETS,
} from '@/lib/shipment-catalog'
import { postShipmentDeliveryJournal } from '@/lib/server/shipment-accounting'

export const dynamic = 'force-dynamic'

/**
 * تحديث حالة مجموعة شحنات — داخل معاملة واحدة:
 * كل شحنة تمر عبر آلة الحالات + قاعدة «بتقف تاني يوم» + سجل حالات + تدقيق خاص بها.
 * الشحنات غير الصالحة تُتخطى (النتيجة تفصيلية لكل شحنة).
 */
export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.status')
    const b = await readBody(req)
    const ids: string[] = Array.isArray(b.ids) ? b.ids : []
    if (!ids.length) throw new ApiError(400, 'اختر الشحنات المراد تحديثها')
    const to = String(b.status ?? '')
    if (!to) throw new ApiError(400, 'اختر الحالة الجديدة')
    if (!isKnownShipmentStatus(to)) throw new ApiError(400, `حالة غير معروفة: "${to}"`)

    const u = { userId: user.userId, username: user.username }
    const result = await db.$transaction(async (tx) => {
      const results: { id: string; ok: boolean; reason?: string }[] = []
      let count = 0
      for (const id of ids) {
        const s = await tx.shipment.findUnique({
          where: { id },
          include: { customer: { select: { id: true, name: true } }, contractor: { select: { id: true, name: true } } },
        })
        if (!s) { results.push({ id, ok: false, reason: 'الشحنة غير موجودة' }); continue }
        if (!canTransitionShipment(s.status, to)) {
          results.push({ id, ok: false, reason: shipmentTransitionError(s.status, to) }); continue
        }
        const activeVoucher = await tx.opVoucherItem.findFirst({
          where: { shipmentId: id, voucher: { status: { in: ACTIVE_VOUCHER_STATUSES } } },
          include: { voucher: { select: { voucherNo: true } } },
        })
        if (activeVoucher) {
          results.push({ id, ok: false, reason: `مرتبطة بإذن نشط (${activeVoucher.voucher.voucherNo})` }); continue
        }
        if (to === 'returned' && s.collectionStatus === 'collected') {
          results.push({ id, ok: false, reason: 'شحنة محصّلة — عكس التحصيل أولًا' }); continue
        }
        // قاعدة «بتقف تاني يوم» — نفس حماية المسار الفردي:
        // شحنة متوقفة (بتاريخ أقدم ولم تُحمّل) لا تُحمّل جماعيًا — إما جدولة لليوم أو مبيت/تعتيق/مؤجلة
        if (isShipmentStoppedNextDay(s) && (SHIPMENT_STOPPED_BLOCKED_TARGETS as readonly string[]).includes(to)) {
          results.push({ id, ok: false, reason: `الشحنة متوقفة عن التحميل (بتقف تاني يوم) — أعد جدولتها لليوم من زر «جدولة لليوم» أو سجّلها مبيت/تعتيق/مؤجلة` }); continue
        }

        await tx.shipment.update({
          where: { id },
          data: {
            status: to,
            statusHistory: {
              create: { fromStatus: s.status, toStatus: to, notes: b.notes ?? `تحديث جماعي: ${shipmentStatusLabel(s.status)} ← ${shipmentStatusLabel(to)}`, userName: user.username },
            },
          },
        })
        if (to === 'delivered') {
          await postShipmentDeliveryJournal(tx, s, u)
        }
        await logAudit(tx, {
          action: 'status_change', entity: 'shipment', entityId: id,
          notes: `تغيير حالة جماعية للشحنة ${s.shipmentNo}: ${shipmentStatusLabel(s.status)} ← ${shipmentStatusLabel(to)}`,
          user: u, before: { status: s.status }, after: { status: to },
        })
        results.push({ id, ok: true })
        count += 1
      }
      await logAudit(tx, {
        action: 'bulk_update', entity: 'shipment', entityId: null,
        notes: `تحديث حالة جماعي: ${count}/${ids.length} شحنة إلى "${shipmentStatusLabel(to)}"`,
        user: u, after: { ids, to, count },
      })
      return { ok: true, count, total: ids.length, results }
    })
    return result
  })
}
