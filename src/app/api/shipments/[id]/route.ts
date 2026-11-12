import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'
import { getShipment } from '@/lib/server/queries'
import { hasDeliveryJournal } from '@/lib/server/shipment-accounting'

export const dynamic = 'force-dynamic'

// الحقول القابلة للتعديل (قائمة بيضاء) — تشمل الحقول المالية والتشغيلية
const EDITABLE_TEXT = ['billNo', 'recipientName', 'deliveryPhones', 'destination', 'destinationEn', 'routeCode', 'branchId', 'warehouseId', 'loadType', 'contractorId', 'customerId', 'notes', 'vehicleNo', 'shipToParty'] as const
const EDITABLE_NUM = ['freightCost', 'freightTotal', 'totalSuppliers', 'salePrice', 'customerPay', 'aging', 'overnight', 'returns', 'transfer', 'other', 'drop', 'ton15', 'ton3', 'm6', 'policyQty'] as const
const MONEY_FIELDS = ['freightCost', 'freightTotal', 'totalSuppliers', 'salePrice', 'customerPay'] as const

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.view')
    const { id } = await params
    return getShipment(id, user)
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.edit')
    const { id } = await params
    const b = await readBody(req)

    await db.$transaction(async (tx) => {
      const s = await tx.shipment.findUnique({ where: { id } })
      if (!s) throw new ApiError(404, 'الشحنة غير موجودة')

      // التحقق من الأطراف/الفروع المشار إليها
      if (b.customerId && !(await tx.party.findUnique({ where: { id: b.customerId } }))) throw new ApiError(400, 'العميل المحدد غير موجود')
      if (b.contractorId && !(await tx.party.findUnique({ where: { id: b.contractorId } }))) throw new ApiError(400, 'المقاول المحدد غير موجود')
      if (b.branchId && !(await tx.branch.findUnique({ where: { id: b.branchId } }))) throw new ApiError(400, 'الفرع المحدد غير موجود')
      if (b.warehouseId && !(await tx.warehouse.findUnique({ where: { id: b.warehouseId } }))) throw new ApiError(400, 'المخزن المحدد غير موجود')

      const moneyTouched = MONEY_FIELDS.some((k) => b[k] !== undefined)

      // حماية الأثر المالي: لا تعديل مبالغ على شحنة محصّلة أو لها قيد تسليم مرحّل
      if (moneyTouched) {
        if (s.collectionStatus === 'collected') {
          throw new ApiError(409, 'لا يمكن تعديل مبالغ شحنة تم تحصيلها — استخدم قيدًا عكسيًا أو إذن تصحيح وفق سياسة النظام')
        }
        if (await hasDeliveryJournal(tx, id)) {
          throw new ApiError(409, 'لا يمكن تعديل مبالغ شحنة مُرحّل قيدها المحاسبي (تم تسليمها) — استخدم قيدًا عكسيًا')
        }
      }

      const data: any = {}
      for (const k of EDITABLE_TEXT) if (b[k] !== undefined) data[k] = b[k] === '' ? null : b[k]
      for (const k of EDITABLE_NUM) if (b[k] !== undefined) data[k] = b[k] === '' || b[k] === null ? null : Number(b[k]) || 0

      // اتساق تكلفة المقاول: تعديل تكلفة النقل يُحدّث totalSuppliers ما لم يُرسل صراحة
      if (data.freightCost !== undefined && data.totalSuppliers === undefined) {
        data.totalSuppliers = data.freightCost
      }

      if (!Object.keys(data).length) throw new ApiError(400, 'لا توجد حقول صالحة للتعديل')

      const updated = await tx.shipment.update({ where: { id }, data })

      // تعديل البيانات المالية يُسجّل سطرًا في سجل حالات الشحنة (أثر مالي موثّق)
      if (moneyTouched) {
        await tx.shipmentStatusHistory.create({
          data: {
            shipmentId: id,
            fromStatus: s.status,
            toStatus: s.status,
            notes: `تعديل بيانات مالية: ${MONEY_FIELDS.filter((k) => b[k] !== undefined).join('، ')}`,
            userName: user.username,
          },
        })
      }
      await logAudit(tx, {
        action: 'update', entity: 'shipment', entityId: id,
        notes: `تعديل الشحنة ${s.shipmentNo}`,
        user: { userId: user.userId, username: user.username },
        before: { freightTotal: s.freightTotal, freightCost: s.freightCost, totalSuppliers: s.totalSuppliers },
        after: data,
      })
      void updated
    })
    return { ok: true }
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.delete')
    const { id } = await params

    await db.$transaction(async (tx) => {
      const s = await tx.shipment.findUnique({ where: { id } })
      if (!s) return

      // منع الحذف المدمر: شحنة مرتبطة بأذونات نشطة أو مكتملة أو قيد مرحّل
      // (الأذونات الملغاة/المرفوضة الميتة لا تمنع الحذف — تصحيح سابق كان يحجب الكل)
      const blockingVoucher = await tx.opVoucherItem.findFirst({
        where: { shipmentId: id, voucher: { status: { in: ['draft', 'pending', 'approved', 'in_progress', 'completed'] } } },
        include: { voucher: { select: { voucherNo: true, status: true } } },
      })
      if (blockingVoucher) {
        throw new ApiError(409, `لا يمكن حذف شحنة مرتبطة بإذن (${blockingVoucher.voucher.voucherNo} — ${blockingVoucher.voucher.status}) — عالجها وفق سياسة التصحيح أولًا`)
      }
      const postedJournal = await tx.journalLine.findFirst({ where: { shipmentId: id, entry: { status: 'posted' } } })
      if (postedJournal) {
        throw new ApiError(409, 'لا يمكن حذف شحنة مرتبطة بقيود محاسبية مرحّلة — استخدم القيد العكسي أولًا')
      }
      if (s.collectionStatus === 'collected') {
        throw new ApiError(409, 'لا يمكن حذف شحنة تم تحصيلها — عكس التحصيل أولًا')
      }

      await tx.shipment.delete({ where: { id } })
      await logAudit(tx, {
        action: 'delete', entity: 'shipment', entityId: id,
        notes: `حذف شحنة ${s.shipmentNo}`,
        user: { userId: user.userId, username: user.username },
        before: { shipmentNo: s.shipmentNo, status: s.status },
      })
    })
    return null
  })
}
