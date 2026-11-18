#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E2E Phase 1b v2 — corrected contracts:
   - reverse payment: POST /api/invoices/{id}/payments/reverse {paymentId} (as UI does)
   - issue net effect: AR +1140-1000 (reclass), revenue net 0 (no double count), VAT +140
   - cancel-guard on paid → 409 'مسددة بالكامل'"""
import json, subprocess, time

BASE = 'http://localhost:3000'
RUN = str(int(time.time()))[-6:]

def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout

def api(token, method, path, body=None, raw=False):
    cmd = f"curl -s -X {method} '{BASE}{path}' -H 'x-session-token: {token}' -H 'Content-Type: application/json'"
    if body is not None:
        cmd += f" -d '{json.dumps(body, ensure_ascii=False)}'"
    out = sh(cmd)
    if raw:
        return out
    try:
        return json.loads(out) if out else {}
    except Exception:
        return {'_raw': out[:200]}

def acc(token):
    r = api(token, 'GET', '/api/reports/trial-balance')
    return {it['code']: it for it in r.get('items', [])}

results, FAILS = [], []
S = json.load(open('/tmp/e2e_state.json'))

def check(name, cond, detail=''):
    results.append(('PASS' if cond else 'FAIL', name, str(detail)))
    if not cond:
        FAILS.append((name, str(detail)))
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail else ''))

ADMIN = json.load(open('/tmp/tokens.json'))['admin']
CID = S['contractor']['id']
CUST = S['customer']['id']

print('========== E) CONTRACTOR PAYMENT + REVERSAL ==========')
bal = acc(ADMIN)
cash0, cont0 = bal['1101']['balance'], bal['2102']['balance']
r = api(ADMIN, 'POST', '/api/payments', {'contractorId': CID, 'amount': 500, 'method': 'cash', 'notes': 'E2E دفعة'})
check('E1 payment created (voucher + JE)', 'voucherNo' in r and r.get('journalEntryNo'), str(r)[:110])
S['payments'].append(r.get('voucherNo'))
bal = acc(ADMIN)
check('E2 JE Dr 2102 (+500)', abs((bal['2102']['balance'] - cont0) - 500) < 0.006, f"{cont0} → {bal['2102']['balance']}")
check('E3 JE Cr 1101 (−500)', abs((bal['1101']['balance'] - cash0) + 500) < 0.006, f"{cash0} → {bal['1101']['balance']}")
lst = api(ADMIN, 'GET', '/api/payments?contractorId=' + CID)['items']
top = lst[0]
check('E4 list effective=true + JE', top['status'] == 'completed' and top['effective'] and top['journalEntryNo'] == r['journalEntryNo'], f"{top['voucherNo']}")
r = api(ADMIN, 'POST', '/api/payments', {'contractorId': CID, 'amount': -5, 'method': 'cash'})
check('E5 negative rejected', isinstance(r.get('error'), str) and 'أكبر من صفر' in r['error'], r.get('error', '')[:70])
r = api(ADMIN, 'POST', '/api/payments', {'contractorId': CID, 'amount': 10, 'method': 'crypto'})
check('E6 unknown method rejected', isinstance(r.get('error'), str) and 'طريقة الدفع' in r['error'], r.get('error', '')[:70])
bal = acc(ADMIN)
bank0, cont1 = bal['1102']['balance'], bal['2102']['balance']
r2 = api(ADMIN, 'POST', '/api/payments', {'contractorId': CID, 'amount': 300, 'method': 'bank', 'notes': 'E2E بنكي'})
check('E7 bank payment created', 'voucherNo' in r2 and r2.get('journalEntryNo'), str(r2)[:90])
S['payments'].append(r2.get('voucherNo'))
bal = acc(ADMIN)
check('E8 bank JE 2102 +300 / 1102 −300', abs((bal['2102']['balance'] - cont1) - 300) < 0.006 and abs((bal['1102']['balance'] - bank0) + 300) < 0.006, f"2102→{bal['2102']['balance']}, 1102→{bal['1102']['balance']}")
payment_id_2 = api(ADMIN, 'GET', f"/api/payments?contractorId={CID}")['items'][0]['id']
bal = acc(ADMIN)
cont2, bank2 = bal['2102']['balance'], bal['1102']['balance']
r3 = api(ADMIN, 'DELETE', f"/api/payments/{payment_id_2}", {'reason': 'E2E إرجاع'})
check('E9 reversal OK (voucherNo + reversalNo)', r3.get('reversalNo') and r3.get('voucherNo'), str(r3)[:100])
bal = acc(ADMIN)
check('E10 reversal 2102 −300 / 1102 +300', abs((bal['2102']['balance'] - cont2) + 300) < 0.006 and abs((bal['1102']['balance'] - bank2) - 300) < 0.006, f"2102→{bal['2102']['balance']}, 1102→{bal['1102']['balance']}")
lst = api(ADMIN, 'GET', f"/api/payments?contractorId={CID}")['items']
reversed_top = next((x for x in lst if x['id'] == payment_id_2), None)
check('E11 reversed effective=false cancelled', reversed_top and reversed_top['status'] == 'cancelled' and reversed_top['effective'] is False, str(reversed_top['status'] if reversed_top else 'missing'))
r4 = api(ADMIN, 'DELETE', f"/api/payments/{payment_id_2}", {'reason': 'E2E'})
check('E12 double reversal rejected', isinstance(r4.get('error'), str) and 'مرتين' in r4['error'], r4.get('error', '')[:80])

print('========== F) INVOICE LIFECYCLE ==========')
DN2 = f'E2E-INV-{RUN}'
r = api(ADMIN, 'POST', '/api/shipments', {'contractorId': CID, 'customerId': CUST, 'destination': 'القاهرة فاتورة', 'deliveryNumber': DN2, 'freightCost': 600, 'freightTotal': 1000})
s2 = r.get('id'); S['shipments'].append(s2)
check('F1 invoice shipment created', bool(s2), str(r)[:70])
for st in ['received', 'loaded', 'out_for_delivery']:
    api(ADMIN, 'POST', f'/api/shipments/{s2}/status', {'status': st})
r = api(ADMIN, 'POST', f'/api/shipments/{s2}/status', {'status': 'delivered'})
check('F2 delivered (JE posted)', 'error' not in r, str(r)[:80])
uninv = api(ADMIN, 'GET', f'/api/invoices/uninvoiced-shipments?customerId={CUST}')['items']
check('F3 shipment in uninvoiced pool', any(x['id'] == s2 for x in uninv), f"pool {len(uninv)}")
r = api(ADMIN, 'POST', '/api/invoices', {'customerId': CUST, 'vatRate': 14, 'notes': 'E2E فاتورة', 'items': [{'shipmentId': s2, 'description': 'نولون شحنة E2E', 'quantity': 1, 'unitPrice': 1000}]})
inv = r
check('F4 draft created', 'id' in r and r.get('invoiceNumber', '').startswith('INV-'), str(r)[:110])
S['invoices'].append(inv.get('id'))
det = api(ADMIN, 'GET', f"/api/invoices/{inv['id']}")
check('F5 draft no JE', det.get('journalEntryId') is None, f"status={det.get('status')}")
r = api(ADMIN, 'POST', '/api/invoices', {'customerId': CUST, 'vatRate': 14, 'items': [{'shipmentId': s2, 'description': 'مكرر', 'quantity': 1, 'unitPrice': 1000}]})
check('F6 double invoicing rejected', isinstance(r.get('error'), str) and 'مرتين' in r['error'], r.get('error', '')[:100])

bal_pre_issue = acc(ADMIN)
r = api(ADMIN, 'POST', f"/api/invoices/{inv['id']}/issue", {})
check('F7 issued (JE + reversals)', 'journalEntryNo' in r, str(r)[:140])
bal = acc(ADMIN)
# net AR = invoice Dr 1140 − delivery JE reversal Dr 1000 = +140
check('F8 AR net +140 (1140 − 1000 reclass)', abs((bal['1103']['balance'] - bal_pre_issue['1103']['balance']) - 140) < 0.006, f"{bal_pre_issue['1103']['balance']} → {bal['1103']['balance']}")
# revenue net 0: delivery JE (Cr 1000) reversed then invoice Cr 1000 — no double count
check('F9 revenue 4101 net 0 (no double count)', abs(bal['4101']['balance'] - bal_pre_issue['4101']['balance']) < 0.006, f"{bal_pre_issue['4101']['balance']} → {bal['4101']['balance']}")
check('F10 VAT 2103 += 140 credit', abs((bal['2103']['balance'] - bal_pre_issue['2103']['balance']) + 140) < 0.006, f"→ {bal['2103']['balance']}")
check('F11 2102 unchanged by issue', abs(bal['2102']['balance'] - bal_pre_issue['2102']['balance']) < 0.006, f"→ {bal['2102']['balance']}")
det = api(ADMIN, 'GET', f"/api/invoices/{inv['id']}")
check('F12 status=issued + JE', det.get('status') == 'issued' and (det.get('journalEntry') or {}).get('entryNo') == r.get('journalEntryNo'), f"status={det.get('status')}")
r = api(ADMIN, 'POST', f"/api/invoices/{inv['id']}/payments", {'amount': 500, 'method': 'cash', 'notes': 'E2E دفعة 1'})
check('F13 partial → partially_paid', r.get('status') == 'partially_paid' and r.get('paidAmount') == 500, str(r)[:110])
pays = api(ADMIN, 'GET', f"/api/invoices/{inv['id']}").get('payments', [])
pay1 = next(p for p in pays if p['status'] == 'completed' and p['amount'] == 500)
r = api(ADMIN, 'POST', f"/api/invoices/{inv['id']}/payments", {'amount': 99999, 'method': 'cash'})
check('F14 overpayment rejected', isinstance(r.get('error'), str) and 'تتجاوز المتبقي' in r['error'], r.get('error', '')[:90])
r = api(ADMIN, 'POST', f"/api/invoices/{inv['id']}/payments", {'amount': 640, 'method': 'bank', 'notes': 'E2E دفعة 2'})
check('F15 full → paid', r.get('status') == 'paid' and r.get('paidAmount') == 1140, str(r)[:110])
pays = api(ADMIN, 'GET', f"/api/invoices/{inv['id']}").get('payments', [])
pay2 = next(p for p in pays if p['status'] == 'completed' and p['amount'] == 640)
r = api(ADMIN, 'POST', f"/api/invoices/{inv['id']}/cancel", {'reason': 'E2E'})
check('F16 cancel-guard on paid → 409', isinstance(r.get('error'), str) and ('مسددة بالكامل' in r['error'] or 'دفعات' in r['error']), r.get('error', '')[:90])

bal = acc(ADMIN)
ar1 = bal['1103']['balance']
r = api(ADMIN, 'POST', f"/api/invoices/{inv['id']}/payments/reverse", {'paymentId': pay2['id'], 'reason': 'E2E عكس'})
check('F17 reverse payment → partially_paid', r.get('status') == 'partially_paid' and r.get('reversalNo'), str(r)[:110])
bal = acc(ADMIN)
check('F18 AR +640 after reversal', abs((bal['1103']['balance'] - ar1) - 640) < 0.006, f"{ar1} → {bal['1103']['balance']}")
r = api(ADMIN, 'POST', f"/api/invoices/{inv['id']}/payments/reverse", {'paymentId': pay1['id'], 'reason': 'E2E'})
check('F19 second reversal → issued', r.get('status') == 'issued', str(r)[:90])
det = api(ADMIN, 'GET', f"/api/invoices/{inv['id']}")
check('F20 paidAmount reset 0', abs(det.get('paidAmount', 1)) < 0.006, f"paid={det.get('paidAmount')}")

bal_pre_cancel = acc(ADMIN)
r = api(ADMIN, 'POST', f"/api/invoices/{inv['id']}/cancel", {'reason': 'E2E إلغاء'})
check('F21 cancel issued invoice OK', r.get('reversalNo'), str(r)[:110])
bal = acc(ADMIN)
check('F22 AR net 0 after cancel', abs(bal['1103']['balance'] - bal_pre_cancel['1103']['balance']) < 0.006, f"→ {bal['1103']['balance']}")
check('F23 VAT net 0 after cancel', abs(bal['2103']['balance'] - bal_pre_cancel['2103']['balance']) < 0.006, f"→ {bal['2103']['balance']}")
uninv = api(ADMIN, 'GET', f'/api/invoices/uninvoiced-shipments?customerId={CUST}')['items']
check('F24 shipment released to pool', any(x['id'] == s2 for x in uninv), f"pool {len(uninv)}")
det = api(ADMIN, 'GET', f"/api/invoices/{inv['id']}")
check('F25 status=cancelled', det.get('status') == 'cancelled', f"status={det.get('status')}")

json.dump(S, open('/tmp/e2e_state.json', 'w'), ensure_ascii=False)
print('\n===== PHASE-1B SUMMARY =====')
print(f"total={len(results)} pass={len(results)-len(FAILS)} fail={len(FAILS)}")
for f_ in FAILS:
    print('  FAIL:', f_[0], '—', f_[1][:160])
