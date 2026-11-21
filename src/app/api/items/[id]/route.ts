import { ApiError, handle, num, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const EDITABLE = ['code', 'name', 'nameEn', 'unit', 'reorderLevel', 'cost', 'price', 'warehouseId', 'notes', 'active'] as const

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'inventory.manage')
    const { id } = await params
    const b = await readBody(req)

    await db.$transaction(async (tx) => {
      const it = await tx.item.findUnique({ where: { id } })
      if (!it) throw new ApiError(404, 'الصنف غير موجود')
      // التحقق من المخزن (كان أي معرف يُقبل → خطأ 500)
      if (b.warehouseId && !(await tx.warehouse.findUnique({ where: { id: b.warehouseId } }))) {
        throw new ApiError(400, 'المخزن المحدد غير موجود')
      }
      const data: any = {}
      for (const k of EDITABLE) if (b[k] !== undefined) data[k] = b[k]
      if (data.reorderLevel !== undefined) data.reorderLevel = num(data.reorderLevel) ?? 0
      if (data.cost !== undefined && data.cost != null) data.cost = num(data.cost)
      if (data.price !== undefined && data.price != null) data.price = num(data.price)
      if (!Object.keys(data).length) throw new ApiError(400, 'لا توجد حقول صالحة للتعديل')
      await tx.item.update({ where: { id }, data })
      await logAudit(tx, {
        action: 'update', entity: 'item', entityId: id,
        notes: `تعديل صنف: ${data.name ?? it.name}`,
        user: { userId: user.userId, username: user.username },
        before: { name: it.name, active: it.active, warehouseId: it.warehouseId },
        after: data,
      })
    })
    return { ok: true }
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'inventory.manage')
    const { id } = await params
    const it = await db.item.findUnique({ where: { id } })
    if (!it) return null
    const used = await db.inventoryMovement.findFirst({ where: { itemId: id } })
    if (used) throw new ApiError(409, 'لا يمكن حذف صنف له حركات مخزون — أوقفه بدلًا من حذفه')
    await db.item.delete({ where: { id } })
    await logAudit(db, { action: 'delete', entity: 'item', entityId: id, notes: `حذف صنف: ${it.name}`, user: { userId: user.userId, username: user.username } })
    return null
  })
}
