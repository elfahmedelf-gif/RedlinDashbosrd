// ============================================================================
// طبقة استعلام أذونات التسليم (الديليفري) — لكل مقاول على حدة
// العنصر الأساسي: الشحنات المسندة لمقاول + علامة استلام الإذن (isReceiptDelivered)
// + عدّادات اليوم: إجمالي شحنات اليوم / خرجت / متبقية (برقم الديليفري)
// + تجميع لكل مقاول (أذوناته الخاصة — لا قوائم مختلطة)
// ============================================================================
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ApiError, round2 } from './http'
import { canSeePrices } from './prices'
import { DISPATCHED_STATUSES, RECEIPT_EXCLUDED_STATUSES, RECEIPT_OVERDUE_DAYS } from '../extra-cost-catalog'

const RECEIPT_INCLUDE = {
  contractor: { select: { id: true, name: true, code: true } },
  customer: { select: { id: true, name: true } },
} satisfies Prisma.ShipmentInclude

function dayRange(dateISO: string | null | undefined) {
  const d = dateISO && /^\d{4}-\d{2}-\d{2}$/.test(dateISO) ? dateISO : new Date().toISOString().slice(0, 10)
  return { from: new Date(d + 'T00:00:00'), to: new Date(d + 'T23:59:59.999'), iso: d }
}

/**
 * قائمة أذونات التسليم — الشحنات المسندة لمقاولين فقط (لا إذن لشحنة بلا مقاول).
 * view: all | undelivered | delivered | overdue (متأخرة = غير مسلمة أقدم من 3 أيام)
 */
export async function listReceipts(q: URLSearchParams, user?: { permissions: string[] } | null) {
  const canPrices = canSeePrices(user)
  const contractorId = q.get('contractorId')
  const view = q.get('view') ?? 'all'
  const search = (q.get('q') ?? '').trim().toLowerCase()
  const now = Date.now()

  // ── البحث الشامل: نص البحث يجيب أي إذن من كل المقاولين (المسلّمة وغير المسلّمة)
  // متجاوزًا تبويب المقاول وعرض الحالة — رقم الديليفري أو الكود يكفي للوصول لأي إذن ──
  const globalSearch = search.length > 0
  const where: Prisma.ShipmentWhereInput = {
    contractorId: !globalSearch && contractorId && contractorId !== 'all' ? contractorId : { not: null },
    status: { notIn: [...RECEIPT_EXCLUDED_STATUSES] },
  }
  if (!globalSearch) {
    if (view === 'undelivered' || view === 'overdue') where.isReceiptDelivered = false
    if (view === 'delivered') where.isReceiptDelivered = true
  }

  const rows = await db.shipment.findMany({
    where,
    include: RECEIPT_INCLUDE,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  })

  const enriched = rows.map((s) => {
    const base = s.date ?? s.createdAt
    const ageDays = base ? Math.max(0, Math.floor((now - new Date(base).getTime()) / 86400000)) : 0
    return {
      id: s.id,
      deliveryNumber: s.deliveryNumber ?? s.shipmentNo,
      shipmentNo: s.shipmentNo,
      billNo: s.billNo,
      destination: s.destination,
      recipientName: s.recipientName,
      date: s.date,
      status: s.status,
      contractor: s.contractor ? { id: s.contractor.id, name: s.contractor.name, code: s.contractor.code } : null,
      customer: s.customer ? { id: s.customer.id, name: s.customer.name } : null,
      isReceiptDelivered: s.isReceiptDelivered,
      receiptDeliveredAt: s.receiptDeliveredAt,
      ageDays,
      overdue: !s.isReceiptDelivered && ageDays > RECEIPT_OVERDUE_DAYS,
      // المبالغ تُكشف فقط لمن يملك صلاحية الأسعار (نفس سياسة الشحنات) — للتعديل من نافذة الإذن
      ...(canPrices ? { freightCost: s.freightCost, freightTotal: s.freightTotal, collected: s.collectionStatus === 'collected' } : {}),
    }
  })

  // أساس العدّادات والتبويبات — فلاتر المقاول/العرض بلا بحث (تبقى ثابتة أثناء البحث)
  const baseItems = globalSearch
    ? enriched.filter((x) => {
        if (contractorId && contractorId !== 'all' && x.contractor?.id !== contractorId) return false
        if (view === 'undelivered' && x.isReceiptDelivered) return false
        if (view === 'delivered' && !x.isReceiptDelivered) return false
        if (view === 'overdue' && !x.overdue) return false
        return true
      })
    : enriched

  let items = baseItems
  if (search) {
    items = enriched.filter((x) =>
      [x.deliveryNumber, x.shipmentNo, x.billNo, x.destination, x.recipientName,
        x.contractor?.name, x.contractor?.code, x.customer?.name]
        .some((f) => String(f ?? '').toLowerCase().includes(search)))
  }

  // تجميع لكل مقاول — أذوناته الخاصة (شارات التبويبات)
  const byContractorMap = new Map<string, { id: string; name: string; code: string | null; pending: number; overdue: number; delivered: number; total: number }>()
  for (const x of baseItems) {
    if (!x.contractor) continue
    const key = x.contractor.id
    const cur = byContractorMap.get(key) ?? { id: key, name: x.contractor.name, code: x.contractor.code, pending: 0, overdue: 0, delivered: 0, total: 0 }
    cur.total += 1
    if (x.isReceiptDelivered) cur.delivered += 1
    else {
      cur.pending += 1
      if (x.overdue) cur.overdue += 1
    }
    byContractorMap.set(key, cur)
  }
  const byContractor = [...byContractorMap.values()].sort((a, b) => b.pending - a.pending || b.overdue - a.overdue)

  const page = Math.max(1, parseInt(q.get('page') || '1', 10))
  const pageSize = Math.min(500, Math.max(1, parseInt(q.get('pageSize') || '20', 10)))
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const p = Math.min(page, totalPages)
  const start = (p - 1) * pageSize

  const totals = {
    all: baseItems.length,
    pending: baseItems.filter((x) => !x.isReceiptDelivered).length,
    overdue: baseItems.filter((x) => x.overdue).length,
    delivered: baseItems.filter((x) => x.isReceiptDelivered).length,
  }

  return { items: items.slice(start, start + pageSize), total, page: p, pageSize, totalPages, totals, byContractor }
}

/**
 * عدّادات اليوم — إجمالي شحنات اليوم / التي خرجت / المتبقية
 * (الملغاة والمشطوبة مستبعدة من العدّ — لا تخرج ولا تبقى)
 */
export async function dailyShipmentKpis(dateISO: string | null | undefined, contractorId?: string | null) {
  const { from, to, iso } = dayRange(dateISO)
  const baseWhere: Prisma.ShipmentWhereInput = {
    date: { gte: from, lte: to },
    status: { notIn: [...RECEIPT_EXCLUDED_STATUSES] },
  }
  if (contractorId) baseWhere.contractorId = contractorId

  const [total, dispatched, receiptsPending] = await Promise.all([
    db.shipment.count({ where: baseWhere }),
    db.shipment.count({ where: { ...baseWhere, status: { in: [...DISPATCHED_STATUSES] } } }),
    db.shipment.count({ where: { ...baseWhere, isReceiptDelivered: false } }),
  ])
  return { date: iso, total, dispatched, remaining: Math.max(0, total - dispatched), receiptsPending }
}

/** تسليم/إرجاع علامة إذن التسليم — داخل معاملة + سجل تدقيق (تُستدعى من المسار) */
export async function setReceiptDelivered(
  user: { userId: string; username: string },
  shipmentId: string,
  delivered: boolean,
  notes?: string,
) {
  return db.$transaction(async (tx) => {
    const s = await tx.shipment.findUnique({ where: { id: shipmentId }, include: { contractor: { select: { id: true, name: true } } } })
    if (!s) throw new ApiError(404, 'الشحنة غير موجودة')
    if (!s.contractorId) throw new ApiError(409, 'الشحنة غير مسندة لأي مقاول — عيّن مقاولًا أولًا')
    if (s.isReceiptDelivered === delivered) {
      return { ok: true, unchanged: true, isReceiptDelivered: s.isReceiptDelivered }
    }
    const updated = await tx.shipment.update({
      where: { id: shipmentId },
      data: { isReceiptDelivered: delivered, receiptDeliveredAt: delivered ? new Date() : null },
    })
    await tx.shipmentStatusHistory.create({
      data: {
        shipmentId,
        fromStatus: s.status,
        toStatus: s.status,
        notes: delivered
          ? `تسليم إذن التسليم (الديليفري ${s.deliveryNumber ?? s.shipmentNo ?? ''}) إلى المقاول${notes ? ` — ${notes}` : ''}`
          : `إرجاع علامة تسليم إذن التسليم${notes ? ` — ${notes}` : ''}`,
        userName: user.username,
      },
    })
    await tx.auditLog.create({
      data: {
        action: delivered ? 'receipt_delivered' : 'receipt_undelivered',
        entity: 'shipment',
        entityId: shipmentId,
        notes: `${delivered ? 'تسجيل تسليم' : 'إلغاء تسليم'} إذن التسليم للشحنة ${s.shipmentNo ?? ''} — المقاول: ${s.contractor?.name ?? ''}`,
        userId: user.userId,
        userName: user.username,
        beforeData: JSON.stringify({ isReceiptDelivered: s.isReceiptDelivered, receiptDeliveredAt: s.receiptDeliveredAt }),
        afterData: JSON.stringify({ isReceiptDelivered: delivered, receiptDeliveredAt: updated.receiptDeliveredAt }),
      },
    })
    return { ok: true, unchanged: false, isReceiptDelivered: updated.isReceiptDelivered, receiptDeliveredAt: updated.receiptDeliveredAt }
  })
}

void round2

// ============================================================================
// CRUD إذن التسليم — إضافة/تعديل/حذف بمزامنة محاسبية متتالية (Cascading)
// كل إذن = شحنة مسندة لمقاول برقم ديليفري؛ أي إضافة/تعديل/حذف يُحدّث:
//   1) سجل حالات الشحنة + التدقيق   2) القيد المحاسبي (عكس وإعادة إثبات)
//   3) عدّادات اليوم وأذونات المقاول فورًا (الواجهة تعيد التحقق عبر SWR)
// ============================================================================

import { logAudit } from './audit'
import { nextShipmentNoTx } from './seed'
import {
  getActiveDeliveryJournal,
  postShipmentDeliveryJournal,
} from './shipment-accounting'
import { reverseJournal } from './accounting'
import { canTransitionShipment, isKnownShipmentStatus, isTerminalShipmentStatus, shipmentStatusLabel, shipmentTransitionError } from '../shipment-catalog'

type Tx = Prisma.TransactionClient

/** حقول الإذن القابلة للتعديل */
const RECEIPT_MONEY_FIELDS = ['freightCost', 'freightTotal'] as const

interface ReceiptActor { userId: string; username: string }

/**
 * منع تكرار رقم الديليفري على مستوى النظام كله — فريد عبر كل المقاولين والشحنات
 * (رقم الديليفري هو معرّف البحث الأساسي لدى المقاول ولا يجوز أن يتكرر إطلاقًا).
 * عند التكرار تُعاد رسالة عربية واضحة + بيانات الشحنة الموجودة لعرض رابط سريع لها.
 */
export async function assertUniqueDeliveryNumber(tx: Tx, deliveryNumber: string, _contractorId: string, exceptId?: string) {
  const dup = await tx.shipment.findFirst({
    where: {
      deliveryNumber,
      id: exceptId ? { not: exceptId } : undefined,
      status: { notIn: [...RECEIPT_EXCLUDED_STATUSES] },
    },
    select: { id: true, shipmentNo: true, deliveryNumber: true, contractor: { select: { name: true } } },
  })
  if (dup) {
    throw new ApiError(
      409,
      `رقم الديليفري مسجل مسبقًا لشحنة أخرى (${dup.shipmentNo}${dup.contractor?.name ? ` — ${dup.contractor.name}` : ''})`,
      {
        code: 'DUPLICATE_DELIVERY_NUMBER',
        existingShipmentId: dup.id,
        existingShipmentNo: dup.shipmentNo,
        existingDeliveryNumber: dup.deliveryNumber,
        existingContractor: dup.contractor?.name ?? null,
      },
    )
  }
}

/**
 * إضافة إذن تسليم جديد — إنشاء شحنة مسندة لمقاول برقم ديليفري
 * افتراضيًا تُسجل «محمّلة على المركبة» (خرجت مع المقاول)، وإذا اختير «تم التسليم»
 * يُرحّل القيد المحاسبي فورًا (إثبات النولون + مستحقات المقاول).
 */
export async function createDeliveryReceipt(user: ReceiptActor & { permissions: string[] }, body: any) {
  const contractorId = String(body.contractorId ?? '').trim()
  if (!contractorId) throw new ApiError(400, 'اختيار المقاول مطلوب — لا يوجد إذن بدون مقاول')

  const status = body.status ? String(body.status) : 'loaded'
  if (!isKnownShipmentStatus(status)) throw new ApiError(400, `حالة غير معروفة: "${status}"`)
  if (isTerminalShipmentStatus(status)) throw new ApiError(400, 'لا يمكن إنشاء إذن بحالة نهائية (ملغاة/مشطوبة)')

  const deliveryNumber = String(body.deliveryNumber ?? '').trim()
  const money = (k: string) => (body[k] === undefined || body[k] === null || body[k] === '' ? null : round2(Number(body[k]) || 0))

  const created = await db.$transaction(async (tx) => {
    const contractor = await tx.party.findUnique({ where: { id: contractorId }, select: { id: true, name: true, isContractor: true } })
    if (!contractor) throw new ApiError(400, 'المقاول المحدد غير موجود')
    if (!contractor.isContractor) throw new ApiError(400, `«${contractor.name}» غير مسجل كمقاول — اختر طرفًا من المقاولين`)

    if (body.customerId) {
      const c = await tx.party.findUnique({ where: { id: String(body.customerId) }, select: { id: true } })
      if (!c) throw new ApiError(400, 'العميل المحدد غير موجود')
    }

    const shipmentNo = await nextShipmentNoTx(tx)
    const dn = deliveryNumber || shipmentNo
    await assertUniqueDeliveryNumber(tx, dn, contractorId)

    const freightCost = money('freightCost')
    const freightTotal = money('freightTotal')

    const s = await tx.shipment.create({
      data: {
        shipmentNo,
        deliveryNumber: dn,
        contractorId,
        customerId: body.customerId ? String(body.customerId) : null,
        recipientName: body.recipientName ? String(body.recipientName).slice(0, 120) : null,
        shipToParty: body.recipientName ? String(body.recipientName).slice(0, 120) : null,
        destination: body.destination ? String(body.destination).slice(0, 120) : null,
        notes: body.notes ? String(body.notes).slice(0, 500) : null,
        date: body.date ? new Date(`${body.date}T12:00:00`) : new Date(),
        freightCost,
        totalSuppliers: freightCost ?? 0, // نولون المقاول = مستحقاته الأساسية
        freightTotal,
        status,
        collectionStatus: 'uncollected',
        isReceiptDelivered: false,
        statusHistory: {
          create: {
            fromStatus: null,
            toStatus: status,
            notes: `إنشاء إذن تسليم يدوي (ديليفري ${dn}) — المقاول: ${contractor.name}`,
            userName: user.username,
          },
        },
      },
      include: { contractor: { select: { id: true, name: true, code: true } } },
    })

    // الأثر المالي: إنشاء الإذن بحالة «تم التسليم» مباشرة يُرحّل القيد فورًا
    let journalEntryNo: string | null = null
    if (status === 'delivered') {
      const fresh = await tx.shipment.findUnique({
        where: { id: s.id },
        include: { customer: { select: { id: true, name: true } }, contractor: { select: { id: true, name: true } } },
      })
      const posted = fresh ? await postShipmentDeliveryJournal(tx, fresh, user) : null
      journalEntryNo = posted?.entryNo ?? null
    }

    await logAudit(tx, {
      action: 'create', entity: 'delivery_receipt', entityId: s.id,
      notes: `إنشاء إذن تسليم ${dn} — الشحنة ${shipmentNo} — المقاول: ${contractor.name}${journalEntryNo ? ` — قيد ${journalEntryNo}` : ''}`,
      user: { userId: user.userId, username: user.username },
      after: { deliveryNumber: dn, shipmentNo, contractorId, status, freightCost, freightTotal },
    })
    return { ...s, journalEntryNo }
  })

  return { id: created.id, shipmentNo: created.shipmentNo, deliveryNumber: created.deliveryNumber, journalEntryNo: created.journalEntryNo }
}

/**
 * تعديل إذن تسليم — متزامن محاسبيًا:
 *   • تغيير المقاول أو النولون على إذن مُرحّل قيده: عكس القيد ثم إعادة إثباته بالبيانات الجديدة
 *     (نقل مستحقات المقاول القديم ← الجديد على حساب 2102 تلقائيًا)
 *   • تغيير الحالة وفق آلة الحالات الصارمة؛ الانتقال إلى «تم التسليم» يُرحّل القيد
 */
export async function updateDeliveryReceipt(user: ReceiptActor, id: string, body: any) {
  const result = await db.$transaction(async (tx) => {
    const s = await tx.shipment.findUnique({
      where: { id },
      include: {
        contractor: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
      },
    })
    if (!s) throw new ApiError(404, 'الإذن غير موجود')
    if (!s.contractorId) throw new ApiError(409, 'الشحنة غير مسندة لأي مقاول — لا تُدار كإذن تسليم')

    const data: any = {}
    const notes: string[] = []

    // رقم الديليفري + المقاول + العميل + البيانات النصية
    if (body.deliveryNumber !== undefined) {
      const dn = String(body.deliveryNumber ?? '').trim()
      if (!dn) throw new ApiError(400, 'رقم الديليفري لا يمكن أن يكون فارغًا — احذف الإذن إذا لم تعد بحاجته')
      if (dn !== (s.deliveryNumber ?? s.shipmentNo)) {
        await assertUniqueDeliveryNumber(tx, dn, s.contractorId, id)
        data.deliveryNumber = dn
        notes.push(`رقم الديليفري: ${s.deliveryNumber ?? '—'} ← ${dn}`)
      }
    }
    if (body.contractorId !== undefined && String(body.contractorId) !== s.contractorId) {
      const contractor = await tx.party.findUnique({ where: { id: String(body.contractorId) }, select: { id: true, name: true, isContractor: true } })
      if (!contractor) throw new ApiError(400, 'المقاول الجديد غير موجود')
      if (!contractor.isContractor) throw new ApiError(400, `«${contractor.name}» غير مسجل كمقاول`)
      data.contractorId = contractor.id
      notes.push(`المقاول: ${s.contractor?.name ?? '—'} ← ${contractor.name}`)
    }
    if (body.customerId !== undefined) {
      const cid = body.customerId ? String(body.customerId) : null
      if (cid) {
        const c = await tx.party.findUnique({ where: { id: cid }, select: { id: true } })
        if (!c) throw new ApiError(400, 'العميل المحدد غير موجود')
      }
      if (cid !== s.customerId) { data.customerId = cid; notes.push('تغيير العميل') }
    }
    for (const [key, label] of [['destination', 'الوجهة'], ['recipientName', 'المستلم'], ['notes', 'ملاحظات']] as const) {
      if (body[key] !== undefined) {
        const v = body[key] ? String(body[key]).slice(0, 500) : null
        if (v !== (s as any)[key]) { data[key] = v; notes.push(`${label}: ${String((s as any)[key] ?? '—')} ← ${v ?? '—'}`) }
      }
    }
    if (body.date !== undefined && body.date) {
      const d = new Date(`${body.date}T12:00:00`)
      if (isNaN(d.getTime())) throw new ApiError(400, 'تاريخ غير صحيح')
      if (String(s.date?.toISOString().slice(0, 10) ?? '') !== body.date) { data.date = d; notes.push(`التاريخ: ${s.date?.toISOString().slice(0, 10) ?? '—'} ← ${body.date}`) }
    }

    // المبالغ — محمية على الشحنات المحصّلة
    const moneyChanges: Record<string, number | null> = {}
    for (const k of RECEIPT_MONEY_FIELDS) {
      if (body[k] === undefined) continue
      const v = body[k] === null || body[k] === '' ? null : round2(Number(body[k]) || 0)
      if (round2(Number((s as any)[k] ?? 0)) !== (v ?? 0)) moneyChanges[k] = v
    }
    if (Object.keys(moneyChanges).length) {
      if (s.collectionStatus === 'collected') throw new ApiError(409, 'لا يمكن تعديل مبالغ إذن تم تحصيله — عكس التحصيل أولًا وفق سياسة النظام')
      if (moneyChanges.freightCost !== undefined) {
        data.freightCost = moneyChanges.freightCost
        data.totalSuppliers = moneyChanges.freightCost ?? 0 // اتساق مستحقات المقاول
      }
      if (moneyChanges.freightTotal !== undefined) data.freightTotal = moneyChanges.freightTotal
      notes.push(`النولون: ${Object.entries(moneyChanges).map(([k, v]) => `${k === 'freightCost' ? 'المقاول' : 'العميل'} ${round2(Number((s as any)[k] ?? 0))} ← ${v ?? 0}`).join('، ')}`)
    }

    // الحالة — آلة حالات صارمة
    let toStatus: string | null = null
    if (body.status !== undefined && body.status !== s.status) {
      const to = String(body.status)
      if (!isKnownShipmentStatus(to)) throw new ApiError(400, `حالة غير معروفة: "${to}"`)
      if (isTerminalShipmentStatus(to)) throw new ApiError(400, 'لا يمكن تحويل الإذن إلى حالة نهائية من شاشة الأذونات — استخدم إلغاء/شطب الشحنات وفق السياسة')
      if (!canTransitionShipment(s.status, to)) throw new ApiError(409, shipmentTransitionError(s.status, to))
      if (to === 'returned' && s.collectionStatus === 'collected') throw new ApiError(409, 'لا يمكن تحويل إذن محصّل إلى مرتجع — عكس التحصيل أولًا')
      toStatus = to
      data.status = to
      notes.push(`الحالة: ${shipmentStatusLabel(s.status)} ← ${shipmentStatusLabel(to)}`)
    }

    if (!Object.keys(data).length) return { id, unchanged: true as const }

    // المزامنة المحاسبية: عكس القيد النشط قبل تغيير المقاول/النولون ثم إعادة الإثبات
    const activeJE = await getActiveDeliveryJournal(tx, id)
    const financialChanged = !!(data.contractorId || data.freightCost !== undefined || data.freightTotal !== undefined)
    let reversalNo: string | null = null
    if (activeJE && financialChanged) {
      if (s.collectionStatus === 'collected') throw new ApiError(409, 'لا يمكن تعديل مستحقات إذن تم تحصيله — عكس التحصيل أولًا')
      const reversal = await reverseJournal(tx, activeJE.id, user, `تصحيح بيانات الإذن ${s.deliveryNumber ?? s.shipmentNo ?? ''} قبل التعديل`)
      reversalNo = reversal.entryNo
    }

    const updated = await tx.shipment.update({
      where: { id },
      data: {
        ...data,
        statusHistory: toStatus
          ? { create: { fromStatus: s.status, toStatus, notes: `تعديل الإذن (ديليفري ${s.deliveryNumber ?? s.shipmentNo ?? ''}) — ${notes.join('، ')}`, userName: user.username } }
          : undefined,
      },
      include: { customer: { select: { id: true, name: true } }, contractor: { select: { id: true, name: true } } },
    })

    // إعادة إثبات القيد بالبيانات الجديدة (نقل مستحقات المقاول القديم ← الجديد)
    let repostNo: string | null = null
    if (reversalNo) {
      const posted = await postShipmentDeliveryJournal(tx, updated, user)
      repostNo = posted?.entryNo ?? null
    }
    // الانتقال إلى «تم التسليم» يُثبت القيد إن لم يكن مُرحّلًا
    let postNo: string | null = null
    if (toStatus === 'delivered' && !reversalNo) {
      const posted = await postShipmentDeliveryJournal(tx, updated, user)
      postNo = posted?.entryNo ?? null
    }

    await logAudit(tx, {
      action: 'update', entity: 'delivery_receipt', entityId: id,
      notes: `تعديل إذن التسليم ${s.deliveryNumber ?? s.shipmentNo ?? ''} — ${notes.join('، ')}${reversalNo ? ` — عكس القيد ${reversalNo}` : ''}${repostNo ? ` — إعادة إثبات بالقيد ${repostNo}` : ''}${postNo ? ` — إثبات بالقيد ${postNo}` : ''}`,
      user: { userId: user.userId, username: user.username },
      before: { deliveryNumber: s.deliveryNumber, contractorId: s.contractorId, status: s.status, freightCost: s.freightCost, freightTotal: s.freightTotal },
      after: { ...data, reversalNo, repostNo, postNo },
    })

    return { id, unchanged: false as const, reversalNo, repostNo, postNo, notes }
  })
  return result
}

/**
 * حذف إذن تسليم — نظيف بلا أرصدة يتيمة:
 *   • إذن له بنود معتمدة ومُرحّلة → يُرفض بتحذير واضح (اعالجها أولًا)
 *   • قيد التسليم النشط → يُعكس تلقائيًا (قيد عكسي يصحح رصيد المقاول والعميل)
 *   • البنود المعلقة/المرفوعة المرتبطة → تُحذف، والسجل التاريخي يُنظف تلقائيًا
 */
export async function deleteDeliveryReceipt(user: ReceiptActor, id: string) {
  await db.$transaction(async (tx) => {
    const s = await tx.shipment.findUnique({
      where: { id },
      include: { contractor: { select: { id: true, name: true } } },
    })
    if (!s) return
    if (!s.contractorId) throw new ApiError(409, 'الشحنة غير مسندة لأي مقاول — احذفها من شاشة الشحنات')

    // 1) منع الحذف المدمر: أذونات تشغيلية نشطة أو مكتملة
    const blockingVoucher = await tx.opVoucherItem.findFirst({
      where: { shipmentId: id, voucher: { status: { in: ['draft', 'pending', 'approved', 'in_progress', 'completed'] } } },
      include: { voucher: { select: { voucherNo: true, status: true } } },
    })
    if (blockingVoucher) throw new ApiError(409, `لا يمكن حذف الإذن — الشحنة مرتبطة بأذون تشغيلي (${blockingVoucher.voucher.voucherNo}) — عالجه أولًا`)

    // 2) البنود الإضافية: المعتمدة تمنع (قيودها مرحّلة)، والمعلقة تُحذف
    const extras = await tx.extraCost.findMany({ where: { shipmentId: id }, select: { id: true, ref: true, approvalStatus: true, amount: true, type: true } })
    const approvedExtras = extras.filter((e) => e.approvalStatus === 'approved')
    if (approvedExtras.length) {
      throw new ApiError(409, `لا يمكن حذف الإذن — عليه ${approvedExtras.length} بند إضافي معتمد ومُرحّل محاسبيًا (${approvedExtras.map((e) => `${e.ref} = ${round2(e.amount)} ج.م`).join('، ')}) — ارفض البنود أولًا ثم احذف الإذن`)
    }

    if (s.collectionStatus === 'collected') throw new ApiError(409, 'لا يمكن حذف إذن تم تحصيله — عكس التحصيل أولًا وفق سياسة النظام')

    // 0) الشحنة المفوترة بفاتورة نشطة — لا حذف (الفاتورة تُحاسَب على هذه الشحنة)
    if (s.invoiceId) {
      const inv = await tx.invoice.findUnique({ where: { id: s.invoiceId }, select: { invoiceNumber: true, status: true } })
      if (inv && inv.status !== 'cancelled') {
        throw new ApiError(409, `لا يمكن حذف الإذن — الشحنة مفوترة بفاتورة نشطة (${inv.invoiceNumber}) — ألغِ الفاتورة أولًا وفق سياسة النظام`)
      }
    }

    // 3) عكس القيود المحاسبية النشطة المرتبطة بالشحنة (قيد التسليم أو أي قيد آخر)
    const activeEntries = await tx.journalEntry.findMany({
      where: { status: 'posted', reversalOfId: null, lines: { some: { shipmentId: id } } },
      select: { id: true, entryNo: true },
    })
    const reversalNos: string[] = []
    for (const je of activeEntries) {
      const already = await tx.journalEntry.findUnique({ where: { reversalOfId: je.id }, select: { id: true } })
      if (!already) {
        const rev = await reverseJournal(tx, je.id, user, `حذف إذن التسليم ${s.deliveryNumber ?? s.shipmentNo ?? ''} — عكس القيد تلقائيًا`)
        reversalNos.push(rev.entryNo)
      }
    }

    // 4) حذف البنود المعلقة/المرفوضة المرتبطة (لا قيود لها)
    await tx.extraCost.deleteMany({ where: { shipmentId: id, approvalStatus: { in: ['pending', 'rejected'] } } })

    // 5) حذف الإذن (سجل الحالات يتساقط تلقائيًا، وسطور القيود تفقد الربط — القيود تبقى للتدقيق)
    await tx.shipment.delete({ where: { id } })

    await logAudit(tx, {
      action: 'delete', entity: 'delivery_receipt', entityId: id,
      notes: `حذف إذن التسليم ${s.deliveryNumber ?? s.shipmentNo ?? ''} — الشحنة ${s.shipmentNo ?? ''} — المقاول: ${s.contractor?.name ?? ''}${reversalNos.length ? ` — عكس القيود: ${reversalNos.join('، ')}` : ''}${extras.filter((e) => e.approvalStatus !== 'approved').length ? ` — حذف ${extras.filter((e) => e.approvalStatus !== 'approved').length} بند معلق` : ''}`,
      user: { userId: user.userId, username: user.username },
      before: { deliveryNumber: s.deliveryNumber, shipmentNo: s.shipmentNo, status: s.status, freightCost: s.freightCost, freightTotal: s.freightTotal, extrasDeleted: extras.length },
    })
  })
  return { ok: true }
}
