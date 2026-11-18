import type { Prisma } from '@prisma/client'
import { ApiError, handle } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const ref = (r?: { id: string; name: string } | null) => (r ? { id: r.id, name: r.name } : null)

function dateRange(from: string | null, to: string | null): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined
  return {
    ...(from ? { gte: new Date(from + 'T00:00:00') } : {}),
    ...(to ? { lte: new Date(to + 'T23:59:59') } : {}),
  }
}

/**
 * كشف حساب لحساب واحد — رصيد افتتاحي + حركات الفترة + رصيد متحرك + إجماليات
 * يتطلب accounting.view (مثل شجرة الحسابات نفسها — وليس صلاحية التقارير)
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'accounting.view')
    const { id } = await params
    const q = new URL(req.url).searchParams
    const from = q.get('from') || null
    const to = q.get('to') || null

    const acc = await db.account.findUnique({ where: { id } })
    if (!acc) throw new ApiError(404, 'الحساب غير موجود')

    // الرصيد الافتتاحي = مجموع (مدين − دائن) للقيود المرحّلة السابقة على بداية الفترة
    let opening = 0
    if (from) {
      const beforeLines = await db.journalLine.findMany({
        where: { accountId: id, entry: { status: 'posted', date: { lt: new Date(from + 'T00:00:00') } } },
        select: { debit: true, credit: true },
      })
      opening = beforeLines.reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0)
    }

    const where: Prisma.JournalLineWhereInput = { accountId: id, entry: { status: 'posted' } }
    const range = dateRange(from, to)
    if (range) where.entry = { status: 'posted', date: range }

    const lines = await db.journalLine.findMany({
      where,
      include: { entry: true, party: { select: { id: true, name: true } } },
      orderBy: [{ entry: { date: 'asc' } }, { entry: { createdAt: 'asc' } }],
    })

    let running = opening
    let periodDebit = 0
    let periodCredit = 0
    const items = lines.map((l) => {
      const debit = l.debit || 0
      const credit = l.credit || 0
      periodDebit += debit
      periodCredit += credit
      running = running + debit - credit
      return {
        id: l.id,
        date: l.entry.date,
        entryNo: l.entry.entryNo,
        entryId: l.entry.id,
        description: l.entry.description,
        lineDescription: l.description,
        reference: l.entry.reference,
        party: ref(l.party),
        debit,
        credit,
        balance: running,
      }
    })

    return {
      account: { id: acc.id, code: acc.code, name: acc.name, type: acc.type },
      opening: Math.round(opening * 100) / 100,
      items,
      totals: {
        debit: Math.round(periodDebit * 100) / 100,
        credit: Math.round(periodCredit * 100) / 100,
        closing: Math.round(running * 100) / 100,
      },
      period: { from: from || null, to: to || null },
    }
  })
}
