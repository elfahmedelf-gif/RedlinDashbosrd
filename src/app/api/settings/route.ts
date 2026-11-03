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
    const rows = await db.setting.findMany({ orderBy: { key: 'asc' } })
    return { items: rows, total: rows.length }
  })
}

export async function PATCH(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'settings.manage')
    const b = await readBody(req)
    const updates: Record<string, any> = Array.isArray(b.updates) ? Object.fromEntries(b.updates.map((u: any) => [u.key, u.value])) : (b.updates ?? {})
    for (const [key, value] of Object.entries(updates)) {
      await db.setting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value), label: key },
      })
    }
    await logAudit(db, { action: 'update', entity: 'setting', entityId: null, notes: 'تحديث إعدادات النظام', user: { userId: user.userId, username: user.username }, after: updates })
    return { ok: true }
  })
}
