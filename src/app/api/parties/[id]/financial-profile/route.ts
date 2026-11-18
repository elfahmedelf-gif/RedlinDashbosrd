import { ApiError, handle, round2 } from '@/lib/server/http'
import { requireUser } from '@/lib/server/session'
import { matchPermission, partyViewKeys } from '@/lib/permissions'
import { ensureSeeded } from '@/lib/server/seed'
import { db } from '@/lib/db'
import { canSeePrices } from '@/lib/server/prices'
import { extraCostTypeLabel } from '@/lib/extra-cost-catalog'

export const dynamic = 'force-dynamic'

/**
 * الملف المالي الشامل للطرف (عميل/مقاول/مورد) — نافذة واحدة تجمع كل ما يخصه ماليًا:
 *
 *  1) ما له / ما عليه بصيغة الأعمال + الرصيد الصافي (من حسابات التحكم الفرعية فقط):
 *     1103 العملاء + 2104 عهد المندوبين (مدينة) · 2101 الموردون + 2102 مقاولو النقل (دائنة)
 *  2) تكوين الرصيد لكل حساب + معلومات الإيراد/التكلفة/النقدية (لا تدخل الرصيد)
 *  3) سندات القبض والصرف المالية المرتبطة + القيد المحاسبي المرتبط بكل سند
 *  4) الأذونات التشغيلية بصفته مندوبًا (عهد/استلام/تسليم/مرتجع…)
 *  5) الشحنات كعميل وكـمقاول + حالة التحصيل + المستحقات المتبقية
 *  6) أعمار المديونية المتأخرة (شحنات مسلّمة غير محصّلة: 0-30/31-60/61-90/+90 يومًا)
 *  7) القيود المحاسبية المرتبطة بالطرف
 *  8) أحدث حركات كشف الحساب
 *
 * صلاحية العرض: parties.view — المبالغ تُفرَّغ لغير أصحاب prices.view (نفس سياسة القائمة).
 */

const FINANCIAL_TYPES = ['collection', 'cash_deposit', 'cash_disbursement', 'courier_settlement']
const CONTROL_CODES = ['1103', '2101', '2102', '2104']

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requireUser(req)
    const { id } = await params
    // صلاحية العرض حسب صفات الطرف الفعلية (عميل/مقاول/مورد) — المبالغ تُفرَّغ لغير أصحاب prices.view
    const flags = await db.party.findUnique({ where: { id }, select: { isCustomer: true, isContractor: true, isSupplier: true } })
    if (!flags) throw new ApiError(404, 'الطرف غير موجود')
    if (!partyViewKeys(flags).some((k) => matchPermission(user.permissions, k))) {
      throw new ApiError(403, `غير مصرح — هذه العملية تتطلب إحدى الصلاحيات: ${partyViewKeys(flags).map((k) => `"${k}"`).join(' أو ')}`)
    }
    const canPrices = canSeePrices(user)
    const q = new URL(req.url).searchParams
    const limit = Math.min(Math.max(Number(q.get('limit') ?? 30), 1), 100)

    const [party, controlAccounts] = await Promise.all([
      db.party.findUnique({
        where: { id },
        include: { branch: { select: { id: true, name: true } } },
      }),
      db.account.findMany({ where: { code: { in: CONTROL_CODES } }, select: { id: true } }),
    ])
    if (!party) throw new ApiError(404, 'الطرف غير موجود')
    const controlIds = controlAccounts.map((a) => a.id)

    // ------------------------------------------------------------------
    // 1) دفتر الأستاذ: تكوين الرصيد + معلومات الإيراد/التكلفة/النقدية
    // ------------------------------------------------------------------
    const [accounts, ledgerGroups] = await Promise.all([
      db.account.findMany({ select: { id: true, code: true, name: true } }),
      db.journalLine.groupBy({
        by: ['accountId'],
        where: { partyId: id, entry: { status: 'posted' } },
        _sum: { debit: true, credit: true },
      }),
    ])
    const accById = new Map(accounts.map((a) => [a.id, a]))
    const composition = ledgerGroups
      .map((g) => {
        const acc = accById.get(g.accountId)
        const debit = round2(g._sum.debit ?? 0)
        const credit = round2(g._sum.credit ?? 0)
        const code = acc?.code ?? ''
        return {
          accountId: g.accountId,
          code,
          name: acc?.name ?? 'حساب محذوف',
          // حسابات التحكم فقط تدخل «له/عليه» — الإيراد/المصروف/النقدية معلوماتية
          kind: code === '1103' || code === '2104'
            ? 'control_debit'
            : code === '2101' || code === '2102'
              ? 'control_credit'
              : code.startsWith('4') || code.startsWith('5')
                ? 'pl'
                : 'other',
          debit,
          credit,
          net: round2(debit - credit),
        }
      })
      .sort((a, b) => a.code.localeCompare(b.code))

    const byCode = (code: string) => composition.find((c) => c.code === code)?.net ?? 0
    const arNet = round2(byCode('1103'))                    // العملاء: موجب = مدين (عليه)
    const custodyNet = round2(byCode('2104'))               // عهد المندوبين: موجب = عهدة معه
    const contractorsNet = round2(-byCode('2102'))          // بطبيعة دائنة: موجب = له
    const suppliersNet = round2(-byCode('2101'))            // موجب = له

    const openingSign = party.openingBalanceType === 'credit' ? -1 : 1
    const opening = round2(openingSign * Number(party.openingBalance ?? 0))
    // الرصيد الصافي الحالي (مدين موجب / دائن سالب) — من حسابات التحكم فقط
    const current = round2(opening + arNet + custodyNet - contractorsNet - suppliersNet)
    // بصيغة الأعمال: ما عليه للشركة / ما له لدى الشركة
    const owedByParty = round2(
      Math.max(round2(arNet + custodyNet), 0) +
      Math.max(-contractorsNet, 0) +
      Math.max(-suppliersNet, 0) +
      Math.max(opening, 0),
    )
    const owedToParty = round2(
      Math.max(round2(-(arNet + custodyNet)), 0) +
      Math.max(contractorsNet, 0) +
      Math.max(suppliersNet, 0) +
      Math.max(-opening, 0),
    )
    const totalDebit = round2(ledgerGroups.reduce((s, g) => s + (g._sum.debit ?? 0), 0))
    const totalCredit = round2(ledgerGroups.reduce((s, g) => s + (g._sum.credit ?? 0), 0))
    const creditLimit = party.creditLimit ?? null
    const creditUsed = round2(Math.max(current, 0))
    const creditAvailable = creditLimit != null ? round2(creditLimit - creditUsed) : null

    // ------------------------------------------------------------------
    // 2) الشحنات كعميل وكـمقاول + حالة التحصيل
    // ------------------------------------------------------------------
    const [shipAggC, shipAggK, collectedAgg, uncollectedAgg, pendingAgg, shipRecent] = await Promise.all([
      db.shipment.aggregate({ where: { customerId: id }, _count: { _all: true }, _sum: { freightTotal: true, customerPay: true } }),
      db.shipment.aggregate({ where: { contractorId: id }, _count: { _all: true }, _sum: { totalSuppliers: true } }),
      db.shipment.aggregate({ where: { customerId: id, status: 'delivered', collectionStatus: 'collected' }, _count: { _all: true }, _sum: { freightTotal: true } }),
      db.shipment.aggregate({ where: { customerId: id, status: 'delivered', collectionStatus: 'uncollected' }, _count: { _all: true }, _sum: { freightTotal: true } }),
      db.shipment.aggregate({ where: { customerId: id, status: { not: 'delivered' } }, _count: { _all: true } }),
      db.shipment.findMany({
        where: { OR: [{ customerId: id }, { contractorId: id }] },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: limit,
        select: {
          id: true, shipmentNo: true, date: true, status: true, collectionStatus: true,
          destination: true, freightTotal: true, totalSuppliers: true, returns: true,
          actualDeliveryDate: true, customerId: true, contractorId: true,
          customer: { select: { id: true, name: true } },
          contractor: { select: { id: true, name: true } },
        },
      }),
    ])

    // ------------------------------------------------------------------
    // 3) أعمار المديونية المتأخرة — شحنات مسلّمة وغير محصّلة (للعميل)
    // ------------------------------------------------------------------
    const aged = uncollectedAgg._count._all > 0
      ? await db.shipment.findMany({
          where: { customerId: id, status: 'delivered', collectionStatus: 'uncollected', freightTotal: { gt: 0 } },
          select: { freightTotal: true, actualDeliveryDate: true, date: true, createdAt: true },
        })
      : []
    const now = Date.now()
    const ageDays = (s: { actualDeliveryDate: Date | null; date: Date | null; createdAt: Date }) => {
      const base = s.actualDeliveryDate ?? s.date ?? s.createdAt
      return Math.max(0, Math.floor((now - base.getTime()) / 86400000))
    }
    const bucketDefs = [
      { key: 'd0_30', label: 'حتى 30 يومًا', min: 0, max: 30 },
      { key: 'd31_60', label: '31 — 60 يومًا', min: 31, max: 60 },
      { key: 'd61_90', label: '61 — 90 يومًا', min: 61, max: 90 },
      { key: 'd90p', label: 'أكثر من 90 يومًا', min: 91, max: Number.POSITIVE_INFINITY },
    ]
    const agingBuckets = bucketDefs.map((b) => {
      const rows = aged.filter((s) => ageDays(s) >= b.min && ageDays(s) <= b.max)
      return { key: b.key, label: b.label, count: rows.length, amount: round2(rows.reduce((s2, r) => s2 + Number(r.freightTotal ?? 0), 0)) }
    })
    const overdueAmount = round2(aged.reduce((s, r) => s + Number(r.freightTotal ?? 0), 0))

    // ------------------------------------------------------------------
    // 4) السندات المالية + الأذونات التشغيلية بصفته مندوبًا
    // ------------------------------------------------------------------
    const [finVouchers, finGroups, courierVouchers, courierCount] = await Promise.all([
      db.opVoucher.findMany({
        where: { partyId: id, type: { in: FINANCIAL_TYPES } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          journalEntry: { select: { id: true, entryNo: true } },
          cashAccount: { select: { id: true, name: true } },
          items: { select: { shipment: { select: { shipmentNo: true } } } },
        },
      }),
      db.opVoucher.groupBy({ by: ['type', 'status'], where: { partyId: id, type: { in: FINANCIAL_TYPES } }, _count: { _all: true }, _sum: { amount: true } }),
      db.opVoucher.findMany({
        where: { courierId: id },
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 20),
        select: { id: true, voucherNo: true, type: true, status: true, createdAt: true, totalValue: true, notes: true },
      }),
      db.opVoucher.count({ where: { courierId: id } }),
    ])
    const sumByType = (type: string) => {
      const rows = finGroups.filter((g) => g.type === type)
      const count = rows.reduce((s, g) => s + g._count._all, 0)
      const completedRows = rows.filter((g) => g.status === 'completed')
      return {
        count,
        completedCount: completedRows.reduce((s, g) => s + g._count._all, 0),
        sum: round2(rows.reduce((s, g) => s + (g._sum.amount ?? 0), 0)),
        completedSum: round2(completedRows.reduce((s, g) => s + (g._sum.amount ?? 0), 0)),
      }
    }
    const received = sumByType('collection')                 // سندات قبض من الطرف
    const paid = sumByType('cash_disbursement')              // سندات صرف للطرف
    const financialTotal = round2(finGroups.reduce((s, g) => s + (g._sum.amount ?? 0), 0))

    // ------------------------------------------------------------------
    // 5) القيود المحاسبية المرتبطة بالطرف
    // ------------------------------------------------------------------
    const [journalEntries, journalCount] = await Promise.all([
      db.journalEntry.findMany({
        where: { lines: { some: { partyId: id } }, status: 'posted' },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: limit,
        select: {
          id: true, entryNo: true, date: true, description: true, reference: true, sourceType: true,
          totalDebit: true, totalCredit: true,
          lines: {
            where: { partyId: id },
            select: {
              id: true, debit: true, credit: true, description: true,
              account: { select: { code: true, name: true } },
              shipment: { select: { shipmentNo: true } },
            },
          },
        },
      }),
      db.journalEntry.count({ where: { lines: { some: { partyId: id } }, status: 'posted' } }),
    ])

    // ------------------------------------------------------------------
    // 6) أحدث حركات كشف الحساب (سطور حسابات التحكم فقط)
    // ------------------------------------------------------------------
    const ledgerRecent = await db.journalLine.findMany({
      where: { partyId: id, entry: { status: 'posted' }, accountId: { in: controlIds } },
      orderBy: [{ entry: { date: 'desc' } }, { id: 'desc' }],
      take: 12,
      include: {
        entry: { select: { entryNo: true, date: true, description: true, sourceType: true } },
        account: { select: { code: true, name: true } },
        shipment: { select: { shipmentNo: true } },
      },
    })

    // ------------------------------------------------------------------
    // 7) البنود الإضافية (تعتيق/مبيت/مرتجعات) — المعتمد داخل المستحقات محاسبيًا
    // ------------------------------------------------------------------
    const [extraGroups, extraRecent] = await Promise.all([
      db.extraCost.groupBy({ by: ['type', 'approvalStatus'], where: { contractorId: id }, _count: { _all: true }, _sum: { amount: true } }),
      db.extraCost.findMany({
        where: { contractorId: id },
        orderBy: { date: 'desc' },
        take: Math.min(limit, 20),
        include: { shipment: { select: { shipmentNo: true, deliveryNumber: true, destination: true } }, journalEntry: { select: { entryNo: true } } },
      }),
    ])
    const extrasByType = ['taateeq', 'mabeet', 'return'].map((t) => {
      const approved = extraGroups.find((g) => g.type === t && g.approvalStatus === 'approved')
      const pending = extraGroups.find((g) => g.type === t && g.approvalStatus === 'pending')
      const rejected = extraGroups.find((g) => g.type === t && g.approvalStatus === 'rejected')
      return {
        type: t,
        label: extraCostTypeLabel(t),
        approved: { count: approved?._count._all ?? 0, amount: round2(approved?._sum.amount ?? 0) },
        pending: { count: pending?._count._all ?? 0, amount: round2(pending?._sum.amount ?? 0) },
        rejected: { count: rejected?._count._all ?? 0 },
      }
    })
    const extrasSummary = {
      approvedAmount: round2(extrasByType.reduce((s, x) => s + x.approved.amount, 0)),
      approvedCount: extrasByType.reduce((s, x) => s + x.approved.count, 0),
      pendingAmount: round2(extrasByType.reduce((s, x) => s + x.pending.amount, 0)),
      pendingCount: extrasByType.reduce((s, x) => s + x.pending.count, 0),
      byType: extrasByType,
      items: extraRecent,
    }

    const shipmentsAsCustomer = {
      count: shipAggC._count._all,
      freightTotal: round2(shipAggC._sum.freightTotal ?? 0),
      customerPay: round2(shipAggC._sum.customerPay ?? 0),
      deliveredCollected: { count: collectedAgg._count._all, amount: round2(collectedAgg._sum.freightTotal ?? 0) },
      deliveredUncollected: { count: uncollectedAgg._count._all, amount: round2(uncollectedAgg._sum.freightTotal ?? 0) },
      pendingDelivery: pendingAgg._count._all,
    }
    const shipmentsAsContractor = {
      count: shipAggK._count._all,
      totalSuppliers: round2(shipAggK._sum.totalSuppliers ?? 0),
      // المتبقي له = المستحقات المُثبتة (دائن 2102) − ما صرف له فعليًا (مدين)
      due: round2(Math.max(contractorsNet, 0)),
      paid: round2(Math.max(-contractorsNet, 0)),
    }

    const payload = {
      party: {
        id: party.id, code: party.code, name: party.name, nameEn: party.nameEn,
        isCustomer: party.isCustomer, isContractor: party.isContractor, isSupplier: party.isSupplier,
        phone: party.phone, phones: party.phones, email: party.email, city: party.city, region: party.region,
        taxNumber: party.taxNumber, paymentTerms: party.paymentTerms, creditLimit,
        openingBalance: party.openingBalance, openingBalanceType: party.openingBalanceType,
        branch: party.branch, active: party.active, createdAt: party.createdAt,
      },
      balances: {
        opening, current, totalDebit, totalCredit,
        owedByParty, owedToParty,
        creditLimit, creditUsed, creditAvailable,
      },
      composition,
      shipments: { asCustomer: shipmentsAsCustomer, asContractor: shipmentsAsContractor, items: shipRecent },
      aging: { buckets: agingBuckets, overdueAmount, overdueCount: aged.length },
      vouchers: {
        received, paid, financialTotal,
        financialCount: finGroups.reduce((s, g) => s + g._count._all, 0),
        items: finVouchers,
        courierCount,
        courierItems: courierVouchers,
      },
      journal: { count: journalCount, items: journalEntries },
      ledgerRecent,
      extras: extrasSummary,
    }

    if (canPrices) return payload

    // إفراغ المبالغ لغير أصحاب صلاحية الأسعار — تبقى الأعداد والهيكل
    return {
      ...payload,
      party: { ...payload.party, openingBalance: 0, creditLimit: null },
      balances: { ...payload.balances, opening: 0, current: 0, totalDebit: 0, totalCredit: 0, owedByParty: 0, owedToParty: 0, creditUsed: 0, creditAvailable: null },
      composition: payload.composition.map((c) => ({ ...c, debit: 0, credit: 0, net: 0 })),
      shipments: {
        ...payload.shipments,
        asCustomer: {
          ...payload.shipments.asCustomer,
          freightTotal: 0, customerPay: 0,
          deliveredCollected: { ...payload.shipments.asCustomer.deliveredCollected, amount: 0 },
          deliveredUncollected: { ...payload.shipments.asCustomer.deliveredUncollected, amount: 0 },
        },
        asContractor: { ...payload.shipments.asContractor, totalSuppliers: 0, due: 0, paid: 0 },
        items: payload.shipments.items.map((s) => ({ ...s, freightTotal: null, totalSuppliers: null, returns: null })),
      },
      aging: { buckets: payload.aging.buckets.map((b) => ({ ...b, amount: 0 })), overdueAmount: 0, overdueCount: payload.aging.overdueCount },
      vouchers: {
        ...payload.vouchers,
        received: { ...payload.vouchers.received, sum: 0, completedSum: 0 },
        paid: { ...payload.vouchers.paid, sum: 0, completedSum: 0 },
        financialTotal: 0,
        items: payload.vouchers.items.map((v) => ({ ...v, amount: null, totalValue: 0 })),
        courierItems: payload.vouchers.courierItems.map((v) => ({ ...v, totalValue: 0 })),
      },
      journal: {
        ...payload.journal,
        items: payload.journal.items.map((e) => ({ ...e, totalDebit: 0, totalCredit: 0, lines: e.lines.map((l) => ({ ...l, debit: 0, credit: 0 })) })),
      },
      ledgerRecent: payload.ledgerRecent.map((l) => ({ ...l, debit: 0, credit: 0 })),
      extras: {
        ...payload.extras,
        approvedAmount: 0,
        pendingAmount: 0,
        byType: payload.extras.byType.map((t) => ({ ...t, approved: { ...t.approved, amount: 0 }, pending: { ...t.pending, amount: 0 } })),
        items: payload.extras.items.map((x) => ({ ...x, amount: null })),
      },
    }
  })
}
