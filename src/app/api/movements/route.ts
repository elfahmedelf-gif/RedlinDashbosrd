import { ApiError, handle, num, readBody, round2 } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const MOVEMENT_TYPES = ['receipt', 'issue', 'transfer', 'adjustment'] as const

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

/**
 * رصيد الصنف داخل مخزن محدد (وليس عالميًا):
 *   receipt/adjustment: ±الكمية | issue: −|الكمية|
 *   transfer: −كمية من مخزن المصدر + كمية لمخزن الوجهة (نفس السطر)
 */
async function warehouseBalance(itemId: string, warehouseId: string): Promise<number> {
  const rows = await db.inventoryMovement.findMany({
    where: { OR: [{ warehouseId }, { toWarehouseId: warehouseId }] },
    select: { type: true, quantity: true, toWarehouseId: true },
  })
  let bal = 0
  for (const m of rows) {
    const qty = Number(m.quantity ?? 0)
    const isDest = m.toWarehouseId === warehouseId && m.type === 'transfer'
    if (isDest) { bal += Math.abs(qty); continue }
    switch (m.type) {
      case 'receipt': bal += Math.abs(qty); break
      case 'issue': bal -= Math.abs(qty); break
      case 'adjustment': bal += qty; break
      case 'transfer': bal -= Math.abs(qty); break
    }
  }
  return round2(bal)
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'inventory.movements')
    const b = await readBody(req)
    const type = String(b.type ?? '')
    if (!(MOVEMENT_TYPES as readonly string[]).includes(type)) {
      throw new ApiError(400, `نوع حركة غير معروف: "${type}" — الأنواع المسموحة: ${MOVEMENT_TYPES.join('، ')}`)
    }
    if (!b.warehouseId) throw new ApiError(400, 'حدد المخزن — الحركة يجب أن ترتبط بمخزن محدد')

    const result = await db.$transaction(async (tx) => {
      const it = b.itemId ? await tx.item.findUnique({ where: { id: b.itemId } }) : null
      if (!it) throw new ApiError(400, 'اختر الصنف أولًا')
      const wh = await tx.warehouse.findUnique({ where: { id: b.warehouseId } })
      if (!wh) throw new ApiError(400, 'المخزن المحدد غير موجود')
      if (!wh.active) throw new ApiError(409, `المخزن "${wh.name}" موقوف`)

      const toWarehouseId = type === 'transfer' ? (b.toWarehouseId || null) : null
      if (type === 'transfer') {
        if (!toWarehouseId) throw new ApiError(400, 'التحويل يتطلب مخزن وجهة (toWarehouseId)')
        if (toWarehouseId === b.warehouseId) throw new ApiError(400, 'لا يمكن التحويل لنفس المخزن')
        const dest = await tx.warehouse.findUnique({ where: { id: toWarehouseId } })
        if (!dest) throw new ApiError(400, 'مخزن الوجهة غير موجود')
        if (!dest.active) throw new ApiError(409, `مخزن الوجهة "${dest.name}" موقوف`)
      }

      const qty = Math.abs(num(b.quantity) ?? 0)
      if (qty <= 0) throw new ApiError(400, 'الكمية يجب أن تكون أكبر من صفر')

      // فحص الرصيد لكل مخزن (داخل المعاملة — بلا سباق TOCTOU)
      // السحب على المكشوف مسموح فقط إذا سمح إعداد النظام صراحةً
      const needsBalance = type === 'issue' || type === 'transfer'
      if (needsBalance) {
        const bal = await warehouseBalance(it.id, b.warehouseId)
        if (bal < qty) {
          const policySetting = await tx.setting.findUnique({ where: { key: 'inventory.allow_negative' } })
          if (policySetting?.value !== 'allow') {
            throw new ApiError(400, `رصيد الصنف "${it.name}" في مخزن "${wh.name}" غير كافٍ — الرصيد ${bal} ${it.unit ?? ''} والمطلوب ${qty}`)
          }
        }
      }

      const mv = await tx.inventoryMovement.create({
        data: {
          type,
          itemId: it.id,
          warehouseId: b.warehouseId,
          toWarehouseId,
          quantity: type === 'adjustment' ? (num(b.quantity) ?? 0) : (type === 'receipt' ? qty : -qty),
          unitCost: b.unitCost != null ? num(b.unitCost) : null,
          totalCost: b.unitCost != null ? round2(qty * Number(b.unitCost)) : null,
          reference: b.reference ?? null,
          notes: b.notes ?? null,
          userName: user.username,
        },
      })
      await logAudit(tx, {
        action: 'create', entity: 'inventory_movement', entityId: mv.id,
        notes: `حركة ${type} للصنف ${it.name} — من "${wh.name}"${toWarehouseId ? ` إلى "${(await tx.warehouse.findUnique({ where: { id: toWarehouseId } }))?.name ?? ''}"` : ''} بكمية ${mv.quantity}`,
        user: { userId: user.userId, username: user.username },
        after: { type, itemId: it.id, warehouseId: b.warehouseId, toWarehouseId, quantity: mv.quantity },
      })
      return { id: mv.id, balance: await warehouseBalance(it.id, b.warehouseId) }
    })
    return result
  })
}
