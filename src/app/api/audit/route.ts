import { handle } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'audit.view')
    const url = new URL(req.url)
    const entity = url.searchParams.get('entity')
    const search = (url.searchParams.get('q') ?? '').trim().toLowerCase()
    const rows = await db.auditLog.findMany({
      where: {
        ...(entity ? { entity } : {}),
        ...(search
          ? {
              OR: [
                { userName: { contains: search } },
                { action: { contains: search } },
                { entity: { contains: search } },
                { notes: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: { date: 'desc' },
      take: 400,
    })
    return { items: rows.slice(0, 200), total: rows.length }
  })
}
