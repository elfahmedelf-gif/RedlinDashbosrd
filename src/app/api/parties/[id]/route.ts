import { ApiError, handle, num, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** قائمة بيضاء صارمة — كانت التعديلات mass-assignment على كل الحقول */
const EDITABLE = ['name', 'nameEn', 'isCustomer', 'isContractor', 'isSupplier', 'phone', 'phones', 'email', 'address', 'city', 'region', 'taxNumber', 'paymentTerms', 'branchId', 'notes', 'active'] as const
/** الرصيد الافتتاحي وسقف الائتمان يُعدلان فقط لطرف بلا حركات (وإلا: قيد تصحيح) */
const FINANCIAL_ONLY_NEW = ['openingBalance', 'creditLimit', 'openingBalanceType'] as const

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'parties.manage')
    const { id } = await params
    const b = await readBody(req)

    await db.$transaction(async (tx) => {
      const party = await tx.party.findUnique({ where: { id } })
      if (!party) throw new ApiError(404, 'الطرف غير موجود')
      if (b.branchId && !(await tx.branch.findUnique({ where: { id: b.branchId } }))) throw new ApiError(400, 'الفرع المحدد غير موجود')

      const wantsFinancial = FINANCIAL_ONLY_NEW.some((k) => b[k] !== undefined)
      if (wantsFinancial) {
        // حماية الأرصدة: طرف له حركات محاسبية أو شحنات لا يُعدل رصيده الافتتاحي يدويًا
        const [hasLines, hasShipments, hasVouchers] = await Promise.all([
          tx.journalLine.count({ where: { partyId: id } }),
          tx.shipment.count({ where: { OR: [{ customerId: id }, { contractorId: id }] } }),
          tx.opVoucher.count({ where: { OR: [{ partyId: id }, { courierId: id }] } }),
        ])
        if (hasLines || hasShipments || hasVouchers) {
          throw new ApiError(409, 'لا يمكن تعديل الرصيد الافتتاحي/سقف الائتمان لطرف له حركات — استخدم قيد تصحيح محاسبي وفق سياسة النظام')
        }
      }

      const data: any = {}
      for (const k of EDITABLE) if (b[k] !== undefined) data[k] = b[k]
      for (const k of FINANCIAL_ONLY_NEW) if (b[k] !== undefined) data[k] = k === 'creditLimit' || k === 'openingBalance' ? (num(b[k]) ?? 0) : b[k]
      if (!Object.keys(data).length) throw new ApiError(400, 'لا توجد حقول صالحة للتعديل')

      await tx.party.update({ where: { id }, data })
      await logAudit(tx, {
        action: 'update', entity: 'party', entityId: id,
        notes: `تعديل طرف: ${party.name}`,
        user: { userId: user.userId, username: user.username },
        before: { name: party.name, active: party.active, openingBalance: party.openingBalance, creditLimit: party.creditLimit },
        after: data,
      })
    })
    return { ok: true }
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'parties.manage')
    const { id } = await params

    await db.$transaction(async (tx) => {
      const party = await tx.party.findUnique({ where: { id } })
      if (!party) return null
      const linked = await tx.shipment.findFirst({ where: { OR: [{ customerId: id }, { contractorId: id }] } })
      if (linked) throw new ApiError(409, 'لا يمكن حذف طرف مرتبط بشحنات — عالجه وفق سياسة التصحيح')
      const linkedVoucher = await tx.opVoucher.findFirst({ where: { OR: [{ partyId: id }, { courierId: id }] } })
      if (linkedVoucher) throw new ApiError(409, 'لا يمكن حذف طرف مرتبط بسندات مالية/أذونات')
      const linkedJournal = await tx.journalLine.findFirst({ where: { partyId: id } })
      if (linkedJournal) throw new ApiError(409, 'لا يمكن حذف طرف مرتبط بقيود محاسبية')
      await tx.party.delete({ where: { id } })
      await logAudit(tx, {
        action: 'delete', entity: 'party', entityId: id,
        notes: `حذف طرف: ${party.name}`,
        user: { userId: user.userId, username: user.username },
        before: { code: party.code, name: party.name },
      })
    })
    return null
  })
}
