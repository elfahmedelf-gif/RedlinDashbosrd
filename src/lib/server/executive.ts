// ============================================================================
// ملخص متابعة الإدارة التنفيذي — «افتح الموبايل من البيت واعرف الموقف»
// لكل مقاول: إجمالي الشغل المعتمد (قيد 2102 دائن + الافتتاحي) / المسحوبات
// (مدين) / المتبقي له — مشتق بالكامل من دفتر الأستاذ الفعلي حتى نهاية تاريخ
// محدد (بدون تكرار أي حساب موازٍ) + عدّادات أذونات التسليم المعلقة والبنود
// بانتظار الاعتماد + عدّادات شحنات اليوم.
// المبالغ تُفرَّغ لغير أصحاب prices.view (نفس سياسة النظام).
// ============================================================================
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { round2 } from './http'
import { ACC, reversalOriginalSources, summarizeContractorLedgerLines } from './accounting'
import { canSeePrices } from './prices'
import { dailyShipmentKpis } from './receipts'
import { RECEIPT_EXCLUDED_STATUSES } from '../extra-cost-catalog'

function endOfDay(dateISO: string | null | undefined) {
  const iso = dateISO && /^\d{4}-\d{2}-\d{2}$/.test(dateISO) ? dateISO : new Date().toISOString().slice(0, 10)
  return { iso, end: new Date(iso + 'T23:59:59.999') }
}

export async function executiveSummary(q: URLSearchParams, user?: { permissions: string[] } | null) {
  const canPrices = canSeePrices(user)
  const { iso: asOf, end } = endOfDay(q.get('asOf'))

  // دفتر اليوم حتى نهاية التاريخ المحدد + الشحنات اليومية + البنود المعلقة
  const [contractors, contractorsAcc, kpis, receiptGroups, extraGroups] = await Promise.all([
    db.party.findMany({
      where: { isContractor: true, active: true },
      select: { id: true, name: true, code: true, openingBalance: true, openingBalanceType: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.account.findUnique({ where: { code: ACC.CONTRACTORS }, select: { id: true } }),
    dailyShipmentKpis(asOf),
    db.shipment.groupBy({
      by: ['contractorId'],
      where: { contractorId: { not: null }, isReceiptDelivered: false, status: { notIn: [...RECEIPT_EXCLUDED_STATUSES] } },
      _count: { _all: true },
    }),
    db.extraCost.groupBy({
      by: ['contractorId'],
      where: { approvalStatus: 'pending' },
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ])

  const accId = contractorsAcc?.id
  // سطور 2102 لكل المقاولين حتى نهاية التاريخ — مع نوع المصدر لتمييز المسحوبات
  // الفعلية (سندات صرف) عن تخفيضات المستحقات (قيود عكسية للبنود المرفوعة)
  const ledgerRows = accId
    ? await db.journalLine.findMany({
        where: { accountId: accId, partyId: { in: contractors.map((c) => c.id) }, entry: { status: 'posted', date: { lte: end } } },
        select: { partyId: true, debit: true, credit: true, entry: { select: { sourceType: true, sourceId: true, reference: true } } },
      })
    : []
  // القيود العكسية تُنسب لأثرها الأصلي: عكس دفعة يخفض المسحوبات، وعكس شغل يخفض الشغل المعتمد
  const reversalSourceIds = ledgerRows
    .filter((l) => l.entry?.sourceType === 'journal_reversal' && l.entry?.sourceId)
    .map((l) => l.entry.sourceId as string)
  const originalSources = await reversalOriginalSources(db, [...new Set(reversalSourceIds)])
  const ledgerMap = summarizeContractorLedgerLines(ledgerRows, originalSources)
  const receiptsMap = new Map(receiptGroups.map((g) => [g.contractorId as string, g._count._all]))
  const extrasMap = new Map(extraGroups.map((g) => [g.contractorId as string, { count: g._count._all, amount: round2(g._sum.amount ?? 0) }]))

  const contractorsSummary = contractors.map((c) => {
    const led = ledgerMap.get(c.id) ?? { earnedFromLedger: 0, paidFromVouchers: 0, duesReduction: 0 }
    const openingSign = c.openingBalanceType === 'credit' ? -1 : 1
    const opening = round2(openingSign * Number(c.openingBalance ?? 0))
    // شغل معتمد (له) = دائن 2102 + افتتاحي دائن (رصيد سابق له) − تخفيضات المستحقات (عكس بنود)
    const earned = round2(led.earnedFromLedger + (opening < 0 ? -opening : 0) - led.duesReduction)
    // مسحوبات = سندات الصرف/القيد اليدوي مدين + افتتاحي مدين (عهد سابقة على العلاقة)
    const paid = round2(led.paidFromVouchers + (opening > 0 ? opening : 0))
    const remaining = round2(earned - paid)
    const extras = extrasMap.get(c.id) ?? { count: 0, amount: 0 }
    return {
      id: c.id,
      name: c.name,
      code: c.code,
      earned,
      paid,
      remaining,
      receiptsPending: receiptsMap.get(c.id) ?? 0,
      extrasPending: extras.count,
      extrasPendingAmount: extras.amount,
    }
  })

  const totals = {
    earned: round2(contractorsSummary.reduce((s, c) => s + c.earned, 0)),
    paid: round2(contractorsSummary.reduce((s, c) => s + c.paid, 0)),
    remaining: round2(contractorsSummary.reduce((s, c) => s + c.remaining, 0)),
    receiptsPending: contractorsSummary.reduce((s, c) => s + c.receiptsPending, 0),
    extrasPending: contractorsSummary.reduce((s, c) => s + c.extrasPending, 0),
  }

  const payload = { asOf, kpis, contractors: contractorsSummary, totals }
  if (canPrices) return payload

  // إفراغ المبالغ لغير أصحاب صلاحية الأسعار — الأعداد تبقى
  return {
    ...payload,
    contractors: payload.contractors.map((c) => ({ ...c, earned: 0, paid: 0, remaining: 0, extrasPendingAmount: 0 })),
    totals: { ...payload.totals, earned: 0, paid: 0, remaining: 0 },
  }
}

void ({} as Prisma.ShipmentWhereInput)
