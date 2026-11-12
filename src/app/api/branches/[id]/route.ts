import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const EDITABLE = ['name', 'nameEn', 'manager', 'phone', 'address', 'region', 'active'] as const

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'structure.manage')
    const { id } = await params
    const b = await readBody(req)

    await db.$transaction(async (tx) => {
      const br = await tx.branch.findUnique({ where: { id } })
      if (!br) throw new ApiError(404, 'الفرع غير موجود')
      const data: any = {}
      for (const k of EDITABLE) if (b[k] !== undefined) data[k] = b[k]
      if (!Object.keys(data).length) throw new ApiError(400, 'لا توجد حقول صالحة للتعديل')
      // إيقاف فرع مرتبط بحركات نشطة = كسر سلامة البيانات
      if (data.active === false) {
        const [wh, sh, je] = await Promise.all([
          tx.warehouse.count({ where: { branchId: id } }),
          tx.shipment.count({ where: { branchId: id } }),
          tx.journalEntry.count({ where: { branchId: id } }),
        ])
        if (wh || sh || je) throw new ApiError(409, 'لا يمكن إيقاف فرع مرتبط بمخازن/شحنات/قيود — عالج الارتباطات وفق سياسة التصحيح')
      }
      await tx.branch.update({ where: { id }, data })
      await logAudit(tx, {
        action: 'update', entity: 'branch', entityId: id,
        notes: `تعديل فرع: ${data.name ?? br.name}`,
        user: { userId: user.userId, username: user.username },
        before: { name: br.name, active: br.active },
        after: data,
      })
    })
    return { ok: true }
  })
}

/** حذف فرع — فقط إن كان بلا أي ارتباط (مخازن/مستخدمون/شحنات/أطراف/قيود/أذونات) */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'structure.manage')
    const { id } = await params
    const br = await db.branch.findUnique({ where: { id } })
    if (!br) return null

    // فحص كامل للارتباطات (كان يفحص الشحنات فقط → خطأ 500 عند وجود مخازن/مستخدمين)
    const [warehouses, users, shipments, parties, journalEntries, vouchersSrc, vouchersDst, costCenters] = await Promise.all([
      db.warehouse.count({ where: { branchId: id } }),
      db.user.count({ where: { branchId: id } }),
      db.shipment.count({ where: { branchId: id } }),
      db.party.count({ where: { branchId: id } }),
      db.journalEntry.count({ where: { branchId: id } }),
      db.opVoucher.count({ where: { sourceBranchId: id } }),
      db.opVoucher.count({ where: { destBranchId: id } }),
      db.costCenter.count({ where: { branchId: id } }),
    ])
    const total = warehouses + users + shipments + parties + journalEntries + vouchersSrc + vouchersDst + costCenters
    if (total > 0) {
      const parts: string[] = []
      if (warehouses) parts.push(`${warehouses} مخزن`)
      if (users) parts.push(`${users} مستخدم`)
      if (shipments) parts.push(`${shipments} شحنة`)
      if (parties) parts.push(`${parties} طرف`)
      if (journalEntries) parts.push(`${journalEntries} قيد`)
      if (vouchersSrc + vouchersDst) parts.push(`${vouchersSrc + vouchersDst} إذن`)
      if (costCenters) parts.push(`${costCenters} مركز تكلفة`)
      throw new ApiError(409, `لا يمكن حذف الفرع "${br.name}" — مرتبط بـ: ${parts.join('، ')}. أوقفه بدلًا من حذفه`)
    }
    await db.branch.delete({ where: { id } })
    await logAudit(db, { action: 'delete', entity: 'branch', entityId: id, notes: `حذف فرع: ${br.name}`, user: { userId: user.userId, username: user.username }, before: { name: br.name } })
    return null
  })
}
