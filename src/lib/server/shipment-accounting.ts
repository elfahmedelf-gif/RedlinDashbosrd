// ============================================================================
// محرك التكامل المالي للشحنات — كل حدث تشغيلي له أثره المحاسبي الحقيقي
//   • عند التسليم (delivered): إثبات استحقاق النولون على العميل (مدين العملاء /
//     دائن إيراد الشحن) + إثبات مستحقات المقاول (مدين تكلفة النقل / دائن
//     مقاولو النقل) — مرة واحدة فقط لكل شحنة (منع الترحيل المزدوج)
//   • عند استلام مرتجع: قيد عكسي للنولون صافيًا بعد رسوم المرتجع (حسب سياسة
//     التسعير — حقل returns على الشحنة)
//   • ترحيل جماعي (Backfill) للشحنات المسلّمة سابقًا بلا قيود — أداة تصحيح
// كل الدوال تقبل Tx لتعمل داخل معاملة المتصل (ذرية كاملة)
// ============================================================================
import type { Prisma } from '@prisma/client'
import { ApiError, round2 } from './http'
import { ACC, accountByCode, createJournal } from './accounting'

type Tx = Prisma.TransactionClient

export interface JUser { userId: string; username: string }

export const SHIPMENT_DELIVERY_SOURCE = 'shipment_delivery'
export const SHIPMENT_RETURN_SOURCE = 'shipment_return_reversal'

interface ShipmentFinancials {
  id: string
  shipmentNo: string | null
  customerId: string | null
  contractorId: string | null
  freightTotal: number | null
  totalSuppliers: number | null
  returns: number | null
  customer?: { id: string; name: string } | null
  contractor?: { id: string; name: string } | null
}

/** هل للشحنة قيد تسليم مرحّل؟ */
export async function hasDeliveryJournal(tx: Tx, shipmentId: string): Promise<boolean> {
  const found = await tx.journalEntry.findFirst({
    where: { sourceType: SHIPMENT_DELIVERY_SOURCE, sourceId: shipmentId, status: 'posted', reversalOfId: null },
    select: { id: true, entryNo: true },
  })
  return !!found
}

/**
 * إثبات الأثر المالي لتسليم الشحنة (مرة واحدة فقط لكل شحنة):
 *   1) إذا كان على العميل نولون: مدين العملاء (1103) / دائن إيراد الشحن (4101)
 *   2) إذا كانت هناك تكلفة مقاول: مدين تكلفة النقل (5101) / دائن مقاولو النقل (2102)
 */
export async function postShipmentDeliveryJournal(
  tx: Tx,
  shipment: ShipmentFinancials,
  user: JUser,
): Promise<{ entryNo: string; id: string } | null> {
  const freight = round2(Number(shipment.freightTotal ?? 0))
  const cost = round2(Number(shipment.totalSuppliers ?? 0))
  if (freight <= 0 && cost <= 0) return null

  // منع الترحيل المزدوج لنفس الشحنة
  if (await hasDeliveryJournal(tx, shipment.id)) return null

  const lines = []
  if (freight > 0 && shipment.customerId) {
    const ar = await accountByCode(tx, ACC.AR)
    const revenue = await accountByCode(tx, '4101') // إيراد الشحن
    lines.push(
      { accountId: ar.id, debit: freight, credit: 0, description: `استحقاق نولون الشحنة ${shipment.shipmentNo ?? ''}`, partyId: shipment.customerId, shipmentId: shipment.id },
      { accountId: revenue.id, debit: 0, credit: freight, description: `إيراد شحن — ${shipment.customer?.name ?? 'عميل'}`, partyId: shipment.customerId, shipmentId: shipment.id },
    )
  }
  if (cost > 0 && shipment.contractorId) {
    const expense = await accountByCode(tx, '5101') // تكلفة النقل (النولون)
    const contractors = await accountByCode(tx, ACC.CONTRACTORS)
    lines.push(
      { accountId: expense.id, debit: cost, credit: 0, description: `تكلفة نقل الشحنة ${shipment.shipmentNo ?? ''}`, partyId: shipment.contractorId, shipmentId: shipment.id },
      { accountId: contractors.id, debit: 0, credit: cost, description: `مستحقات المقاول — ${shipment.contractor?.name ?? 'مقاول'}`, partyId: shipment.contractorId, shipmentId: shipment.id },
    )
  }
  if (!lines.length) return null

  const parts = [
    freight > 0 && shipment.customerId ? `نولون ${freight}` : null,
    cost > 0 && shipment.contractorId ? `تكلفة مقاول ${cost}` : null,
  ].filter(Boolean).join(' + ')

  const entry = await createJournal(tx, {
    description: `إثبات تسليم الشحنة ${shipment.shipmentNo ?? ''} — ${parts}`,
    reference: shipment.shipmentNo,
    sourceType: SHIPMENT_DELIVERY_SOURCE,
    sourceId: shipment.id,
    status: 'posted',
    lines,
    user,
    preventDuplicateSource: true,
  })
  return { id: entry.id, entryNo: entry.entryNo }
}

/**
 * القيد العكسي عند استلام مرتجع: عكس النولون المستحق على العميل صافيًا بعد
 * رسوم المرتجع (shipment.returns) — لا أثر إذا لم يوجد قيد تسليم أصلي.
 */
export async function postShipmentReturnReversal(
  tx: Tx,
  shipment: ShipmentFinancials,
  user: JUser,
): Promise<{ entryNo: string; id: string } | null> {
  if (!(await hasDeliveryJournal(tx, shipment.id))) return null

  const freight = round2(Number(shipment.freightTotal ?? 0))
  if (freight <= 0 || !shipment.customerId) return null

  // رسوم المرتجع حسب سياسة التسعير — الصافي المرتجع للعميل
  const returnFee = round2(Math.min(Math.max(Number(shipment.returns ?? 0), 0), freight))
  const net = round2(freight - returnFee)
  if (net <= 0) return null

  // منع تكرار العكس لنفس الشحنة
  const dup = await tx.journalEntry.findFirst({
    where: { sourceType: SHIPMENT_RETURN_SOURCE, sourceId: shipment.id, status: 'posted', reversalOfId: null },
    select: { id: true },
  })
  if (dup) return null

  const ar = await accountByCode(tx, ACC.AR)
  const revenue = await accountByCode(tx, '4101')
  const lines = [
    { accountId: revenue.id, debit: net, credit: 0, description: `عكس إيراد نولون مرتجع الشحنة ${shipment.shipmentNo ?? ''}`, partyId: shipment.customerId, shipmentId: shipment.id },
    { accountId: ar.id, debit: 0, credit: net, description: `خفض مستحقات العميل — مرتجع (رسوم مرتجع: ${returnFee})`, partyId: shipment.customerId, shipmentId: shipment.id },
  ]
  const entry = await createJournal(tx, {
    description: `قيد عكسي لمرتجع الشحنة ${shipment.shipmentNo ?? ''} — صافي ${net}${returnFee ? ` (رسوم مرتجع ${returnFee})` : ''}`,
    reference: shipment.shipmentNo,
    sourceType: SHIPMENT_RETURN_SOURCE,
    sourceId: shipment.id,
    status: 'posted',
    lines,
    user,
  })
  return { id: entry.id, entryNo: entry.entryNo }
}

/** الشحنات المسلّمة بلا قيد تسليم (لأداة الترحيل الجماعي) */
export async function findDeliveredWithoutJournal(tx: Tx, limit = 500) {
  return tx.shipment.findMany({
    where: { status: 'delivered' },
    include: { customer: { select: { id: true, name: true } }, contractor: { select: { id: true, name: true } } },
    take: limit,
    orderBy: { updatedAt: 'desc' },
  })
}

/**
 * ترحيل قيود التسليم لكل الشحنات المسلّمة بلا قيود (أداة تصحيح للأرصدة القديمة)
 */
export async function backfillShipmentJournals(tx: Tx, user: JUser) {
  const shipments = await findDeliveredWithoutJournal(tx)
  const results: { shipmentNo: string | null; entryNo?: string; skipped?: string }[] = []
  for (const s of shipments) {
    try {
      const posted = await postShipmentDeliveryJournal(tx, s, user)
      results.push(posted ? { shipmentNo: s.shipmentNo, entryNo: posted.entryNo } : { shipmentNo: s.shipmentNo, skipped: 'بلا نولون/تكلفة أو مُرحّل مسبقًا' })
    } catch (e: any) {
      results.push({ shipmentNo: s.shipmentNo, skipped: e?.message ?? 'خطأ' })
    }
  }
  return { processed: shipments.length, posted: results.filter((r) => r.entryNo).length, results }
}
