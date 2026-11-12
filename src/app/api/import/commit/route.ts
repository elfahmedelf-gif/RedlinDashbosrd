import { ApiError, handle, num, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded, nextShipmentNoTx } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * تنفيذ الاستيراد الحقيقي: إنشاء شحنات من الصفوف داخل معاملة واحدة
 * + تسجيل سجل استيراد (ImportLog — كان نموذجًا ميتًا لا يكتبه أي كود)
 * + تدقيق. الصفوف الخاطئة تُتخطى وتُوثّق.
 */
export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'import.manage')
    const b = await readBody(req)
    const rows: any[] = Array.isArray(b.rows) ? b.rows : []
    if (!rows.length) throw new ApiError(400, 'لا توجد صفوف للاستيراد')
    const fileName = b.fileName ?? 'لصق مباشر'
    const sheetName = b.sheetName ?? null

    const result = await db.$transaction(async (tx) => {
      const branches = await tx.branch.findMany({ select: { id: true, name: true } })
      const branchByName = new Map(branches.map((x) => [x.name, x.id]))
      const customers = await tx.party.findMany({ where: { isCustomer: true }, select: { id: true, name: true } })
      const customerByName = new Map(customers.map((x) => [x.name, x.id]))
      const contractors = await tx.party.findMany({ where: { isContractor: true }, select: { id: true, name: true } })
      const contractorByName = new Map(contractors.map((x) => [x.name, x.id]))

      let imported = 0
      let skipped = 0
      const errors: string[] = []

      for (const r of rows) {
        try {
          const recipientName = String(r.recipientName ?? '').trim()
          const destination = String(r.destination ?? '').trim()
          if (!recipientName || !destination) { skipped += 1; errors.push(`صف ${r._row ?? '?'}: بيانات ناقصة (مستلم/وجهة)`); continue }

          // إنشاء العميل تلقائيًا إن لم يوجد (سياسة الاستيراد)
          let customerId = r.customerName ? customerByName.get(String(r.customerName).trim()) ?? null : null
          if (!customerId && r.customerName && String(r.customerName).trim()) {
            const c = await tx.party.create({ data: { name: String(r.customerName).trim(), isCustomer: true } })
            customerByName.set(c.name, c.id)
            customerId = c.id
          }
          const contractorId = r.contractorName ? contractorByName.get(String(r.contractorName).trim()) ?? null : null

          const shipmentNo = await nextShipmentNoTx(tx)
          await tx.shipment.create({
            data: {
              shipmentNo,
              recipientName,
              shipToParty: recipientName,
              deliveryPhones: r.deliveryPhones ? String(r.deliveryPhones) : null,
              destination,
              routeCode: r.routeCode ? String(r.routeCode) : null,
              branchId: r.branchName ? branchByName.get(String(r.branchName).trim()) ?? null : null,
              customerId,
              contractorId,
              freightCost: num(r.freightCost) ?? 0,
              freightTotal: num(r.freightTotal) ?? 0,
              totalSuppliers: num(r.freightCost) ?? 0,
              policyQty: num(r.policyQty) ?? null,
              ton15: num(r.ton15) ?? null,
              ton3: num(r.ton3) ?? null,
              m6: num(r.m6) ?? null,
              status: 'new',
              collectionStatus: 'uncollected',
              date: r.date ? new Date(r.date) : new Date(),
              notes: `استيراد (${fileName})`,
              statusHistory: { create: { fromStatus: null, toStatus: 'new', notes: `استيراد من ${fileName}`, userName: user.username } },
            },
          })
          imported += 1
        } catch (e: any) {
          skipped += 1
          errors.push(e?.message ?? 'خطأ غير معروف')
        }
      }

      const log = await tx.importLog.create({
        data: {
          fileName, sheetName,
          totalRows: rows.length,
          importedRows: imported,
          skippedRows: skipped,
          errors: errors.slice(0, 100).join('\n'),
          status: skipped > 0 ? 'partial' : 'completed',
          userId: user.userId,
          userName: user.username,
        },
      })
      await logAudit(tx, {
        action: 'import', entity: 'shipment', entityId: log.id,
        notes: `استيراد شحنات من "${fileName}": نجح ${imported}، تخطي ${skipped}`,
        user: { userId: user.userId, username: user.username },
        after: { fileName, imported, skipped },
      })
      return { imported, skipped, errors: errors.length, total: rows.length, logId: log.id, errorDetails: errors.slice(0, 50) }
    })
    return result
  })
}
