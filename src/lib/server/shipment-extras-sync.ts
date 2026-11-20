// ============================================================================
// محرك مزامنة بنود النقلة الإضافية (F2) — الحلقة الواصلة بين جدول الصباح
// والمحاسبة: المبالغ المُدخلة على الشحنة (تعتيق/مبيت/تحويلة/دروب) تُترجم
// تلقائيًا إلى بنود ExtraCost مرتبطة بالشحنة (source='shipment_sync') فتمر
// بدورة الاعتماد والقيود المزدوجة نفسها — بلا إدخال مزدوج وبلا تكرار محاسبي.
//
// القواعد:
//   • المبلغ > 0 على الشحنة ← بند متزامن (تعتيق يُعتمد ويرحّل تلقائيًا،
//     الباقي بانتظار اعتماد الشركة وفق سياسة النظام).
//   • تعديل المبلغ على شحنة معتمد بندُها ← عكس القيد + تحديث + إعادة إثبات.
//   • تصفير المبلغ أو حذف الارتباط ← عكس القيد + حذف البند المتزامن.
//   • تغيير مقاول الشحنة ← عكس/حذف بنود المقاول القديم + إنشاء بالمقاول الجديد.
//   • بنود المصدر اليدوي (source=null) لا تُمس نهائيًا من هذه المزامنة.
// كل الدوال تعمل داخل معاملة المتصل (ذرية كاملة).
// ============================================================================
import type { Prisma } from '@prisma/client'
import { ApiError, num, round2 } from './http'
import { nextSeq, logAudit } from './audit'
import { EXTRA_COST_SOURCE, extraCostTypeLabel } from '../extra-cost-catalog'
import { postExtraCostJournal } from './extras'
import { reverseJournal } from './accounting'

type Tx = Prisma.TransactionClient

export interface JUser { userId: string; username: string }

/** خريطة حقل الشحنة ← نوع البند الإضافي المقابل */
export const SHIPMENT_EXTRA_FIELD_MAP = [
  { field: 'aging', type: 'taateeq' },   // التعتيق (تحميل وتنزيل)
  { field: 'overnight', type: 'mabeet' }, // المبيت
  { field: 'transfer', type: 'transfer' }, // التحويلة
  { field: 'drop', type: 'drop' },        // الدروب
] as const

export type ShipmentExtraField = (typeof SHIPMENT_EXTRA_FIELD_MAP)[number]['field']

/** هل المستخدم أرسل أي حقل بنود نقلة إضافية؟ */
export function extrasTouched(body: Record<string, any>): boolean {
  return SHIPMENT_EXTRA_FIELD_MAP.some((m) => body[m.field] !== undefined)
}

/** قيم البنود النهائية بعد الدمج (null/0/نص فارغ = لا بند) */
export function extractExtras(body: Record<string, any>): Record<ShipmentExtraField, number> {
  const out = {} as Record<ShipmentExtraField, number>
  for (const m of SHIPMENT_EXTRA_FIELD_MAP) {
    const v = num(body[m.field])
    out[m.field] = v != null && v > 0 ? round2(v) : 0
  }
  return out
}

/** بنود النقلة المتزامنة المرتبطة بالشحنة (لكل الأنواع) */
function syncedWhere(shipmentId: string, type?: string) {
  return {
    shipmentId,
    source: 'shipment_sync',
    ...(type ? { type } : {}),
    // المرفوض يُترك تاريخيًا — لا يُعدل ولا يُعاد إنشاؤه فوقه (سياسة الوحدة)
    approvalStatus: { not: 'rejected' },
  }
}

async function activeExtraCostJournal(tx: Tx, extraCostId: string) {
  const je = await tx.journalEntry.findFirst({
    where: { sourceType: EXTRA_COST_SOURCE, sourceId: extraCostId, status: 'posted', reversalOfId: null },
    select: { id: true, entryNo: true },
  })
  if (!je) return null
  const reversed = await tx.journalEntry.findUnique({ where: { reversalOfId: je.id }, select: { id: true } })
  return reversed ? null : je
}

/** عكس قيد بند معتمد ثم حذفه (تصفير المبلغ / تغيير المقاول) */
async function reverseAndDeleteSynced(tx: Tx, ec: { id: string; ref: string; approvalStatus: string; journalEntryId?: string | null }, user: JUser, reason: string) {
  if (ec.approvalStatus === 'approved') {
    const je = await activeExtraCostJournal(tx, ec.id)
    if (je) await reverseJournal(tx, je.id, user, `${reason} — ${ec.ref}`)
  }
  await tx.extraCost.delete({ where: { id: ec.id } })
}

/**
 * مزامنة بنود النقلة الإضافية للشحنة مع ExtraCost (تُستدعى من POST/PATCH الشحنة).
 * @param finalExtras القيم النهائية لحقول الشحنة (بعد الدمج) — 0 يعني لا بند
 * @param previousExtras القيم السابقة قبل التعديل (للرسائل التدقيقية)
 */
export async function syncShipmentExtras(
  tx: Tx,
  shipment: {
    id: string
    shipmentNo: string | null
    deliveryNumber?: string | null
    contractorId: string | null
    date?: Date | null
    customer?: { name?: string | null } | null
    contractor?: { name?: string | null } | null
  },
  finalExtras: Record<ShipmentExtraField, number>,
  user: JUser,
  previousExtras?: Record<ShipmentExtraField, number>,
): Promise<{ created: string[]; updated: string[]; deleted: string[] }> {
  const result = { created: [] as string[], updated: [] as string[], deleted: [] as string[] }
  if (!shipment.contractorId) return result

  const contractor = await tx.party.findUnique({
    where: { id: shipment.contractorId },
    select: { id: true, name: true, isContractor: true, active: true },
  })
  if (!contractor) throw new ApiError(400, 'المقاول المحدد غير موجود — تعذر تسجيل البنود الإضافية')
  if (!contractor.isContractor) throw new ApiError(400, 'الطرف المحدد ليس مقاول نقل — تعذر تسجيل البنود الإضافية')
  if (!contractor.active) throw new ApiError(400, 'المقاول موقوف — فعّله أولًا قبل تسجيل بنود النقلة')

  const refLabel = shipment.deliveryNumber ?? shipment.shipmentNo ?? shipment.id

  for (const { field, type } of SHIPMENT_EXTRA_FIELD_MAP) {
    const amount = finalExtras[field] ?? 0
    const prev = previousExtras?.[field] ?? 0
    if (amount === prev) continue // لا تغيير — لا تلمس شيئًا

    const existing = await tx.extraCost.findFirst({
      where: syncedWhere(shipment.id, type),
      orderBy: { createdAt: 'desc' },
    })

    if (amount > 0) {
      if (existing) {
        // تحديث البند الموجود: المعتمد يُعكس قيده ثم يُعاد إثباته بالمبلغ الجديد
        let reversed = false
        if (existing.approvalStatus === 'approved') {
          const je = await activeExtraCostJournal(tx, existing.id)
          if (je) {
            await reverseJournal(tx, je.id, user, `تحديث مبلغ ${extraCostTypeLabel(type)} من الشحنة ${refLabel}`)
            reversed = true
          }
        }
        // journalEntryId يُمسح بعد العكس — يُعاد ربطه بالقيد الجديد عند إعادة الإثبات
        await tx.extraCost.update({
          where: { id: existing.id },
          data: { amount, ...(reversed ? { journalEntryId: null } : {}) },
        })
        const fresh = await tx.extraCost.findUnique({ where: { id: existing.id }, include: { contractor: { select: { name: true } }, shipment: { select: { shipmentNo: true, deliveryNumber: true } } } })
        if (fresh?.approvalStatus === 'approved') {
          // postExtraCostJournal يحدّث journalEntryId داخليًا بعد الترحيل
          await postExtraCostJournal(tx, fresh, user)
        }
        result.updated.push(`${extraCostTypeLabel(type)} ${prev} ← ${amount}`)
      } else {
        // إنشاء بند متزامن جديد — التعتيق يُعتمد ويُرحّل تلقائيًا، الباقي بانتظار الاعتماد
        const autoApprove = type === 'taateeq'
        const n = await nextSeq(tx, 'extra_cost')
        const ref = `EC-${String(n).padStart(4, '0')}`
        const ec = await tx.extraCost.create({
          data: {
            ref,
            type,
            amount,
            notes: `متزامن تلقائيًا من جدول الشحنات — الشحنة ${refLabel}${shipment.customer?.name ? ` — ${shipment.customer.name}` : ''}`,
            approvalStatus: autoApprove ? 'approved' : 'pending',
            contractorId: shipment.contractorId,
            shipmentId: shipment.id,
            date: shipment.date ?? new Date(),
            source: 'shipment_sync',
            userId: user.userId,
            userName: user.username,
            ...(autoApprove
              ? { approvalUserId: user.userId, approvalUserName: user.username, approvalAt: new Date(), approvalNotes: 'اعتماد تلقائي — بند تعتيق قياسي (مزامنة جدول الشحنات)' }
              : {}),
          },
          include: { contractor: { select: { name: true } }, shipment: { select: { shipmentNo: true, deliveryNumber: true } } },
        })
        let journalNo: string | null = null
        if (autoApprove) {
          // postExtraCostJournal يربط القيد بالبند داخليًا (journalEntryId)
          const posted = await postExtraCostJournal(tx, ec, user)
          journalNo = posted?.entryNo ?? null
        }
        result.created.push(`${extraCostTypeLabel(type)} ${amount} (${ref}${journalNo ? ` — قيد ${journalNo}` : ''}${autoApprove ? '' : ' — بانتظار الاعتماد'})`)
      }
    } else if (existing) {
      // تصفير المبلغ على الشحنة = حذف البند المتزامن (وعكس قيده إن كان مرحّلًا)
      await reverseAndDeleteSynced(tx, existing, user, `تصفير ${extraCostTypeLabel(type)} من الشحنة ${refLabel}`)
      result.deleted.push(`${extraCostTypeLabel(type)} ${existing.amount} (${existing.ref})`)
    }
  }

  if (result.created.length || result.updated.length || result.deleted.length) {
    const parts: string[] = []
    if (result.created.length) parts.push(`إنشاء: ${result.created.join('، ')}`)
    if (result.updated.length) parts.push(`تحديث: ${result.updated.join('، ')}`)
    if (result.deleted.length) parts.push(`حذف: ${result.deleted.join('، ')}`)
    await logAudit(tx, {
      action: 'extras_sync', entity: 'shipment', entityId: shipment.id,
      notes: `مزامنة بنود النقلة للشحنة ${refLabel} مع المقاول ${contractor.name} — ${parts.join(' | ')}`,
      user,
    })
  }
  return result
}

/** القيم السابقة لحقول البنود من كائن شحنة قديم (قبل التعديل) */
export function extrasFromShipment(s: { aging?: number | null; overnight?: number | null; transfer?: number | null; drop?: number | null }): Record<ShipmentExtraField, number> {
  return {
    aging: round2(Number(s.aging ?? 0)) || 0,
    overnight: round2(Number(s.overnight ?? 0)) || 0,
    transfer: round2(Number(s.transfer ?? 0)) || 0,
    drop: round2(Number(s.drop ?? 0)) || 0,
  }
}

/**
 * مسح كل البنود المتزامنة للشحنة (عكس القيود المرحّلة ثم الحذف).
 * تُستخدم عند تغيير مقاول الشحنة — بنود المقاول القديم تُسحب بالكامل
 * ثم تُعاد المزامنة لبناء بنود جديدة بالمقاول الجديد (لا نقل خاطئ للمستحقات).
 */
export async function clearSyncedExtras(tx: Tx, shipmentId: string, user: JUser, reason: string): Promise<string[]> {
  const rows = await tx.extraCost.findMany({ where: syncedWhere(shipmentId) })
  const cleared: string[] = []
  for (const ec of rows) {
    await reverseAndDeleteSynced(tx, ec, user, reason)
    cleared.push(`${ec.ref} (${extraCostTypeLabel(ec.type)} — ${ec.amount})`)
  }
  return cleared
}
