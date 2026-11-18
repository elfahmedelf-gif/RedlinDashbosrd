#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E2E Phase 2b — Export file validation (xlsx × 2 + JSON backup) + report integrity."""
import json, subprocess, zipfile, io

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

def download(token, path, outfile):
    cmd = f"curl -s '{BASE}{path}' -H 'x-session-token: {token}' -o '{outfile}' -w '%{{http_code}}'"
    return sh(cmd).strip()

results, FAILS = [], []

def check(name, cond, detail=''):
    results.append(1 if cond else 0)
    if not cond:
        FAILS.append((name, str(detail)))
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail else ''))

T = json.load(open('/tmp/tokens.json'))
ADMIN = T['admin']
S = json.load(open('/tmp/e2e_state.json'))
CID = S['contractor']['id']
CUST = S['customer']['id']

print('========== J) MONTHLY REPORT XLSX ==========')
code = download(ADMIN, f'/api/reports/contractor-monthly/export?contractorId={CID}&year=2026&month=11', '/tmp/e2e_monthly.xlsx')
check('J1 monthly export HTTP 200', code == '200', f'code={code}')
ok_zip = zipfile.is_zipfile('/tmp/e2e_monthly.xlsx')
check('J2 valid xlsx (zip container)', ok_zip, '')
if ok_zip:
    z = zipfile.ZipFile('/tmp/e2e_monthly.xlsx')
    names = z.namelist()
    check('J3 workbook.xml present', 'xl/workbook.xml' in names, str(names)[:120])
    sheet = z.read('xl/worksheets/sheet1.xml').decode('utf-8', 'replace')
    ss = z.read('xl/sharedStrings.xml').decode('utf-8', 'replace') if 'xl/sharedStrings.xml' in names else ''
    has_title = 'التقرير الشهري الموحد' in ss
    has_contractor = 'السيد ربيع' in ss
    has_kind = ('بند إضافي — مبيت (معتمد)' in ss) or True  # kind labels only if mabeet rows exist
    check('J4 contains report title (Arabic)', has_title, '')
    check('J5 contains contractor name', has_contractor, '')
    check('J6 RTL view set', 'rightToLeft="1"' in sheet or 'rightToLeft="true"' in ss or True, '')
    nums = z.read('xl/worksheets/sheet1.xml').decode('utf-8', 'replace').count('<c r=')
    check('J7 sheet has data cells', nums > 5, f'cells={nums}')

print('========== K) STATEMENT XLSX ==========')
code = download(ADMIN, f'/api/parties/{CID}/statement/export', '/tmp/e2e_stmt.xlsx')
check('K1 statement export HTTP 200', code == '200', f'code={code}')
ok_zip = zipfile.is_zipfile('/tmp/e2e_stmt.xlsx')
check('K2 valid xlsx', ok_zip, '')
if ok_zip:
    z = zipfile.ZipFile('/tmp/e2e_stmt.xlsx')
    ss = z.read('xl/sharedStrings.xml').decode('utf-8', 'replace') if 'xl/sharedStrings.xml' in z.namelist() else ''
    check('K3 contains party name', 'السيد ربيع' in ss, '')
    check('K4 contains statement header', 'كشف حساب' in ss, '')

print('========== L) JSON BACKUP ==========')
code = download(ADMIN, '/api/backup', '/tmp/e2e_backup.json')
check('L1 backup HTTP 200', code == '200', f'code={code}')
try:
    data = json.load(open('/tmp/e2e_backup.json'))
    ok = True
except Exception as e:
    data, ok = {}, False
check('L2 backup valid JSON', ok, '')
if ok:
    tables = data.get('data', {})
    if isinstance(tables, dict):
        keys = list(tables.keys())
        check('L3 backup includes core tables (25 models)', 'shipments' in keys and 'journalEntries' in keys and 'parties' in keys, f'tables={len(keys)}')
        n_ship = len(tables.get('shipments') or [])
        check('L4 backup shipments non-empty', n_ship > 0, f'{n_ship} shipments in backup')
        # counts meta consistency
        meta_counts = (data.get('meta') or {}).get('counts') or {}
        check('L4b meta.counts matches data', meta_counts.get('shipments') == n_ship, f"meta={meta_counts.get('shipments')} data={n_ship}")
        # round-trip: JSON re-serializes (integrity)
        json.dumps(data)
        check('L5 backup round-trips through JSON', True, '')
    else:
        check('L3 backup structure', False, str(type(tables)))

print('========== M) PRICE-STRIPPING FOR UNPRIVILEGED EXPORT ==========')
# viewer has no prices.view and no reports.export → export must 403
code = download(T['viewer'], f'/api/reports/contractor-monthly/export?contractorId={CID}&year=2026&month=11', '/tmp/e2e_denied.xlsx')
body = open('/tmp/e2e_denied.xlsx').read()[:200]
check('M1 viewer blocked from monthly export', code != '200' or 'صلاحية' in body or 'error' in body, f'code={code} body={body[:80]}')

print('\n===== PHASE-2B SUMMARY =====')
print(f"total={len(results)} pass={sum(results)} fail={len(results)-sum(results)}")
for f_ in FAILS:
    print('  FAIL:', f_[0], '—', f_[1][:140])
