#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E2E Cleanup — remove all temporary test records, restore ledger to baseline.
Order: reverse invoice payments → cancel INV-0011 → delete drafts → reject+delete extras
       → delete shipments (auto-reverses delivery JEs) → reverse UI payment → verify."""
import json, subprocess

BASE = 'http://localhost:3000'

def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout

def api(token, method, path, body=None):
    cmd = f"curl -s -X {method} '{BASE}{path}' -H 'x-session-token: {token}' -H 'Content-Type: application/json'"
    if body is not None:
        cmd += f" -d '{json.dumps(body, ensure_ascii=False)}'"
    out = sh(cmd)
    try:
        return json.loads(out) if out else {}
    except Exception:
        return {'_raw': out[:150]}

def acc(token):
    r = api(token, 'GET', '/api/reports/trial-balance')
    return {it['code']: it['balance'] for it in r.get('items', [])}

ADMIN = json.load(open('/tmp/tokens.json'))['admin']
BASELINE = json.load(open('/home/z/my-project/.e2e/baseline.json'))['balances']

print('========== CLEANUP ==========')

# 1) reverse INV-0011 payments
inv11 = 'cmwmm515i007dtx3hiq4r894f'
for pid, no in [('cmwmm518r008atx3ht5dy8eao', 'COL-0039'), ('cmwmm51a1008qtx3hd3ffxmha', 'COL-0040')]:
    r = api(ADMIN, 'POST', f'/api/invoices/{inv11}/payments/reverse', {'paymentId': pid, 'reason': 'تنظيف بيانات الاختبار E2E'})
    print(f"1) reverse {no}: {r.get('status')} rev={r.get('reversalNo')}")

# 2) cancel INV-0011
r = api(ADMIN, 'POST', f'/api/invoices/{inv11}/cancel', {'reason': 'تنظيف بيانات الاختبار E2E'})
print(f"2) cancel INV-0011: rev={r.get('reversalNo')}")

# 3) delete draft INV-0013
r = api(ADMIN, 'DELETE', '/api/invoices/cmwmmggvl00entx3h9nifiss5')
print(f"3) delete draft INV-0013: {r}")

# 4) reject approved extras then delete all E2E extras
for eid, ref in [('cmwmm17k80011tx3hoedow5zj', 'EC-0031'), ('cmwmm3yiw0042tx3hpo96fwsb', 'EC-0035')]:
    r = api(ADMIN, 'POST', f'/api/extras/{eid}/reject', {'notes': 'تنظيف بيانات الاختبار E2E'})
    print(f"4a) reject {ref}: rev={r.get('reversalEntryNo')}")
for eid, ref in [('cmwmm17k80011tx3hoedow5zj', 'EC-0031'), ('cmwmm17l8001ctx3hasy9aqbn', 'EC-0032'), ('cmwmm17rp002dtx3h9kprd158', 'EC-0033'), ('cmwmm2fvo002itx3hwl75pucl', 'EC-0034'), ('cmwmm3yiw0042tx3hpo96fwsb', 'EC-0035'), ('cmwmm3yjw004dtx3hv9unjk3h', 'EC-0036'), ('cmwmm3ypk005etx3hvhiowmsa', 'EC-0037')]:
    r = api(ADMIN, 'DELETE', f'/api/extras/{eid}')
    print(f"4b) delete {ref}: {r}")

# 5) delete all E2E shipments (delete receipt → reverses active delivery JEs)
ship_ids = ['cmwmlsfta0008tx3hw93ejol6',  # SH-00274
            'cmwmlsfuj000ftx3hqo2si7q1',  # SH-00277
            'cmwmm17ai000stx3hfksm3qwc',  # SH-00280 (run2 A1)
            'cmwmm3y6p0032tx3hyprp9mcf',  # SH-00285 (run3 A1)
            'cmwmm3y9k0039tx3hm2bvczig',  # SH-00288 (run3 A4)
            'cmwmm512f006rtx3hwm89gk6e',  # SH-00290 (run1 F1)
            'cmwmm6gg300aetx3hub13tnlh']  # SH-00291 (run3 F1)
for sid in ship_ids:
    r = api(ADMIN, 'DELETE', f'/api/shipments/{sid}')
    print(f"5) delete shipment {sid[-8:]}: {json.dumps(r, ensure_ascii=False)[:100]}")

# 6) reverse UI payment CSH-0035
r = api(ADMIN, 'DELETE', '/api/payments/cmwmmoqha00evtx3hpc8p2j2i', {'reason': 'تنظيف بيانات الاختبار E2E'})
print(f"6) reverse CSH-0035: {json.dumps(r, ensure_ascii=False)[:100]}")

# 7) verify balances vs baseline
bal = acc(ADMIN)
print('\n========== BALANCE VERIFICATION vs BASELINE ==========')
all_ok = True
for code, base in BASELINE.items():
    now = bal.get(code, 0)
    diff = round(now - base, 2)
    ok = abs(diff) < 0.005
    if not ok:
        all_ok = False
        print(f"  {code}: baseline={base} now={now} Δ={diff} ← MISMATCH")
print('ALL ACCOUNTS RESTORED TO BASELINE 0.00' if all_ok else 'DISCREPANCIES REMAIN')
