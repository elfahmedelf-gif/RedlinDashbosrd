import { handle } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** سجل التدقيق — يدعم entity/action/q + ترقيم صحيح (كان الإجمالي مقتطعًا عند 400) */
export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'audit.view')
    const url = new URL(req.url)
    const entity = url.searchParams.get('entity')
    const action = url.searchParams.get('action')
    const search = (url.searchParams.get('q') ?? '').trim().toLowerCase()
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
    const pageSize = Math.min(200, Math.max(10, parseInt(url.searchParams.get('pageSize') || '100', 10)))
    const where = {
      ...(entity ? { entity } : {}),
      ...(action ? { action } : {}),
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
    }
    const [rows, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.auditLog.count({ where }),
    ])
    return { items: rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
  })
}
