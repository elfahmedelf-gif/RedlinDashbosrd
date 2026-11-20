import { ApiError, handle, num, readBody, round2 } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded, nextShipmentNo } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'
import { listShipments } from '@/lib/server/queries'
import { assertUniqueDeliveryNumber } from '@/lib/server/receipts'
import { extractExtras, syncShipmentExtras } from '@/lib/server/shipment-extras-sync'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.view')
    return listShipments(new URL(req.url).searchParams, user)
  })
}

/** الحقول المالية والتشغيلية المقبولة عند الإنشاء (الكل كانت تُسقط سابقًا) */
const NUMERIC_FIELDS = ['freightCost', 'freightTotal', 'totalSuppliers', 'salePrice', 'customerPay', 'aging', 'overnight', 'returns', 'transfer', 'other', 'drop', 'ton15', 'ton3', 'm6', 'policyQty'] as const
const TEXT_FIELDS = ['billNo', 'recipientName', 'deliveryPhones', 'destination', 'destinationEn', 'routeCode', 'loadType', 'vehicleNo', 'shipToParty', 'notes'] as const
const FK_FIELDS = ['customerId', 'contractorId', 'branchId', 'warehouseId'] as const

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'shipments.create')
    const b = await readBody(req)
    const shipmentNo = await nextShipmentNo()

    // ── تحقق صارم قبل الحفظ ──
    // المقاول إلزامي — لا شحنة بدون ناقل (يُختار المقاول قبل الحفظ)
    const contractorId = String(b.contractorId ?? '').trim()
    if (!contractorId) throw new ApiError(400, 'اختيار المقاول مطلوب — عيّن مقاول النقل قبل حفظ الشحنة')
    // المبالغ السالبة ممنوعة — لا معنى لنولون/مبالغ سالبة
    for (const k of NUMERIC_FIELDS) {
      const v = num(b[k])
      if (v != null && v < 0) throw new ApiError(400, `القيمة في «${k}» لا يمكن أن تكون سالبة — أدخل مبلغًا صحيحًا أو اتركه فارغًا`)
    }
    // تاريخ الشحنة يجب أن يكون صالحًا — قيمة غير قابلة للتحليل تسبب خطأ خادم
    if (b.date) {
      const d = new Date(String(b.date))
      if (isNaN(d.getTime())) throw new ApiError(400, 'تاريخ الشحنة غير صالح — اختر تاريخًا صحيحًا')
    }
    // رقم الديليفري فريد على مستوى النظام — يُمنع التكرار برسالة عربية واضحة + بيانات الشحنة الموجودة
    const dn = b.deliveryNumber ? String(b.deliveryNumber).trim() : ''
    if (dn) {
      const dup = await db.shipment.findFirst({
        where: { deliveryNumber: dn },
        select: { id: true, shipmentNo: true, contractor: { select: { name: true } } },
      })
      if (dup) {
        throw new ApiError(409, `رقم الديليفري مسجل مسبقًا لشحنة أخرى (${dup.shipmentNo}${dup.contractor?.name ? ` — ${dup.contractor.name}` : ''})`, {
          code: 'DUPLICATE_DELIVERY_NUMBER',
          existingShipmentId: dup.id,
          existingShipmentNo: dup.shipmentNo,
          existingDeliveryNumber: dn,
          existingContractor: dup.contractor?.name ?? null,
        })
      }
    }

    // إنشاء الشحنة + السجل التاريخي + التدقيق داخل معاملة واحدة (ذرية كاملة)
    // التقاط P2002 (تعارض تزامن نادر على رقم الديليفري) → رسالة عربية واضحة بدل خطأ خادم
    let created: any
    try {
      created = await db.$transaction(async (tx) => {
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
          // رقم الديليفري: المُدخل صريحًا أو رقم الشحنة نفسه (المعرف البحثي الأساسي)
          deliveryNumber: b.deliveryNumber ? String(b.deliveryNumber).trim() : shipmentNo,
          statusHistory: { create: { fromStatus: null, toStatus: 'new', notes: 'إنشاء شحنة جديدة', userName: user.username } },
        },
      })
      // مزامنة بنود النقلة الإضافية (تعتيق/مبيت/تحويلة/دروب) مع البنود الإضافية والقيود —
      // المبالغ المسجلة على الشحنة تدخل مستحقات المقاول عبر دورة الاعتماد الرسمية
      const extras = extractExtras(data)
      let extrasSynced: string[] = []
      if (Object.values(extras).some((v) => v > 0)) {
        const sync = await syncShipmentExtras(tx, {
          ...s,
          deliveryNumber: s.deliveryNumber,
        }, extras, { userId: user.userId, username: user.username })
        extrasSynced = [...sync.created]
      }
      await logAudit(tx, {
        action: 'create', entity: 'shipment', entityId: s.id,
        notes: `إنشاء شحنة ${shipmentNo}${data.freightTotal ? ` بنولون ${data.freightTotal}` : ''}${extrasSynced.length ? ` — بنود متزامنة: ${extrasSynced.join('، ')}` : ''}`,
        user: { userId: user.userId, username: user.username },
        after: { shipmentNo, status: 'new', freightTotal: data.freightTotal ?? 0, totalSuppliers: data.totalSuppliers, extrasSynced },
      })
      return s
    })
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ApiError(409, 'رقم الديليفري مسجل مسبقًا لشحنة أخرى — أدخل رقمًا مختلفًا')
      throw e
    }
    return { id: created.id, shipmentNo }
  })
}

void round2
