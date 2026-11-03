import { handle } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { report } from '@/lib/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ type: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const { type } = await params
    await requirePerm(req, 'reports.view')
    return report(type, new URL(req.url).searchParams)
  })
}
