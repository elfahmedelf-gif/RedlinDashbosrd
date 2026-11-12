import { ApiError, handle, num, readBody, round2 } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded, nextShipmentNo } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'
import { listShipments } from '@/lib/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.view')
    return listShipments(new URL(req.url).searchParams, user)
  })
}

/** الحقول المالية والتشغيلية المقبولة عند الإنشاء (الكل كانت تُسقط سابقًا) */
const NUMERIC_FIELDS = ['freightCost', 'freightTotal', 'salePrice', 'customerPay', 'aging', 'overnight', 'returns', 'transfer', 'other', 'drop', 'ton15', 'ton3', 'm6', 'policyQty'] as const
const TEXT_FIELDS = ['billNo', 'recipientName', 'deliveryPhones', 'destination', 'destinationEn', 'routeCode', 'loadType', 'vehicleNo', 'shipToParty', 'notes'] as const
const FK_FIELDS = ['customerId', 'contractorId', 'branchId', 'warehouseId'] as const

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.create')
    const b = await readBody(req)
    const shipmentNo = await nextShipmentNo()

    // إنشاء الشحنة + السجل التاريخي + التدقيق داخل معاملة واحدة (ذرية كاملة)
    const created = await db.$transaction(async (tx) => {
      // التحقق من الأطراف/الفروع/المخازن المشار إليها (منع مفاتيح مكسورة)
      if (b.customerId && !(await tx.party.findUnique({ where: { id: b.customerId } }))) throw new ApiError(400, 'العميل المحدد غير موجود')
      if (b.contractorId && !(await tx.party.findUnique({ where: { id: b.contractorId } }))) throw new ApiError(400, 'المقاول المحدد غير موجود')
      if (b.branchId && !(await tx.branch.findUnique({ where: { id: b.branchId } }))) throw new ApiError(400, 'الفرع المحدد غير موجود')
      if (b.warehouseId && !(await tx.warehouse.findUnique({ where: { id: b.warehouseId } }))) throw new ApiError(400, 'المخزن المحدد غير موجود')

      const data: any = {
        shipmentNo,
        status: 'new', // الشحنة تبدأ دائمًا "جديدة" — التغيير عبر آلة الحالات أو الأذونات
        collectionStatus: 'uncollected',
        date: b.date ? new Date(b.date) : new Date(),
      }
      for (const k of TEXT_FIELDS) if (b[k] !== undefined && b[k] !== null && b[k] !== '') data[k] = String(b[k])
      if (b.recipientName != null) { data.recipientName = String(b.recipientName); data.shipToParty = data.shipToParty ?? String(b.recipientName) }
      for (const k of NUMERIC_FIELDS) if (b[k] !== undefined && b[k] !== null && b[k] !== '') data[k] = num(b[k]) ?? 0
      for (const k of FK_FIELDS) if (b[k]) data[k] = b[k]
      // تكلفة المقاول: totalSuppliers = المُدخل صريحًا أو تكلفة النقل (اتساق تقرير مستحقات المقاولين)
      data.totalSuppliers = num(b.totalSuppliers) ?? num(b.freightCost) ?? 0

      const s = await tx.shipment.create({
        data: {
          ...data,
          statusHistory: { create: { fromStatus: null, toStatus: 'new', notes: 'إنشاء شحنة جديدة', userName: user.username } },
        },
      })
      await logAudit(tx, {
        action: 'create', entity: 'shipment', entityId: s.id,
        notes: `إنشاء شحنة ${shipmentNo}${data.freightTotal ? ` بنولون ${data.freightTotal}` : ''}`,
        user: { userId: user.userId, username: user.username },
        after: { shipmentNo, status: 'new', freightTotal: data.freightTotal ?? 0, totalSuppliers: data.totalSuppliers },
      })
      return s
    })
    return { id: created.id, shipmentNo }
  })
}

void round2
