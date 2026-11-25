// ============================================================================
// محرك المصروفات العمومية والتشغيلية (مكتب/بوفية/أدوات/مشتريات...إلخ)
// مستقلة عن حساب المقاول — قيد مزدوج عند الإنشاء:
//   مدين حساب المصروف (accountId) / دائن الصندوق أو البنك (payAccountId)
// التعديل يُعكس القيد ويُعاد إثباته بالبيانات الجديدة (نفس محرك البنود الإضافية).
// الحذف يُعكس القيد ثم يحذف السجل. كل الدوال داخل db.$transaction (ذرية كاملة).
// ============================================================================
import type { Prisma } from '@prisma/client'
import { ApiError, num, round2 } from './http'
import { logAudit, nextSeq } from './audit'
import { ACC, accountByCode, createJournal, reverseJournal } from './accounting'
import { db } from '@/lib/db'

type Tx = Prisma.TransactionClient

interface JUser { userId: string; username: string }

export const OPEX_SOURCE = 'operating_expense'

// قائمة الأصناف المقبولة + تسمياتها العربية
export const OPEX_CATEGORIES = ['operating', 'general', 'other'] as const
type OpexCategory = (typeof OPEX_CATEGORIES)[number]

export function isKnownOpexCategory(c: string): c is OpexCategory {
  return (OPEX_CATEGORIES as readonly string[]).includes(c)
}

export function opexCategoryLabel(c: string | null | undefined): string {
  switch (c) {
    case 'operating': return 'مصروفات تشغيلية'
    case 'general': return 'مصروفات عمومية وإدارية'
    case 'other': return 'مصروفات أخرى'
    default: return 'مصروف'
  }
}

/** الحسابات الافتراضية لكل تصنيف — يُستخدم كاقتراح في النموذج */
export const OPEX_DEFAULT_ACCOUNT_CODE: Record<OpexCategory, string> = {
  operating: '5104',
  general: '5105',
  other: '5104',
}

const OE_INCLUDE = {
  account: { select: { id: true, code: true, name: true } },
  payAccount: { select: { id: true, code: true, name: true } },
  branch: { select: { id: true, name: true } },
  journalEntry: { select: { id: true, entryNo: true, status: true } },
} satisfies Prisma.OperatingExpenseInclude

export function enrichOperatingExpense(oe: Prisma.OperatingExpenseGetPayload<{ include: typeof OE_INCLUDE }>) {
  return {
    ...oe,
    categoryLabel: opexCategoryLabel(oe.category),
    account: oe.account ? { id: oe.account.id, code: oe.account.code, name: oe.account.name } : null,
    payAccount: oe.payAccount ? { id: oe.payAccount.id, code: oe.payAccount.code, name: oe.payAccount.name } : null,
    branch: oe.branch ? { id: oe.branch.id, name: oe.branch.name } : null,
    journalEntry: oe.journalEntry ? { id: oe.journalEntry.id, entryNo: oe.journalEntry.entryNo, status: oe.journalEntry.status } : null,
  }
}

/** ترحيل قيد المصروف — مدين المصروف / دائن الصندوق أو البنك (يُستدعى داخل معاملة المتصل) */
export async function postOperatingExpenseJournal(
  tx: Tx,
  oe: { id: string; ref: string; amount: number; date: Date; accountId: string; payAccountId: string | null; vendor: string | null; notes: string | null; branchId: string | null; journalEntryId?: string | null; account?: { code?: string | null; name?: string | null } | null; payAccount?: { code?: string | null; name?: string | null } | null },
  user: JUser,
): Promise<{ id: string; entryNo: string }> {
  if (oe.journalEntryId) {
    const existing = await tx.journalEntry.findUnique({ where: { id: oe.journalEntryId }, select: { entryNo: true } })
    throw new ApiError(409, `المصروف له قيد مرحّل بالفعل (${existing?.entryNo ?? '—'}) — لا يمكن الترحيل مرتين`)
  }
  const amount = round2(Number(oe.amount))
  if (amount <= 0) throw new ApiError(400, 'مبلغ المصروف يجب أن يكون أكبر من صفر')

  const expense = await tx.account.findUnique({ where: { id: oe.accountId } })
  if (!expense) throw new ApiError(400, 'حساب المصروف غير موجود')
  if (!expense.isDetail) throw new ApiError(400, `الحساب "${expense.name}" حساب رئيسي — استخدم حسابًا تفصيليًا`)
  if (!expense.active) throw new ApiError(400, `الحساب "${expense.name}" موقوف`)

  // الدائن: الصندوق/البنك — يُعتمد payAccountId أو الصندوق (1101) افتراضيًا
  let payAcc = oe.payAccountId ? await tx.account.findUnique({ where: { id: oe.payAccountId } }) : null
  if (!payAcc) {
    payAcc = await accountByCode(tx, ACC.CASH)
    oe = { ...oe, payAccountId: payAcc.id }
  }
  if (!payAcc.isDetail) throw new ApiError(400, `حساب الدفع "${payAcc.name}" حساب رئيسي — استخدم حسابًا تفصيليًا`)
  if (!payAcc.active) throw new ApiError(400, `حساب الدفع "${payAcc.name}" موقوف`)

  const vendorPart = oe.vendor ? ` — ${oe.vendor}` : ''
  const notesPart = oe.notes ? ` (${oe.notes})` : ''
  const desc = `مصروف ${opexCategoryLabel(undefined)} — ${expense.name}${vendorPart}${notesPart}`
  const entry = await createJournal(tx, {
    date: oe.date,
    description: desc,
    reference: oe.ref,
    branchId: oe.branchId ?? null,
    sourceType: OPEX_SOURCE,
    sourceId: oe.id,
    status: 'posted',
    lines: [
      { accountId: expense.id, debit: amount, credit: 0, description: `${expense.name}${vendorPart}`, costCenterId: null },
      { accountId: payAcc.id, debit: 0, credit: amount, description: `سداد مصروف (${oe.ref}) من ${payAcc.name}`, costCenterId: null },
    ],
    user,
    preventDuplicateSource: true,
    allowIfReversed: true,
  })
  await tx.operatingExpense.update({ where: { id: oe.id }, data: { payAccountId: payAcc.id, journalEntryId: entry.id } })
  return { id: entry.id, entryNo: entry.entryNo }
}

/** قائمة المصروفات — فلترة + ترقيم */
export async function listOperatingExpenses(q: URLSearchParams, user: { permissions: string[] } | null) {
  void user // الوصول للوحدة محجوز بـ opex.view على مستوى المسار — كل من يصل يرى المبالغ
  const category = q.get('category')
  const accountId = q.get('accountId')
  const branchId = q.get('branchId')
  const from = q.get('from')
  const to = q.get('to')
  const search = (q.get('q') ?? '').trim().toLowerCase()

  const where: Prisma.OperatingExpenseWhereInput = {}
  if (category && category !== 'all') where.category = category
  if (accountId && accountId !== 'all') where.accountId = accountId
  if (branchId && branchId !== 'all') where.branchId = branchId
  if (from || to) {
    where.date = {}
    if (from) (where.date as any).gte = new Date(from + 'T00:00:00')
    if (to) (where.date as any).lte = new Date(to + 'T23:59:59')
  }

  const rows = await db.operatingExpense.findMany({
    where,
    include: OE_INCLUDE,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  })

  let items = rows.map((r) => enrichOperatingExpense(r))
  if (search) {
    items = items.filter((oe: any) =>
      [oe.ref, oe.account?.name, oe.payAccount?.name, oe.vendor, oe.notes, oe.branch?.name, oe.categoryLabel]
        .some((f) => String(f ?? '').toLowerCase().includes(search)))
  }

  const page = Math.max(1, parseInt(q.get('page') || '1', 10))
  const pageSize = Math.min(500, Math.max(1, parseInt(q.get('pageSize') || '20', 10)))
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const p = Math.min(page, totalPages)
  const start = (p - 1) * pageSize

  const sumBy = (list: any[]) => round2(list.reduce((s, x) => s + Number(x.amount ?? 0), 0))
  const summary = {
    total: rows.length,
    totalAmount: sumBy(rows),
    byCategory: OPEX_CATEGORIES.map((c) => ({
      category: c,
      label: opexCategoryLabel(c),
      count: rows.filter((r) => r.category === c).length,
      amount: sumBy(rows.filter((r) => r.category === c)),
    })),
  }

  return { items: items.slice(start, start + pageSize), total, page: p, pageSize, totalPages, summary }
}

/** التحقق من حساب الدفع — يجب أن يكون صندوق/بنك (أصل متداول تفصيلي نشط) */
async function resolvePayAccount(tx: Tx, payAccountId: string | null | undefined) {
  if (!payAccountId) return null
  const acc = await tx.account.findUnique({ where: { id: payAccountId } })
  if (!acc) throw new ApiError(400, 'حساب الدفع غير موجود')
  if (!acc.isDetail) throw new ApiError(400, `حساب الدفع "${acc.name}" حساب رئيسي — اختر حسابًا تفصيليًا`)
  if (!acc.active) throw new ApiError(400, `حساب الدفع "${acc.name}" موقوف`)
  if (acc.type !== 'asset') throw new ApiError(400, `حساب الدفع "${acc.name}" ليس حساب أصل (صندوق/بنك)`)
  return acc
}

/** التحقق من حساب المصروف — يجب أن يكون مصروف تفصيلي نشط */
async function resolveExpenseAccount(tx: Tx, accountId: string) {
  const acc = await tx.account.findUnique({ where: { id: accountId } })
  if (!acc) throw new ApiError(400, 'حساب المصروف غير موجود')
  if (!acc.isDetail) throw new ApiError(400, `الحساب "${acc.name}" حساب رئيسي — استخدم حسابًا تفصيليًا`)
  if (!acc.active) throw new ApiError(400, `الحساب "${acc.name}" موقوف`)
  if (acc.type !== 'expense') throw new ApiError(400, `الحساب "${acc.name}" ليس حساب مصروف`)
  return acc
}

/** إنشاء مصروف — يُرحّل القيد المزدوج فورًا (مدين مصروف / دائن صندوق/بنك) */
export async function createOperatingExpense(user: { userId: string; username: string; permissions: string[] }, body: any) {
  const accountId = String(body.accountId ?? '').trim()
  const amount = round2(num(body.amount) ?? 0)
  const category = String(body.category ?? 'operating').trim()
  if (!accountId) throw new ApiError(400, 'حدد حساب المصروف')
  if (!isKnownOpexCategory(category)) throw new ApiError(400, 'تصنيف غير معروف — المسموح: تشغيلية / عمومية / أخرى')
  if (amount <= 0) throw new ApiError(400, 'أدخل مبلغًا صحيحًا أكبر من صفر')

  const date = body.date ? new Date(body.date) : new Date()
  if (isNaN(date.getTime())) throw new ApiError(400, 'تاريخ غير صالح')

  const result = await db.$transaction(async (tx) => {
    const expense = await resolveExpenseAccount(tx, accountId)
    const payAcc = await resolvePayAccount(tx, body.payAccountId ?? null)
    if (body.branchId) {
      const br = await tx.branch.findUnique({ where: { id: String(body.branchId) }, select: { id: true } })
      if (!br) throw new ApiError(400, 'الفرع المحدد غير موجود')
    }

    const n = await nextSeq(tx, 'opex')
    const ref = `OE-${String(n).padStart(4, '0')}`

    const oe = await tx.operatingExpense.create({
      data: {
        ref,
        date,
        accountId: expense.id,
        payAccountId: payAcc?.id ?? null,
        amount,
        category,
        vendor: body.vendor ? String(body.vendor).slice(0, 200) : null,
        notes: body.notes ? String(body.notes).slice(0, 500) : null,
        branchId: body.branchId || null,
        userId: user.userId,
        userName: user.username,
      },
      include: OE_INCLUDE,
    })

    const journal = await postOperatingExpenseJournal(
      tx,
      { ...oe, account: { code: expense.code, name: expense.name }, payAccount: payAcc ? { code: payAcc.code, name: payAcc.name } : null },
      { userId: user.userId, username: user.username },
    )

    await logAudit(tx, {
      action: 'create', entity: 'operating_expense', entityId: oe.id,
      notes: `تسجيل مصروف ${ref} — ${opexCategoryLabel(category)} — ${expense.name} — ${amount} ج.م — قيد ${journal.entryNo}`,
      user: { userId: user.userId, username: user.username },
      after: { ref, category, accountId: expense.id, payAccountId: payAcc?.id ?? null, amount, branchId: body.branchId ?? null, journalEntryNo: journal.entryNo },
    })
    return { oe, journal }
  })

  return {
    id: result.oe.id,
    ref: result.oe.ref,
    journalEntryNo: result.journal.entryNo,
  }
}

/** تعديل مصروف — يُعكس القيد القديم ويُعاد إثباته بالبيانات الجديدة */
export async function updateOperatingExpense(user: { userId: string; username: string }, id: string, body: any) {
  const result = await db.$transaction(async (tx) => {
    const oe = await tx.operatingExpense.findUnique({ where: { id }, include: OE_INCLUDE })
    if (!oe) throw new ApiError(404, 'المصروف غير موجود')

    const data: any = {}
    const notes: string[] = []

    if (body.amount !== undefined) {
      const amount = round2(num(body.amount) ?? 0)
      if (amount <= 0) throw new ApiError(400, 'أدخل مبلغًا صحيحًا أكبر من صفر')
      if (round2(oe.amount) !== amount) { data.amount = amount; notes.push(`المبلغ: ${oe.amount} ← ${amount}`) }
    }
    if (body.category !== undefined && body.category !== oe.category) {
      if (!isKnownOpexCategory(String(body.category))) throw new ApiError(400, 'تصنيف غير معروف')
      data.category = String(body.category)
      notes.push(`التصنيف: ${opexCategoryLabel(oe.category)} ← ${opexCategoryLabel(String(body.category))}`)
    }
    if (body.date !== undefined && body.date) {
      const d = new Date(body.date)
      if (!isNaN(d.getTime()) && d.toISOString().slice(0, 10) !== oe.date.toISOString().slice(0, 10)) { data.date = d; notes.push('تعديل التاريخ') }
    }
    if (body.accountId !== undefined && String(body.accountId) !== oe.accountId) {
      const acc = await resolveExpenseAccount(tx, String(body.accountId))
      data.accountId = acc.id
      notes.push(`حساب المصروف: ${oe.account?.name ?? ''} ← ${acc.name}`)
    }
    if (body.payAccountId !== undefined) {
      const payId = body.payAccountId ? String(body.payAccountId) : null
      if (payId !== oe.payAccountId) {
        const payAcc = await resolvePayAccount(tx, payId)
        data.payAccountId = payAcc?.id ?? null
        notes.push(`حساب الدفع: ${oe.payAccount?.name ?? 'الصندوق'} ← ${payAcc?.name ?? 'الصندوق'}`)
      }
    }
    if (body.vendor !== undefined) {
      const v = body.vendor ? String(body.vendor).slice(0, 200) : null
      if (v !== oe.vendor) { data.vendor = v; notes.push('تعديل المورد') }
    }
    if (body.notes !== undefined) {
      const v = body.notes ? String(body.notes).slice(0, 500) : null
      if (v !== oe.notes) { data.notes = v; notes.push('تعديل الملاحظات') }
    }
    if (body.branchId !== undefined) {
      const brId = body.branchId ? String(body.branchId) : null
      if (brId !== oe.branchId) {
        if (brId) {
          const br = await tx.branch.findUnique({ where: { id: brId }, select: { id: true } })
          if (!br) throw new ApiError(400, 'الفرع المحدد غير موجود')
        }
        data.branchId = brId
        notes.push('تعديل الفرع')
      }
    }

    if (!Object.keys(data).length) throw new ApiError(400, 'لا توجد حقول صالحة للتعديل')

    // المزامنة المحاسبية: عكس القيد القديم ثم إعادة إثباته بالبيانات الجديدة
    let reversalNo: string | null = null
    if (oe.journalEntryId) {
      const je = await tx.journalEntry.findUnique({ where: { id: oe.journalEntryId } })
      const jeActive = je && je.status === 'posted' && !(await tx.journalEntry.findUnique({ where: { reversalOfId: je.id }, select: { id: true } }))
      if (jeActive) {
        const reversal = await reverseJournal(tx, je.id, user, `تصحيح المصروف ${oe.ref} بعد التعديل`)
        reversalNo = reversal.entryNo
        data.journalEntryId = null
      }
    }

    const updated = await tx.operatingExpense.update({ where: { id }, data, include: OE_INCLUDE })

    let repostNo: string | null = null
    if (reversalNo) {
      const fresh = await tx.operatingExpense.findUnique({
        where: { id },
        include: { account: { select: { code: true, name: true } }, payAccount: { select: { code: true, name: true } } },
      })
      if (fresh) {
        const posted = await postOperatingExpenseJournal(tx, fresh, { userId: user.userId, username: user.username })
        repostNo = posted.entryNo
      }
    }

    await logAudit(tx, {
      action: 'update', entity: 'operating_expense', entityId: id,
      notes: `تعديل المصروف ${oe.ref} — ${notes.join('، ')}${reversalNo ? ` — عكس القيد ${reversalNo}` : ''}${repostNo ? ` — إعادة إثبات بالقيد ${repostNo}` : ''}`,
      user: { userId: user.userId, username: user.username },
      before: { amount: oe.amount, category: oe.category, accountId: oe.accountId, payAccountId: oe.payAccountId, date: oe.date, vendor: oe.vendor, notes: oe.notes, branchId: oe.branchId },
      after: { ...data, reversalNo, repostNo },
    })
    return { ref: oe.ref, reversalNo, repostNo }
  })
  return result
}

/** حذف مصروف — يُعكس القيد المرتبط ثم يُحذف السجل */
export async function deleteOperatingExpense(user: { userId: string; username: string }, id: string) {
  await db.$transaction(async (tx) => {
    const oe = await tx.operatingExpense.findUnique({ where: { id } })
    if (!oe) return

    let reversalNo: string | null = null
    if (oe.journalEntryId) {
      const je = await tx.journalEntry.findUnique({ where: { id: oe.journalEntryId } })
      if (je && je.status === 'posted') {
        const reversed = await tx.journalEntry.findUnique({ where: { reversalOfId: je.id }, select: { id: true } })
        if (!reversed) {
          const reversal = await reverseJournal(tx, je.id, user, `حذف المصروف ${oe.ref}`)
          reversalNo = reversal.entryNo
        }
      }
    }

    await tx.operatingExpense.delete({ where: { id } })
    await logAudit(tx, {
      action: 'delete', entity: 'operating_expense', entityId: id,
      notes: `حذف المصروف ${oe.ref} — ${oe.amount} ج.م${reversalNo ? ` — عكس القيد ${reversalNo}` : ''}`,
      user: { userId: user.userId, username: user.username },
      before: { ref: oe.ref, amount: oe.amount, category: oe.category, accountId: oe.accountId },
    })
  })
  return { ok: true }
}
