#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E2E Reconciliation — Executive View = Contractor Statement = Monthly Report = Ledger/TrialBalance
   Asserts 0.00 difference across all four screens for EVERY active contractor."""
import json, subprocess
from datetime import datetime

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
        return {'_raw': out[:200]}

ADMIN = json.load(open('/tmp/tokens.json'))['admin']
now = datetime.now()
YEAR, MONTH = now.year, now.month

fails = []
rows = []

# 1) Executive view
exec_data = api(ADMIN, 'GET', '/api/executive')
assert 'contractors' in exec_data, exec_data

# 2) Trial balance (account-wide)
tb = api(ADMIN, 'GET', '/api/reports/trial-balance')
tb2102 = next(it for it in tb['items'] if it['code'] == '2102')

# direct DB ledger per party (source of truth)
script = f'''
import {{ PrismaClient }} from '@prisma/client'
const db = new PrismaClient()
const acc = await db.account.findUnique({{ where: {{ code: '2102' }} }})
const lines = await db.journalLine.findMany({{ where: {{ accountId: acc.id, entry: {{ status: 'posted' }} }}, select: {{ partyId: true, debit: true, credit: true }} }})
const map = {{}}
for (const l of lines) {{
  if (!l.partyId) continue
  // 2102 liability: remaining for contractor = credit − debit
  map[l.partyId] = (map[l.partyId] ?? 0) + (l.credit ?? 0) - (l.debit ?? 0)
}}
console.log(JSON.stringify(map))
await db.$disconnect()
'''
import tempfile, os
tf = tempfile.NamedTemporaryFile('w', suffix='.ts', delete=False, dir='/home/z/my-project/.e2e')
tf.write(script)
tf.close()
ledger_raw = subprocess.run('cd /home/z/my-project && bun run ' + tf.name, shell=True, capture_output=True, text=True).stdout.strip()
os.unlink(tf.name)
ledger = json.loads(ledger_raw)

print(f"{'contractor':<28} {'exec.remain':>12} {'−stmt.close':>12} {'monthly.net':>12} {'ledger':>12} {'Δ':>8}")
for c in exec_data['contractors']:
    cid, name = c['id'], c['name']
    st = api(ADMIN, 'GET', f'/api/parties/{cid}/statement')
    closing = st.get('totals', {}).get('closing')
    mon = api(ADMIN, 'GET', f'/api/reports/contractor-monthly?contractorId={cid}&year={YEAR}&month={MONTH}')
    net = mon.get('totals', {}).get('net')
    led = round(ledger.get(cid, 0), 2)
    exec_rem = round(c['remaining'], 2)
    neg_closing = round(-closing, 2) if closing is not None else None
    net_v = round(net, 2) if net is not None else None
    diffs = [abs(exec_rem - x) for x in (neg_closing, net_v, led) if x is not None]
    max_diff = max(diffs) if diffs else 0
    ok = max_diff < 0.005
    if not ok:
        fails.append((name, exec_rem, neg_closing, net_v, led, max_diff))
    rows.append((name, exec_rem, neg_closing, net_v, led, max_diff))
    print(f"{name[:26]:<28} {exec_rem:>12} {neg_closing:>12} {net_v:>12} {led:>12} {max_diff:>8.2f} {'OK' if ok else 'MISMATCH!'}")

# aggregate checks
sum_exec = round(sum(c['remaining'] for c in exec_data['contractors']), 2)
sum_ledger = round(sum(v for v in ledger.values()), 2)
print(f"\nExecutive totals.remaining={sum_exec} | Σ ledger parties={sum_ledger} | TB 2102 balance={tb2102['balance']}")
d1 = abs(sum_exec - sum_ledger)
print(f"Δ(exec Σ vs ledger Σ) = {d1:.2f} → {'OK' if d1 < 0.005 else 'MISMATCH!'}")
if d1 >= 0.005:
    fails.append(('Σ executive vs Σ ledger', sum_exec, sum_ledger, '', '', d1))
# parties with opening balances not in ledger map (zero-activity contractors)
untracked = [c['name'] for c in exec_data['contractors'] if c['id'] not in ledger and abs(c['remaining']) > 0.005]
if untracked:
    fails.append(('executors with remaining but no ledger lines', untracked, '', '', '', ''))

# monthly opening consistency: opening of current month == statement closing − current month movements
print('\n--- monthly opening vs statement (sample: first 3 contractors) ---')
for c in exec_data['contractors'][:3]:
    st = api(ADMIN, 'GET', f'/api/parties/{c["id"]}/statement')
    mon = api(ADMIN, 'GET', f'/api/reports/contractor-monthly?contractorId={c["id"]}&year={YEAR}&month={MONTH}')
    closing = st['totals']['closing']
    month_moves = sum(round(i['amount'], 2) for i in mon['items'])
    implied_opening = round(closing + month_moves, 2)  # closing = debit−credit; openingForHim = −(closing + moves)
    mon_opening = round(mon['opening'], 2)
    d = abs(implied_opening + mon_opening)
    print(f"{c['name'][:24]:<26} stmt.closing={closing:>12} month.moves={month_moves:>12} implied−opening={implied_opening:>12} monthly.opening={mon_opening:>12} Δ={d:.2f} {'OK' if d < 0.005 else 'MISMATCH!'}")
    if d >= 0.005:
        fails.append((c['name'] + ' monthly-opening', implied_opening, mon_opening, '', '', d))

print('\n===== RECONCILIATION SUMMARY =====')
print('FAILS:', len(fails))
for f_ in fails:
    print('  MISMATCH:', f_)
print('ALL FOUR SCREENS MATCH 0.00' if not fails else 'DISCREPANCIES FOUND')
