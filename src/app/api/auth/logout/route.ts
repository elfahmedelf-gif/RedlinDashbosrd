import { handle } from '@/lib/server/http'
import { authLogoutToken, tokenFrom } from '@/lib/server/session'

export async function POST(req: Request) {
  return handle(async () => {
    await authLogoutToken(tokenFrom(req))
    return { ok: true }
  })
}
