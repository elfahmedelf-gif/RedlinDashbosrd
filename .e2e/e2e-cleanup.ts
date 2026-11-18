// ============================================================================
// E2E Cleanup — removes ALL temporary test records created during the E2E run
// (including leftovers from earlier failed runs) so the DB stays clean & balanced.
// Only touches records tagged E2E (deliveryNumber prefix / notes containing E2E /
// usernames & roles named e2e_*). All JE deletions remove posted+reversal pairs
// together, keeping the ledger balanced.
// Usage: bun .e2e/e2e-cleanup.ts
// ============================================================================
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const round2 = (n: number) => Math.round(n * 100) / 100

async function trialBalanceDirect() {
  const g = await db.journalLine.groupBy({
    by: ['accountId'],
    where: { entry: { status: 'posted' } },
    _sum: { debit: true, credit: true },
  })
  const totalDebit = round2(g.reduce((s, x) => s + (x._sum.debit ?? 0), 0))
  const totalCredit = round2(g.reduce((s, x) => s + (x._sum.credit ?? 0), 0))
  return { totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.005 }
}

/** delete a set of journal entries safely: reversals first, then originals */
async function deleteJournalEntries(ids: string[]) {
  if (!ids.length) return 0
  // delete reversals that reference these entries
  await db.journalEntry.deleteMany({ where: { reversalOfId: { in: ids } } })
  // also include the reversal ids themselves
  const revs = await db.journalEntry.findMany({ where: { reversalOfId: { in: ids } }, select: { id: true } })
  const all = [...new Set([...ids, ...revs.map((r) => r.id)])]
  // detach opVouchers pointing at these entries
  await db.opVoucher.updateMany({ where: { journalEntryId: { in: all } }, data: { journalEntryId: null } })
  // detach invoices pointing at these entries
  await db.invoice.updateMany({ where: { journalEntryId: { in: all } }, data: { journalEntryId: null } })
  // detach extras pointing at these entries
  await db.extraCost.updateMany({ where: { journalEntryId: { in: all } }, data: { journalEntryId: null } })
  const res = await db.journalEntry.deleteMany({ where: { id: { in: all } } })
  return res.count
}

async function main() {
  console.log('=== E2E CLEANUP START ===')
  const before = await trialBalanceDirect()
  console.log('before:', JSON.stringify(before))

  // 1) collect E2E shipments (deliveryNumber prefix E2E- or destination/notes contain E2E)
  const e2eShipments = await db.shipment.findMany({
    where: {
      OR: [
        { deliveryNumber: { startsWith: 'E2E-' } },
        { destination: { contains: 'E2E' } },
        { notes: { contains: 'E2E' } },
        { recipientName: { contains: 'E2E' } },
      ],
    },
    select: { id: true, shipmentNo: true, deliveryNumber: true },
  })
  const shipIds = e2eShipments.map((s) => s.id)
  console.log(`E2E shipments: ${e2eShipments.length}`, e2eShipments.map((s) => s.deliveryNumber ?? s.shipmentNo).join(', '))

  // 2) E2E invoices (notes contain E2E)
  const e2eInvoices = await db.invoice.findMany({
    where: { OR: [{ notes: { contains: 'E2E' } }, { cancelReason: { contains: 'E2E' } }] },
    select: { id: true, invoiceNumber: true, status: true },
  })
  console.log(`E2E invoices: ${e2eInvoices.length}`, e2eInvoices.map((v) => `${v.invoiceNumber}(${v.status})`).join(', '))

  // 3) E2E extras (notes contain E2E)
  const e2eExtras = await db.extraCost.findMany({
    where: { notes: { contains: 'E2E' } },
    select: { id: true, ref: true, type: true, amount: true, approvalStatus: true, journalEntryId: true },
  })
  console.log(`E2E extras: ${e2eExtras.length}`, e2eExtras.map((e) => `${e.ref}:${e.type}:${e.amount}:${e.approvalStatus}`).join(', '))

  // 4) E2E payment vouchers (contractor payments + any opVoucher with E2E notes)
  const e2eVouchers = await db.opVoucher.findMany({
    where: { OR: [{ notes: { contains: 'E2E' } }, { actions: { some: { notes: { contains: 'E2E' } } } }] },
    select: { id: true, voucherNo: true, type: true, status: true, journalEntryId: true },
  })
  console.log(`E2E vouchers: ${e2eVouchers.length}`, e2eVouchers.map((v) => `${v.voucherNo}(${v.status})`).join(', '))

  // 5) E2E roles/users
  const e2eRoles = await db.role.findMany({ where: { OR: [{ name: { startsWith: 'e2e_' } }, { label: { contains: 'اختبار' } }] }, select: { id: true, name: true } })
  const e2eUsers = await db.user.findMany({ where: { username: { startsWith: 'e2e_' } }, select: { id: true, username: true } })
  console.log(`E2E roles: ${e2eRoles.map((r) => r.name).join(', ') || '—'} | users: ${e2eUsers.map((u) => u.username).join(', ') || '—'}`)

  // ---- gather journal entries tied to all of the above ----
  const jeIds = new Set<string>()
  const collect = (rows: { journalEntryId: string | null }[]) => {
    for (const r of rows) if (r.journalEntryId) jeIds.add(r.journalEntryId)
  }
  collect(e2eExtras)
  collect(e2eVouchers)
  // JEs whose sourceType/sourceId reference E2E entities
  for (const s of e2eShipments) {
    const rows = await db.journalEntry.findMany({ where: { sourceId: s.id, sourceType: { in: ['shipment_delivery', 'shipment_cost', 'shipment_return_reversal'] } }, select: { id: true } })
    rows.forEach((r) => jeIds.add(r.id))
  }
  for (const v of e2eInvoices) {
    const rows = await db.journalEntry.findMany({ where: { sourceId: v.id, sourceType: 'invoice' }, select: { id: true } })
    rows.forEach((r) => jeIds.add(r.id))
  }
  // JEs with lines referencing E2E shipments (captures reversals which lose sourceType linkage)
  if (shipIds.length) {
    const lines = await db.journalLine.findMany({ where: { shipmentId: { in: shipIds } }, select: { entryId: true } })
    lines.forEach((l) => jeIds.add(l.entryId))
  }
  // JEs referencing E2E invoices via invoice payments linkage (opVoucher already collected)
  // JEs whose description/reference mention E2E refs (delivery numbers, EC refs, INV numbers)
  const e2eRefs = [
    ...e2eShipments.map((s) => s.deliveryNumber ?? s.shipmentNo ?? ''),
    ...e2eShipments.map((s) => s.shipmentNo ?? ''),
    ...e2eExtras.map((e) => e.ref),
    ...e2eInvoices.map((v) => v.invoiceNumber),
  ].filter(Boolean)
  if (e2eRefs.length) {
    const rows = await db.journalEntry.findMany({
      where: {
        OR: e2eRefs.flatMap((r) => [{ reference: { contains: r } }, { description: { contains: r } }]),
      },
      select: { id: true },
    })
    rows.forEach((r) => jeIds.add(r.id))
  }
  // legacy manual test JEs from earlier sessions (اختبار آلي — قيد ترحيل TEST-E2E)
  const legacyTestJEs = await db.journalEntry.findMany({
    where: { OR: [{ description: { contains: 'TEST-E2E' } }, { description: { contains: 'اختبار آلي' } }] },
    select: { id: true },
  })
  legacyTestJEs.forEach((r) => jeIds.add(r.id))
  console.log(`legacy TEST-E2E manual JEs: ${legacyTestJEs.length}`)

  // final sweep: ANY journal entry whose text mentions E2E (catches JEs of entities
  // deleted mid-test and cancelled vouchers whose journalEntryId was detached on reversal)
  const textSweep = await db.journalEntry.findMany({
    where: { OR: [{ description: { contains: 'E2E' } }, { reference: { contains: 'E2E' } }] },
    select: { id: true },
  })
  textSweep.forEach((r) => jeIds.add(r.id))
  console.log(`text-sweep E2E JEs: ${textSweep.length}`)

  console.log(`Journal entries to delete: ${jeIds.size}`)

  // ---- perform deletions in safe order (inside a transaction) ----
  await db.$transaction(async (tx) => {
    // a) delete invoice items of E2E invoices + the invoices
    for (const v of e2eInvoices) {
      await tx.invoiceItem.deleteMany({ where: { invoiceId: v.id } })
      await tx.invoice.delete({ where: { id: v.id } }).catch(() => {})
    }
    // b) delete extras (their JEs deleted later in bulk)
    for (const e of e2eExtras) {
      await tx.extraCost.delete({ where: { id: e.id } }).catch(() => {})
    }
    // c) delete opVoucher actions & items & vouchers (E2E)
    for (const v of e2eVouchers) {
      await tx.opVoucher.delete({ where: { id: v.id } }).catch(() => {})
    }
    // d) delete shipments (statusHistory & voucherItems cascade or manual)
    for (const s of e2eShipments) {
      await tx.shipmentStatusHistory.deleteMany({ where: { shipmentId: s.id } })
      await tx.opVoucherItem.deleteMany({ where: { shipmentId: s.id } })
      await tx.invoiceItem.deleteMany({ where: { shipmentId: s.id } })
      await tx.extraCost.deleteMany({ where: { shipmentId: s.id, notes: { contains: 'E2E' } } })
      await tx.shipment.delete({ where: { id: s.id } }).catch(() => {})
    }
    // e) delete E2E users (sessions & userRoles cascade) then roles
    for (const u of e2eUsers) {
      await tx.userSession.deleteMany({ where: { userId: u.id } })
      await tx.userRole.deleteMany({ where: { userId: u.id } })
      await tx.user.delete({ where: { id: u.id } }).catch(() => {})
    }
    for (const r of e2eRoles) {
      await tx.userRole.deleteMany({ where: { roleId: r.id } })
      await tx.role.delete({ where: { id: r.id } }).catch(() => {})
    }
    // f) delete E2E audit logs (entityId in deleted ids OR notes mention E2E)
    await tx.auditLog.deleteMany({
      where: {
        OR: [
          { notes: { contains: 'E2E' } },
          { entityId: { in: [...shipIds, ...e2eInvoices.map((v) => v.id), ...e2eExtras.map((e) => e.id), ...e2eVouchers.map((v) => v.id)] } },
        ],
      },
    })
  })

  // g) journal entries (outside tx: includes reversals-first logic)
  const deletedJE = await deleteJournalEntries([...jeIds])
  console.log(`Deleted journal entries (incl. reversals): ${deletedJE}`)

  // h) legacy test artifacts from earlier sessions: parties named اختبار آلي / TEST-E2E
  //    + invoices tagged فاتورة اختبار آلي + their shipments & JEs
  const testParties = await db.party.findMany({
    where: { OR: [{ name: { contains: 'TEST-E2E' } }, { name: { contains: 'اختبار آلي' } }] },
    select: { id: true, name: true },
  })
  const testPartyIds = testParties.map((p) => p.id)
  const testInvoices = await db.invoice.findMany({
    where: { OR: [{ notes: { contains: 'اختبار آلي' } }, { customerId: { in: testPartyIds } }] },
    select: { id: true, invoiceNumber: true },
  })
  const testInvoicedShipmentIds = (await db.invoiceItem.findMany({ where: { invoiceId: { in: testInvoices.map((v) => v.id) } }, select: { shipmentId: true } })).map((r) => r.shipmentId).filter(Boolean) as string[]
  const testShips = await db.shipment.findMany({
    where: { OR: [{ customerId: { in: testPartyIds } }, { contractorId: { in: testPartyIds } }, { id: { in: testInvoicedShipmentIds } }] },
    select: { id: true, shipmentNo: true },
  })
  console.log(`legacy test parties: ${testParties.length} | test invoices: ${testInvoices.map((v) => v.invoiceNumber).join(',')} | their shipments: ${testShips.length}`)

  // JEs of test invoices + JE lines on test shipments/test parties
  const legacyJeIds = new Set<string>()
  for (const v of testInvoices) {
    const rows = await db.journalEntry.findMany({ where: { sourceId: v.id, sourceType: 'invoice' }, select: { id: true } })
    rows.forEach((r) => legacyJeIds.add(r.id))
  }
  if (testShips.length) {
    const lines = await db.journalLine.findMany({ where: { shipmentId: { in: testShips.map((s) => s.id) } }, select: { entryId: true } })
    lines.forEach((l) => legacyJeIds.add(l.entryId))
  }
  if (testPartyIds.length) {
    const lines = await db.journalLine.findMany({ where: { partyId: { in: testPartyIds } }, select: { entryId: true } })
    lines.forEach((l) => legacyJeIds.add(l.entryId))
  }
  // vouchers tied to test parties (collection/disbursement)
  const testVouchers = await db.opVoucher.findMany({ where: { OR: [{ partyId: { in: testPartyIds } }, { courierId: { in: testPartyIds } }] }, select: { id: true, journalEntryId: true } })
  testVouchers.forEach((v) => { if (v.journalEntryId) legacyJeIds.add(v.journalEntryId) })
  console.log(`legacy JEs: ${legacyJeIds.size} | test vouchers: ${testVouchers.length}`)

  await db.$transaction(async (tx) => {
    for (const v of testInvoices) {
      await tx.invoiceItem.deleteMany({ where: { invoiceId: v.id } })
      await tx.invoice.updateMany({ where: { id: v.id }, data: { journalEntryId: null } })
      await tx.invoice.delete({ where: { id: v.id } }).catch(() => {})
    }
    for (const s of testShips) {
      await tx.shipmentStatusHistory.deleteMany({ where: { shipmentId: s.id } })
      await tx.opVoucherItem.deleteMany({ where: { shipmentId: s.id } })
      await tx.invoiceItem.deleteMany({ where: { shipmentId: s.id } })
      await tx.extraCost.deleteMany({ where: { shipmentId: s.id } })
      await tx.shipment.delete({ where: { id: s.id } }).catch(() => {})
    }
    for (const v of testVouchers) {
      await tx.opVoucher.delete({ where: { id: v.id } }).catch(() => {})
    }
    // extras of test parties
    await tx.extraCost.deleteMany({ where: { contractorId: { in: testPartyIds } } })
    // audit logs referencing test parties
    await tx.auditLog.deleteMany({ where: { entityId: { in: [...testPartyIds, ...testInvoices.map((v) => v.id), ...testShips.map((s) => s.id), ...testVouchers.map((v) => v.id)] } } })
  })
  // delete their JEs FIRST (journalLine.partyId FK blocks party deletion otherwise)
  const legacyDeleted = await deleteJournalEntries([...legacyJeIds])
  console.log(`Deleted legacy JEs: ${legacyDeleted}`)
  // now the parties are unreferenced
  await db.$transaction(async (tx) => {
    for (const p of testParties) {
      await tx.party.delete({ where: { id: p.id } }).catch((e) => console.log('party delete failed:', p.name, String(e).slice(0, 120)))
    }
  })

  // final verification
  const after = await trialBalanceDirect()
  console.log('after:', JSON.stringify(after))

  // residual scan: anything E2E left?
  const residual = {
    shipments: await db.shipment.count({ where: { OR: [{ deliveryNumber: { startsWith: 'E2E-' } }, { destination: { contains: 'E2E' } }, { notes: { contains: 'E2E' } }] } }),
    invoices: await db.invoice.count({ where: { OR: [{ notes: { contains: 'E2E' } }, { cancelReason: { contains: 'E2E' } }] } }),
    extras: await db.extraCost.count({ where: { notes: { contains: 'E2E' } } }),
    vouchers: await db.opVoucher.count({ where: { notes: { contains: 'E2E' } } }),
    roles: await db.role.count({ where: { name: { startsWith: 'e2e_' } } }),
    users: await db.user.count({ where: { username: { startsWith: 'e2e_' } } }),
    orphanLines: await db.journalLine.count({ where: { shipmentId: { not: null }, shipment: null } }),
    e2eTextJEs: await db.journalEntry.count({ where: { OR: [{ description: { contains: 'E2E' } }, { reference: { contains: 'E2E' } }] } }),
    testParties: await db.party.count({ where: { OR: [{ name: { contains: 'TEST-E2E' } }, { name: { contains: 'اختبار آلي' } }] } }),
    testInvoices: await db.invoice.count({ where: { notes: { contains: 'اختبار آلي' } } }),
  }
  console.log('residual E2E records:', JSON.stringify(residual))

  const clean = Object.values(residual).every((v) => v === 0)
  console.log(`=== CLEANUP ${clean && after.balanced ? 'PASSED — DB clean & balanced' : 'REVIEW NEEDED'} ===`)
  await db.$disconnect()
  if (!(clean && after.balanced)) process.exit(2)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
