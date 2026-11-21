import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const EDITABLE = ['name', 'manager', 'active'] as const

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'warehouses.manage')
    const { id } = await params
    const b = await readBody(req)

    await db.$transaction(async (tx) => {
      const w = await tx.warehouse.findUnique({ where: { id } })
      if (!w) throw new ApiError(404, 'المخزن غير موجود')
      const data: any = {}
      for (const k of EDITABLE) if (b[k] !== undefined) data[k] = b[k]
      if (!Object.keys(data).length) throw new ApiError(400, 'لا توجد حقول صالحة للتعديل')
      if (data.active === false) {
        const [items, movements, shipments] = await Promise.all([
          tx.item.count({ where: { warehouseId: id } }),
          tx.inventoryMovement.count({ where: { OR: [{ warehouseId: id }, { toWarehouseId: id }] } }),
          tx.shipment.count({ where: { warehouseId: id } }),
        ])
        if (items || movements || shipments) throw new ApiError(409, 'لا يمكن إيقاف مخزن مرتبط بأصناف/حركات/شحنات — عالج الارتباطات وفق سياسة التصحيح')
      }
      await tx.warehouse.update({ where: { id }, data })
      await logAudit(tx, {
        action: 'update', entity: 'warehouse', entityId: id,
        notes: `تعديل مخزن: ${data.name ?? w.name}`,
        user: { userId: user.userId, username: user.username },
        before: { name: w.name, active: w.active },
        after: data,
      })
    })
    return { ok: true }
  })
}

/** حذف مخزن — فقط إن كان بلا أي ارتباط (أصناف/حركات/شحنات) */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'warehouses.manage')
    const { id } = await params
    const w = await db.warehouse.findUnique({ where: { id } })
    if (!w) return null

    // فحص كامل (كان يفحص الشحنات فقط → خطأ 500 عند وجود أصناف/حركات)
    const [items, movements, shipments] = await Promise.all([
      db.item.count({ where: { warehouseId: id } }),
      db.inventoryMovement.count({ where: { OR: [{ warehouseId: id }, { toWarehouseId: id }] } }),
      db.shipment.count({ where: { warehouseId: id } }),
    ])
    const total = items + movements + shipments
    if (total > 0) {
      const parts: string[] = []
      if (items) parts.push(`${items} صنف`)
      if (movements) parts.push(`${movements} حركة مخزون`)
      if (shipments) parts.push(`${shipments} شحنة`)
      throw new ApiError(409, `لا يمكن حذف المخزن "${w.name}" — مرتبط بـ: ${parts.join('، ')}. أوقفه بدلًا من حذفه`)
    }
    await db.warehouse.delete({ where: { id } })
    await logAudit(db, { action: 'delete', entity: 'warehouse', entityId: id, notes: `حذف مخزن: ${w.name}`, user: { userId: user.userId, username: user.username }, before: { name: w.name } })
    return null
  })
}
