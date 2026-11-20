import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'
import { getShipment } from '@/lib/server/queries'
import { getActiveDeliveryJournal, postShipmentDeliveryJournal } from '@/lib/server/shipment-accounting'
import { reverseJournal } from '@/lib/server/accounting'
import { assertUniqueDeliveryNumber } from '@/lib/server/receipts'
import { clearSyncedExtras, extractExtras, extrasFromShipment, extrasTouched, syncShipmentExtras } from '@/lib/server/shipment-extras-sync'

export const dynamic = 'force-dynamic'

// الحقول القابلة للتعديل (قائمة بيضاء) — تشمل الحقول المالية والتشغيلية
const EDITABLE_TEXT = ['billNo', 'recipientName', 'deliveryPhones', 'destination', 'destinationEn', 'routeCode', 'branchId', 'warehouseId', 'loadType', 'contractorId', 'customerId', 'notes', 'vehicleNo', 'shipToParty', 'deliveryNumber'] as const
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
      const contractorChanged = b.contractorId !== undefined && b.contractorId !== s.contractorId
      // بنود النقلة الإضافية: هل طلب المستخدم تعديل تعتيق/مبيت/تحويلة/دروب؟
      const prevExtras = extrasFromShipment(s)
      const touchedExtras = extrasTouched(b)

      // حماية الأثر المالي: الشحنات المحصّلة لا تُعدّل مبالغها أبدًا
      if ((moneyTouched || touchedExtras) && s.collectionStatus === 'collected') {
        throw new ApiError(409, 'لا يمكن تعديل مبالغ شحنة تم تحصيلها — استخدم قيدًا عكسيًا أو إذن تصحيح وفق سياسة النظام')
      }

      // المزامنة المحاسبية المتتالية: تغيير المقاول أو المبالغ على شحنة مُرحّلة
      // → عكس القيد النشط ثم إعادة إثباته بالبيانات الجديدة (نقل مستحقات المقاول القديم ← الجديد على 2102)
      let reversalNo: string | null = null
      if (moneyTouched || contractorChanged) {
        const activeJE = await getActiveDeliveryJournal(tx, id)
        if (activeJE) {
          const reversal = await reverseJournal(tx, activeJE.id, user, `تصحيح بيانات الشحنة ${s.shipmentNo ?? ''} قبل التعديل`)
          reversalNo = reversal.entryNo
        }
      }

      const data: any = {}
      for (const k of EDITABLE_TEXT) if (b[k] !== undefined) data[k] = b[k] === '' ? null : b[k]
      for (const k of EDITABLE_NUM) {
        if (b[k] === undefined) continue
        const v = b[k] === '' || b[k] === null ? null : Number(b[k]) || 0
        if (v != null && v < 0) throw new ApiError(400, `القيمة في «${k}» لا يمكن أن تكون سالبة — أدخل مبلغًا صحيحًا`)
        data[k] = v
      }

      // رقم الديليفري فريد على مستوى النظام — تحقق عند تغييره
      if (data.deliveryNumber && String(data.deliveryNumber).trim() !== (s.deliveryNumber ?? s.shipmentNo)) {
        await assertUniqueDeliveryNumber(tx, String(data.deliveryNumber).trim(), s.contractorId ?? '', id)
      }

      // اتساق تكلفة المقاول: تعديل تكلفة النقل يُحدّث totalSuppliers ما لم يُرسل صراحة
      if (data.freightCost !== undefined && data.totalSuppliers === undefined) {
        data.totalSuppliers = data.freightCost
      }

      if (!Object.keys(data).length) throw new ApiError(400, 'لا توجد حقول صالحة للتعديل')

      const updated = await tx.shipment.update({ where: { id }, data })

      // إعادة إثبات القيد بالبيانات الجديدة بعد العكس (تزامن فوري لكل الشاشات المشتقة)
      let repostNo: string | null = null
      if (reversalNo) {
        const fresh = await tx.shipment.findUnique({
          where: { id },
          include: { customer: { select: { id: true, name: true } }, contractor: { select: { id: true, name: true } } },
        })
        if (fresh) {
          const posted = await postShipmentDeliveryJournal(tx, fresh, user)
          repostNo = posted?.entryNo ?? null
        }
      }

      // ── مزامنة بنود النقلة الإضافية (تعتيق/مبيت/تحويلة/دروب) مع البنود والقيود ──
      let extrasSyncNote: string | null = null
      if (touchedExtras || contractorChanged) {
        // تغيير المقاول: بنود المقاول القديم تُسحب بالكامل (عكس القيود + حذف)
        let cleared: string[] = []
        if (contractorChanged) {
          cleared = await clearSyncedExtras(tx, id, user, `تغيير مقاول الشحنة ${s.shipmentNo ?? ''}`)
        }
        // المزامنة بالقيم النهائية بعد الدمج — تُنشئ/تحدّث بنود المقاول الجديد
        const fresh = await tx.shipment.findUnique({
          where: { id },
          include: { customer: { select: { id: true, name: true } }, contractor: { select: { id: true, name: true } } },
        })
        if (fresh) {
          const finalExtras = extrasFromShipment(fresh)
          const sync = await syncShipmentExtras(tx, fresh, finalExtras, { userId: user.userId, username: user.username }, prevExtras)
          const parts: string[] = []
          if (sync.created.length) parts.push(`إنشاء: ${sync.created.join('، ')}`)
          if (sync.updated.length) parts.push(`تحديث: ${sync.updated.join('، ')}`)
          if (sync.deleted.length || cleared.length) parts.push(`سحب: ${[...cleared, ...sync.deleted].join('، ')}`)
          if (parts.length) extrasSyncNote = parts.join(' | ')
        }
      }

      // تعديل البيانات المالية يُسجّل سطرًا في سجل حالات الشحنة (أثر مالي موثّق)
      if (moneyTouched || touchedExtras) {
        const touchedNames = [
          ...MONEY_FIELDS.filter((k) => b[k] !== undefined),
          ...(touchedExtras ? ['تعتيق/مبيت/تحويلة/دروب (بنود النقلة)'] : []),
        ]
        await tx.shipmentStatusHistory.create({
          data: {
            shipmentId: id,
            fromStatus: s.status,
            toStatus: s.status,
            notes: `تعديل بيانات مالية: ${touchedNames.join('، ')}`,
            userName: user.username,
          },
        })
      }
      await logAudit(tx, {
        action: 'update', entity: 'shipment', entityId: id,
        notes: `تعديل الشحنة ${s.shipmentNo}${reversalNo ? ` — عكس القيد ${reversalNo}` : ''}${repostNo ? ` — إعادة إثبات بالقيد ${repostNo}` : ''}${contractorChanged ? ' — نقل المستحقات بين المقاولين تلقائيًا' : ''}${extrasSyncNote ? ` — مزامنة بنود النقلة: ${extrasSyncNote}` : ''}`,
        user: { userId: user.userId, username: user.username },
        before: { freightTotal: s.freightTotal, freightCost: s.freightCost, totalSuppliers: s.totalSuppliers, contractorId: s.contractorId, ...prevExtras },
        after: { ...data, reversalNo, repostNo, extrasSyncNote },
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

      // منع الحذف المدمر: أي ارتباط بإذن تشغيلي (بأي حالة — حتى الملغاة تحمل بندًا مرجعيًا)
      // أو فاتورة، أو بنود إضافية معتمدة (قيودها مرحّلة)
      const anyVoucherLink = await tx.opVoucherItem.findFirst({
        where: { shipmentId: id },
        include: { voucher: { select: { voucherNo: true, status: true } } },
      })
      if (anyVoucherLink) {
        throw new ApiError(409, `لا يمكن حذف شحنة مرتبطة بإذن تشغيلي (${anyVoucherLink.voucher.voucherNo} — ${anyVoucherLink.voucher.status}) — احذف/ألغِ بند الشحنة من الإذن أولًا وفق سياسة التصحيح`)
      }
      if (s.invoiceId) {
        throw new ApiError(409, 'لا يمكن حذف شحنة مسجّلة في فاتورة — احذفها من الفاتورة أولًا (منع ازدواج الإيراد)')
      }
      const approvedExtras = await tx.extraCost.count({ where: { shipmentId: id, approvalStatus: 'approved' } })
      if (approvedExtras > 0) {
        throw new ApiError(409, `لا يمكن حذف الشحنة — عليها ${approvedExtras} بند إضافي معتمد ومُرحّل محاسبيًا — ارفض البنود أولًا (سيُعكس قيدها تلقائيًا) ثم احذف الشحنة`)
      }
      if (s.collectionStatus === 'collected') {
        throw new ApiError(409, 'لا يمكن حذف شحنة تم تحصيلها — عكس التحصيل أولًا')
      }

      // عكس القيود النشطة المرتبطة بالشحنة تلقائيًا (قيد التسليم وغيره) — لا أرصدة يتيمة
      const activeEntries = await tx.journalEntry.findMany({
        where: { status: 'posted', reversalOfId: null, lines: { some: { shipmentId: id } } },
        select: { id: true, entryNo: true },
      })
      const reversalNos: string[] = []
      for (const je of activeEntries) {
        const already = await tx.journalEntry.findUnique({ where: { reversalOfId: je.id }, select: { id: true } })
        if (!already) {
          const rev = await reverseJournal(tx, je.id, user, `حذف الشحنة ${s.shipmentNo ?? ''} — عكس القيد تلقائيًا`)
          reversalNos.push(rev.entryNo)
        }
      }

      // البنود المعلقة/المرفوضة المرتبطة تُحذف (بلا قيود)
      await tx.extraCost.deleteMany({ where: { shipmentId: id, approvalStatus: { in: ['pending', 'rejected'] } } })

      await tx.shipment.delete({ where: { id } })
      await logAudit(tx, {
        action: 'delete', entity: 'shipment', entityId: id,
        notes: `حذف شحنة ${s.shipmentNo}${reversalNos.length ? ` — عكس القيود: ${reversalNos.join('، ')}` : ''}`,
        user: { userId: user.userId, username: user.username },
        before: { shipmentNo: s.shipmentNo, status: s.status },
      })
    })
    return null
  })
}
