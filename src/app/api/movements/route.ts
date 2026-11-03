import { ApiError, handle, num, readBody, round2 } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'inventory.view')
    const rows = await db.inventoryMovement.findMany({
      include: {
        item: { select: { id: true, name: true, code: true, unit: true } },
        warehouse: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
    })
    const toWhIds = rows.map((m) => m.toWarehouseId).filter(Boolean) as string[]
    const toWhs = toWhIds.length ? await db.warehouse.findMany({ where: { id: { in: toWhIds } }, select: { id: true, name: true } }) : []
    const toWhMap = new Map(toWhs.map((w) => [w.id, { id: w.id, name: w.name }]))
    const items = rows.map((m) => ({ ...m, warehouse: m.warehouse ? { id: m.warehouse.id, name: m.warehouse.name } : null, toWarehouse: m.toWarehouseId ? toWhMap.get(m.toWarehouseId) ?? null : null }))
    return { items, total: items.length }
  })
}

async function itemBalance(itemId: string): Promise<number> {
  const rows = await db.inventoryMovement.groupBy({ by: ['type'], where: { itemId }, _sum: { quantity: true } })
  let bal = 0
  for (const g of rows) {
    if (g.type === 'transfer') continue
    bal += g._sum.quantity ?? 0
  }
  return round2(bal)
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'inventory.movements')
    const b = await readBody(req)
    const it = b.itemId ? await db.item.findUnique({ where: { id: b.itemId } }) : null
    if (!it) throw new ApiError(400, 'اختر الصنف أولًا')
    let qty = num(b.quantity) ?? 0
    if (b.type === 'issue') qty = -Math.abs(qty)
    if (b.type === 'receipt') qty = Math.abs(qty)
    const bal = await itemBalance(it.id)
    if ((b.type === 'issue' || b.type === 'adjustment') && bal + qty < 0) {
      throw new ApiError(400, `الرصيد غير كافٍ — الرصيد الحالي ${bal} ${it.unit ?? ''}`)
    }
    const mv = await db.inventoryMovement.create({
      data: {
        type: b.type, itemId: it.id, warehouseId: b.warehouseId || null,
        toWarehouseId: b.type === 'transfer' ? (b.toWarehouseId || null) : null,
        quantity: qty, unitCost: b.unitCost != null ? num(b.unitCost) : null,
        totalCost: b.unitCost != null ? round2(Math.abs(qty) * Number(b.unitCost)) : null,
        notes: b.notes ?? null, userName: user.username,
      },
    })
    await logAudit(db, { action: 'create', entity: 'inventory_movement', entityId: mv.id, notes: `حركة ${b.type} للصنف ${it.name} بكمية ${qty}`, user: { userId: user.userId, username: user.username } })
    return { id: mv.id, balance: await itemBalance(it.id) }
  })
}
