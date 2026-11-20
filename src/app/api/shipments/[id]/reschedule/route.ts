import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * إعادة جدولة شحنة متوقفة (بتقف تاني يوم) إلى يوم محدد — اليوم افتراضيًا.
 * هذه هي البوابة الرسمية الوحيدة لإلغاء الإيقاف التلقائي: العمليات تراجع الشحنة
 * صباحًا وتعيد جدولتها لترخيص تحميلها اليوم، مع سجل تدقيق كامل.
 * لا تُسمح بإعادة الجدولة لتاريخ قديم (يُلغي معنى القاعدة) ولا لشحنة مُحمّلة/مُسلّمة.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.edit')
    const { id } = await params
    const b = await readBody(req).catch(() => ({}) as any)

    const result = await db.$transaction(async (tx) => {
      const s = await tx.shipment.findUnique({ where: { id } })
      if (!s) throw new ApiError(404, 'الشحنة غير موجودة')

      const today = new Date()
      const todayISO = today.toISOString().slice(0, 10)
      let targetDate = today
      if (b?.date) {
        const d = new Date(String(b.date) + 'T00:00:00')
        if (isNaN(d.getTime())) throw new ApiError(400, 'تاريخ غير صالح — استخدم صيغة YYYY-MM-DD')
        if (d.toISOString().slice(0, 10) < todayISO) {
          throw new ApiError(400, 'لا يمكن إعادة الجدولة لتاريخ قديم — اختر اليوم أو تاريخًا مستقبليًا (هذا معنى قاعدة «بتقف تاني يوم»)')
        }
        targetDate = d
      }

      // إعادة الجدولة معناها فقط للشحنات التي لم تُحمّل بعد — المحمّلة/المسلّمة لا تُعاد جدولتها
      const notLoaded = ['new', 'preparing', 'received'].includes(s.status)
      if (!notLoaded) {
        throw new ApiError(409, 'الشحنة ليست في حالة «لم تُحمّل» — إعادة الجدولة معناها فقط للشحنات الجديدة/قيد التجهيز/المستلمة بالمخزن')
      }

      const oldISO = s.date ? s.date.toISOString().slice(0, 10) : null
      if (oldISO === targetDate.toISOString().slice(0, 10)) {
        return { ok: true, date: targetDate.toISOString().slice(0, 10), changed: false }
      }

      await tx.shipment.update({
        where: { id },
        data: {
          date: targetDate,
          statusHistory: {
            create: {
              fromStatus: s.status,
              toStatus: s.status,
              notes: `إعادة جدولة الصباح: ${oldISO ?? '—'} ← ${targetDate.toISOString().slice(0, 10)} — إلغاء الإيقاف (بتقف تاني يوم) وترخيص التحميل`,
              userName: user.username,
            },
          },
        },
      })
      await logAudit(tx, {
        action: 'reschedule', entity: 'shipment', entityId: id,
        notes: `إعادة جدولة الشحنة ${s.shipmentNo}: ${oldISO ?? '—'} ← ${targetDate.toISOString().slice(0, 10)} — إلغاء الإيقاف وترخيص التحميل`,
        user: { userId: user.userId, username: user.username },
        before: { date: oldISO, status: s.status },
        after: { date: targetDate.toISOString().slice(0, 10), status: s.status },
      })
      return { ok: true, date: targetDate.toISOString().slice(0, 10), changed: true }
    })
    return result
  })
}
