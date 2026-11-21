import { ApiError, handle, num, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
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
    if (!b.name || !String(b.name).trim()) throw new ApiError(400, 'اسم الصنف مطلوب')

    const result = await db.$transaction(async (tx) => {
      // التحقق من وجود المخزن (كان يُقبل أي معرف → خطأ 500)
      if (b.warehouseId && !(await tx.warehouse.findUnique({ where: { id: b.warehouseId } }))) {
        throw new ApiError(400, 'المخزن المحدد غير موجود')
      }
      const it = await tx.item.create({
        data: {
          code: b.code ?? null, name: String(b.name).trim(), nameEn: b.nameEn ?? null,
          unit: b.unit ?? null, reorderLevel: num(b.reorderLevel) ?? 0,
          cost: b.cost != null ? (num(b.cost) as number) : undefined,
          price: b.price != null ? (num(b.price) as number) : undefined,
          warehouseId: b.warehouseId || null, notes: b.notes ?? null,
        },
      })
      await logAudit(tx, {
        action: 'create', entity: 'item', entityId: it.id,
        notes: `إضافة صنف: ${it.name}`,
        user: { userId: user.userId, username: user.username },
        after: { name: it.name, warehouseId: it.warehouseId },
      })
      return { id: it.id }
    })
    return result
  })
}
