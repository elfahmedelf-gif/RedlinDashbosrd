// ============================================================================
// E2E Test Suite Part 1 — Auth, Shipments/Receipts, Extra Costs, Payments
// Runs against the live production server on http://localhost:3000
// Usage: bun .e2e/e2e-part1.ts
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
let opsToken = ''

async function req(method: string, path: string, body?: any, token?: string) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-session-token': token } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json: any = null
  try { json = await res.json() } catch { json = null }
  return { status: res.status, json }
}

async function login(u: string, p: string) {
  const r = await req('POST', '/api/auth/login', { username: u, password: p })
  if (r.status !== 200 || !r.json?.token) throw new Error(`login failed for ${u}: ${JSON.stringify(r.json)}`)
  return r.json.token as string
}

const round2 = (n: number) => Math.round(n * 100) / 100

async function trialBalance() {
  const r = await req('GET', '/api/reports/trial-balance', undefined, adminToken)
  if (r.status !== 200) throw new Error('trial-balance failed')
  const items: { id: string; code: string; name: string; debit: number; credit: number; balance: number }[] = r.json.items
  const totalDebit = round2(items.reduce((s, x) => s + x.debit, 0))
  const totalCredit = round2(items.reduce((s, x) => s + x.credit, 0))
  const byCode = (c: string) => items.find((x) => x.code === c) ?? { debit: 0, credit: 0, balance: 0 }
  return { items, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.005, byCode }
}

async function executive() {
  const r = await await_any(() => req('GET', '/api/executive', undefined, adminToken))
  if (r.status !== 200) throw new Error('executive failed')
  return r.json as { contractors: { id: string; name: string; earned: number; paid: number; remaining: number }[]; totals: any }
}
async function await_any(f: () => Promise<any>) { return f() }

async function partyBalance(partyId: string) {
  const r = await req('GET', `/api/parties/${partyId}/statement`, undefined, adminToken)
  if (r.status !== 200) throw new Error('statement failed: ' + JSON.stringify(r.json))
  return r.json as { opening: number; totals: { closing: number } }
}

async function main() {
  section('PHASE 0 — AUTH & BASELINE')
  adminToken = await login('admin', 'admin123')
  rec('login admin/admin123', !!adminToken)
  viewerToken = await login('viewer', 'view123')
  rec('login viewer (restricted role)', !!viewerToken)
  opsToken = await login('ops', 'ops123')
  rec('login ops (branch_manager+prices)', !!opsToken)

  const noTok = await req('GET', '/api/shipments')
  rec('API without token → 401', noTok.status === 401, `got ${noTok.status}`)

  const badLogin = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'wrong' }) })
  const badBody = await badLogin.json()
  rec('wrong password → 401 + Arabic msg', badLogin.status === 401 && String(badBody?.error ?? '').includes('كلمة المرور'), `got ${badLogin.status}: ${badBody?.error}`)

  // Reference data
  const contractors = (await req('GET', '/api/parties?type=contractor&pageSize=100', undefined, adminToken)).json.items
  const customers = (await req('GET', '/api/parties?type=customer&pageSize=100', undefined, adminToken)).json.items
  const contractor = contractors[0]
  const customer = customers[0]
  rec('seeded contractor exists', !!contractor, contractor?.name)
  rec('seeded customer exists', !!customer, customer?.name)

  const tb0 = await trialBalance()
  rec('baseline trial balance balanced', tb0.balanced, `Dr ${tb0.totalDebit} / Cr ${tb0.totalCredit}`)
  const ar0 = tb0.byCode('1103'), cash0 = tb0.byCode('1101'), rev0 = tb0.byCode('4101'), vat0 = tb0.byCode('2103'), ctr0 = tb0.byCode('2102'), exp0 = tb0.byCode('5101')

  // ========================================================================
  section('PHASE 1 — SHIPMENTS & DELIVERY RECEIPTS')
  const ts = Date.now().toString().slice(-8)
  const dn1 = `E2E-DN-${ts}`
  const c1 = await req('POST', '/api/shipments', {
    contractorId: contractor.id, customerId: customer.id, deliveryNumber: dn1,
    destination: 'القاهرة — E2E', recipientName: 'مستلم E2E',
    freightTotal: 500, freightCost: 200, notes: 'سجل اختبار E2E',
  }, adminToken)
  rec('create shipment with unique deliveryNumber → 200', c1.status === 200 && !!c1.json?.id, JSON.stringify(c1.json))
  const shipment1Id = c1.json?.id as string

  const dup = await req('POST', '/api/shipments', { contractorId: contractor.id, deliveryNumber: dn1, freightTotal: 1 }, adminToken)
  rec('duplicate deliveryNumber → 409 + Arabic error', dup.status === 409 && String(dup.json?.error ?? '').includes('مسجل مسبقًا'), `got ${dup.status}: ${dup.json?.error}`)

  rec('duplicate deliveryNumber returns existing shipment details', dup.json?.details?.existingShipmentId === shipment1Id, JSON.stringify(dup.json?.details ?? {}))

  // negative amounts blocked
  const neg = await req('POST', '/api/shipments', { contractorId: contractor.id, deliveryNumber: `NEG-${ts}`, freightTotal: -5 }, adminToken)
  rec('negative freight blocked → 400', neg.status === 400, `got ${neg.status}: ${neg.json?.error}`)

  // receipt toggle on (shipment still status=new — receipt flag is independent)
  const tog1 = await req('POST', `/api/shipments/${shipment1Id}/receipt`, { delivered: true }, adminToken)
  rec('toggle delivery receipt ✓ → ok', tog1.status === 200 && tog1.json?.isReceiptDelivered === true, JSON.stringify(tog1.json))

  const recList = await req('GET', '/api/receipts?view=delivered&pageSize=500', undefined, adminToken)
  const inDelivered = (recList.json?.items ?? []).some((x: any) => x.id === shipment1Id)
  rec('receipt appears in delivered view', recList.status === 200 && inDelivered, `totals=${JSON.stringify(recList.json?.totals)}`)

  // overdue counter sanity: total delivered count matches item count
  const recAll = await req('GET', '/api/receipts?view=all&pageSize=500', undefined, adminToken)
  const t = recAll.json?.totals ?? {}
  rec('receipts counters consistent (all = pending+delivered)', t.all === (t.pending ?? 0) + (t.delivered ?? 0), JSON.stringify(t))

  // toggle back off
  const tog2 = await req('POST', `/api/shipments/${shipment1Id}/receipt`, { delivered: false }, adminToken)
  rec('toggle delivery receipt back (undelivered) → ok', tog2.status === 200 && tog2.json?.isReceiptDelivered === false)
  const recList2 = await req('GET', '/api/receipts?view=undelivered&pageSize=500', undefined, adminToken)
  rec('receipt back in undelivered view', (recList2.json?.items ?? []).some((x: any) => x.id === shipment1Id))

  // ========================================================================
  section('PHASE 2 — EXTRA COSTS (APPROVAL GATE + JE SYNC)')
  const ctrBalBefore = await partyBalance(contractor.id)
  const execBefore = await executive()
  const ctrBefore = execBefore.contractors.find((c) => c.id === contractor.id)

  // taateeq auto-applied
  const taateeq = await req('POST', '/api/extras', { contractorId: contractor.id, type: 'taateeq', amount: 100, notes: 'E2E تعتيق' }, adminToken)
  rec('create تعتيق → auto-approved with JE', taateeq.status === 200 && taateeq.json?.approvalStatus === 'approved' && !!taateeq.json?.journalEntryNo, JSON.stringify(taateeq.json))
  const taateeqId = taateeq.json?.id

  // pending mabeit — must NOT affect balance
  const mabeit = await req('POST', '/api/extras', { contractorId: contractor.id, type: 'mabeet', amount: 250, notes: 'E2E مبيت' }, adminToken)
  rec('create مبيت → pending, no JE', mabeit.status === 200 && mabeit.json?.approvalStatus === 'pending' && mabeit.json?.journalEntryNo === null, JSON.stringify(mabeit.json))
  const mabeitId = mabeit.json?.id

  // pending return
  const ret = await req('POST', '/api/extras', { contractorId: contractor.id, type: 'return', amount: 80, notes: 'E2E مرتجع' }, adminToken)
  rec('create مرتجع → pending', ret.status === 200 && ret.json?.approvalStatus === 'pending')
  const retId = ret.json?.id

  let execMid = await executive()
  let ctrMid = execMid.contractors.find((c) => c.id === contractor.id)
  rec('pending items do NOT affect contractor dues (only taateeq 100)', round2((ctrMid?.earned ?? 0) - (ctrBefore?.earned ?? 0)) === 100, `delta=${round2((ctrMid?.earned ?? 0) - (ctrBefore?.earned ?? 0))}`)

  // approve mabeit → JE Dr 5101 / Cr 2102
  const appr = await req('POST', `/api/extras/${mabeitId}/approve`, { notes: 'اعتماد E2E' }, adminToken)
  rec('approve مبيت → JE posted', appr.status === 200 && !!appr.json?.journalEntryNo, JSON.stringify(appr.json))
  const mabeitJENo = appr.json?.journalEntryNo

  // verify JE balanced and on 2102
  const jr = await req('GET', `/api/journal?q=${mabeitJENo}`, undefined, adminToken)
  const jeRow = (jr.json?.items ?? []).find((e: any) => e.entryNo === mabeitJENo)
  rec('approval JE balanced (Dr=Cr) + on account 2102', !!jeRow && round2(jeRow.totalDebit) === round2(jeRow.totalCredit) && (jeRow.lines ?? []).some((l: any) => l.account?.code === '2102'), JSON.stringify(jeRow?.lines?.map((l: any) => `${l.account?.code}:${l.debit}/${l.credit}`)))

  execMid = await executive()
  ctrMid = execMid.contractors.find((c) => c.id === contractor.id)
  rec('approved مبيت raises dues by 250 (total +350)', round2((ctrMid?.earned ?? 0) - (ctrBefore?.earned ?? 0)) === 350, `earned delta=${round2((ctrMid?.earned ?? 0) - (ctrBefore?.earned ?? 0))}`)

  // double approve blocked
  const appr2 = await req('POST', `/api/extras/${mabeitId}/approve`, {}, adminToken)
  rec('double-approve مبيت → 409', appr2.status === 409, `got ${appr2.status}: ${appr2.json?.error}`)

  // edit approved item → auto reversal + repost
  const edit = await req('PATCH', `/api/extras/${mabeitId}`, { amount: 300 }, adminToken)
  rec('edit approved مبيت amount → reversal + repost JE', edit.status === 200 && !!edit.json?.reversalNo && !!edit.json?.repostNo, JSON.stringify(edit.json))
  execMid = await executive()
  ctrMid = execMid.contractors.find((c) => c.id === contractor.id)
  rec('dues after edit = +400 (100+300)', round2((ctrMid?.earned ?? 0) - (ctrBefore?.earned ?? 0)) === 400, `delta=${round2((ctrMid?.earned ?? 0) - (ctrBefore?.earned ?? 0))}`)

  // approve the مرتجع first (dues +80), then reject it → automatic reversal JE (dues back −80)
  const retAppr = await req('POST', `/api/extras/${retId}/approve`, { notes: 'اعتماد E2E للمرتجع' }, adminToken)
  rec('approve مرتجع → JE posted (dues +80)', retAppr.status === 200 && !!retAppr.json?.journalEntryNo, JSON.stringify(retAppr.json))
  execMid = await executive()
  ctrMid = execMid.contractors.find((c) => c.id === contractor.id)
  rec('dues after approving return = +480 (100+300+80)', round2((ctrMid?.earned ?? 0) - (ctrBefore?.earned ?? 0)) === 480, `delta=${round2((ctrMid?.earned ?? 0) - (ctrBefore?.earned ?? 0))}`)

  const rej = await req('POST', `/api/extras/${retId}/reject`, { notes: 'رفض E2E بعد الاعتماد' }, adminToken)
  rec('reject APPROVED مرتجع → automatic reversal JE', rej.status === 200 && !!rej.json?.reversalEntryNo, JSON.stringify(rej.json))
  execMid = await executive()
  ctrMid = execMid.contractors.find((c) => c.id === contractor.id)
  rec('after rejecting approved return, dues back to +400 (reversal removed 80)', round2((ctrMid?.earned ?? 0) - (ctrBefore?.earned ?? 0)) === 400, `delta=${round2((ctrMid?.earned ?? 0) - (ctrBefore?.earned ?? 0))}`)

  // delete rejected item
  const del = await req('DELETE', `/api/extras/${retId}`, undefined, adminToken)
  rec('delete rejected مرتجع → ok', del.status === 200)

  // delete approved item blocked
  const delAppr = await req('DELETE', `/api/extras/${mabeitId}`, undefined, adminToken)
  rec('delete approved مبيت → 409 (must reject first)', delAppr.status === 409, `got ${delAppr.status}: ${delAppr.json?.error}`)

  const tb2 = await trialBalance()
  rec('trial balance still balanced after extras', tb2.balanced, `Dr ${tb2.totalDebit} / Cr ${tb2.totalCredit}`)

  // ========================================================================
  section('PHASE 3 — CONTRACTOR PAYMENTS')
  const pay = await req('POST', '/api/payments', { contractorId: contractor.id, amount: 300, method: 'cash', notes: 'دفعة E2E' }, adminToken)
  rec('record cash payment → JE + voucher', pay.status === 200 && !!pay.json?.journalEntryNo && !!pay.json?.voucherNo, JSON.stringify(pay.json))

  const payList = await req('GET', `/api/payments?contractorId=${contractor.id}&pageSize=20`, undefined, adminToken)
  const payRow = (payList.json?.items ?? []).find((x: any) => x.voucherNo === pay.json?.voucherNo)
  rec('payment appears in list with effective=true', !!payRow && payRow.effective === true && round2(payRow.amount) === 300)

  const jePay = await req('GET', `/api/journal?q=${pay.json?.journalEntryNo}`, undefined, adminToken)
  const jePayRow = (jePay.json?.items ?? []).find((e: any) => e.entryNo === pay.json?.journalEntryNo)
  const payLines = (jePayRow?.lines ?? []).map((l: any) => ({ code: l.account?.code, d: l.debit, c: l.credit }))
  const dr2102 = payLines.find((l: any) => l.code === '2102' && l.d === 300)
  const cr1101 = payLines.find((l: any) => l.code === '1101' && l.c === 300)
  rec('payment JE = Dr 2102 / Cr 1101 balanced', !!dr2102 && !!cr1101 && round2(jePayRow.totalDebit) === round2(jePayRow.totalCredit), JSON.stringify(payLines))

  execMid = await executive()
  ctrMid = execMid.contractors.find((c) => c.id === contractor.id)
  rec('payment raises paid by 300, remaining consistent', round2((ctrMid?.paid ?? 0) - (ctrBefore?.paid ?? 0)) === 300 && round2(ctrMid?.remaining ?? 0) === round2((ctrMid?.earned ?? 0) - (ctrMid?.paid ?? 0)), `paid=${ctrMid?.paid} earned=${ctrMid?.earned}`)

  // reverse payment
  const rev = await req('DELETE', `/api/payments/${payRow.id}`, { reason: 'إرجاع E2E' }, adminToken)
  rec('reverse payment → reversal JE + cancelled', rev.status === 200 && !!rev.json?.reversalNo, JSON.stringify(rev.json))
  execMid = await executive()
  ctrMid = execMid.contractors.find((c) => c.id === contractor.id)
  rec('after reversal paid=baseline, earned intact (no inflation)', round2((ctrMid?.paid ?? 0) - (ctrBefore?.paid ?? 0)) === 0 && round2((ctrMid?.earned ?? 0) - (ctrBefore?.earned ?? 0)) === 400, `paidDelta=${round2((ctrMid?.paid ?? 0) - (ctrBefore?.paid ?? 0))}, earnedDelta=${round2((ctrMid?.earned ?? 0) - (ctrBefore?.earned ?? 0))}`)
  const ctrBalAfterExtras = await partyBalance(contractor.id)
  rec('contractor statement closing ≡ executive remaining', Math.abs(round2(-ctrBalAfterExtras.totals.closing) - round2(ctrMid?.remaining ?? 0)) < 0.01, `statementClosing=${ctrBalAfterExtras.totals.closing} vs -remaining=${round2(-(ctrMid?.remaining ?? 0))}`)

  // save state for part2
  const state = {
    ts, dn1, shipment1Id, contractorId: contractor.id, customerId: customer.id,
    contractorName: contractor.name, customerName: customer.name,
    taateeqId, mabeitId,
    baselineEarned: ctrBefore?.earned ?? 0, baselinePaid: ctrBefore?.paid ?? 0,
    statementClosingBefore: ctrBalBefore.totals.closing,
    tbBaseline: { totalDebit: tb0.totalDebit, totalCredit: tb0.totalCredit, rev: { d: rev0.debit, c: rev0.credit }, ar: { d: ar0.debit, c: ar0.credit }, cash: { d: cash0.debit, c: cash0.credit }, vat: { d: vat0.debit, c: vat0.credit }, ctr: { d: ctr0.debit, c: ctr0.credit }, exp: { d: exp0.debit, c: exp0.credit } },
  }
  await Bun.write('/home/z/my-project/.e2e/state.json', JSON.stringify(state, null, 2))
  console.log('\nSTATE SAVED → .e2e/state.json')

  // Summary
  const fails = results.filter((r) => !r.ok)
  console.log(`\n===== PART1 SUMMARY: ${results.length - fails.length}/${results.length} passed, ${fails.length} failed =====`)
  if (fails.length) { console.log('FAILED:'); fails.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`)) }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
