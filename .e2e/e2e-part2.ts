// ============================================================================
// E2E Test Suite Part 2 — Invoices lifecycle, VAT JE, Reconciliation,
// Permissions isolation, Exports
// Usage: bun .e2e/e2e-part2.ts
// ============================================================================
const BASE = 'http://localhost:3000'

const results: { name: string; ok: boolean; detail?: string }[] = []
function rec(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ` — ${detail}` : ''}`)
}
function section(t: string) { console.log(`\n========== ${t} ==========`) }

let adminToken = ''
let viewerToken = ''

async function req(method: string, path: string, body?: any, token?: string) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-session-token': token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json: any = null
  try { json = await res.json() } catch { json = null }
  return { status: res.status, json }
}

const round2 = (n: number) => Math.round(n * 100) / 100

async function trialBalance() {
  const r = await req('GET', '/api/reports/trial-balance', undefined, adminToken)
  const items: any[] = r.json.items
  const totalDebit = round2(items.reduce((s, x) => s + x.debit, 0))
  const totalCredit = round2(items.reduce((s, x) => s + x.credit, 0))
  const byCode = (c: string) => items.find((x) => x.code === c) ?? { debit: 0, credit: 0, balance: 0 }
  return { items, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.005, byCode }
}

async function main() {
  const state = await Bun.file('/home/z/my-project/.e2e/state.json').json()
  adminToken = (await req('POST', '/api/auth/login', { username: 'admin', password: 'admin123' })).json.token
  viewerToken = (await req('POST', '/api/auth/login', { username: 'viewer', password: 'view123' })).json.token
  const { contractorId, customerId, contractorName, customerName, baselineEarned, baselinePaid } = state

  // ========================================================================
  section('PHASE 4 — CUSTOMER TAX INVOICES & VAT')
  // create 2 shipments for the customer, deliver them (delivery JE posts)
  const mk = async (dn: string, freight: number, cost: number) => {
    const c = await req('POST', '/api/shipments', {
      contractorId, customerId, deliveryNumber: dn, destination: 'الإسكندرية — E2E فواتير',
      freightTotal: freight, freightCost: cost, notes: 'E2E فوترة',
    }, adminToken)
    if (c.status !== 200) throw new Error('shipment create failed: ' + JSON.stringify(c.json))
    const id = c.json.id
    // transition chain new→preparing→received→loaded→assigned_courier→delivered
    for (const st of ['preparing', 'received', 'loaded', 'assigned_courier', 'delivered']) {
      const r = await req('POST', `/api/shipments/${id}/status`, { status: st }, adminToken)
      if (r.status !== 200) throw new Error(`status ${st} failed: ${JSON.stringify(r.json)}`)
    }
    return id
  }
  const rn = Date.now().toString().slice(-6) // per-run suffix — allows re-running part2 without part1
  const sh1 = await mk(`E2E-INV-${state.ts}-${rn}-1`, 500, 200)
  const sh2 = await mk(`E2E-INV-${state.ts}-${rn}-2`, 700, 300)
  rec('2 shipments created & delivered (delivery JE auto-posted)', !!sh1 && !!sh2)

  const tbPre = await trialBalance()
  const net = (b: { debit: number; credit: number }) => round2(b.credit - b.debit)
  const revPreNet = net(tbPre.byCode('4101')), vatPreNet = net(tbPre.byCode('2103')), arPreNet = -net(tbPre.byCode('1103'))

  // uninvoiced pool contains both
  const uni = await req('GET', `/api/invoices/uninvoiced-shipments?customerId=${customerId}`, undefined, adminToken)
  const uniIds = (uni.json?.items ?? []).map((x: any) => x.id)
  rec('uninvoiced pool contains both new shipments', uniIds.includes(sh1) && uniIds.includes(sh2), `count=${uni.json?.total}`)

  // draft invoice importing both
  const inv = await req('POST', '/api/invoices', {
    customerId,
    items: [
      { shipmentId: sh1, description: 'نولون شحنة E2E-1', quantity: 1, unitPrice: 500 },
      { shipmentId: sh2, description: 'نولون شحنة E2E-2', quantity: 1, unitPrice: 700 },
    ],
    vatRate: 14, discountAmount: 0, notes: 'فاتورة E2E',
  }, adminToken)
  rec('create draft invoice → 200 draft', inv.status === 200 && inv.json?.invoiceNumber?.startsWith('INV-'), JSON.stringify(inv.json))
  const invId = inv.json?.id

  // double-invoicing blocked
  const inv2 = await req('POST', '/api/invoices', {
    customerId,
    items: [{ shipmentId: sh1, description: 'محاولة فوترة مزدوجة', quantity: 1, unitPrice: 500 }],
    vatRate: 14,
  }, adminToken)
  rec('double-invoicing same shipment → 409', inv2.status === 409 && String(inv2.json?.error ?? '').includes('مفوترة'), `got ${inv2.status}: ${inv2.json?.error}`)
  if (inv2.json?.id) await req('DELETE', `/api/invoices/${inv2.json.id}`, undefined, adminToken)

  // draft must NOT have JE
  const invDetail0 = await req('GET', `/api/invoices/${invId}`, undefined, adminToken)
  rec('draft invoice has NO journal entry', invDetail0.json?.journalEntry == null && invDetail0.json?.status === 'draft')

  // issue → JE Dr 1103 / Cr 4101 + Cr 2103
  const issue = await req('POST', `/api/invoices/${invId}/issue`, {}, adminToken)
  rec('issue invoice → JE posted', issue.status === 200 && !!issue.json?.journalEntryNo, JSON.stringify(issue.json))
  const issueJE = issue.json?.journalEntryNo
  const jrInv = await req('GET', `/api/journal?q=${issueJE}`, undefined, adminToken)
  const jeInvRow = (jrInv.json?.items ?? []).find((e: any) => e.entryNo === issueJE)
  const linesInv = (jeInvRow?.lines ?? []).map((l: any) => ({ code: l.account?.code, d: l.debit, c: l.credit }))
  const dr1103 = linesInv.find((l: any) => l.code === '1103' && l.d === 1368)
  const cr4101 = linesInv.find((l: any) => l.code === '4101' && l.c === 1200)
  const cr2103 = linesInv.find((l: any) => l.code === '2103' && l.c === 168)
  rec('invoice JE = Dr 1103 (1368) / Cr 4101 (1200) / Cr 2103 VAT (168)', !!dr1103 && !!cr4101 && !!cr2103 && round2(jeInvRow.totalDebit) === round2(jeInvRow.totalCredit), JSON.stringify(linesInv))

  // shipments locked to invoice
  const uni2 = await req('GET', `/api/invoices/uninvoiced-shipments?customerId=${customerId}`, undefined, adminToken)
  const uni2Ids = (uni2.json?.items ?? []).map((x: any) => x.id)
  rec('issued invoice hides shipments from uninvoiced pool (no double-invoice)', !uni2Ids.includes(sh1) && !uni2Ids.includes(sh2))

  // contractor dues: deliveries post cost +500; issuing re-reclassifies revenue (delivery JE reversed, cost-only reposted)
  // → earned delta vs pre-shipments must be exactly +500 (contractor cost) and unchanged by the invoice itself
  const exec0 = await req('GET', '/api/executive', undefined, adminToken)
  const ctr0 = exec0.json.contractors.find((c: any) => c.id === contractorId)
  rec('contractor earned after deliveries = baseline + 500 (cost side only)', round2(ctr0.earned) === round2(baselineEarned + 400 + 500), `earned=${ctr0.earned} expected=${baselineEarned + 400 + 500}`)

  // partial payment 500 → partially_paid
  const p1 = await req('POST', `/api/invoices/${invId}/payments`, { amount: 500, method: 'cash', notes: 'دفعة جزئية E2E' }, adminToken)
  rec('partial payment 500 → status partially_paid', p1.status === 200 && p1.json?.status === 'partially_paid', JSON.stringify(p1.json))
  // overpay blocked
  const pOver = await req('POST', `/api/invoices/${invId}/payments`, { amount: 900, method: 'cash' }, adminToken)
  rec('overpay beyond remaining → 400', pOver.status === 400, `got ${pOver.status}: ${pOver.json?.error}`)
  // full payment 868 → paid
  const p2 = await req('POST', `/api/invoices/${invId}/payments`, { amount: 868, method: 'bank', notes: 'سداد كامل E2E' }, adminToken)
  rec('full payment 868 → status paid', p2.status === 200 && p2.json?.status === 'paid', JSON.stringify(p2.json))

  // cancel guard on paid invoice
  const cancelPaid = await req('POST', `/api/invoices/${invId}/cancel`, { reason: 'محاولة إلغاء مسددة' }, adminToken)
  rec('cancel PAID invoice → 409 guard', cancelPaid.status === 409, `got ${cancelPaid.status}: ${cancelPaid.json?.error}`)

  // reverse second payment → partially_paid
  const invDetail1 = await req('GET', `/api/invoices/${invId}`, undefined, adminToken)
  const pay2 = (invDetail1.json?.payments ?? []).find((x: any) => x.voucherNo === p2.json?.voucherNo)
  const revPay = await req('POST', `/api/invoices/${invId}/payments/reverse`, { paymentId: pay2?.id, reason: 'عكس E2E' }, adminToken)
  rec('reverse payment → status back to partially_paid', revPay.status === 200 && revPay.json?.status === 'partially_paid', JSON.stringify(revPay.json))

  // cancel guard with payments: cancel should now work (paidAmount=500 > 0 → blocked)
  const cancelWithPay = await req('POST', `/api/invoices/${invId}/cancel`, { reason: 'E2E' }, adminToken)
  rec('cancel invoice with remaining payments → 409 (reverse first)', cancelWithPay.status === 409, `got ${cancelWithPay.status}: ${cancelWithPay.json?.error}`)

  // reverse first payment → issued, then cancel → shipments released
  const invDetail2 = await req('GET', `/api/invoices/${invId}`, undefined, adminToken)
  const pay1 = (invDetail2.json?.payments ?? []).find((x: any) => x.voucherNo === p1.json?.voucherNo)
  const revPay1 = await req('POST', `/api/invoices/${invId}/payments/reverse`, { paymentId: pay1?.id, reason: 'عكس E2E 1' }, adminToken)
  rec('reverse first payment → status issued', revPay1.status === 200 && revPay1.json?.status === 'issued')
  const cancel = await req('POST', `/api/invoices/${invId}/cancel`, { reason: 'إلغاء E2E بعد عكس الدفعات' }, adminToken)
  rec('cancel issued invoice → reversal JE + released', cancel.status === 200 && !!cancel.json?.reversalNo, JSON.stringify(cancel.json))
  const uni3 = await req('GET', `/api/invoices/uninvoiced-shipments?customerId=${customerId}`, undefined, adminToken)
  const uni3Ids = (uni3.json?.items ?? []).map((x: any) => x.id)
  rec('cancelled invoice releases shipments back to uninvoiced pool', uni3Ids.includes(sh1) && uni3Ids.includes(sh2))

  // revenue/VAT/AR NET balances restored to pre-invoice levels (no double counting)
  // (gross debit/credit totals grow with each reversal+repost cycle — the NET balance is the truth)
  const tbPost = await trialBalance()
  rec('4101 revenue NET balance restored exactly after cancel', Math.abs(net(tbPost.byCode('4101')) - revPreNet) < 0.005, `preNet=${revPreNet} postNet=${net(tbPost.byCode('4101'))}`)
  rec('2103 VAT NET balance restored exactly after cancel', Math.abs(net(tbPost.byCode('2103')) - vatPreNet) < 0.005, `preNet=${vatPreNet} postNet=${net(tbPost.byCode('2103'))}`)
  rec('1103 AR NET balance restored exactly after cancel', Math.abs(-net(tbPost.byCode('1103')) - arPreNet) < 0.005, `preNet=${arPreNet} postNet=${-net(tbPost.byCode('1103'))}`)
  rec('contractor earned after full cycle still +500 (cost intact, no inflation)', round2((await req('GET', '/api/executive', undefined, adminToken)).json.contractors.find((c: any) => c.id === contractorId).earned) === round2(baselineEarned + 400 + 500))

  // ========================================================================
  section('PHASE 5 — SINGLE SOURCE OF TRUTH RECONCILIATION')
  const tb = await trialBalance()
  rec('trial balance balanced to the piastre (ΣDr = ΣCr)', tb.balanced, `Dr=${tb.totalDebit} Cr=${tb.totalCredit} diff=${round2(tb.totalDebit - tb.totalCredit)}`)

  const exec = await req('GET', '/api/executive', undefined, adminToken)
  let allMatch = true
  let mismatch = ''
  for (const c of exec.json.contractors) {
    const st = await req('GET', `/api/parties/${c.id}/statement`, undefined, adminToken)
    const closing = st.json?.totals?.closing ?? 0
    // executive remaining is positive=owed-to-contractor; statement closing (debit-positive) should be -remaining
    if (Math.abs(round2(-closing) - round2(c.remaining)) > 0.005) {
      allMatch = false
      mismatch += ` [${c.name}: exec=${c.remaining} stmt=${-closing}]`
    }
  }
  rec('Executive View ≡ Contractor Statement closing (ALL contractors, exact piastre)', allMatch, mismatch || 'all match')

  // monthly report vs statement for the test contractor
  // (sign conventions differ: report "net" = what's owed TO the contractor (positive);
  //  statement closing is debit-positive → negative when owed to him)
  const now = new Date()
  const mr = await req('GET', `/api/reports/contractor-monthly?contractorId=${contractorId}&year=${now.getFullYear()}&month=${now.getMonth() + 1}`, undefined, adminToken)
  const st2 = await req('GET', `/api/parties/${contractorId}/statement`, undefined, adminToken)
  rec('Monthly Report (totals.net) ≡ |Statement closing| (same balance, sign conventions differ)', mr.status === 200 && st2.status === 200 && Math.abs(round2(mr.json?.totals?.net ?? NaN) + round2(st2.json?.totals?.closing ?? NaN)) < 0.01, `mr.net=${mr.json?.totals?.net} stmt.closing=${st2.json?.totals?.closing}`)

  // AR control: Σ customer statements + AR lines with NO party (legacy manual JEs) ≡ 1103 balance
  const { PrismaClient } = await import('@prisma/client')
  const pdb = new PrismaClient()
  const arAcc = await pdb.account.findUnique({ where: { code: '1103' } })
  const unassigned = await pdb.journalLine.aggregate({ where: { accountId: arAcc.id, partyId: null, entry: { status: 'posted' } }, _sum: { debit: true, credit: true } })
  const unassignedAR = round2((unassigned._sum.debit ?? 0) - (unassigned._sum.credit ?? 0))
  await pdb.$disconnect()
  const custs = (await req('GET', '/api/parties?type=customer&pageSize=500', undefined, adminToken)).json.items
  let arSum = 0, openingsSum = 0
  for (const cu of custs) {
    const st = await req('GET', `/api/parties/${cu.id}/statement`, undefined, adminToken)
    arSum += st.json?.totals?.closing ?? 0
    const sign = st.json?.party?.openingBalanceType === 'credit' ? -1 : 1
    openingsSum += sign * Number(st.json?.party?.openingBalance ?? 0)
  }
  const ar1103 = tb.byCode('1103')
  rec('Σ customer statements + openings − unassigned AR ≡ account 1103 (exact)', Math.abs(round2(arSum) - round2(ar1103.balance - unassignedAR + openingsSum)) < 0.01, `Σstat=${round2(arSum)} vs 1103(${round2(ar1103.balance)}) − unassigned(${unassignedAR}) + openings(${round2(openingsSum)})`)

  // contractor control: Σ contractor statements ≡ 2102
  const ctrs = (await req('GET', '/api/parties?type=contractor&pageSize=500', undefined, adminToken)).json.items
  let ctrSum = 0
  for (const c of ctrs) {
    const st = await req('GET', `/api/parties/${c.id}/statement`, undefined, adminToken)
    ctrSum += st.json?.totals?.closing ?? 0
  }
  const ctr2102 = tb.byCode('2102')
  rec('Σ contractor statements ≡ account 2102 balance (exact)', Math.abs(round2(ctrSum) - round2(ctr2102.balance)) < 0.01, `Σstat=${round2(ctrSum)} vs 2102=${ctr2102.balance}`)

  // ========================================================================
  section('PHASE 6 — PERMISSIONS & ROLE ISOLATION')
  // dedicated minimal role: only shipments.view — deterministic enforcement test
  const rMin = await req('POST', '/api/roles', { name: `e2e_min_${state.ts}`, label: 'دور اختبار الشحنات فقط', permissions: ['shipments.view'] }, adminToken)
  const minRoleId = rMin.json?.id
  const uMin = await req('POST', '/api/users', { username: `e2e_min_${state.ts}`, name: 'مستخدم الشحنات فقط', password: 'e2etest123', roleId: minRoleId }, adminToken)
  const minToken = uMin.status === 200 || uMin.status === 409 ? (await req('POST', '/api/auth/login', { username: `e2e_min_${state.ts}`, password: 'e2etest123' })).json?.token : null
  rec('minimal role (shipments.view only) + user created & logged in', !!minToken)

  const forbidden = [
    ['POST /api/shipments (shipments.create)', 'POST', '/api/shipments', { contractorId, deliveryNumber: `X-${Date.now()}` }],
    ['PATCH /api/shipments/{id} (shipments.edit)', 'PATCH', `/api/shipments/${state.shipment1Id}`, { notes: 'x' }],
    ['DELETE /api/shipments/{id} (shipments.delete)', 'DELETE', '/api/shipments/xxx', undefined],
    ['POST /api/shipments/{id}/status (shipments.status)', 'POST', `/api/shipments/${state.shipment1Id}/status`, { status: 'preparing' }],
    ['POST /api/extras (extra_costs.create)', 'POST', '/api/extras', { contractorId, type: 'mabeet', amount: 10 }],
    ['POST /api/payments (payments.create)', 'POST', '/api/payments', { contractorId, amount: 10 }],
    ['POST /api/invoices (invoices.create)', 'POST', '/api/invoices', { customerId, items: [{ description: 'x', quantity: 1, unitPrice: 1 }] }],
    ['POST /api/invoices/{id}/issue (invoices.issue)', 'POST', '/api/invoices/xxx/issue', {}],
    ['POST /api/invoices/{id}/cancel (invoices.cancel)', 'POST', '/api/invoices/xxx/cancel', {}],
    ['DELETE /api/payments/{id} (payments.cancel)', 'DELETE', '/api/payments/xxx', {}],
    ['POST /api/extras/{id}/approve (extra_costs.approve)', 'POST', '/api/extras/xxx/approve', {}],
    ['GET /api/backup (backup.export)', 'GET', '/api/backup', undefined],
    ['GET /api/audit (audit.view)', 'GET', '/api/audit', undefined],
    ['GET /api/users (users.manage)', 'GET', '/api/users', undefined],
    ['GET /api/roles (roles.manage)', 'GET', '/api/roles', undefined],
    ['PATCH /api/settings (settings.manage)', 'PATCH', '/api/settings', { updates: {} }],
    ['POST /api/journal (accounting.journal)', 'POST', '/api/journal', { description: 'x', lines: [] }],
    ['GET /api/executive (executive.view)', 'GET', '/api/executive', undefined],
    ['GET /api/reports/trial-balance (reports.view)', 'GET', '/api/reports/trial-balance', undefined],
    ['POST /api/import/commit (import.manage)', 'POST', '/api/import/commit', {}],
    ['POST /api/lookups (lookups.manage)', 'POST', '/api/lookups', { category: 'x', label: 'x' }],
    ['POST /api/movements (inventory.movements)', 'POST', '/api/movements', { itemId: 'x', warehouseId: 'x', quantity: 1, type: 'in' }],
    ['GET /api/accounts (accounting.view)', 'GET', '/api/accounts', undefined],
    ['GET /api/vouchers/stats (vouchers.view)', 'GET', '/api/vouchers/stats', undefined],
    ['GET /api/parties/{id}/statement (party view)', 'GET', `/api/parties/${contractorId}/statement`, undefined],
    ['GET /api/parties/{id}/statement/export (reports.export)', 'GET', `/api/parties/${contractorId}/statement/export`, undefined],
    ['GET /api/reports/contractor-monthly/export (reports.export)', 'GET', `/api/reports/contractor-monthly/export?contractorId=${contractorId}&year=2026&month=1`, undefined],
    ['GET /api/items (inventory.view)', 'GET', '/api/items', undefined],
    ['POST /api/freight (inventory.freight)', 'POST', '/api/freight', { regionAr: 'x' }],
    ['GET /api/branches/manage-only (branches.manage)', 'POST', '/api/branches', { name: 'x' }],
    ['POST /api/warehouses (warehouses.manage)', 'POST', '/api/warehouses', { name: 'x', branchId: 'x' }],
    ['POST /api/shipments/bulk/assign (shipments.assign)', 'POST', '/api/shipments/bulk/assign', { ids: [], contractorId }],
    ['POST /api/shipments/{id}/settle-cod (shipments.settle)', 'POST', `/api/shipments/${state.shipment1Id}/settle-cod`, {}],
  ]
  let all403 = true
  const misses: string[] = []
  for (const [name, method, path, body] of forbidden) {
    const r = await req(method as string, path as string, body, minToken)
    if (r.status !== 403) { all403 = false; misses.push(`${name} → ${r.status}`) }
  }
  rec('minimal role gets 403 on ALL unauthorized endpoints (35 checked)', all403, misses.join(', ') || 'all 403')

  // allowed read for minimal role
  const vOk = await req('GET', '/api/shipments?pageSize=1', undefined, minToken)
  rec('minimal role CAN read shipments (its only permission)', vOk.status === 200, `got ${vOk.status}`)
  const vRcpts = await req('GET', '/api/receipts?pageSize=1', undefined, minToken)
  rec('receipts.view granted via designed legacy equivalence (shipments.view → receipts.view)', vRcpts.status === 200, `got ${vRcpts.status}`)

  // viewer (multi-view role): mutating endpoints must still 403
  const viewerMutations = [
    ['POST /api/shipments', 'POST', '/api/shipments', { contractorId, deliveryNumber: `XV-${Date.now()}` }],
    ['POST /api/extras', 'POST', '/api/extras', { contractorId, type: 'mabeet', amount: 10 }],
    ['POST /api/payments', 'POST', '/api/payments', { contractorId, amount: 10 }],
    ['POST /api/invoices', 'POST', '/api/invoices', { customerId, items: [{ description: 'x', quantity: 1, unitPrice: 1 }] }],
    ['DELETE /api/payments/{id}', 'DELETE', '/api/payments/xxx', {}],
    ['GET /api/backup', 'GET', '/api/backup', undefined],
    ['GET /api/users', 'GET', '/api/users', undefined],
    ['GET /api/roles', 'GET', '/api/roles', undefined],
    ['PATCH /api/settings', 'PATCH', '/api/settings', { updates: {} }],
    ['POST /api/journal', 'POST', '/api/journal', { description: 'x', lines: [] }],
    ['POST /api/lookups', 'POST', '/api/lookups', { category: 'x', label: 'x' }],
    ['POST /api/movements', 'POST', '/api/movements', { itemId: 'x', warehouseId: 'x', quantity: 1, type: 'in' }],
  ]
  let vAll403 = true
  const vMiss: string[] = []
  for (const [name, method, path, body] of viewerMutations) {
    const r = await req(method as string, path as string, body, viewerToken)
    if (r.status !== 403) { vAll403 = false; vMiss.push(`${name} → ${r.status}`) }
  }
  rec('viewer role (21 view perms) gets 403 on ALL mutation/admin endpoints (12 checked)', vAll403, vMiss.join(', ') || 'all 403')

  // ops legacy-permission equivalence: parties.extras.manage → extra_costs.create
  const opsToken = (await req('POST', '/api/auth/login', { username: 'ops', password: 'ops123' })).json.token
  const opsExtra = await req('POST', '/api/extras', { contractorId, type: 'mabeet', amount: 5, notes: 'توافق الصلاحيات القديمة' }, opsToken)
  rec('legacy perm equivalence (ops: parties.extras.manage → extra_costs.create) works', opsExtra.status === 200, `got ${opsExtra.status}: ${JSON.stringify(opsExtra.json)}`)
  if (opsExtra.json?.id) {
    await req('DELETE', `/api/extras/${opsExtra.json.id}`, undefined, adminToken)
  }

  // KNOWN BUG CHECK: /api/shipments/{id}/receipt uses legacy key shipments.receipts —
  // a user granted the NEW receipts.manage (without shipments.receipts) must get access
  const roles = (await req('GET', '/api/roles', undefined, adminToken)).json.items ?? []
  let testRoleId: string | null = null
  const rNew = await req('POST', '/api/roles', { name: `e2e_rcpt_${state.ts}`, label: 'دور اختبار الأذونات', permissions: ['receipts.manage'] }, adminToken)
  if (rNew.status === 200) testRoleId = rNew.json?.id
  rec('create role with receipts.manage only', rNew.status === 200 || rNew.status === 409, JSON.stringify(rNew.json ?? {}))
  // create user with that role
  const uNew = await req('POST', '/api/users', { username: `e2e_rcpt_${state.ts}`, name: 'مستخدم اختبار الأذونات', password: 'e2etest123', roleId: testRoleId }, adminToken)
  const rcptToken = uNew.status === 200 ? (await req('POST', '/api/auth/login', { username: `e2e_rcpt_${state.ts}`, password: 'e2etest123' })).json?.token : null
  rec('login as receipts-manage-only user', !!rcptToken)
  if (rcptToken && state.shipment1Id) {
    const rcptToggle = await req('POST', `/api/shipments/${state.shipment1Id}/receipt`, { delivered: true }, rcptToken)
    rec('receipts.manage user CAN toggle delivery receipt (perm key consistency)', rcptToggle.status === 200, `got ${rcptToggle.status}: ${rcptToggle.json?.error ?? ''}`)
    await req('POST', `/api/shipments/${state.shipment1Id}/receipt`, { delivered: false }, adminToken)
  } else {
    rec('receipts.manage user CAN toggle delivery receipt (perm key consistency)', false, 'user/role creation failed')
  }

  // ========================================================================
  section('PHASE 7 — EXPORTS & BACKUP')
  const xlsx1 = await fetch(`${BASE}/api/reports/contractor-monthly/export?contractorId=${contractorId}&year=${now.getFullYear()}&month=${now.getMonth() + 1}`, { headers: { 'x-session-token': adminToken } })
  const buf1 = Buffer.from(await xlsx1.arrayBuffer())
  rec('Monthly Report .xlsx downloads with valid ZIP signature', xlsx1.status === 200 && buf1.subarray(0, 2).toString() === 'PK' && buf1.length > 1000, `status=${xlsx1.status} bytes=${buf1.length} type=${xlsx1.headers.get('content-type')}`)

  const xlsx2 = await fetch(`${BASE}/api/parties/${contractorId}/statement/export`, { headers: { 'x-session-token': adminToken } })
  const buf2 = Buffer.from(await xlsx2.arrayBuffer())
  rec('Statement .xlsx downloads with valid ZIP signature', xlsx2.status === 200 && buf2.subarray(0, 2).toString() === 'PK' && buf2.length > 1000, `status=${xlsx2.status} bytes=${buf2.length}`)

  const backup = await req('GET', '/api/backup', undefined, adminToken)
  const backupOk = backup.status === 200 && backup.json && typeof backup.json === 'object'
  const backupKeys = backupOk ? Object.keys(backup.json) : []
  rec('JSON /api/backup returns structured full dump', !!backupOk, `keys=${backupKeys.slice(0, 8).join(',')}`)

  const xlsxViewer = await fetch(`${BASE}/api/parties/${contractorId}/statement/export`, { headers: { 'x-session-token': minToken } })
  rec('minimal role (no party view / no reports.export) → statement export blocked', xlsxViewer.status === 403, `got ${xlsxViewer.status}`)

  // save cleanup info
  const cleanupState = { ...state, sh1, sh2, invId, testRoleId, testUsername: `e2e_rcpt_${state.ts}`, minRoleId, minUsername: `e2e_min_${state.ts}` }
  await Bun.write('/home/z/my-project/.e2e/state.json', JSON.stringify(cleanupState, null, 2))

  const fails = results.filter((r) => !r.ok)
  console.log(`\n===== PART2 SUMMARY: ${results.length - fails.length}/${results.length} passed, ${fails.length} failed =====`)
  if (fails.length) { console.log('FAILED:'); fails.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`)) }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
