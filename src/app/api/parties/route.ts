import { ApiError, handle, num, readBody, round2 } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit, nextSeq } from '@/lib/server/audit'
import { db } from '@/lib/db'
import { listParties } from '@/lib/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'parties.view')
    return listParties(new URL(req.url).searchParams, user)
  })
}

/** إنشاء طرف — الرمز من عدّاد تسلسلي (لا تكرار بعد حذف أي طرف) */
export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'parties.manage')
    const b = await readBody(req)
    if (!b.name || !String(b.name).trim()) throw new ApiError(400, 'اسم الطرف مطلوب')

    const result = await db.$transaction(async (tx) => {
      const prefix = b.isContractor ? 'K' : b.isSupplier ? 'S' : 'C'
      const n = await nextSeq(tx, `party:${prefix}`)
      const code = b.code || `${prefix}-${String(n).padStart(4, '0')}`
      if (b.branchId && !(await tx.branch.findUnique({ where: { id: b.branchId } }))) throw new ApiError(400, 'الفرع المحدد غير موجود')

      const p = await tx.party.create({
        data: {
          code,
          name: String(b.name).trim(), nameEn: b.nameEn ?? null,
          isCustomer: !!b.isCustomer, isContractor: !!b.isContractor, isSupplier: !!b.isSupplier,
          phone: b.phone ?? null, phones: b.phones ?? null, email: b.email ?? null,
          address: b.address ?? null, city: b.city ?? null, region: b.region ?? null,
          taxNumber: b.taxNumber ?? null, paymentTerms: b.paymentTerms ?? null,
          creditLimit: b.creditLimit != null ? num(b.creditLimit) : null,
          openingBalance: b.openingBalance != null ? num(b.openingBalance) ?? 0 : 0,
          openingBalanceType: b.openingBalanceType === 'credit' ? 'credit' : b.openingBalanceType === 'debit' ? 'debit' : null,
          branchId: b.branchId || null, notes: b.notes ?? null,
        },
      })
      await logAudit(tx, {
        action: 'create', entity: 'party', entityId: p.id,
        notes: `إضافة طرف: ${p.name}${p.openingBalance ? ` برصيد افتتاحي ${p.openingBalance}` : ''}`,
        user: { userId: user.userId, username: user.username },
        after: { code: p.code, name: p.name, openingBalance: p.openingBalance },
      })
      return { id: p.id, code }
    })
    return result
  })
}

void round2
