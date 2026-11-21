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

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.status')
    const { id } = await params
    const b = await readBody(req)
    const to = String(b.status ?? '')
    if (!to) throw new ApiError(400, 'الحالة الجديدة مطلوبة')
    if (!isKnownShipmentStatus(to)) throw new ApiError(400, `حالة غير معروفة: "${to}"`)

    const result = await db.$transaction(async (tx) => {
      const s = await tx.shipment.findUnique({
        where: { id },
        include: { customer: { select: { id: true, name: true } }, contractor: { select: { id: true, name: true } } },
      })
      if (!s) throw new ApiError(404, 'الشحنة غير موجودة')

      // آلة الحالات الصارمة — منع الانتقال العشوائي
      if (!canTransitionShipment(s.status, to)) {
        throw new ApiError(409, shipmentTransitionError(s.status, to))
      }

      // لا تغيير يدوي للحالة أثناء ارتباط الشحنة بإذن تشغيلي نشط (منع تعارض الأذونات)
      const activeVoucher = await tx.opVoucherItem.findFirst({
        where: { shipmentId: id, voucher: { status: { in: ACTIVE_VOUCHER_STATUSES } } },
        include: { voucher: { select: { voucherNo: true, type: true } } },
      })
      if (activeVoucher) {
        throw new ApiError(409, `الشحنة مرتبطة بإذن تشغيلي نشط (${activeVoucher.voucher.voucherNo}) — أكمله أو ألغه قبل تغيير الحالة يدويًا`)
      }

      // حماية مالية: شحنة محصّلة لا تتحول إلى مرتجع مباشرة (يلزم عكس التحصيل أولًا)
      if (to === 'returned' && s.collectionStatus === 'collected') {
        throw new ApiError(409, 'لا يمكن تحويل شحنة محصّلة إلى مرتجع — عكس التحصيل (إلغاء سند القبض) أولًا وفق سياسة التصحيح')
      }

      // ── قاعدة «بتقف تاني يوم» ──
      // شحنة بتاريخ أقدم من اليوم ولم تُحمّل بعد (جديدة/تجهيز/مستلمة) =
      // متوقفة تلقائيًا عن التحميل والإرسال في اليوم التالي.
      // المسار الصحيح: إعادة الجدولة لليوم (زر «جدولة لليوم») أو تسجيلها
      // مبيت/تعتيق/مؤجلة وفق الواقع الفعلي.
      const stopped = isShipmentStoppedNextDay(s)
      if (stopped && (SHIPMENT_STOPPED_BLOCKED_TARGETS as readonly string[]).includes(to)) {
        throw new ApiError(409, `الشحنة متوقفة عن التحميل (بتقف تاني يوم) — بتاريخ ${s.date ? new Date(s.date).toISOString().slice(0, 10) : '—'} ولم تُحمّل في يومها. أعد جدولتها لليوم من زر «جدولة لليوم» أو سجّلها مبيت/تعتيق/مؤجلة وفق الواقع`, {
          code: 'SHIPMENT_STOPPED_NEXT_DAY',
          shipmentId: id,
          shipmentDate: s.date,
        })
      }

      await tx.shipment.update({
        where: { id },
        data: {
          status: to,
          statusHistory: {
            create: {
              fromStatus: s.status,
              toStatus: to,
              notes: b.notes ?? `${shipmentStatusLabel(s.status)} ← ${shipmentStatusLabel(to)}`,
              userName: user.username,
            },
          },
        },
      })

      // التكامل المالي التلقائي: التسليم = إثبات النولون على العميل ومستحقات المقاول
      let journalEntryNo: string | null = null
      if (to === 'delivered') {
        const posted = await postShipmentDeliveryJournal(tx, s, { userId: user.userId, username: user.username })
        journalEntryNo = posted?.entryNo ?? null
      }

      await logAudit(tx, {
        action: 'status_change', entity: 'shipment', entityId: id,
        notes: `تغيير حالة الشحنة ${s.shipmentNo}: ${shipmentStatusLabel(s.status)} ← ${shipmentStatusLabel(to)}${journalEntryNo ? ` (قيد ${journalEntryNo})` : ''}`,
        user: { userId: user.userId, username: user.username },
        before: { status: s.status },
        after: { status: to, journalEntryNo },
      })
      return { ok: true, from: s.status, to, journalEntryNo }
    })
    return result
  })
}
