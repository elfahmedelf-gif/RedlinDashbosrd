import { handle } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'
import { backfillShipmentJournals } from '@/lib/server/shipment-accounting'

export const dynamic = 'force-dynamic'

/**
 * ترحيل جماعي (أداة تصحيح): إنشاء قيود تسليم لكل الشحنات المسلّمة
 * التي لا يوجد لها قيد — لإتزامان الأرصدة الحية مع الشحنات الفعلية.
 * داخل معاملة واحدة + تدقيق.
 */
export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'accounting.journal')
    const result = await db.$transaction(async (tx) => {
      const r = await backfillShipmentJournals(tx, { userId: user.userId, username: user.username })
      await logAudit(tx, {
        action: 'backfill', entity: 'journal_entry', entityId: null,
        notes: `ترحيل قيود تسليم الشحنات غير المرحّلة: ${r.posted}/${r.processed}`,
        user: { userId: user.userId, username: user.username },
        after: { processed: r.processed, posted: r.posted },
      })
      return r
    })
    return result
  })
}
