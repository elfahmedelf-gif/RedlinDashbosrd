import { ApiError, handle, readBody } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/session'
import { ensureSeeded } from '@/lib/server/seed'
import { logAudit } from '@/lib/server/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** قائمة بيضاء — القيم القابلة للتعديل (category/key لها تحقق تفرد) */
const EDITABLE = ['label', 'labelEn', 'tone', 'icon', 'active', 'sortOrder'] as const

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'settings.manage')
    const { id } = await params
    const b = await readBody(req)

    await db.$transaction(async (tx) => {
      const lk = await tx.lookupItem.findUnique({ where: { id } })
      if (!lk) throw new ApiError(404, 'القيمة غير موجودة')

      const data: any = {}
      for (const k of EDITABLE) if (b[k] !== undefined) data[k] = b[k]
      // تغيير category/key محفوف بكسر المراجع — مسموح فقط مع تحقق التفرد
      if ((b.category !== undefined && b.category !== lk.category) || (b.key !== undefined && b.key !== lk.key)) {
        if (lk.isSystem) throw new ApiError(409, 'لا يمكن تغيير مفتاح قيمة نظامية (مرتبطة بمنطق التشغيل)')
        const category = b.category ?? lk.category
        const key = b.key ?? lk.key
        const dup = await tx.lookupItem.findUnique({ where: { category_key: { category, key } } })
        if (dup && dup.id !== id) throw new ApiError(409, 'قيمة بنفس الفئة والمفتاح موجودة بالفعل')
        data.category = category
        data.key = key
      }
      if (!Object.keys(data).length) throw new ApiError(400, 'لا توجد حقول صالحة للتعديل')

      await tx.lookupItem.update({ where: { id }, data })
      // كانت التعديلات هنا بلا أي تدقيق — الآن موثّقة
      await logAudit(tx, {
        action: 'update', entity: 'setting', entityId: id,
        notes: `تعديل قيمة قائمة: ${lk.label ?? lk.key}`,
        user: { userId: user.userId, username: user.username },
        before: { category: lk.category, key: lk.key, label: lk.label, active: lk.active, sortOrder: lk.sortOrder },
        after: data,
      })
    })
    return { ok: true }
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await ensureSeeded()
    const user = await requirePerm(req, 'settings.manage')
    const { id } = await params
    await db.$transaction(async (tx) => {
      const lk = await tx.lookupItem.findUnique({ where: { id } })
      if (!lk) return null
      if (lk.isSystem) throw new ApiError(409, 'لا يمكن حذف قيمة نظامية (مرتبطة بمنطق التشغيل) — أوقفها بدلًا من حذفها')
      await tx.lookupItem.delete({ where: { id } })
      await logAudit(tx, {
        action: 'delete', entity: 'setting', entityId: id,
        notes: `حذف قيمة قائمة: ${lk.label ?? lk.key}`,
        user: { userId: user.userId, username: user.username },
        before: { category: lk.category, key: lk.key },
      })
    })
    return null
  })
}
