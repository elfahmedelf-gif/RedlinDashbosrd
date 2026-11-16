import { handle } from '@/lib/server/http'
import { requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { db } from '@/lib/db'
import { report } from '@/lib/server/queries'

export const dynamic = 'force-dynamic'

/**
 * عدّادات موحدة لكل الوحدات في طلب واحد — يُستخدم في القائمة الجانبية.
 * استبدال 13 طلب SWR منفصل بطلب واحد يقلل الحمل على الخادم والشبكة.
 *
 * ملاحظات:
 *  - كل العدّادات تُحسب من قاعدة البيانات بفعالية (لا N+1).
 *  - لا يكشف أسعارًا — العدّادات أرقام صرفة فقط.
 *  - يتطلب مستخدم مسجلًا فقط (أي صلاحية)، لأن القائمة الجانبية تُعرض لكل المستخدمين.
 */
export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requireUser(req)

    // جلب كل العدّادات بالتوازي
    const [
      shipmentsCount, customersCount, contractorsCount, suppliersCount,
      branchesCount, warehousesCount, itemsCount, movementsCount,
      freightCount, accountsCount, journalCount, vouchersCount,
      usersCount, auditCount, lookupsCount, pendingReturns,
      receiptsPending, extrasPending,
    ] = await Promise.all([
      db.shipment.count(),
      db.party.count({ where: { isCustomer: true } }),
      db.party.count({ where: { isContractor: true } }),
      db.party.count({ where: { isSupplier: true } }),
      db.branch.count(),
      db.warehouse.count(),
      db.item.count(),
      db.inventoryMovement.count(),
      db.freightPrice.count(),
      db.account.count(),
      db.journalEntry.count(),
      db.opVoucher.count(),
      db.user.count(),
      db.auditLog.count(),
      db.lookupItem.count(),
      // تقرير المرتجعات لم تُستلم — نستخدم نفس منطق report() لكن نأخذ العدد فقط
      (async () => {
        try {
          const r: any = await report('pending-returns', new URLSearchParams(), user)
          return r?.total ?? 0
        } catch {
          // المستخدم قد لا يملك vouchers.view — يعطى 0
          return 0
        }
      })(),
      // أذونات التسليم غير المسلمة (شحنات مسندة لمقاولين بلا ملغاة/مشطوبة)
      db.shipment.count({ where: { contractorId: { not: null }, isReceiptDelivered: false, status: { notIn: ['cancelled', 'written_off'] } } }),
      // البنود الإضافية بانتظار اعتماد الشركة (مبيت/مرتجعات)
      db.extraCost.count({ where: { approvalStatus: 'pending' } }),
    ])

    return {
      overview: shipmentsCount,
      shipments: shipmentsCount,
      'pending-returns': pendingReturns,
      receipts: receiptsPending,
      'extra-costs': extrasPending,
      customers: customersCount,
      contractors: contractorsCount,
      suppliers: suppliersCount,
      branches: branchesCount,
      warehouses: warehousesCount,
      inventory: itemsCount,
      movements: movementsCount,
      freight: freightCount,
      accounts: accountsCount,
      journal: journalCount,
      vouchers: vouchersCount,
      users: usersCount,
      audit: auditCount,
      lookups: lookupsCount,
    }
  })
}
