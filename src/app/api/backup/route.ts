// ============================================================================
// النسخ الاحتياطي الكامل — تصدير لقطة JSON لكل بيانات النظام بنقرة واحدة
// GET /api/backup → ملف shipping-backup-YYYY-MM-DD-HHmm.json
// صلاحية إعدادات النظام (settings.manage) — عمليًا المالك/النظام فقط.
// ملاحظات أمان: كلمات مرور المستخدمين لا تُصدّر أبدًا (حقل password يُحذف).
// ============================================================================

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    await ensureSeeded()
    const user = await requirePerm(req, 'backup.export')

    // لقطة كاملة لكل جداول النظام — توازي (أسرع) ثم تُجمَّع في كائن واحد
    const [
      exportedAt,
      parties, branches, warehouses, items, inventoryMovements,
      shipments, shipmentStatusHistory, freightPrices,
      accounts, costCenters, journalEntries, journalLines,
      opVouchers, opVoucherItems, opVoucherActions,
      extraCosts, seqCounters,
      usersNoPwd, roles, userRoles, sessionsCount,
      auditLogs, importLogs, settings, lookupItems,
    ] = await Promise.all([
      Promise.resolve(new Date().toISOString()),
      db.party.findMany(),
      db.branch.findMany(),
      db.warehouse.findMany(),
      db.item.findMany(),
      db.inventoryMovement.findMany(),
      db.shipment.findMany(),
      db.shipmentStatusHistory.findMany(),
      db.freightPrice.findMany(),
      db.account.findMany(),
      db.costCenter.findMany(),
      db.journalEntry.findMany(),
      db.journalLine.findMany(),
      db.opVoucher.findMany(),
      db.opVoucherItem.findMany(),
      db.opVoucherAction.findMany(),
      db.extraCost.findMany(),
      db.seqCounter.findMany(),
      db.user.findMany({ select: { id: true, username: true, name: true, email: true, phone: true, active: true, branchId: true, createdAt: true } }),
      db.role.findMany(),
      db.userRole.findMany(),
      db.userSession.count().catch(() => 0),
      db.auditLog.findMany({ orderBy: { date: 'desc' }, take: 5000 }),
      db.importLog.findMany(),
      db.setting.findMany(),
      db.lookupItem.findMany(),
    ])

    const snapshot: Record<string, unknown> = {
      meta: {
        app: 'نظام إدارة الشحن المتكامل',
        version: 2,
        generatedAt: exportedAt,
        generatedBy: { userId: user.userId, username: user.username },
        note: 'نسخة احتياطية كاملة — كلمات المرور مستثناة لأسباب أمنية',
        counts: {
          parties: parties.length,
          shipments: shipments.length,
          journalEntries: journalEntries.length,
          journalLines: journalLines.length,
          opVouchers: opVouchers.length,
          extraCosts: extraCosts.length,
          users: usersNoPwd.length,
          auditLogs: auditLogs.length,
        },
        activeSessions: sessionsCount,
      },
      data: {
        parties, branches, warehouses, items, inventoryMovements,
        shipments, shipmentStatusHistory, freightPrices,
        accounts, costCenters, journalEntries, journalLines,
        opVouchers, opVoucherItems, opVoucherActions,
        extraCosts, seqCounters,
        users: usersNoPwd, roles, userRoles,
        auditLogs, importLogs, settings, lookupItems,
      },
    }

    // توثيق العملية في سجل التدقيق (خارج اللقطة نفسها)
    try {
      await logAudit(db, {
        action: 'export', entity: 'backup', entityId: 'full-snapshot',
        notes: `تنزيل نسخة احتياطية كاملة (JSON) — ${parties.length} طرف / ${shipments.length} شحنة / ${journalEntries.length} قيد`,
        user: { userId: user.userId, username: user.username },
      })
    } catch { /* التوثيق لا يفشل التصدير */ }

    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-').replace(/Z$/, '')
    const body = JSON.stringify(snapshot, null, 1)
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="shipping-backup-${stamp}.json"`,
      },
    })
  } catch (e: any) {
    const status = e?.status ?? (e instanceof Error && e.message.includes('صلاحية') ? 403 : 500)
    return NextResponse.json({ error: e?.message ?? 'خطأ غير متوقع في الخادم' }, { status })
  }
}
