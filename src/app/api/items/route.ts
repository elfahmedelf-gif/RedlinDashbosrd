import { handle, num, readBody } from '@/lib/server/http'
import { requirePerm, requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'
import { listItems } from '@/lib/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'inventory.view')
    return listItems(new URL(req.url).searchParams)
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'inventory.manage')
    const b = await readBody(req)
    const it = await db.item.create({ data: { code: b.code ?? null, name: b.name, nameEn: b.nameEn ?? null, unit: b.unit ?? null, reorderLevel: num(b.reorderLevel) ?? 0, cost: b.cost != null ? (num(b.cost) as number) : undefined, price: b.price != null ? (num(b.price) as number) : undefined, warehouseId: b.warehouseId || null, notes: b.notes ?? null } })
    await logAudit(db, { action: 'create', entity: 'item', entityId: it.id, notes: `إضافة صنف: ${it.name}`, user: { userId: user.userId, username: user.username } })
    return { id: it.id }
  })
}
