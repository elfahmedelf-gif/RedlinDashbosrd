import { handle, readBody } from '@/lib/server/http'
import { authLoginUser } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const body = await readBody(req)
    return authLoginUser(String(body.username ?? ''), String(body.password ?? ''))
  })
}
