import { ApiError, handle } from '@/lib/server/http'
import { authValidateToken, tokenFrom } from '@/lib/server/session'

export async function POST(req: Request) {
  return handle(async () => {
    const user = await authValidateToken(tokenFrom(req))
    if (!user) throw new ApiError(401, 'انتهت الجلسة — سجّل الدخول من جديد')
    return { user }
  })
}
