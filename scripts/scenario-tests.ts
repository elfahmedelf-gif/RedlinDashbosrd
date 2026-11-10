// ============================================================================
// سيناريوهات الاختبار الشاملة — تعمل على الخادم الحي عبر HTTP
// Usage: bun scripts/scenario-tests.ts [baseUrl]
// المخرجات: PASS/FAIL لكل سيناريو + ملخص نهائي + كود خروج (0 = نجاح كامل)
// بيانات معزولة: كل السجلات تحمل وسم "اختبار آلي TEST-E2E"
// ============================================================================
const BASE = process.argv[2] ?? 'http://localhost:3000'

let passCount = 0
let failCount = 0
const failures: string[] = []

function log(step: string, ok: boolean, detail = '') {
  if (ok) { passCount++; console.log(`  ✅ ${step}${detail ? ` — ${detail}` : ''}`) }
  else { failCount++; failures.push(`${step}${detail ? ` — ${detail}` : ''}`); console.log(`  ❌ ${step}${detail ? ` — ${detail}` : ''}`) }
}

async function req(method: string, path: string, body?: any, token?: string, idem?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['x-session-token'] = token
  if (idem) headers['Idempotency-Key'] = idem
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  let data: any = null
  try { data = await res.json() } catch { /* empty */ }
  return { status: res.status, data }
}

function asItems(d: any): any[] { return Array.isArray(d) ? d : d?.items ?? [] }

/** يتوقع نجاح الطلب (2xx) */
async function must(step: string, method: string, path: string, body?: any, token?: string, idem?: string) {
  const r = await req(method, path, body, token, idem)
  if (r.status >= 200 && r.status < 300) { log(step, true); return r.data }
  log(step, false, `HTTP ${r.status}: ${r.data?.error ?? '?'}`)
  throw new Error(`STOP: ${step}`)
}

/** يتوقع فشل الطلب مع كود الحالة المتوقع */
async function mustFail(step: string, expectStatus: number, method: string, path: string, body?: any, token?: string) {
  const r = await req(method, path, body, token)
  const ok = r.status === expectStatus
  log(step, ok, ok ? `رفض كما هو مطلوب (HTTP ${r.status}: ${r.data?.error ?? ''})` : `متوقع ${expectStatus} لكن حصل ${r.status}: ${r.data?.error ?? '?'}`)
  return ok
}

async function login(username: string, password: string) {
  const r = await req('POST', '/api/auth/login', { username, password })
  if (r.status !== 200 || !r.data?.token) throw new Error(`login failed for ${username}: ${r.status}`)
  return { token: r.data.token as string, userId: r.data.user?.userId as string }
}

/** دورة حياة كاملة: submit → approve → execute → complete (المعتمد مستخدم مختلف عن المنشئ) */
async function fullLifecycle(tokenCreate: string, tokenApprove: string, voucherId: string, label: string) {
  await must(`${label}: رفع`, 'POST', `/api/vouchers/${voucherId}/transition`, { action: 'submit' }, tokenCreate)
  await must(`${label}: اعتماد`, 'POST', `/api/vouchers/${voucherId}/transition`, { action: 'approve' }, tokenApprove)
  await must(`${label}: تنفيذ`, 'POST', `/api/vouchers/${voucherId}/transition`, { action: 'execute' }, tokenApprove)
  await must(`${label}: إكمال`, 'POST', `/api/vouchers/${voucherId}/transition`, { action: 'complete' }, tokenApprove)
}

async function getShipment(token: string, id: string) {
  const r = await req('GET', `/api/shipments/${id}`, undefined, token)
  return r.data
}

async function trialBalance(token: string) {
  const r = await req('GET', '/api/reports/trial-balance', undefined, token)
  const items = r.data?.items ?? []
  const td = items.reduce((s: number, i: any) => s + i.debit, 0)
  const tc = items.reduce((s: number, i: any) => s + i.credit, 0)
  return { td, tc, balanced: Math.abs(td - tc) < 0.01 }
}

// ============================================================================
async function main() {
  console.log(`\n🧪 سيناريوهات الاختبار — ${BASE}\n`)

  // ---------- التهيئة: جلسات + بيانات معزولة ----------
  console.log('—— التهيئة (جلسات وبيانات معزولة) ——')
  const admin = await login('admin', 'admin123')
  const ops = await login('ops', 'ops123')
  const fin = await login('finance', 'fin123')
  const viewer = await login('viewer', 'view123')
  log('تسجيل دخول 4 مستخدمين (admin/ops/finance/viewer)', true)

  const branches = await must('جلب الفروع', 'GET', '/api/branches', undefined, admin.token)
  const branchList = asItems(branches)
  if (branchList.length < 2) throw new Error('STOP: يحتاج الاختبار فرعين على الأقل')
  const brA = branchList[0], brB = branchList[1]

  const customer = await must('إنشاء عميل اختبار', 'POST', '/api/parties',
    { name: 'اختبار آلي — عميل TEST-E2E', isCustomer: true, phone: '000' }, admin.token)
  const contractor = await must('إنشاء مقاول اختبار', 'POST', '/api/parties',
    { name: 'اختبار آلي — مقاول TEST-E2E', isContractor: true, phone: '000' }, admin.token)
  const courier = await must('إنشاء مندوب اختبار', 'POST', '/api/parties',
    { name: 'اختبار آلي — مندوب TEST-E2E', isContractor: true, phone: '000' }, admin.token)

  const mkShipment = async (tag: string, freightTotal: number, freightCost: number) =>
    must(`إنشاء شحنة ${tag}`, 'POST', '/api/shipments', {
      recipientName: `اختبار آلي ${tag}`, destination: brA.name, branchId: brA.id,
      customerId: customer.id, contractorId: contractor.id,
      freightTotal, freightCost, notes: 'TEST-E2E',
    }, admin.token)

  const shA = await mkShipment('A', 1000, 0)   // السلسلة الكاملة
  const shB = await mkShipment('B', 900, 0)    // تحميل متعدد
  const shC = await mkShipment('C', 700, 400)  // تسوية COD
  const shD = await mkShipment('D', 100, 0)    // اختبار الصلاحيات
  const shE = await mkShipment('E', 100, 0)    // اختبار فصل المهام

  const accounts = await must('جلب شجرة الحسابات', 'GET', '/api/accounts', undefined, admin.token)
  const accList = asItems(accounts)
  const cashAcc = accList.find((a) => a.code === '1101')
  const arAcc = accList.find((a) => a.code === '1103')
  if (!cashAcc || !arAcc) throw new Error('STOP: حسابات 1101/1103 غير موجودة')

  const tb0 = await trialBalance(admin.token)
  log('ميزان المراجعة متوازن قبل الاختبارات', tb0.balanced, `مدين ${tb0.td} / دائن ${tb0.tc}`)

  // ---------- S1: إذن استلام وإكمال (شحنتان منفصلتان) ----------
  console.log('\n—— S1: إذن استلام شحنات (دورة حياة كاملة) ——')
  const r1 = await must('S1: إنشاء إذن استلام A', 'POST', '/api/vouchers',
    { type: 'receiving', sourceBranchId: brA.id, employeeId: admin.userId, shipmentIds: [shA.id] }, ops.token)
  await fullLifecycle(ops.token, fin.token, r1.id, 'S1')
  const r1b = await must('S1b: إنشاء إذن استلام B', 'POST', '/api/vouchers',
    { type: 'receiving', sourceBranchId: brA.id, employeeId: admin.userId, shipmentIds: [shB.id] }, ops.token)
  await fullLifecycle(ops.token, fin.token, r1b.id, 'S1b')
  const [s1a, s1b] = await Promise.all([getShipment(admin.token, shA.id), getShipment(admin.token, shB.id)])
  log('S1: الشحنتان أصبحتا "received"', s1a?.status === 'received' && s1b?.status === 'received', `A=${s1a?.status} B=${s1b?.status}`)

  // ---------- S2: إذن تحميل بعدة شحنات ----------
  console.log('\n—— S2: إذن تحميل بعدة شحنات (A+B) ——')
  const r2 = await must('S2: إنشاء إذن تحميل (شحنتان)', 'POST', '/api/vouchers',
    { type: 'loading', sourceBranchId: brA.id, destBranchId: brB.id, employeeId: admin.userId, vehicleNo: 'اختبار-1', driverName: 'سائق اختبار', shipmentIds: [shA.id, shB.id] }, ops.token)
  await fullLifecycle(ops.token, fin.token, r2.id, 'S2')
  const [a2, b2] = await Promise.all([getShipment(admin.token, shA.id), getShipment(admin.token, shB.id)])
  log('S2: الشحنتان أصبحتا "loaded"', a2?.status === 'loaded' && b2?.status === 'loaded', `A=${a2?.status} B=${b2?.status}`)

  // ---------- S3: تحويل بين الفروع (عهدة تنتقل فعليًا) ----------
  console.log('\n—— S3: إذن تحويل بين الفروع ——')
  const r3 = await must('S3: إنشاء إذن تحويل A من فرع إلى آخر', 'POST', '/api/vouchers',
    { type: 'branch_transfer', sourceBranchId: brA.id, destBranchId: brB.id, employeeId: admin.userId, vehicleNo: 'اختبار-2', driverName: 'سائق اختبار', shipmentIds: [shA.id] }, ops.token)
  await fullLifecycle(ops.token, fin.token, r3.id, 'S3')
  const a3 = await getShipment(admin.token, shA.id)
  log('S3: الشحنة "in_transit" والعهدة انتقلت للفرع المستلم', a3?.status === 'in_transit' && a3?.branchId === brB.id, `status=${a3?.status} branch_moved=${a3?.branchId === brB.id}`)

  // ---------- S4: تفريغ ----------
  console.log('\n—— S4: إذن تفريغ شحنات ——')
  const r4 = await must('S4: إنشاء إذن تفريغ A', 'POST', '/api/vouchers',
    { type: 'unloading', sourceBranchId: brB.id, employeeId: admin.userId, shipmentIds: [shA.id] }, ops.token)
  await fullLifecycle(ops.token, fin.token, r4.id, 'S4')
  const a4 = await getShipment(admin.token, shA.id)
  log('S4: الشحنة أصبحت "arrived" (وصلت)', a4?.status === 'arrived', `status=${a4?.status}`)

  // ---------- S5: تسليم لمندوب ثم تسليم للعميل ----------
  console.log('\n—— S5: إذن تسليم لمندوب + إذن تسليم نهائي ——')
  const r5a = await must('S5a: إنشاء إذن تسليم لمندوب A', 'POST', '/api/vouchers',
    { type: 'courier_assignment', sourceBranchId: brB.id, employeeId: admin.userId, courierId: courier.id, shipmentIds: [shA.id] }, ops.token)
  await fullLifecycle(ops.token, fin.token, r5a.id, 'S5a')
  const a5a = await getShipment(admin.token, shA.id)
  log('S5a: الشحنة "assigned_courier"', a5a?.status === 'assigned_courier', `status=${a5a?.status}`)
  const r5b = await must('S5b: إنشاء إذن تسليم نهائي A', 'POST', '/api/vouchers',
    { type: 'delivery', sourceBranchId: brB.id, employeeId: admin.userId, courierId: courier.id, shipmentIds: [shA.id] }, ops.token)
  await fullLifecycle(ops.token, fin.token, r5b.id, 'S5b')
  const a5b = await getShipment(admin.token, shA.id)
  log('S5b: الشحنة "delivered"', a5b?.status === 'delivered', `status=${a5b?.status} collection=${a5b?.collectionStatus}`)

  // ---------- S6: مرتجع ثم استلام مرتجعات ----------
  console.log('\n—— S6: إذن مرتجع + استلام مرتجعات ——')
  const r6a = await must('S6a: إنشاء إذن مرتجع A', 'POST', '/api/vouchers',
    { type: 'return', sourceBranchId: brB.id, employeeId: admin.userId, courierId: courier.id, shipmentIds: [shA.id] }, ops.token)
  await fullLifecycle(ops.token, fin.token, r6a.id, 'S6a')
  const a6a = await getShipment(admin.token, shA.id)
  log('S6a: الشحنة "returned"', a6a?.status === 'returned', `status=${a6a?.status}`)
  const r6b = await must('S6b: إنشاء إذن استلام مرتجعات A', 'POST', '/api/vouchers',
    { type: 'returned_receiving', sourceBranchId: brB.id, employeeId: admin.userId, shipmentIds: [shA.id] }, ops.token)
  await fullLifecycle(ops.token, fin.token, r6b.id, 'S6b')
  const a6b = await getShipment(admin.token, shA.id)
  log('S6b: الشحنة "received_returned"', a6b?.status === 'received_returned', `status=${a6b?.status}`)

  // ---------- S7: سند قبض + قيد مرتبط ----------
  console.log('\n—— S7: سند قبض نقدية (قيد مزدوج مرتبط) ——')
  const r7 = await must('S7: إنشاء سند قبض 500', 'POST', '/api/vouchers',
    { type: 'collection', sourceBranchId: brA.id, partyId: customer.id, employeeId: admin.userId, amount: 500, accountName: 'الصندوق' }, ops.token)
  await fullLifecycle(ops.token, fin.token, r7.id, 'S7')
  const v7 = await req('GET', `/api/vouchers/${r7.id}`, undefined, admin.token)
  log('S7: سند مكتمل مرتبط بقيد محاسبي مرحّل', v7.data?.status === 'completed' && !!v7.data?.journalEntryId, `entryNo=${v7.data?.journalEntryNo ?? '—'}`)

  // ---------- S8: سند صرف + قيد مرتبط ----------
  console.log('\n—— S8: سند صرف نقدية لمقاول ——')
  const r8 = await must('S8: إنشاء سند صرف 300', 'POST', '/api/vouchers',
    { type: 'cash_disbursement', sourceBranchId: brA.id, partyId: contractor.id, employeeId: admin.userId, amount: 300, accountName: 'الصندوق' }, fin.token)
  await fullLifecycle(fin.token, admin.token, r8.id, 'S8')
  const v8 = await req('GET', `/api/vouchers/${r8.id}`, undefined, admin.token)
  log('S8: سند مكتمل مرتبط بقيد محاسبي مرحّل', v8.data?.status === 'completed' && !!v8.data?.journalEntryId, `entryNo=${v8.data?.journalEntryNo ?? '—'}`)

  // ---------- S9: تسوية COD (قبض + صرف تلقائي) ----------
  console.log('\n—— S9: تسوية COD لشحنة C ——')
  const r9 = await must('S9: تسوية COD', 'POST', `/api/shipments/${shC.id}/settle-cod`, {}, admin.token)
  const codOk = !!r9?.receiptVoucherNo && !!r9?.paymentVoucherNo
  log('S9: أُنشئ سند قبض وسند صرف تلقائيًا مع قيدين', codOk, `قبض=${r9?.receiptVoucherNo ?? '—'} صرف=${r9?.paymentVoucherNo ?? '—'}`)
  const c9 = await getShipment(admin.token, shC.id)
  log('S9: الشحنة أصبحت "collected"', c9?.collectionStatus === 'collected', `collection=${c9?.collectionStatus}`)

  // ---------- S10: تسوية COD مرتين → يجب أن تفشل ----------
  console.log('\n—— S10: منع تسوية COD مرتين ——')
  await mustFail('S10: تسوية C مرة ثانية مرفوضة', 409, 'POST', `/api/shipments/${shC.id}/settle-cod`, {}, admin.token)

  // ---------- S11: ترحيل قيد مرتين → يجب أن تفشل ----------
  console.log('\n—— S11: منع الترحيل المزدوج للقيد ——')
  const je11 = await must('S11: إنشاء قيد مسودة متوازن 120/120', 'POST', '/api/journal',
    { description: 'اختبار آلي — قيد ترحيل TEST-E2E', autoPost: false, lines: [
      { accountId: cashAcc.id, debit: 120, credit: 0, description: 'مدين' },
      { accountId: arAcc.id, debit: 0, credit: 120, description: 'دائن' },
    ] }, fin.token)
  await must('S11: ترحيل القيد أول مرة', 'POST', `/api/journal/${je11.id}/post`, {}, fin.token)
  await mustFail('S11: ترحيل نفس القيد مرة ثانية مرفوض', 409, 'POST', `/api/journal/${je11.id}/post`, {}, fin.token)

  // ---------- S12: قيد غير متوازن → فشل بدون حفظ جزئي ----------
  console.log('\n—— S12: منع القيد غير المتوازن (لا حفظ جزئي) ——')
  await mustFail('S12: قيد 100/80 مرفوض', 400, 'POST', '/api/journal',
    { description: 'اختبار آلي — غير متوازن TEST-E2E', lines: [
      { accountId: cashAcc.id, debit: 100, credit: 0 },
      { accountId: arAcc.id, debit: 0, credit: 80 },
    ] }, fin.token)
  const jList = await req('GET', '/api/journal', undefined, admin.token)
  const leaked = asItems(jList.data).some((j) => String(j.description ?? '').includes('غير متوازن TEST-E2E'))
  log('S12: لا يوجد أي أثر محفوظ للقيد المرفوض', !leaked)

  // ---------- S13: مستخدم غير مصرح → يجب أن يفشل ----------
  console.log('\n—— S13: منع مستخدم بلا صلاحية (اعتماد + ترحيل) ——')
  const r13 = await must('S13: إنشاء إذن استلام D (بواسطة ops)', 'POST', '/api/vouchers',
    { type: 'receiving', sourceBranchId: brA.id, employeeId: admin.userId, shipmentIds: [shD.id] }, ops.token)
  await must('S13: رفع الإذن للاعتماد', 'POST', `/api/vouchers/${r13.id}/transition`, { action: 'submit' }, ops.token)
  await mustFail('S13: اعتماد بواسطة "عارض" مرفوض', 403, 'POST', `/api/vouchers/${r13.id}/transition`, { action: 'approve' }, viewer.token)
  await mustFail('S13: ترحيل قيد بواسطة "عارض" مرفوض', 403, 'POST', `/api/journal/${je11.id}/post`, {}, viewer.token)
  await must('S13: إلغاء الإذن الاختباري (تنظيف)', 'POST', `/api/vouchers/${r13.id}/transition`, { action: 'cancel' }, admin.token)

  // ---------- S14: منع اعتماد الإذن من نفس منشئه ----------
  console.log('\n—— S14: سياسة فصل المهام (لا اعتماد ذاتي) ——')
  const r14 = await must('S14: إنشاء إذن استلام E (بواسطة ops)', 'POST', '/api/vouchers',
    { type: 'receiving', sourceBranchId: brA.id, employeeId: admin.userId, shipmentIds: [shE.id] }, ops.token)
  await must('S14: رفع الإذن للاعتماد', 'POST', `/api/vouchers/${r14.id}/transition`, { action: 'submit' }, ops.token)
  await mustFail('S14: ops يعتمد إذن أنشأه بنفسه → مرفوض', 403, 'POST', `/api/vouchers/${r14.id}/transition`, { action: 'approve' }, ops.token)
  await must('S14: اعتماد من مستخدم مختلف ينجح', 'POST', `/api/vouchers/${r14.id}/transition`, { action: 'approve' }, fin.token)
  await must('S14: إلغاء الإذن الاختباري (تنظيف)', 'POST', `/api/vouchers/${r14.id}/transition`, { action: 'cancel' }, admin.token)

  // ---------- S15: منع حذف إذن مكتمل/مرتبط بقيد ----------
  console.log('\n—— S15: منع حذف الإذن المكتمل ——')
  await mustFail('S15: حذف سند القبض المكتمل مرفوض', 409, 'DELETE', `/api/vouchers/${r7.id}`, undefined, admin.token)

  // ---------- S16: استمرارية البيانات + توازن الميزان ----------
  console.log('\n—— S16: استمرارية البيانات (جلسة جديدة = جهاز آخر) + التوازن ——')
  const admin2 = await login('admin', 'admin123')
  const vList = await req('GET', '/api/vouchers', undefined, admin2.token)
  const vItems = asItems(vList.data)
  const testIds = [r1.id, r1b.id, r2.id, r3.id, r4.id, r5a.id, r5b.id, r6a.id, r6b.id, r7.id, r8.id]
  const found = testIds.filter((id) => vItems.some((v) => v.id === id))
  log('S16: كل أذونات الاختبار موجودة من جلسة جديدة', found.length === testIds.length, `وُجد ${found.length}/${testIds.length}`)
  const tb1 = await trialBalance(admin2.token)
  log('S16: ميزان المراجعة ما زال متوازنًا بعد كل العمليات', tb1.balanced, `مدين ${tb1.td} / دائن ${tb1.tc}`)
  const audit = await req('GET', '/api/audit', undefined, admin2.token)
  const aItems = asItems(audit.data)
  const hasTestAudit = aItems.some((a) => String(a.notes ?? '').includes('TEST-E2E'))
  log('S16: سجل التدقيق يوثق عمليات الاختبار', hasTestAudit, `إجمالي السجلات: ${aItems.length}`)

  // ---------- S17: تتبع العهدة — مرتجع ثم تسليم ثم فحص التقرير ----------
  console.log('\n—— S17: تتبع عهدة المرتجع (mark-received + pending-returns) ——')
  // إنشاء شحنة جديدة + إيصالها + تحميلها + تفريغها + تسليمها لمندوب + تسليمها للعميل + مرتجع ثم تسليمها
  const shR = await mkShipment('R', 500, 0) // سلسلة المرتجع
  // سلسلة: receiving → loading → unloading → courier_assignment → delivery → return
  const rR1 = await must('S17: إنشاء إذن استلام R', 'POST', '/api/vouchers',
    { type: 'receiving', sourceBranchId: brA.id, employeeId: admin.userId, shipmentIds: [shR.id] }, ops.token)
  await fullLifecycle(ops.token, fin.token, rR1.id, 'S17-receive')
  const rR2 = await must('S17: إنشاء إذن تحميل R', 'POST', '/api/vouchers',
    { type: 'loading', sourceBranchId: brA.id, destBranchId: brB.id, employeeId: admin.userId, vehicleNo: 'اختبار-R', driverName: 'سائق R', shipmentIds: [shR.id] }, ops.token)
  await fullLifecycle(ops.token, fin.token, rR2.id, 'S17-load')
  const rR2b = await must('S17: إنشاء إذن تفريغ R', 'POST', '/api/vouchers',
    { type: 'unloading', sourceBranchId: brB.id, employeeId: admin.userId, shipmentIds: [shR.id] }, ops.token)
  await fullLifecycle(ops.token, fin.token, rR2b.id, 'S17-unload')
  const rR3 = await must('S17: إنشاء إذن تسليم لمندوب R', 'POST', '/api/vouchers',
    { type: 'courier_assignment', sourceBranchId: brB.id, employeeId: admin.userId, courierId: courier.id, shipmentIds: [shR.id] }, ops.token)
  await fullLifecycle(ops.token, fin.token, rR3.id, 'S17-assign')
  const rR4 = await must('S17: إنشاء إذن تسليم نهائي R', 'POST', '/api/vouchers',
    { type: 'delivery', sourceBranchId: brB.id, employeeId: admin.userId, courierId: courier.id, shipmentIds: [shR.id] }, ops.token)
  await fullLifecycle(ops.token, fin.token, rR4.id, 'S17-deliver')
  const rR5 = await must('S17: إنشاء إذن مرتجع R', 'POST', '/api/vouchers',
    { type: 'return', sourceBranchId: brB.id, employeeId: admin.userId, courierId: courier.id, shipmentIds: [shR.id] }, ops.token)
  await fullLifecycle(ops.token, fin.token, rR5.id, 'S17-return')
  const aR = await getShipment(admin.token, shR.id)
  log('S17: الشحنة أصبحت "returned" (مع المندوب، لم تُستلم بعد)', aR?.status === 'returned', `status=${aR?.status}`)

  // تقرير المرتجعات لم تُستلم يجب أن يضم الشحنة R
  const pendingResp = await req('GET', '/api/reports/pending-returns', undefined, admin.token)
  const pendingItems = asItems(pendingResp.data)
  const pendingFound = pendingItems.some((it) => it.shipmentId === shR.id)
  log('S17: تقرير "المرتجعات لم تُستلم" يضم الشحنة R', pendingFound, `إجمالي: ${pendingItems.length}`)
  // ملخص المسؤولية حسب المندوب يجب أن يضم المندوب
  const byCourier = pendingResp.data?.byCourier ?? []
  const courierInSummary = byCourier.some((c) => c.courierId === courier.id)
  log('S17: ملخص المسؤولية يضم المندوب الاختباري', courierInSummary, `إجمالي المندوبين: ${byCourier.length}`)

  // تسليم المرتجع (mark-received)
  const markRes = await must('S17: تسليم المرتجع R (mark-received)', 'POST', `/api/vouchers/${rR5.id}/mark-received`, { notes: 'TEST-E2E تسليم' }, admin.token)
  log('S17: تم تسليم شحنة واحدة بنجاح', markRes?.succeeded === 1 && markRes?.total === 1, `نجح ${markRes?.succeeded}/${markRes?.total}`)
  const aR2 = await getShipment(admin.token, shR.id)
  log('S17: الشحنة أصبحت "received_returned" (تم التسليم)', aR2?.status === 'received_returned', `status=${aR2?.status}`)
  // التقرير يجب أن لا يضم الشحنة R بعد التسليم
  const pendingAfter = await req('GET', '/api/reports/pending-returns', undefined, admin.token)
  const pendingAfterItems = asItems(pendingAfter.data)
  const stillPending = pendingAfterItems.some((it) => it.shipmentId === shR.id)
  log('S17: الشحنة R اختفت من تقرير "لم تُستلم" بعد التسليم', !stillPending, `متبقٍ: ${pendingAfterItems.length}`)
  // يجب أن يوجد إذن "استلام مرتجعات" مكتمل مرتبط بالشحنة R
  const rRvouchers = await req('GET', `/api/shipments/${shR.id}/vouchers`, undefined, admin.token)
  const rvItems = asItems(rRvouchers.data)
  const hasReceivingVoucher = rvItems.some((v: any) => v.type === 'returned_receiving' && v.status === 'completed')
  log('S17: أُنشئ إذن "استلام مرتجعات" مكتمل تلقائيًا', hasReceivingVoucher, `إجمالي سندات الشحنة: ${rvItems.length}`)

  // ---------- S18: منع تسليم مرتجع مرتين ----------
  console.log('\n—— S18: منع تسليم المرتجع مرتين ——')
  const markRes2 = await req('POST', `/api/vouchers/${rR5.id}/mark-received`, { notes: 'محاولة ثانية TEST-E2E' }, admin.token)
  const markFail = markRes2.status === 200 && (markRes2.data?.succeeded === 0) && (markRes2.data?.failed === 1)
  log('S18: تسليم نفس المرتجع مرة ثانية = 0 نجاح، 1 فشل (لا تكرار)', markFail, `نجح ${markRes2.data?.succeeded}/${markRes2.data?.total}`)

  // ---------- S19: صلاحية الأسعار — viewer لا يرى المبالغ ----------
  console.log('\n—— S19: صلاحية الأسعار (prices.view) — إخفاء المبالغ عن غير المصرح لهم ——')
  // viewer لا يملك prices.view — يجب أن تكون حقول الأسعار مفرغة
  const vs = await req('GET', `/api/shipments/${shA.id}`, undefined, viewer.token)
  const vsOk = vs.data?.freightTotal == null && vs.data?.customerPay == null && vs.data?.salePrice == null && vs.data?.freightCost == null
  log('S19: viewer لا يرى أسعار الشحنة (freightTotal/customerPay/salePrice/freightCost مفرغة)', vsOk, `freightTotal=${vs.data?.freightTotal}`)
  // ops (محمود) يملك prices.view — يجب أن يرى الأسعار
  const os = await req('GET', `/api/shipments/${shA.id}`, undefined, ops.token)
  const osOk = os.data?.freightTotal != null
  log('S19: محمود (ops) يرى أسعار الشحنة', osOk, `freightTotal=${os.data?.freightTotal}`)
  // admin يرى الأسعار (عبر '*')
  const as_ = await req('GET', `/api/shipments/${shA.id}`, undefined, admin.token)
  const asOk = as_.data?.freightTotal != null
  log('S19: admin يرى أسعار الشحنة', asOk, `freightTotal=${as_.data?.freightTotal}`)
  // viewer لا يمكنه الوصول لتقارير الأسعار (403)
  await mustFail('S19: viewer لا يصل لتقرير هامش النولون (403)', 403, 'GET', '/api/reports/freight-margin', undefined, viewer.token)
  await mustFail('S19: viewer لا يصل لتقرير مستحقات المقاولين (403)', 403, 'GET', '/api/reports/contractor-dues', undefined, viewer.token)
  await mustFail('S19: viewer لا يصل لتقرير ديون العملاء (403)', 403, 'GET', '/api/reports/customer-debts', undefined, viewer.token)
  // viewer يصل لتقرير المرتجعات لم تُستلم (لا يكشف أسعارًا)
  const vtpr = await req('GET', '/api/reports/pending-returns', undefined, viewer.token)
  log('S19: viewer يصل لتقرير "المرتجعات لم تُستلم" (لا أسعار)', vtpr.status === 200, `HTTP ${vtpr.status}`)
  // محمود يصل لتقارير الأسعار (200)
  const otpr = await req('GET', '/api/reports/freight-margin', undefined, ops.token)
  log('S19: محمود يصل لتقرير هامش النولون (له صلاحية)', otpr.status === 200, `HTTP ${otpr.status}`)
  // vouchers stats: viewer يجب أن تكون collectionTotal/disbursementTotal = 0
  const vs2 = await req('GET', '/api/vouchers/stats', undefined, viewer.token)
  const vsStatsOk = vs2.data?.collectionTotal === 0 && vs2.data?.disbursementTotal === 0
  log('S19: viewer لا يرى محصّلات/مصروفات الأذونات المالية', vsStatsOk, `collection=${vs2.data?.collectionTotal} disbursement=${vs2.data?.disbursementTotal}`)
  // محمود يرى المحصّلات
  const os2 = await req('GET', '/api/vouchers/stats', undefined, ops.token)
  const osStatsOk = os2.data?.collectionTotal !== 0 || os2.data?.disbursementTotal !== 0
  log('S19: محمود يرى محصّلات/مصروفات الأذونات المالية', osStatsOk, `collection=${os2.data?.collectionTotal}`)

  // ---------- S20: قيد محاسبي للأذونات المالية لا يكشف عنه لغير المصرح لهم ----------
  console.log('\n—— S20: قيد سند القبض لا يكشف مبالغه لغير المصرح لهم ——')
  // سند القبض r7 (collection 500) — viewer يجب أن يرى amount=null و totalValue=0
  const vV7 = await req('GET', `/api/vouchers/${r7.id}`, undefined, viewer.token)
  const v7Ok = vV7.data?.amount == null && (vV7.data?.totalValue === 0 || vV7.data?.totalValue == null)
  log('S20: viewer لا يرى مبلغ سند القبض', v7Ok, `amount=${vV7.data?.amount} totalValue=${vV7.data?.totalValue}`)
  const oV7 = await req('GET', `/api/vouchers/${r7.id}`, undefined, ops.token)
  const o7Ok = oV7.data?.amount === 500
  log('S20: محمود يرى مبلغ سند القبض', o7Ok, `amount=${oV7.data?.amount}`)

  // ---------- الملخص ----------
  const total = passCount + failCount
  console.log('\n════════════════════════════════════')
  console.log(`النتيجة: ${passCount}/${total} ناجح${failCount ? ` — ${failCount} فاشل` : ' ✨ كل السيناريوهات ناجحة'}`)
  console.log('════════════════════════════════════')
  if (failures.length) {
    console.log('السيناريوهات الفاشلة:')
    for (const f of failures) console.log(`  ❌ ${f}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(`\n💥 توقف الاختبار: ${e.message}`)
  console.log(`النتيجة الجزئية: ${passCount} ناجح / ${failCount} فاشل`)
  process.exit(1)
})
