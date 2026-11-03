import { handle, readBody } from '@/lib/server/http'
import { requirePerm, requireUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requireUser(req)
    const url = new URL(req.url)
    const category = url.searchParams.get('category')
    const activeOnly = url.searchParams.get('active') === '1'
    const rows = await db.lookupItem.findMany({ where: { ...(category ? { category } : {}), ...(activeOnly ? { active: true } : {}) }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] })
    const byCategory: Record<string, any[]> = {}
    for (const it of rows) {
      if (!byCategory[it.category]) byCategory[it.category] = []
      byCategory[it.category].push(it)
    }
    return { items: rows, byCategory, total: rows.length }
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'settings.manage')
    const b = await readBody(req)
    const cat = b.category
    const max = await db.lookupItem.aggregate({ where: { category: cat }, _max: { sortOrder: true } })
    const lk = await db.lookupItem.create({
      data: { category: cat, key: b.key || b.label, label: b.label ?? b.key, labelEn: b.labelEn ?? null, tone: b.tone ?? null, icon: b.icon ?? null, active: b.active !== false, sortOrder: (b.sortOrder ?? (max._max.sortOrder ?? 0) + 1), isSystem: false },
    })
    await logAudit(db, { action: 'create', entity: 'setting', entityId: lk.id, notes: `إضافة قيمة قائمة منسدلة: ${lk.label}`, user: { userId: user.userId, username: user.username } })
    return { id: lk.id }
  })
}
