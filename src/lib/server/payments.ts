// ============================================================================
// دفعات وعهد المقاولين — تسجيل سريع بإثراء محاسبي فوري (بدون دورة حياة الأذونات)
// كل دفعة = إذن صرف نقدية مكتمل (cash_disbursement) + قيد مزدوج فوري:
//   مدين: مقاولو النقل (2102) — دائن: الصندوق (1101) أو البنك (1102)
// الارتداد: حذف الدفعة يعكس القيد تلقائيًا ويُلغي الإذن — الرصيد يبقى دقيقًا 100%
// في كشف الحساب ومتابعة الإدارة والتقرير الشهري (كلها مشتقة من دفتر الأستاذ).
// ============================================================================

import { ApiError, num, round2 } from '@/lib/server/http'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'
import { ACC, accountByCode, reverseJournal } from '@/lib/server/accounting'
import { nextVoucherNo, postFinancialVoucherJournal } from '@/lib/server/vouchers'
import type { SessionUser } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0]

/** طرق الدفع المدعومة — الصندوق (نقدي) أو البنك (تحويل) */
const PAY_METHODS: Record<string, { code: string; label: string }> = {
  cash: { code: ACC.CASH, label: 'نقدي من الصندوق' },
  bank: { code: ACC.BANK, label: 'تحويل بنكي' },
}

/** تسجيل دفعة/عهدة لمقاول — قيد فوري + إذن صرف مكتمل في معاملة واحدة */
export async function recordContractorPayment(user: SessionUser, body: any) {
  const contractorId = String(body.contractorId ?? '').trim()
  const amount = round2(num(body.amount) ?? 0)
  const method = String(body.method ?? 'cash').trim()
  if (!contractorId) throw new ApiError(400, 'اختيار المقاول مطلوب — لا توجد دفعة بدون مقاول')
  if (!(amount > 0)) throw new ApiError(400, 'أدخل مبلغًا صحيحًا أكبر من صفر')
  const methodDef = PAY_METHODS[method]
  if (!methodDef) throw new ApiError(400, 'طريقة الدفع غير معروفة — المسموح: نقدي أو بنكي')

  const result = await db.$transaction(async (tx) => {
    const contractor = await tx.party.findUnique({
      where: { id: contractorId },
      select: { id: true, name: true, isContractor: true, active: true },
    })
    if (!contractor) throw new ApiError(404, 'المقاول غير موجود')
    if (!contractor.isContractor) throw new ApiError(400, 'الطرف المحدد ليس مقاول نقل')
    if (!contractor.active) throw new ApiError(400, 'المقاول موقوف — فعّله أولًا')

    const cashAccount = await accountByCode(tx, methodDef.code)
    if (!cashAccount) throw new ApiError(500, `حساب ${method === 'bank' ? 'البنك (1102)' : 'الصندوق (1101)'} غير موجود في دليل الحسابات`)

    const voucherNo = await nextVoucherNo(tx, 'cash_disbursement')
    const notes = body.notes ? String(body.notes).slice(0, 300) : null
    const v = await tx.opVoucher.create({
      data: {
        voucherNo,
        type: 'cash_disbursement',
        status: 'completed',
        partyId: contractorId,
        amount,
        totalValue: amount,
        notes,
        accountName: methodDef.label,
        cashAccountId: cashAccount.id,
        userId: user.userId,
        userName: user.username,
        actions: {
          create: [
            { action: 'create', userId: user.userId, userName: user.username, notes: 'تسجيل دفعة سريعة للمقاول' },
            { action: 'submit', userId: user.userId, userName: user.username },
            { action: 'approve', userId: user.userId, userName: user.username, notes: 'اعتماد تلقائي — دفعة مباشرة' },
            { action: 'execute', userId: user.userId, userName: user.username },
            { action: 'complete', userId: user.userId, userName: user.username, notes: 'إكمال تلقائي مع القيد' },
          ],
        },
      },
    })

    // القيد المزدوج الفوري: مدين 2102 مقاولو النقل / دائن الصندوق أو البنك
    const je = await postFinancialVoucherJournal(tx, v.id, user)

    await logAudit(tx, {
      action: 'create', entity: 'contractor_payment', entityId: v.id,
      notes: `تسجيل دفعة/عهدة للمقاول ${contractor.name} — ${amount} ج.م (${methodDef.label}) — سند ${voucherNo} — قيد ${je?.entryNo ?? '—'}`,
      user: { userId: user.userId, username: user.username },
      after: { voucherNo, amount, contractorId, method, journalEntryNo: je?.entryNo ?? null, notes },
    })
    return { voucherNo, journalEntryNo: je?.entryNo ?? null, contractorName: contractor.name }
  })

  return result
}

/** قائمة دفعات/عهد المقاولين — من الأذونات المكتملة والملغاة (لعرض أثر العكس) */
export async function listContractorPayments(q: URLSearchParams, user: SessionUser) {
  void user
  const contractorId = q.get('contractorId') ?? ''
  const page = Math.max(1, Number(q.get('page') ?? 1) || 1)
  const pageSize = Math.min(100, Math.max(5, Number(q.get('pageSize') ?? 10) || 10))

  const where: any = { type: 'cash_disbursement' }
  if (contractorId && contractorId !== 'all') where.partyId = contractorId

  const [rows, total, summaryAgg] = await Promise.all([
    db.opVoucher.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, voucherNo: true, amount: true, notes: true, status: true,
        createdAt: true, partyId: true, journalEntryId: true, accountName: true,
        party: { select: { id: true, name: true, code: true } },
        journalEntry: { select: { entryNo: true, status: true } },
      },
    }),
    db.opVoucher.count({ where }),
    db.opVoucher.aggregate({ where: { ...where, status: 'completed' }, _sum: { amount: true }, _count: { _all: true } }),
  ])

  const items = rows.map((v) => ({
    id: v.id,
    voucherNo: v.voucherNo,
    contractorId: v.partyId,
    contractorName: v.party?.name ?? '—',
    contractorCode: v.party?.code ?? null,
    amount: v.amount,
    method: v.accountName ?? 'نقدي من الصندوق',
    notes: v.notes,
    status: v.status,
    // الحالة الفعلية للقيد: مكتمل = قيد حي، ملغي = قيد معكوس (لا يعد في الرصيد)
    effective: v.status === 'completed',
    journalEntryNo: v.journalEntry?.entryNo ?? null,
    journalEntryStatus: v.journalEntry?.status ?? null,
    date: v.createdAt,
  }))

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    summary: { totalPaid: round2(summaryAgg._sum.amount ?? 0), count: summaryAgg._count._all },
  }
}

/**
 * إرجاع/عكس دفعة مسجّلة — يعكس القيد المزدوج تلقائيًا (مدين الصندوق / دائن 2102)
 * ويُلغي الإذن — رصيد المقاول يرتد فورًا في كل الشاشات.
 */
export async function reverseContractorPayment(user: SessionUser, paymentId: string, body: any) {
  const reason = body?.reason ? String(body.reason).slice(0, 300) : 'إرجاع دفعة من شاشة المصاريف والبنود'
  const result = await db.$transaction(async (tx) => {
    const v = await tx.opVoucher.findUnique({
      where: { id: paymentId },
      include: { party: { select: { id: true, name: true } } },
    })
    if (!v) throw new ApiError(404, 'الدفعة غير موجودة')
    if (v.type !== 'cash_disbursement') throw new ApiError(400, 'السجل المحدد ليس دفعة لمقاول')
    if (v.status !== 'completed') throw new ApiError(409, 'الدفعة ملغاة أو معكوسة مسبقًا — لا يمكن الإرجاع مرتين')
    if (!v.journalEntryId) throw new ApiError(409, 'الدفعة مرتبطة بقيد محاسبي مفقود — راجع القيود اليومية')

    const reversal = await reverseJournal(tx, v.journalEntryId, user, reason)

    await tx.opVoucher.update({
      where: { id: v.id },
      data: {
        status: 'cancelled',
        updatedAt: new Date(),
        actions: { create: { action: 'cancel', userId: user.userId, userName: user.username, notes: `إرجاع الدفعة — عكس القيد ${reversal.entryNo}` } },
      },
    })

    await logAudit(tx, {
      action: 'reverse', entity: 'contractor_payment', entityId: v.id,
      notes: `إرجاع دفعة ${v.voucherNo} — ${v.party?.name ?? ''} — ${v.amount} ج.م — عكس بالقيد ${reversal.entryNo}`,
      user: { userId: user.userId, username: user.username },
      before: { voucherNo: v.voucherNo, amount: v.amount, status: 'completed' },
      after: { reversalNo: reversal.entryNo, reason },
    })
    return { voucherNo: v.voucherNo, reversalNo: reversal.entryNo, contractorName: v.party?.name ?? '' }
  })
  return result
}
