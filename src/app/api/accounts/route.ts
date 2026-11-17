import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit, nextSeq } from '@/lib/server/audit'
import { db } from '@/lib/db'
import { listAccounts } from '@/lib/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    await requirePerm(req, 'accounting.view')
    return listAccounts()
  })
}

/** إنشاء حساب — رمز تلقائي من تسلسل الحساب الأب (بلا سباق تكرار) */
export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'accounting.accounts.manage')
    const b = await readBody(req)
    if (!b.name || !String(b.name).trim()) throw new ApiError(400, 'اسم الحساب مطلوب')

    const result = await db.$transaction(async (tx) => {
      let code = b.code ? String(b.code).trim() : null
      let parentId = b.parentId || null
      if (parentId) {
        const parent = await tx.account.findUnique({ where: { id: parentId } })
        if (!parent) throw new ApiError(400, 'الحساب الأب غير موجود')
        if (!b.code) {
          // رمز تلقائي: رمز الأب + تسلسل تحت نفس الأب
          const n = await nextSeq(tx, `account:children:${parent.code}`)
          code = `${parent.code}${String(n).padStart(2, '0')}`
        }
      }
      if (!code) throw new ApiError(400, 'رمز الحساب مطلوب (أو حدد الحساب الأب ليُولَّد تلقائيًا)')
      if (await tx.account.findUnique({ where: { code } })) throw new ApiError(409, `رمز الحساب ${code} موجود بالفعل`)
      const acc = await tx.account.create({
        data: {
          code, name: String(b.name).trim(), nameEn: b.nameEn ?? null,
          type: b.type ?? 'asset', parentId, isDetail: b.isDetail !== false,
        },
      })
      await logAudit(tx, {
        action: 'create', entity: 'account', entityId: acc.id,
        notes: `إضافة حساب: ${acc.code} — ${acc.name}`,
        user: { userId: user.userId, username: user.username },
        after: { code: acc.code, name: acc.name, parentId },
      })
      return { id: acc.id, code: acc.code }
    })
    return result
  })
}

/** تعديل حساب (اسم/أب/تفعيل) — الحسابات ذات حركات لا تُوقف ولا يُغيّر أبها (حماية الأرصدة) */
export async function PATCH(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'accounting.accounts.manage')
    const b = await readBody(req)
    if (!b.id) throw new ApiError(400, 'معرف الحساب مطلوب')

    await db.$transaction(async (tx) => {
      const acc = await tx.account.findUnique({ where: { id: b.id } })
      if (!acc) throw new ApiError(404, 'الحساب غير موجود')

      const hasLines = await tx.journalLine.count({ where: { accountId: acc.id } })
      const hasChildren = await tx.account.count({ where: { parentId: acc.id } })
      const hasVouchers = await tx.opVoucher.count({ where: { cashAccountId: acc.id } })

      const data: any = {}
      if (b.name != null && String(b.name).trim()) data.name = String(b.name).trim()
      if (b.nameEn !== undefined) data.nameEn = b.nameEn
      if (b.active !== undefined) data.active = !!b.active
      if (b.parentId !== undefined && b.parentId !== acc.parentId) {
        if (hasLines) throw new ApiError(409, 'لا يمكن نقل حساب له حركات محاسبية — استخدم قيد تصحيح')
        if (hasChildren) throw new ApiError(409, 'لا يمكن نقل حساب رئيسي له حسابات فرعية')
        if (b.parentId) {
          const parent = await tx.account.findUnique({ where: { id: b.parentId } })
          if (!parent) throw new ApiError(400, 'الحساب الأب الجديد غير موجود')
          if (parent.id === acc.id) throw new ApiError(400, 'لا يمكن جعل الحساب أبًا لنفسه')
        }
        data.parentId = b.parentId || null
      }
      // إيقاف حساب له حركات/أذونات مرتبطة = كسر الأرصدة (منع الحذف المدمر)
      if (data.active === false && (hasLines || hasVouchers)) {
        throw new ApiError(409, 'لا يمكن إيقاف حساب له حركات محاسبية أو أذونات مرتبطة — استخدم قيدًا عكسيًا أو تسوية وفق سياسة النظام')
      }
      if (!Object.keys(data).length) throw new ApiError(400, 'لا توجد حقول صالحة للتعديل')

      await tx.account.update({ where: { id: acc.id }, data })
      await logAudit(tx, {
        action: 'update', entity: 'account', entityId: acc.id,
        notes: `تعديل حساب: ${acc.code} — ${data.name ?? acc.name}`,
        user: { userId: user.userId, username: user.username },
        before: { name: acc.name, active: acc.active, parentId: acc.parentId },
        after: data,
      })
    })
    return { ok: true }
  })
}

/** حذف حساب — فقط إذا كان بلا حركات وبلا أبناء وبلا أذونات مرتبطة */
export async function DELETE(req: Request) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'accounting.accounts.manage')
    const b = await readBody(req)
    if (!b.id) throw new ApiError(400, 'معرف الحساب مطلوب')

    await db.$transaction(async (tx) => {
      const acc = await tx.account.findUnique({ where: { id: b.id } })
      if (!acc) return null
      const [hasLines, hasChildren, hasVouchers] = await Promise.all([
        tx.journalLine.count({ where: { accountId: acc.id } }),
        tx.account.count({ where: { parentId: acc.id } }),
        tx.opVoucher.count({ where: { cashAccountId: acc.id } }),
      ])
      if (hasLines) throw new ApiError(409, `لا يمكن حذف الحساب "${acc.name}" — له حركات محاسبية. استخدم القيد العكسي أو التسوية`)
      if (hasChildren) throw new ApiError(409, `لا يمكن حذف الحساب "${acc.name}" — له حسابات فرعية`)
      if (hasVouchers) throw new ApiError(409, `لا يمكن حذف الحساب "${acc.name}" — مرتبط بأذونات مالية`)
      await tx.account.delete({ where: { id: acc.id } })
      await logAudit(tx, {
        action: 'delete', entity: 'account', entityId: acc.id,
        notes: `حذف حساب: ${acc.code} — ${acc.name}`,
        user: { userId: user.userId, username: user.username },
        before: { code: acc.code, name: acc.name },
      })
    })
    return null
  })
}
