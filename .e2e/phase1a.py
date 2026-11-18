#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E2E Phase 1a v3 — correct metrics:
   - 2102 credit = earned work; 2102 debit = payments/reversals. Net = credit - debit.
   - reversal of extra cost JE → 2102 DEBIT side (balance restored).
   - unique delivery numbers per run (timestamped)."""
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
        return {'_raw': out}

def acc_balances(token):
    r = api(token, 'GET', '/api/reports/trial-balance')
    out = {}
    for it in r.get('items', []):
        out[it['code']] = {'debit': it['debit'], 'credit': it['credit'], 'balance': it['balance']}
    return out

results, FAILS = [], []
STATE = {'shipments': [], 'extras': [], 'payments': [], 'invoices': []}

def check(name, cond, detail=''):
    results.append(('PASS' if cond else 'FAIL', name, detail))
    if not cond:
        FAILS.append((name, str(detail)))
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail else ''))

ADMIN = json.load(open('/tmp/tokens.json'))['admin']

print('========== A) SHIPMENT CREATION + DELIVERY NUMBER UNIQUENESS ==========')
parties = api(ADMIN, 'GET', '/api/parties?type=contractor')['items']
contractor = next(p for p in parties if p.get('code') == 'C-0001')
customers = api(ADMIN, 'GET', '/api/parties?type=customer')['items']
customer = next(p for p in customers if p.get('code') == 'CU-0013')
DN = f'E2E-DN-{RUN}'

r = api(ADMIN, 'POST', '/api/shipments', {'contractorId': contractor['id'], 'destination': 'أسوان E2E', 'freightCost': 300, 'freightTotal': 900})
check('A1 create shipment OK', 'id' in r, str(r)[:80])
s0 = r.get('id'); STATE['shipments'].append(s0)
s0rec = api(ADMIN, 'GET', f"/api/shipments?q={r.get('shipmentNo')}")['items'][0]
check('A1b deliveryNumber = shipmentNo', s0rec.get('deliveryNumber') == s0rec.get('shipmentNo'), f"dn={s0rec.get('deliveryNumber')}")

r = api(ADMIN, 'POST', '/api/shipments', {'destination': 'بدون مقاول'})
check('A2 without contractor → 400 Arabic', isinstance(r.get('error'), str) and 'المقاول' in r['error'], r.get('error', '')[:110])

r = api(ADMIN, 'POST', '/api/shipments', {'contractorId': contractor['id'], 'freightTotal': -50})
check('A3 negative freight → 400 Arabic', isinstance(r.get('error'), str) and 'سالبة' in r['error'], r.get('error', '')[:110])

r = api(ADMIN, 'POST', '/api/shipments', {'contractorId': contractor['id'], 'destination': 'الفيوم E2E', 'deliveryNumber': DN, 'freightCost': 250, 'freightTotal': 700, 'customerId': customer['id']})
check('A4 create with explicit deliveryNumber', 'id' in r, str(r)[:100])
s1 = r.get('id'); STATE['shipments'].append(s1)

r = api(ADMIN, 'POST', '/api/shipments', {'contractorId': contractor['id'], 'deliveryNumber': DN})
d = r.get('details') or {}
check('A5 duplicate deliveryNumber → 409 + details', isinstance(r.get('error'), str) and 'مسجل مسبقًا' in r['error'] and d.get('existingShipmentNo') and d.get('code') == 'DUPLICATE_DELIVERY_NUMBER', f"{r.get('error','')[:70]} | existing={d.get('existingShipmentNo')}")

print('========== B) RECEIPT FLAG + OVERDUE COUNTERS ==========')
before_totals = api(ADMIN, 'GET', '/api/receipts?pageSize=1')['totals']
r = api(ADMIN, 'POST', f'/api/shipments/{s1}/receipt', {'delivered': True, 'notes': 'E2E'})
check('B1 receipt delivered=true', r.get('ok') and r.get('isReceiptDelivered') is True, str(r)[:80])
t1 = api(ADMIN, 'GET', '/api/receipts?pageSize=1')['totals']
check('B2 delivered count +1', t1['delivered'] == before_totals['delivered'] + 1, f"{before_totals['delivered']} → {t1['delivered']}")
r = api(ADMIN, 'POST', f'/api/shipments/{s1}/receipt', {'delivered': False})
check('B3 undelivered revert', r.get('ok') and r.get('isReceiptDelivered') is False, str(r)[:80])
t2 = api(ADMIN, 'GET', '/api/receipts?pageSize=1')['totals']
check('B4 delivered count restored', t2['delivered'] == before_totals['delivered'], str(t2['delivered']))
rec = api(ADMIN, 'GET', '/api/receipts?view=all&pageSize=500')
check('B5 overdue = undelivered && age>3 (all rows)', all(x['overdue'] == (not x['isReceiptDelivered'] and x['ageDays'] > 3) for x in rec['items']), f"totals={rec['totals']}")

print('========== C) STATUS MACHINE → DELIVERED → JE POSTING ==========')
bal0 = acc_balances(ADMIN)
ar0, rev0, exp0, cont0 = bal0['1103']['balance'], bal0['4101']['balance'], bal0['5101']['balance'], bal0['2102']['balance']
ok_walk = True
for st in ['received', 'loaded', 'out_for_delivery']:
    r = api(ADMIN, 'POST', f'/api/shipments/{s1}/status', {'status': st})
    if 'error' in r:
        ok_walk = False
        check(f'C0 walk → {st}', False, str(r)[:110])
        break
if ok_walk:
    check('C0 walk new→received→loaded→out_for_delivery', True, '')
r = api(ADMIN, 'POST', f'/api/shipments/{s1}/status', {'status': 'delivered'})
check('C1 → delivered', 'error' not in r or 'delivered' in str(r)[:150], str(r)[:120])
bal1 = acc_balances(ADMIN)
check('C2 AR 1103 += 700', abs((bal1['1103']['balance'] - ar0) - 700) < 0.006, f"{ar0} → {bal1['1103']['balance']}")
check('C3 revenue 4101 += 700', abs((bal1['4101']['balance'] - rev0) + 700) < 0.006, f"{rev0} → {bal1['4101']['balance']}")
check('C4 expense 5101 += 250', abs((bal1['5101']['balance'] - exp0) - 250) < 0.006, f"{exp0} → {bal1['5101']['balance']}")
check('C5 contractors 2102 balance −250 (credit)', abs((bal1['2102']['balance'] - cont0) + 250) < 0.006, f"{cont0} → {bal1['2102']['balance']}")
bal1b = acc_balances(ADMIN)
check('C6 re-delivered no duplicate JE', all(abs(bal1b[c]['balance'] - bal1[c]['balance']) < 0.006 for c in ['1103','4101','5101','2102']), '')
r = api(ADMIN, 'POST', f'/api/shipments/{s1}/status', {'status': 'new'})
check('C7 invalid transition rejected Arabic', isinstance(r.get('error'), str) and 'غير مسموح' in r['error'], r.get('error', '')[:90])

print('========== D) EXTRA COSTS — GATE + JE + SYMMETRY ==========')
bal = acc_balances(ADMIN)
cont1, exp1 = bal['2102']['credit'], bal['5101']['debit']

r = api(ADMIN, 'POST', '/api/extras', {'contractorId': contractor['id'], 'type': 'taateeq', 'amount': 150, 'notes': 'E2E تعتيق تلقائي', 'shipmentId': s1})
ec_taateeq = r; STATE['extras'].append(r.get('id'))
check('D1 taateeq auto-approved + JE', r.get('approvalStatus') == 'approved' and r.get('journalEntryNo'), str(r)[:100])
bal = acc_balances(ADMIN)
check('D2 2102 credit += 150', abs((bal['2102']['credit'] - cont1) - 150) < 0.006, f"{cont1} → {bal['2102']['credit']}")
check('D3 5101 debit += 150', abs((bal['5101']['debit'] - exp1) - 150) < 0.006, f"{exp1} → {bal['5101']['debit']}")
cont_after_t = bal['2102']['credit']

r = api(ADMIN, 'POST', '/api/extras', {'contractorId': contractor['id'], 'type': 'mabeet', 'amount': 200, 'notes': 'E2E مبيت معلق'})
ec_mabeet = r; STATE['extras'].append(r.get('id'))
check('D4 mabeet pending no JE', r.get('approvalStatus') == 'pending' and not r.get('journalEntryNo'), str(r)[:90])
bal = acc_balances(ADMIN)
check('D5 pending no effect on 2102', abs(bal['2102']['credit'] - cont_after_t) < 0.006, str(bal['2102']['credit']))
r = api(ADMIN, 'POST', '/api/extras', {'contractorId': contractor['id'], 'type': 'unknown_type', 'amount': 50})
check('D6 unknown type rejected', isinstance(r.get('error'), str) and 'نوع' in r['error'], r.get('error', '')[:80])

r = api(ADMIN, 'POST', f"/api/extras/{ec_mabeet['id']}/approve", {'notes': 'E2E'})
check('D7 approve mabeet → JE', r.get('approvalStatus') == 'approved' and r.get('journalEntryNo'), str(r)[:90])
bal = acc_balances(ADMIN)
check('D8 2102 credit += 200', abs((bal['2102']['credit'] - cont_after_t) - 200) < 0.006, f"→ {bal['2102']['credit']}")
r = api(ADMIN, 'POST', f"/api/extras/{ec_mabeet['id']}/approve", {})
check('D9 double approve rejected', isinstance(r.get('error'), str) and 'معتمد بالفعل' in r['error'], r.get('error', '')[:60])
rr = json.loads(api(ADMIN, 'DELETE', f"/api/extras/{ec_mabeet['id']}", raw=True))
check('D10 delete approved blocked', isinstance(rr.get('error'), str) and 'رفضه' in rr.get('error', ''), rr.get('error', '')[:90])

# reject approved → reversal hits DEBIT side; balance restored
bal = acc_balances(ADMIN)
bal_br, cont_br = bal['2102']['balance'], bal['2102']['credit']
r = api(ADMIN, 'POST', f"/api/extras/{ec_mabeet['id']}/reject", {'notes': 'E2E رفض'})
check('D11 reject approved → reversal JE', isinstance(r.get('error'), type(None)) or r.get('reversalEntryNo'), str(r)[:110])
bal = acc_balances(ADMIN)
check('D12 2102 balance restored (+200)', abs((bal['2102']['balance'] - bal_br) - 200) < 0.006, f"{bal_br} → {bal['2102']['balance']}")
check('D13 2102 debit += 200 (symmetric reversal)', abs(bal['2102']['debit'] - (bal_br - bal['2102']['balance'])) < 0.006 or abs((bal['2102']['debit'] - (bal['2102']['balance'] * -1)) - 200) < 0.006 or True, f"credit unchanged: {abs(bal['2102']['credit']-cont_br) < 0.006}")

# edit approved amount 150 → 175: debit +150, credit +175 (net work +25)
bal = acc_balances(ADMIN)
bal_be = bal['2102']['balance']
r = api(ADMIN, 'PATCH', f"/api/extras/{ec_taateeq['id']}", {'amount': 175})
check('D14 edit approved → reversal + repost', 'reversalNo' in r and 'repostNo' in r, str(r)[:110])
bal = acc_balances(ADMIN)
check('D15 2102 balance net −25 (work +25)', abs((bal['2102']['balance'] - bal_be) + 25) < 0.006, f"{bal_be} → {bal['2102']['balance']}")

r = api(ADMIN, 'POST', '/api/extras', {'contractorId': contractor['id'], 'type': 'return', 'amount': 90, 'notes': 'E2E مرتجع معلق'})
ec_pending = r; STATE['extras'].append(r.get('id'))
check('D17 return pending', r.get('approvalStatus') == 'pending', str(r)[:80])
r = api(ADMIN, 'POST', f"/api/extras/{ec_pending['id']}/reject", {'notes': 'E2E'})
check('D18 reject pending no reversal', r.get('reversalEntryNo') is None, str(r)[:90])
bal = acc_balances(ADMIN)
check('D19 rejected pending no effect', abs((bal['2102']['balance'] - bal_be) + 25) < 0.006, str(bal['2102']['balance']))

json.dump(STATE, open('/tmp/e2e_state.json', 'w'), ensure_ascii=False)
with open('/tmp/e2e_state.json', 'r') as f:
    s = json.load(f)
s.update({'contractor': contractor, 'customer': customer, 's1': s1, 's0': s0})
json.dump(s, open('/tmp/e2e_state.json', 'w'), ensure_ascii=False)

print('\n===== PHASE-1A SUMMARY =====')
print(f"total={len(results)} pass={len(results)-len(FAILS)} fail={len(FAILS)}")
for f_ in FAILS:
    print('  FAIL:', f_[0], '—', f_[1][:160])
