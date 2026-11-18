#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E2E Phase 2a — Role permissions isolation (403 gates) + roles module full save cycle
   + permissions catalog sync + admin/ops/viewer/finance sidebar-vs-API matrix."""
import json, subprocess

BASE = 'http://localhost:3000'

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
        return {'_raw': out[:120]}

T = json.load(open('/tmp/tokens.json'))
ADMIN, OPS, VIEWER, FINANCE = T['admin'], T['ops'], T['viewer'], T['finance']

results, FAILS = [], []

def check(name, cond, detail=''):
    results.append(1 if cond else 0)
    if not cond:
        FAILS.append((name, str(detail)))
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail else ''))

def expect_403(name, token, method, path, body=None):
    r = api(token, method, path, body)
    err = r.get('error', '')
    cond = ('غير مصرح' in err or 'صلاحية' in err) and '403' not in str(r)
    # detect status by presence of Arabic auth message
    ok = isinstance(err, str) and ('غير مصرح' in err or 'صلاحية' in err)
    check(name, ok, err[:110])

def expect_401(name, token, method, path, body=None):
    r = api(token, method, path, body)
    ok = isinstance(r.get('error'), str) and 'سجّل الدخول' in r['error']
    check(name, ok, r.get('error', '')[:90])

print('========== G) AUTH GATES ==========')
expect_401('G1 no token → 401', '', 'GET', '/api/shipments')
expect_401('G2 invalid token → 401', 'dead-token-xyz', 'GET', '/api/shipments')
expect_401('G3 no token POST → 401', '', 'POST', '/api/extras', {'contractorId': 'x'})
# logout kills session
tmp_token = json.loads(sh(f"curl -s -X POST {BASE}/api/auth/login -H 'Content-Type: application/json' -d '{{\"username\":\"viewer\",\"password\":\"view123\"}}'")).get('token')
api(tmp_token, 'POST', '/api/auth/logout')
r = api(tmp_token, 'GET', '/api/shipments')
check('G4 logout invalidates session', isinstance(r.get('error'), str) and 'سجّل الدخول' in r['error'], r.get('error', '')[:80])

print('========== H) ROLE ISOLATION MATRIX (API 403 gates) ==========')
# viewer: read-only
expect_403('H1 viewer cannot create shipment', VIEWER, 'POST', '/api/shipments', {'contractorId': 'x'})
expect_403('H2 viewer cannot create extra', VIEWER, 'POST', '/api/extras', {'contractorId': 'x', 'type': 'taateeq', 'amount': 1})
expect_403('H3 viewer cannot record payment', VIEWER, 'POST', '/api/payments', {'contractorId': 'x', 'amount': 1})
expect_403('H4 viewer cannot create invoice', VIEWER, 'POST', '/api/invoices', {'customerId': 'x', 'items': []})
expect_403('H5 viewer cannot manage roles', VIEWER, 'POST', '/api/roles', {'name': 'x'})
expect_403('H6 viewer cannot manage users', VIEWER, 'POST', '/api/users', {'username': 'x'})
expect_403('H7 viewer cannot export backup', VIEWER, 'GET', '/api/backup')
r = api(VIEWER, 'GET', '/api/shipments?pageSize=1')
check('H8 viewer CAN view shipments', 'items' in r, '')
r = api(VIEWER, 'GET', '/api/reports/contractor-monthly?contractorId=x&year=2026&month=11')
ok_price = r.get('error') is not None and ('أسعار' in r.get('error', '') or 'صلاحية' in r.get('error', ''))
check('H9 viewer blocked from price reports (prices.view)', ok_price, str(r.get('error', ''))[:90])

# ops (branch_manager): shipments yes, invoices no, users no
r = api(OPS, 'GET', '/api/shipments?pageSize=1')
check('H10 ops CAN view shipments', 'items' in r, '')
r = api(OPS, 'GET', '/api/parties?type=contractor&pageSize=1')
check('H11 ops CAN view parties', 'items' in r, '')
expect_403('H12 ops CANNOT issue invoices', OPS, 'POST', '/api/invoices/000000/invoice-fake/issue')
expect_403('H13 ops CANNOT manage users', OPS, 'POST', '/api/users', {'username': 'x'})
expect_403('H14 ops CANNOT manage roles', OPS, 'POST', '/api/roles', {'name': 'x'})
expect_403('H15 ops CANNOT access journal', OPS, 'GET', '/api/journal')
expect_403('H16 ops CANNOT export backup', OPS, 'GET', '/api/backup')

# finance: invoices/accounting yes, shipments.create no
r = api(FINANCE, 'GET', '/api/invoices?pageSize=1')
check('H17 finance CAN view invoices', 'items' in r, '')
r = api(FINANCE, 'GET', '/api/journal')
check('H18 finance CAN view journal', 'error' not in r, str(r.get('error', ''))[:80])
expect_403('H19 finance CANNOT create shipment', FINANCE, 'POST', '/api/shipments', {'contractorId': 'x'})
expect_403('H20 finance CANNOT manage users', FINANCE, 'POST', '/api/users', {'username': 'x'})
expect_403('H21 finance CANNOT manage branches', FINANCE, 'POST', '/api/branches', {'name': 'x'})

print('========== I) ROLES MODULE — FULL SAVE CYCLE ==========')
r = api(ADMIN, 'GET', '/api/roles')
check('I1 roles list + catalog synced', 'items' in r and 'permissionsSynced' in r, f"roles={len(r.get('items', []))}, synced={r.get('permissionsSynced')}")
# verify admin role has '*'
admin_role = next((x for x in r['items'] if x['name'] == 'admin'), None)
check('I2 admin role = *', admin_role and admin_role['permissions'] == ['*'], '')
# protect admin edits
r = api(ADMIN, 'PATCH', f"/api/roles/{admin_role['id']}", {'permissions': ['dashboard.view']})
check('I3 admin role permissions locked', isinstance(r.get('error'), str) and 'ثابتة' in r['error'], r.get('error', '')[:80])

# create test role with a specific subset
perms = ['shipments.view', 'shipments.create', 'receipts.view', 'receipts.manage', 'dashboard.view']
r = api(ADMIN, 'POST', '/api/roles', {'name': 'e2e_test_role', 'label': 'دور اختبار E2E', 'permissions': perms})
check('I4 role created', 'id' in r, str(r)[:80])
role_id = r.get('id')
r = api(ADMIN, 'GET', '/api/roles')
saved = next((x for x in r['items'] if x['id'] == role_id), None)
check('I5 role permissions saved & re-read', saved and sorted(saved['permissions']) == sorted(perms), f"saved={saved['permissions'] if saved else None}")
# patch role permissions
perms2 = perms + ['invoices.view']
r = api(ADMIN, 'PATCH', f'/api/roles/{role_id}', {'permissions': perms2})
check('I6 role patched', r.get('ok') is True, str(r)[:60])
r = api(ADMIN, 'GET', '/api/roles')
saved = next((x for x in r['items'] if x['id'] == role_id), None)
check('I7 patched permissions persisted', saved and 'invoices.view' in saved['permissions'] and len(saved['permissions']) == len(perms2), '')

# assign role to a temp user → user session gets exactly those permissions
r = api(ADMIN, 'POST', '/api/users', {'username': 'e2e_user', 'name': 'مستخدم اختبار', 'password': 'e2e123', 'roleId': role_id, 'active': True})
uid = r.get('id') or r.get('user', {}).get('id')
check('I8 user created with role', bool(uid), str(r)[:100])
tok = json.loads(sh(f"curl -s -X POST {BASE}/api/auth/login -H 'Content-Type: application/json' -d '{{\"username\":\"e2e_user\",\"password\":\"e2e123\"}}'")).get('token')
r = api(tok, 'GET', '/api/shipments?pageSize=1')
check('I9 e2e_user CAN view shipments (granted)', 'items' in r, '')
r = api(tok, 'GET', '/api/invoices?pageSize=1')
check('I10 e2e_user CAN view invoices (granted)', 'items' in r, '')
expect_403('I11 e2e_user CANNOT record payment (not granted)', tok, 'POST', '/api/payments', {'contractorId': 'x', 'amount': 1})
expect_403('I12 e2e_user CANNOT manage roles', tok, 'GET', '/api/roles')

# cleanup role + user
api(ADMIN, 'DELETE', f'/api/users/{uid}')
r = api(ADMIN, 'DELETE', f'/api/roles/{role_id}')
check('I13 test role deleted (after user detached)', 'error' not in r, str(r)[:80])

print('\n===== PHASE-2A SUMMARY =====')
print(f"total={len(results)} pass={sum(results)} fail={len(results)-sum(results)}")
for f_ in FAILS:
    print('  FAIL:', f_[0], '—', f_[1][:150])
