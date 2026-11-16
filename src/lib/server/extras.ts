// ============================================================================
// محرك البنود الإضافية على حساب المقاولين (تعتيق/مبيت/مرتجعات)
// قاعدة العمل الحاسمة: المبيت والمرتجعات لا تدخل مستحقات المقاول (2102)
// إلا بعد اعتماد الشركة — وعند الاعتماد يُرحّل قيد مزدوج مرة واحدة:
//   مدين تكلفة النقل (5101) / دائن مقاولو النقل (2102) — بمصدر وحيد
//   sourceType='extra_cost' + preventDuplicateSource لمنع الترحيل المزدوج.
// الاعتماد المرفوض بعد اعتماد سابق = قيد عكسي تلقائي (نفس محرك العكس).
// كل الدوال تعمل داخل معاملات db.$transaction (ذرية كاملة) + سجل تدقيق.
// ============================================================================
import type { Prisma } from '@prisma/client'
import { ApiError, num, readBody, round2 } from './http'
import { logAudit, nextSeq } from './audit'
import { ACC, accountByCode, createJournal, reverseJournal } from './accounting'
import { EXTRA_COST_SOURCE, extraCostTypeLabel, isKnownExtraCostType } from '../extra-cost-catalog'
import { canSeePrices } from './prices'
import { db } from '@/lib/db'

type Tx = Prisma.TransactionClient

interface JUser { userId: string; username: string }

const EC_INCLUDE = {
  contractor: { select: { id: true, name: true, code: true } },
  shipment: { select: { id: true, shipmentNo: true, deliveryNumber: true, destination: true, date: true } },
  journalEntry: { select: { id: true, entryNo: true, date: true, status: true } },
} satisfies Prisma.ExtraCostInclude

export function enrichExtraCost(ec: Prisma.ExtraCostGetPayload<{ include: typeof EC_INCLUDE }>, canPrices: boolean) {
  const base: any = {
    ...ec,
    contractor: ec.contractor ? { id: ec.contractor.id, name: ec.contractor.name, code: ec.contractor.code } : null,
    shipment: ec.shipment
      ? { id: ec.shipment.id, shipmentNo: ec.shipment.shipmentNo, deliveryNumber: ec.shipment.deliveryNumber, destination: ec.shipment.destination, date: ec.shipment.date }
      : null,
    journalEntry: ec.journalEntry ? { id: ec.journalEntry.id, entryNo: ec.journalEntry.entryNo, status: ec.journalEntry.status } : null,
  }
  if (!canPrices) base.amount = null
  return base
}

/** ترحيل قيد الاعتماد — مرة واحدة لكل بند (يُستدعى داخل معاملة المتصل) */
export async function postExtraCostJournal(
  tx: Tx,
  ec: { id: string; ref: string; type: string; amount: number; notes: string | null; contractorId: string; shipmentId: string | null; date: Date; journalEntryId?: string | null; contractor?: { name?: string | null } | null; shipment?: { shipmentNo?: string | null; deliveryNumber?: string | null } | null },
  user: JUser,
): Promise<{ id: string; entryNo: string }> {
  if (ec.journalEntryId) {
    const existing = await tx.journalEntry.findUnique({ where: { id: ec.journalEntryId }, select: { entryNo: true } })
    throw new ApiError(409, `البند له قيد مرحّل بالفعل (${existing?.entryNo ?? '—'}) — لا يمكن الترحيل مرتين`)
  }
  const dup = await tx.journalEntry.findFirst({
    where: { sourceType: EXTRA_COST_SOURCE, sourceId: ec.id, status: 'posted', reversalOfId: null },
    select: { id: true, entryNo: true },
  })
  if (dup) {
    // القيد السابق المعكوس بقيد عكسي = أثره ألغي — يجوز إعادة الإثبات (تصحيح بعد الاعتماد)
    const reversed = await tx.journalEntry.findUnique({ where: { reversalOfId: dup.id }, select: { id: true } })
    if (!reversed) throw new ApiError(409, `يوجد قيد مرحّل بالفعل لهذا البند (${dup.entryNo})`)
  }

  const amount = round2(Number(ec.amount))
  if (amount <= 0) throw new ApiError(400, 'مبلغ البند يجب أن يكون أكبر من صفر')

  const expense = await accountByCode(tx, '5101') // تكلفة النقل
  const contractors = await accountByCode(tx, ACC.CONTRACTORS) // 2102
  const desc = `بنود إضافية — ${extraCostTypeLabel(ec.type)} — ${ec.contractor?.name ?? 'مقاول'}${ec.shipment ? ` — شحنة ${ec.shipment.deliveryNumber ?? ec.shipment.shipmentNo ?? ''}` : ''}${ec.notes ? ` (${ec.notes})` : ''}`

  const entry = await createJournal(tx, {
    date: ec.date,
    description: desc,
    reference: ec.ref,
    sourceType: EXTRA_COST_SOURCE,
    sourceId: ec.id,
    status: 'posted',
    lines: [
      { accountId: expense.id, debit: amount, credit: 0, description: `${extraCostTypeLabel(ec.type)} — ${ec.contractor?.name ?? 'مقاول'}`, partyId: ec.contractorId, shipmentId: ec.shipmentId },
      { accountId: contractors.id, debit: 0, credit: amount, description: `مستحقات المقاول — ${extraCostTypeLabel(ec.type)} (${ec.ref})`, partyId: ec.contractorId, shipmentId: ec.shipmentId },
    ],
    user,
    preventDuplicateSource: true,
    allowIfReversed: true, // إعادة الإثبات بعد تصحيح بند معتمد (عكس ثم قيد جديد) مسموحة
  })
  await tx.extraCost.update({ where: { id: ec.id }, data: { journalEntryId: entry.id } })
  return { id: entry.id, entryNo: entry.entryNo }
}

/** قائمة البنود الإضافية — فلترة + ترقيم + إخفاء المبالغ لغير المصرح */
export async function listExtraCosts(q: URLSearchParams, user: { permissions: string[] } | null) {
  const canPrices = canSeePrices(user)
  const contractorId = q.get('contractorId')
  const type = q.get('type')
  const status = q.get('status')
  const shipmentId = q.get('shipmentId')
  const from = q.get('from')
  const to = q.get('to')
  const search = (q.get('q') ?? '').trim().toLowerCase()

  const where: Prisma.ExtraCostWhereInput = {}
  if (contractorId && contractorId !== 'all') where.contractorId = contractorId
  if (type && type !== 'all') where.type = type
  if (status && status !== 'all') where.approvalStatus = status
  if (shipmentId) where.shipmentId = shipmentId
  if (from || to) {
    where.date = {}
    if (from) (where.date as any).gte = new Date(from + 'T00:00:00')
    if (to) (where.date as any).lte = new Date(to + 'T23:59:59')
  }

  const rows = await db.extraCost.findMany({
    where,
    include: EC_INCLUDE,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  })

  let items = rows.map((r) => enrichExtraCost(r, canPrices))
  if (search) {
    items = items.filter((ec: any) =>
      [ec.ref, ec.contractor?.name, ec.notes, ec.shipment?.shipmentNo, ec.shipment?.deliveryNumber, ec.shipment?.destination]
        .some((f) => String(f ?? '').toLowerCase().includes(search)))
  }

  const page = Math.max(1, parseInt(q.get('page') || '1', 10))
  const pageSize = Math.min(500, Math.max(1, parseInt(q.get('pageSize') || '20', 10)))
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const p = Math.min(page, totalPages)
  const start = (p - 1) * pageSize

  // ملخصات سريعة (للشريط العلوي) — تُفرَّغ المبالغ لغير أصحاب الأسعار
  const sumBy = (list: any[]) => round2(list.reduce((s, x) => s + Number(x.amount ?? 0), 0))
  const approvedAll = rows.filter((r) => r.approvalStatus === 'approved')
  const pendingAll = rows.filter((r) => r.approvalStatus === 'pending')
  const summary = {
    total: rows.length,
    pending: { count: pendingAll.length, amount: canPrices ? sumBy(pendingAll) : 0 },
    approved: { count: approvedAll.length, amount: canPrices ? sumBy(approvedAll) : 0 },
    rejected: { count: rows.filter((r) => r.approvalStatus === 'rejected').length },
    byType: EXTRA_TYPE_KEYS.map((t) => ({
      type: t,
      pending: pendingAll.filter((r) => r.type === t).length,
      approved: approvedAll.filter((r) => r.type === t).length,
      approvedAmount: canPrices ? sumBy(approvedAll.filter((r) => r.type === t)) : 0,
    })),
  }

  return { items: items.slice(start, start + pageSize), total, page: p, pageSize, totalPages, summary }
}

const EXTRA_TYPE_KEYS = ['taateeq', 'mabeet', 'return']

async function resolveShipment(tx: Tx, shipmentId: string | null | undefined, contractorId: string) {
  if (!shipmentId) return null
  const s = await tx.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, shipmentNo: true, contractorId: true } })
  if (!s) throw new ApiError(400, 'الشحنة المحددة غير موجودة')
  if (s.contractorId !== contractorId) throw new ApiError(400, 'الشحنة المحددة مسندة لمقاول آخر — لا يمكن ربط البند بها')
  return s
}

/** إنشاء بند إضافي — التعتيق يُعتمد ويُرحّل تلقائيًا، المبيت/المرتجعات بانتظار الاعتماد */
export async function createExtraCost(user: { userId: string; username: string; permissions: string[] }, body: any) {
  const contractorId = String(body.contractorId ?? '').trim()
  const type = String(body.type ?? '').trim()
  const amount = round2(num(body.amount) ?? 0)
  if (!contractorId) throw new ApiError(400, 'حدد المقاول')
  if (!isKnownExtraCostType(type)) throw new ApiError(400, 'نوع بند غير معروف — المسموح: تعتيق / مبيت / مرتجعات')
  if (amount <= 0) throw new ApiError(400, 'أدخل مبلغًا صحيحًا أكبر من صفر')

  const date = body.date ? new Date(body.date) : new Date()

  const result = await db.$transaction(async (tx) => {
    const contractor = await tx.party.findUnique({ where: { id: contractorId }, select: { id: true, name: true, isContractor: true, active: true } })
    if (!contractor) throw new ApiError(404, 'المقاول غير موجود')
    if (!contractor.isContractor) throw new ApiError(400, 'الطرف المحدد ليس مقاول نقل')
    if (!contractor.active) throw new ApiError(400, 'المقاول موقوف — فعّله أولًا')

    await resolveShipment(tx, body.shipmentId, contractorId)

    const n = await nextSeq(tx, 'extra_cost')
    const ref = `EC-${String(n).padStart(4, '0')}`
    const autoApprove = type === 'taateeq'

    const ec = await tx.extraCost.create({
      data: {
        ref,
        type,
        amount,
        notes: body.notes ? String(body.notes).slice(0, 500) : null,
        approvalStatus: autoApprove ? 'approved' : 'pending',
        contractorId,
        shipmentId: body.shipmentId || null,
        date,
        userId: user.userId,
        userName: user.username,
        ...(autoApprove
          ? { approvalUserId: user.userId, approvalUserName: user.username, approvalAt: new Date(), approvalNotes: 'اعتماد تلقائي — بند تعتيق قياسي' }
          : {}),
      },
      include: EC_INCLUDE,
    })

    let journal: { id: string; entryNo: string } | null = null
    if (autoApprove) {
      journal = await postExtraCostJournal(tx, { ...ec, amount, contractor: { name: contractor.name } }, { userId: user.userId, username: user.username })
    }

    await logAudit(tx, {
      action: 'create', entity: 'extra_cost', entityId: ec.id,
      notes: `تسجيل بند إضافي ${ref} — ${extraCostTypeLabel(type)} — ${contractor.name} — ${amount} ج.م${autoApprove ? ` — قيد ${journal?.entryNo}` : ' — بانتظار اعتماد الشركة'}`,
      user: { userId: user.userId, username: user.username },
      after: { ref, type, amount, contractorId, shipmentId: body.shipmentId ?? null, approvalStatus: ec.approvalStatus },
    })
    return { ec, journal }
  })

  return {
    id: result.ec.id,
    ref: result.ec.ref,
    approvalStatus: result.ec.approvalStatus,
    journalEntryNo: result.journal?.entryNo ?? null,
  }
}

/**
 * تعديل بند إضافي — متزامن محاسبيًا:
 *   • المعلق (pending): تعديل حر للحقول
 *   • المعتمد (approved): تعديل المبلغ/النوع/المقاول/الشحنة/التاريخ يُعكس قيده تلقائيًا
 *     ثم يعاد إثباته بالبيانات الجديدة (الدفتر يبقى دقيقًا 100% في كل الشاشات)
 *   • المرفوض (rejected): لا يُعدّل — يُحذف ويُعاد تسجيله
 */
export async function updateExtraCost(user: { userId: string; username: string }, id: string, body: any) {
  const result = await db.$transaction(async (tx) => {
    const ec = await tx.extraCost.findUnique({ where: { id }, include: EC_INCLUDE })
    if (!ec) throw new ApiError(404, 'البند الإضافي غير موجود')
    if (ec.approvalStatus === 'rejected') {
      throw new ApiError(409, 'البند مرفوض — لا يُعدّل؛ احذفه وأعد تسجيله من جديد')
    }

    const approved = ec.approvalStatus === 'approved'
    const data: any = {}
    const notes: string[] = []

    if (body.amount !== undefined) {
      const amount = round2(num(body.amount) ?? 0)
      if (amount <= 0) throw new ApiError(400, 'أدخل مبلغًا صحيحًا أكبر من صفر')
      if (round2(ec.amount) !== amount) { data.amount = amount; notes.push(`المبلغ: ${ec.amount} ← ${amount}`) }
    }
    if (body.type !== undefined && body.type !== ec.type) {
      if (!isKnownExtraCostType(String(body.type))) throw new ApiError(400, 'نوع بند غير معروف')
      data.type = String(body.type)
      notes.push(`النوع: ${extraCostTypeLabel(ec.type)} ← ${extraCostTypeLabel(String(body.type))}`)
    }
    if (body.notes !== undefined) {
      const v = body.notes ? String(body.notes).slice(0, 500) : null
      if (v !== ec.notes) { data.notes = v; notes.push('تعديل الملاحظات') }
    }
    if (body.date !== undefined && body.date) {
      const d = new Date(body.date)
      if (!isNaN(d.getTime()) && d.toISOString().slice(0, 10) !== ec.date.toISOString().slice(0, 10)) { data.date = d; notes.push('تعديل التاريخ') }
    }
    if (body.contractorId !== undefined && String(body.contractorId) !== ec.contractorId) {
      const p = await tx.party.findUnique({ where: { id: String(body.contractorId) }, select: { id: true, name: true, isContractor: true } })
      if (!p) throw new ApiError(400, 'المقاول الجديد غير موجود')
      if (!p.isContractor) throw new ApiError(400, `«${p.name}» غير مسجل كمقاول`)
      data.contractorId = p.id
      notes.push(`المقاول: ${ec.contractor.name} ← ${p.name}`)
    }
    if (body.shipmentId !== undefined) {
      const shipmentId = body.shipmentId ? String(body.shipmentId) : null
      if (shipmentId !== ec.shipmentId) {
        await resolveShipment(tx, shipmentId, data.contractorId ?? ec.contractorId)
        data.shipmentId = shipmentId
        notes.push('تغيير الشحنة المرتبطة')
      }
    }

    if (!Object.keys(data).length) throw new ApiError(400, 'لا توجد حقول صالحة للتعديل')

    // المزامنة المحاسبية للبنود المعتمدة: عكس القيد قبل التعديل ثم إعادة إثباته بالبيانات الجديدة
    let reversalNo: string | null = null
    if (approved) {
      const financialChanged = data.amount !== undefined || data.type !== undefined || data.contractorId !== undefined || data.shipmentId !== undefined || data.date !== undefined
      if (financialChanged && ec.journalEntryId) {
        const je = await tx.journalEntry.findUnique({ where: { id: ec.journalEntryId } })
        const jeActive = je && je.status === 'posted' && !(await tx.journalEntry.findUnique({ where: { reversalOfId: je.id }, select: { id: true } }))
        if (jeActive) {
          const reversal = await reverseJournal(tx, je.id, user, `تصحيح البند ${ec.ref} (${extraCostTypeLabel(ec.type)}) بعد الاعتماد`)
          reversalNo = reversal.entryNo
          data.journalEntryId = null // يُعاد ربطه بالقيد الجديد عند إعادة الإثبات
        }
      }
    }

    const updated = await tx.extraCost.update({ where: { id }, data, include: EC_INCLUDE })

    // إعادة إثبات القيد بالبيانات الجديدة للبنود المعتمدة
    let repostNo: string | null = null
    if (reversalNo) {
      const fresh = await tx.extraCost.findUnique({ where: { id }, include: { contractor: { select: { name: true } }, shipment: { select: { shipmentNo: true, deliveryNumber: true } } } })
      if (fresh) {
        const posted = await postExtraCostJournal(tx, fresh, { userId: user.userId, username: user.username })
        repostNo = posted.entryNo
      }
    }

    await logAudit(tx, {
      action: 'update', entity: 'extra_cost', entityId: id,
      notes: `تعديل البند ${ec.ref} (${extraCostTypeLabel(ec.type)})${approved ? ' — بند معتمد' : ''} — ${notes.join('، ')}${reversalNo ? ` — عكس القيد ${reversalNo}` : ''}${repostNo ? ` — إعادة إثبات بالقيد ${repostNo}` : ''}`,
      user: { userId: user.userId, username: user.username },
      before: { amount: ec.amount, type: ec.type, notes: ec.notes, shipmentId: ec.shipmentId, contractorId: ec.contractorId, date: ec.date, approvalStatus: ec.approvalStatus },
      after: { ...data, reversalNo, repostNo },
    })
    return { ref: ec.ref, reversalNo, repostNo }
  })
  return result
}

/** اعتماد بند (مبيت/مرتجعات) — يُرحّل القيد المزدوج ويُضيف لمستحقات المقاول */
export async function approveExtraCost(user: { userId: string; username: string }, id: string, notes?: string) {
  const result = await db.$transaction(async (tx) => {
    const ec = await tx.extraCost.findUnique({ where: { id }, include: EC_INCLUDE })
    if (!ec) throw new ApiError(404, 'البند الإضافي غير موجود')
    if (ec.approvalStatus === 'approved') throw new ApiError(409, 'البند معتمد بالفعل')
    if (ec.approvalStatus === 'rejected') throw new ApiError(409, 'البند مرفوض — لا يمكن اعتماده (أنشئ بندًا جديدًا)')

    const journal = await postExtraCostJournal(tx, ec, { userId: user.userId, username: user.username })
    const updated = await tx.extraCost.update({
      where: { id },
      data: {
        approvalStatus: 'approved',
        approvalUserId: user.userId,
        approvalUserName: user.username,
        approvalAt: new Date(),
        approvalNotes: notes ? String(notes).slice(0, 500) : (ec.approvalNotes ?? null),
      },
      include: EC_INCLUDE,
    })
    await logAudit(tx, {
      action: 'approve', entity: 'extra_cost', entityId: id,
      notes: `اعتماد البند ${ec.ref} — ${extraCostTypeLabel(ec.type)} — ${ec.contractor.name} — ${ec.amount} ج.م — قيد ${journal.entryNo} (أُضيف لمستحقات المقاول)`,
      user: { userId: user.userId, username: user.username },
      before: { approvalStatus: 'pending' },
      after: { approvalStatus: 'approved', journalEntryNo: journal.entryNo },
    })
    return updated
  })
  return { id: result.id, ref: result.ref, approvalStatus: result.approvalStatus, journalEntryNo: result.journalEntry?.entryNo ?? null }
}

/** رفض بند — إذا كان معتمدًا سابقًا يُعكس قيده تلقائيًا (يرجع مستحق المقاول لخلف) */
export async function rejectExtraCost(user: { userId: string; username: string }, id: string, notes?: string) {
  const result = await db.$transaction(async (tx) => {
    const ec = await tx.extraCost.findUnique({ where: { id }, include: EC_INCLUDE })
    if (!ec) throw new ApiError(404, 'البند الإضافي غير موجود')
    if (ec.approvalStatus === 'rejected') throw new ApiError(409, 'البند مرفوض بالفعل')

    let reversalNo: string | null = null
    if (ec.approvalStatus === 'approved' && ec.journalEntryId) {
      const reversal = await reverseJournal(tx, ec.journalEntryId, { userId: user.userId, username: user.username }, `رفض بند ${ec.ref} بعد الاعتماد${notes ? ` — ${notes}` : ''}`)
      reversalNo = reversal.entryNo
    }

    const updated = await tx.extraCost.update({
      where: { id },
      data: {
        approvalStatus: 'rejected',
        approvalUserId: user.userId,
        approvalUserName: user.username,
        approvalAt: new Date(),
        approvalNotes: notes ? String(notes).slice(0, 500) : (ec.approvalNotes ?? null),
      },
      include: EC_INCLUDE,
    })
    await logAudit(tx, {
      action: 'reject', entity: 'extra_cost', entityId: id,
      notes: `رفض البند ${ec.ref} — ${extraCostTypeLabel(ec.type)} — ${ec.contractor.name}${reversalNo ? ` — عكس القيد بالقيد ${reversalNo}` : ' — لم يُرحّل سابقًا'}`,
      user: { userId: user.userId, username: user.username },
      before: { approvalStatus: ec.approvalStatus },
      after: { approvalStatus: 'rejected', reversalEntryNo: reversalNo },
    })
    void updated
    return { ref: ec.ref, reversalEntryNo: reversalNo }
  })
  return result
}

/** حذف بند — مسموح للبنود غير المعتمدة فقط (المعتمد يُرفض أولًا فيعكس قيده) */
export async function deleteExtraCost(user: { userId: string; username: string }, id: string) {
  await db.$transaction(async (tx) => {
    const ec = await tx.extraCost.findUnique({ where: { id } })
    if (!ec) return
    if (ec.approvalStatus === 'approved') {
      throw new ApiError(409, 'لا يمكن حذف بند معتمد ومُرحّل محاسبيًا — ارفضه أولًا (سيُعكس القيد تلقائيًا) ثم احذفه')
    }
    await tx.extraCost.delete({ where: { id } })
    await logAudit(tx, {
      action: 'delete', entity: 'extra_cost', entityId: id,
      notes: `حذف البند ${ec.ref} (${extraCostTypeLabel(ec.type)}) — ${ec.amount} ج.م`,
      user: { userId: user.userId, username: user.username },
      before: { ref: ec.ref, type: ec.type, amount: ec.amount, approvalStatus: ec.approvalStatus },
    })
  })
  return { ok: true }
}

void readBody
