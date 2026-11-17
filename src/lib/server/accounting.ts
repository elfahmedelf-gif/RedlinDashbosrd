// ============================================================================
// محرك المحاسبة — قيد مزدوج صارم + ترحيل + عكس + إلغاء (داخل معاملات DB)
// كل الدوال تقبل Tx لتشغيلها داخل معاملة المتصل (ذرية كاملة)
// ============================================================================
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ApiError, round2 } from './http'
import { logAudit, nextSeq } from './audit'
import { matchPermission } from '../permissions'

type Tx = Prisma.TransactionClient

export interface JLineInput {
  accountId: string
  debit?: number
  credit?: number
  description?: string
  partyId?: string | null
  shipmentId?: string | null
  costCenterId?: string | null
}

export interface JUser { userId: string; username: string }

export interface CreateJournalOpts {
  date?: string | Date | null
  description: string
  reference?: string | null
  branchId?: string | null
  sourceType?: string | null
  sourceId?: string | null
  status?: 'draft' | 'posted'
  lines: JLineInput[]
  user: JUser
  /** منع تكرار الترحيل لنفس المصدر — يتحقق من قيد مرحّل سابق لنفس (sourceType, sourceId) */
  preventDuplicateSource?: boolean
  /** مع preventDuplicateSource: اسمح بالترحيل إذا كان القيد السابق معكوسًا بقيد عكسي (سيناريو عكس ثم إعادة إثبات) */
  allowIfReversed?: boolean
}

export const ACC = {
  CASH: '1101',          // الصندوق
  BANK: '1102',          // البنوك
  AR: '1103',            // العملاء (مدينون)
  INVENTORY: '1104',     // المخزون
  SUPPLIERS: '2101',     // الموردون
  CONTRACTORS: '2102',   // مقاولو النقل
  COURIER_CUSTODY: '2104', // عهد المندوبين (COD)
} as const

export async function accountByCode(tx: Tx, code: string) {
  const acc = await tx.account.findUnique({ where: { code } })
  if (!acc) throw new ApiError(500, `الحساب ${code} غير موجود في دليل الحسابات — راجع تهيئة النظام`)
  return acc
}

const EPS = 0.005

/** التحقق من صحة سطور القيد مزدوج الدقة */
async function validateLines(tx: Tx, lines: JLineInput[]) {
  const clean = lines
    .map((l) => ({
      ...l,
      debit: round2(Number(l.debit) || 0),
      credit: round2(Number(l.credit) || 0),
    }))
    .filter((l) => l.accountId && (l.debit > 0 || l.credit > 0))
  if (clean.length < 2) throw new ApiError(400, 'القيد يحتاج سطرين على الأقل (مدين ودائن)')
  for (const l of clean) {
    const acc = await tx.account.findUnique({ where: { id: l.accountId } })
    if (!acc) throw new ApiError(400, 'أحد سطور القيد يشير إلى حساب غير موجود')
    if (!acc.isDetail) throw new ApiError(400, `الحساب "${acc.name}" حساب رئيسي — استخدم حسابًا تفصيليًا`)
    if (!acc.active) throw new ApiError(400, `الحساب "${acc.name}" موقوف`)
    if (l.debit > 0 && l.credit > 0) {
      throw new ApiError(400, `سطر الحساب "${acc.name}" لا يمكن أن يكون مدينًا ودائنًا في نفس الوقت`)
    }
  }
  const totalDebit = round2(clean.reduce((s, l) => s + l.debit, 0))
  const totalCredit = round2(clean.reduce((s, l) => s + l.credit, 0))
  if (Math.abs(totalDebit - totalCredit) > EPS) {
    throw new ApiError(400, `القيد غير متوازن — إجمالي المدين ${totalDebit} ≠ إجمالي الدائن ${totalCredit}`)
  }
  return { clean, totalDebit, totalCredit }
}

/** إنشاء قيد — تحقق كامل + رقم تسلسلي + سطر مرتبط بالحساب/الطرف/الشحنة */
export async function createJournal(tx: Tx, opts: CreateJournalOpts) {
  if (opts.preventDuplicateSource && opts.sourceType && opts.sourceId) {
    const dup = await tx.journalEntry.findFirst({
      where: { sourceType: opts.sourceType, sourceId: opts.sourceId, status: 'posted', reversalOfId: null },
      select: { id: true, entryNo: true },
    })
    if (dup) {
      // إذا كان القيد السابق معكوسًا بقيد عكسي مرتبط — أثره ألغي ويجوز إعادة الإثبات
      const reversed = opts.allowIfReversed
        ? await tx.journalEntry.findUnique({ where: { reversalOfId: dup.id }, select: { id: true } })
        : null
      if (!reversed) throw new ApiError(409, `يوجد قيد مرحّل بالفعل لهذه العملية (${dup.entryNo}) — لا يمكن الترحيل مرتين`)
    }
  }
  const { clean, totalDebit, totalCredit } = await validateLines(tx, opts.lines)
  const n = await nextSeq(tx, 'journal')
  const entryNo = `JE-${String(n).padStart(4, '0')}`
  const status = opts.status === 'posted' ? 'posted' : 'draft'
  const entry = await tx.journalEntry.create({
    data: {
      entryNo,
      date: opts.date ? new Date(opts.date as any) : new Date(),
      description: opts.description,
      reference: opts.reference ?? null,
      branchId: opts.branchId ?? null,
      sourceType: opts.sourceType ?? null,
      sourceId: opts.sourceId ?? null,
      status,
      totalDebit,
      totalCredit,
      userId: opts.user.userId,
      userName: opts.user.username,
      postedAt: status === 'posted' ? new Date() : null,
      postedByUserName: status === 'posted' ? opts.user.username : null,
      lines: {
        create: clean.map((l) => ({
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
          description: l.description ?? null,
          partyId: l.partyId ?? null,
          shipmentId: l.shipmentId ?? null,
          costCenterId: l.costCenterId ?? null,
        })),
      },
    },
    include: { lines: { include: { account: true, party: true } } },
  })
  await logAudit(tx, {
    action: 'create', entity: 'journal_entry', entityId: entry.id,
    notes: `إنشاء قيد ${entryNo} — ${opts.description}`, user: opts.user,
    after: { entryNo, totalDebit, totalCredit, status },
  })
  return entry
}

/** ترحيل قيد مسودة — إعادة حساب الإجماليات + منع الترحيل المكرر */
export async function postJournal(tx: Tx, id: string, user: JUser) {
  const e = await tx.journalEntry.findUnique({ where: { id }, include: { lines: true } })
  if (!e) throw new ApiError(404, 'القيد غير موجود')
  if (e.status === 'posted') throw new ApiError(409, 'القيد مرحّل بالفعل — لا يمكن الترحيل مرتين')
  if (e.status === 'void') throw new ApiError(409, 'القيد ملغي — لا يمكن ترحيله')
  const { totalDebit, totalCredit } = await validateLines(
    tx,
    e.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description ?? '', partyId: l.partyId, shipmentId: l.shipmentId })),
  )
  const updated = await tx.journalEntry.update({
    where: { id },
    data: {
      status: 'posted',
      totalDebit,
      totalCredit,
      postedAt: new Date(),
      postedByUserId: user.userId,
      postedByUserName: user.username,
    },
  })
  await logAudit(tx, { action: 'post', entity: 'journal_entry', entityId: id, notes: `ترحيل قيد ${e.entryNo}`, user })
  return updated
}

/** قيد عكسي Reversal — ينعكس المدين/الدائن ويُرحّل تلقائيًا (مرتبط بالأصل)
 *  + يصحح الربط: إذا كان القيد الأصلي مرتبطًا بسند مالي (OpVoucher) يُفك الربط
 *  ويُسجل فعل "journal_reversed" على السند (كان العكس يترك السند يظهر كمحصّل) */
export async function reverseJournal(tx: Tx, id: string, user: JUser, reason?: string) {
  const e = await tx.journalEntry.findUnique({ where: { id }, include: { lines: true } })
  if (!e) throw new ApiError(404, 'القيد غير موجود')
  if (e.status !== 'posted') throw new ApiError(409, 'العكس متاح فقط للقيود المرحّلة')
  const existing = await tx.journalEntry.findUnique({ where: { reversalOfId: id } })
  if (existing) throw new ApiError(409, `تم عكس هذا القيد مسبقًا (${existing.entryNo}) — لا يمكن العكس مرتين`)
  const reversal = await createJournal(tx, {
    date: new Date(),
    description: `قيد عكسي للقيد ${e.entryNo}${reason ? ` — ${reason}` : ''}`,
    reference: `REV-${e.entryNo}`,
    branchId: e.branchId,
    sourceType: 'journal_reversal',
    sourceId: e.id,
    status: 'posted',
    user,
    lines: e.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.credit, // انعكاس تام
      credit: l.debit,
      description: l.description ?? undefined,
      partyId: l.partyId,
      shipmentId: l.shipmentId,
      costCenterId: l.costCenterId,
    })),
  })
  await tx.journalEntry.update({ where: { id: reversal.id }, data: { reversalOfId: id } })

  // تصحيح الربط مع الأذونات التشغيلية (sourceType=op_voucher)
  if (e.sourceType === 'op_voucher' && e.sourceId) {
    const voucher = await tx.opVoucher.findUnique({ where: { id: e.sourceId } })
    if (voucher && voucher.journalEntryId === id) {
      await tx.opVoucher.update({ where: { id: voucher.id }, data: { journalEntryId: null } })
      await tx.opVoucherAction.create({
        data: { voucherId: voucher.id, userId: user.userId, userName: user.username, action: 'journal_reversed', notes: `عكس القيد ${e.entryNo} بالقيد ${reversal.entryNo}${reason ? ` — ${reason}` : ''}` },
      })
    }
  }

  await logAudit(tx, { action: 'reverse', entity: 'journal_entry', entityId: id, notes: `عكس القيد ${e.entryNo} بالقيد ${reversal.entryNo}${reason ? ` — ${reason}` : ''}`, user })
  return reversal
}

/** إلغاء قيد مسودة (وليس مرحّلًا) */
export async function voidJournal(tx: Tx, id: string, user: JUser, reason?: string) {
  const e = await tx.journalEntry.findUnique({ where: { id } })
  if (!e) throw new ApiError(404, 'القيد غير موجود')
  if (e.status === 'posted') throw new ApiError(409, 'لا يمكن إلغاء قيد مرحّل — استخدم القيد العكسي')
  if (e.status === 'void') throw new ApiError(409, 'القيد ملغي بالفعل')
  await tx.journalEntry.update({ where: { id }, data: { status: 'void' } })
  await logAudit(tx, { action: 'void', entity: 'journal_entry', entityId: id, notes: `إلغاء قيد ${e.entryNo}${reason ? ` — ${reason}` : ''}`, user })
  return { ok: true }
}

/** حماية خادم لعمليات القيود حسب الصلاحية */
export function assertJournalPerm(user: { permissions: string[] }, action: 'create' | 'post' | 'reverse' | 'void') {
  const key = 'accounting.journal'
  if (!matchPermission(user.permissions, key)) {
    throw new ApiError(403, `غير مصرح — هذه العملية تتطلب صلاحية "${key}"`)
  }
}

/** أرصدة الحسابات من القيود المرحّلة فقط (تُستخدم للتقارير والأشجار) */
export async function accountBalancesMap(tx: Tx): Promise<Map<string, { debit: number; credit: number }>> {
  const grouped = await tx.journalLine.groupBy({
    by: ['accountId'],
    where: { entry: { status: 'posted' } },
    _sum: { debit: true, credit: true },
  })
  const map = new Map<string, { debit: number; credit: number }>()
  for (const g of grouped) {
    map.set(g.accountId, { debit: round2(g._sum.debit ?? 0), credit: round2(g._sum.credit ?? 0) })
  }
  return map
}

// ---------------------------------------------------------------------------
// تصنيف سطور دفتر المقاولين (2102) — متسق عبر كل الشاشات المشتقة
// (متابعة الإدارة / مستحقات المقاولين / كشف الحساب / التقرير الشهري)
// قاعدة العكس: القيد العكسي يُنسب لأثره الأصلي — عكس دفعة يخفض المسحوبات
// وعكس شغل/بند يخفض الشغل المعتمد، فلا يتضخم أي رقم بعد أي إرجاع.
// ---------------------------------------------------------------------------

export interface ContractorLedgerLine {
  partyId: string | null
  debit: number | null
  credit: number | null
  entry: { sourceType: string | null; sourceId: string | null }
}

export interface ContractorLedgerSummary {
  earnedFromLedger: number
  paidFromVouchers: number
  duesReduction: number
}

/** نوع المصدر الأصلي للقيود العكسية — عكس دفعة (op_voucher/manual) يختلف عن عكس شغل/بند */
export async function reversalOriginalSources(
  dbOrTx: Pick<typeof db, 'journalEntry'>,
  sourceIds: string[],
): Promise<Map<string, string | null>> {
  if (!sourceIds.length) return new Map()
  const rows = await dbOrTx.journalEntry.findMany({
    where: { id: { in: sourceIds } },
    select: { id: true, sourceType: true },
  })
  return new Map(rows.map((r) => [r.id, r.sourceType]))
}

export function summarizeContractorLedgerLines(
  lines: ContractorLedgerLine[],
  originalSources: Map<string, string | null>,
): Map<string, ContractorLedgerSummary> {
  const map = new Map<string, ContractorLedgerSummary>()
  for (const l of lines) {
    if (!l.partyId) continue
    const cur = map.get(l.partyId) ?? { earnedFromLedger: 0, paidFromVouchers: 0, duesReduction: 0 }
    const src = l.entry?.sourceType ?? 'manual'
    const debit = round2(l.debit ?? 0)
    const credit = round2(l.credit ?? 0)
    if (src === 'journal_reversal') {
      const originalSrc = (l.entry.sourceId && originalSources.get(l.entry.sourceId)) ?? null
      if (originalSrc === 'op_voucher' || originalSrc === 'manual') {
        // عكس دفعة/سند صرف — يخفض المسحوبات (وليس الشغل)
        cur.paidFromVouchers = round2(cur.paidFromVouchers + debit - credit)
      } else {
        // عكس شغل/بند معتمد — يخفض الشغل المعتمد
        cur.duesReduction = round2(cur.duesReduction + debit - credit)
      }
    } else {
      if (credit > 0) cur.earnedFromLedger = round2(cur.earnedFromLedger + credit)
      if (src === 'op_voucher' || src === 'manual') {
        cur.paidFromVouchers = round2(cur.paidFromVouchers + debit)
      } else if (debit > 0) {
        cur.duesReduction = round2(cur.duesReduction + debit)
      }
    }
    map.set(l.partyId, cur)
  }
  return map
}
