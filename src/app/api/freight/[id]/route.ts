import { ApiError, handle, num, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const EDITABLE_TEXT = ['regionAr', 'regionEn', 'routeName', 'loadType', 'notes'] as const
const EDITABLE_NUM = ['cost', 'sellPrice', 'sellPrice2'] as const

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'inventory.freight')
    const { id } = await params
    const b = await readBody(req)

    await db.$transaction(async (tx) => {
      const f = await tx.freightPrice.findUnique({ where: { id } })
      if (!f) throw new ApiError(404, 'السعر غير موجود')
      const data: any = {}
      for (const k of EDITABLE_TEXT) if (b[k] !== undefined) data[k] = b[k]
      for (const k of EDITABLE_NUM) if (b[k] !== undefined) data[k] = num(b[k]) ?? 0
      if (b.distanceKm !== undefined) data.distanceKm = b.distanceKm != null ? String(b.distanceKm) : null
      if (!Object.keys(data).length) throw new ApiError(400, 'لا توجد حقول صالحة للتعديل')
      await tx.freightPrice.update({ where: { id }, data })
      await logAudit(tx, {
        action: 'update', entity: 'freight_price', entityId: id,
        notes: `تعديل سعر نولون: ${data.routeName ?? f.routeName}`,
        user: { userId: user.userId, username: user.username },
        before: { cost: f.cost, sellPrice: f.sellPrice, sellPrice2: f.sellPrice2 },
        after: data,
      })
    })
    return { ok: true }
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'inventory.freight')
    const { id } = await params
    const f = await db.freightPrice.findUnique({ where: { id } })
    if (!f) return null
    await db.freightPrice.delete({ where: { id } })
    await logAudit(db, { action: 'delete', entity: 'freight_price', entityId: id, notes: `حذف سعر نولون: ${f.routeName}`, user: { userId: user.userId, username: user.username } })
    return null
  })
}
