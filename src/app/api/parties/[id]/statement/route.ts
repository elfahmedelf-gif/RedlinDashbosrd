import { ApiError, handle, round2 } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * كشف حساب تفصيلي للطرف (عميل/مقاول/مورد) — كل الحركات الفعلية مرتبة زمنيًا
 * مع رصيد تراكمي (Running Balance) بعد كل حركة:
 *   الرصيد الافتتاحي (سالب إذا كان دائن) + Σ(مدين − دائن) من القيود المرحّلة
 * يتضمن: قيود تسليم الشحنات، سندات القبض/الصرف، تسويات المندوبين، القيود اليدوية.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'parties.view')
    const { id } = await params
    const q = new URL(req.url).searchParams
    const from = q.get('from')
    const to = q.get('to')

    const party = await db.party.findUnique({
      where: { id },
      include: { branch: { select: { id: true, name: true } } },
    })
    if (!party) throw new ApiError(404, 'الطرف غير موجود')

    // الرصيد الافتتاحي: دائن = الطرف دفع مقدمًا (سالب)، مدين = الطرف مدين لنا
    const sign = party.openingBalanceType === 'credit' ? -1 : 1
    let opening = round2(sign * Number(party.openingBalance ?? 0))

    // الرصيد قبل بداية الفترة (من القيود المرحّلة السابقة على المدى)
    if (from) {
      const beforeLines = await db.journalLine.findMany({
        where: { partyId: id, entry: { status: 'posted', date: { lt: new Date(from + 'T00:00:00') } } },
        select: { debit: true, credit: true },
      })
      opening = round2(opening + beforeLines.reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0))
    }

    const lineWhere: any = { partyId: id, entry: { status: 'posted' } }
    const dateRange: any = {}
    if (from) dateRange.gte = new Date(from + 'T00:00:00')
    if (to) dateRange.lte = new Date(to + 'T23:59:59')
    if (from || to) lineWhere.entry.date = dateRange

    const lines = await db.journalLine.findMany({
      where: lineWhere,
      include: {
        entry: { select: { id: true, entryNo: true, date: true, description: true, reference: true, sourceType: true } },
        account: { select: { id: true, code: true, name: true } },
        shipment: { select: { id: true, shipmentNo: true } },
      },
      orderBy: [{ entry: { date: 'asc' } }, { id: 'asc' }],
    })

    let running = opening
    const items = lines.map((l) => {
      running = round2(running + (l.debit || 0) - (l.credit || 0))
      return {
        id: l.id,
        date: l.entry.date,
        entryNo: l.entry.entryNo,
        description: l.entry.description,
        reference: l.entry.reference,
        sourceType: l.entry.sourceType,
        account: { id: l.account.id, code: l.account.code, name: l.account.name },
        shipment: l.shipment ? { id: l.shipment.id, shipmentNo: l.shipment.shipmentNo } : null,
        debit: l.debit,
        credit: l.credit,
        balance: running,
      }
    })

    const totalDebit = round2(items.reduce((s, i) => s + i.debit, 0))
    const totalCredit = round2(items.reduce((s, i) => s + i.credit, 0))
    return {
      party: {
        id: party.id, code: party.code, name: party.name, nameEn: party.nameEn,
        isCustomer: party.isCustomer, isContractor: party.isContractor, isSupplier: party.isSupplier,
        phone: party.phone, branch: party.branch ? { id: party.branch.id, name: party.branch.name } : null,
        openingBalance: party.openingBalance,
        openingBalanceType: party.openingBalanceType,
      },
      period: { from: from ?? null, to: to ?? null },
      opening,
      items,
      totals: { totalDebit, totalCredit, closing: running },
    }
  })
}
