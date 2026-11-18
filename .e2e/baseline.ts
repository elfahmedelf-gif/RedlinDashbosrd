// E2E baseline snapshot — account balances + JE integrity
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

async function main() {
  const accounts = await db.account.findMany({ where: { isDetail: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } })
  const grouped = await db.journalLine.groupBy({
    by: ['accountId'],
    where: { entry: { status: 'posted' } },
    _sum: { debit: true, credit: true },
  })
  const map = new Map(grouped.map((g) => [g.accountId, { debit: g._sum.debit ?? 0, credit: g._sum.credit ?? 0 }]))
  const balances: Record<string, { debit: number; credit: number; balance: number }> = {}
  for (const a of accounts) {
    const b = map.get(a.id) ?? { debit: 0, credit: 0 }
    balances[a.code] = { debit: Math.round(b.debit * 100) / 100, credit: Math.round(b.credit * 100) / 100, balance: Math.round((b.debit - b.credit) * 100) / 100 }
  }
  const jes = await db.journalEntry.aggregate({ _count: { _all: true }, _sum: { totalDebit: true, totalCredit: true } })
  const posted = await db.journalEntry.count({ where: { status: 'posted' } })
  const drafts = await db.journalEntry.count({ where: { status: 'draft' } })
  const voided = await db.journalEntry.count({ where: { status: 'void' } })
  const shipments = await db.shipment.count()
  const invoices = await db.invoice.count()
  const extras = await db.extraCost.count()
  const vouchers = await db.opVoucher.count()
  const seqs = await db.seqCounter.findMany()
  const users = await db.userSession.count()

  const snapshot = {
    at: new Date().toISOString(),
    balances,
    journal: {
      total: jes._count._all,
      posted,
      drafts,
      voided,
      totalDebit: Math.round((jes._sum.totalDebit ?? 0) * 100) / 100,
      totalCredit: Math.round((jes._sum.totalCredit ?? 0) * 100) / 100,
    },
    counts: { shipments, invoices, extras, vouchers },
    seqCounters: Object.fromEntries(seqs.map((s) => [s.key, s.value])),
    sessions: users,
  }
  console.log(JSON.stringify(snapshot, null, 1))
}

main().finally(() => db.$disconnect())
