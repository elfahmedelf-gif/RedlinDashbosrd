// ============================================================================
// ترقيع بيانات البذرة في القاعدة الحية (مرة واحدة):
//   • كل سند مالي من بذور النظام القديمة (seed-ovc-fin-*) يحصل على قيده المزدوج
//     الخاص المطابق تمامًا لمبلغه — بنفس قواعد postFinancialVoucherJournal
//     قبض: مدين الصندوق 1101 / دائن العملاء 1103
//     صرف: مدين مقاولي النقل 2102 / دائن الصندوق 1101
//   • فك الربط الخاطئ القديم (COL-0001→JE-0002، CSH-0001→JE-0003)
//   • تصحيح وصف القيد السردي JE-0003 (استحقاق وليس صرف)
//   • العداد التسلسلي للقيود يظل متسقًا عبر nextSeq
// ============================================================================
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient({ datasources: { db: { url: 'file:/home/z/my-project/db/custom.db' } } })

const TYPE_LABEL = { collection: 'إذن تحصيل نقدية', cash_disbursement: 'إذن صرف نقدية', cash_deposit: 'إذن توريد خزينة', courier_settlement: 'إذن تسوية عهدة مندوب' }

async function nextSeq(key) {
  const row = await db.seqCounter.upsert({ where: { key }, update: { value: { increment: 1 } }, create: { key, value: 1 } })
  return row.value
}

async function main() {
  const cash = await db.account.findUnique({ where: { code: '1101' } })
  const ar = await db.account.findUnique({ where: { code: '1103' } })
  const contractors = await db.account.findUnique({ where: { code: '2102' } })
  if (!cash || !ar || !contractors) throw new Error('حسابات الدليل الأساسية غير موجودة')

  const vouchers = await db.opVoucher.findMany({
    where: { id: { startsWith: 'seed-ovc-fin-' }, type: { in: ['collection', 'cash_disbursement', 'cash_deposit', 'courier_settlement'] } },
    include: { party: { select: { id: true, name: true } }, journalEntry: { select: { id: true, entryNo: true, totalDebit: true, totalCredit: true, sourceType: true, sourceId: true } } },
  })
  console.log(`financial seed vouchers: ${vouchers.length}`)

  let created = 0
  for (const v of vouchers) {
    const amount = Number(v.amount ?? 0)
    if (!(amount > 0)) { console.log(`skip ${v.voucherNo} — amount invalid`); continue }

    const je = v.journalEntry
    const alreadyExact = !!je
      && je.sourceType === 'op_voucher'
      && je.sourceId === v.id
      && Math.abs(je.totalDebit - amount) < 0.005
      && Math.abs(je.totalCredit - amount) < 0.005
    if (alreadyExact) { console.log(`ok    ${v.voucherNo} — already exact (${je.entryNo})`); continue }

    const admin = await db.user.findUnique({ where: { username: 'admin' } })
    const n = await nextSeq('journal')
    const entryNo = `JE-${String(n).padStart(4, '0')}`
    const partyId = v.partyId ?? v.courierId ?? null
    const partyName = v.party?.name ?? ''
    const desc = `${TYPE_LABEL[v.type] ?? v.type} ${v.voucherNo}${partyName ? ` — ${partyName}` : ''}${v.notes ? ` — ${v.notes}` : ''}`

    let lines
    if (v.type === 'collection') {
      lines = [
        { accountId: cash.id, debit: amount, credit: 0, description: 'نقدية محصلة', partyId },
        { accountId: ar.id, debit: 0, credit: amount, description: 'تحصيل من العميل', partyId },
      ]
    } else if (v.type === 'cash_disbursement') {
      lines = [
        { accountId: contractors.id, debit: amount, credit: 0, description: 'صرف مستحقات مقاول', partyId },
        { accountId: cash.id, debit: 0, credit: amount, description: 'نقدية مدفوعة', partyId },
      ]
    } else {
      // أنواع بذرة غير موجودة عمليًا — حماية
      console.log(`skip ${v.voucherNo} — unsupported type ${v.type}`)
      continue
    }

    await db.$transaction(async (tx) => {
      const entry = await tx.journalEntry.create({
        data: {
          entryNo,
          date: v.createdAt,
          description: desc,
          reference: v.voucherNo,
          branchId: v.sourceBranchId,
          sourceType: 'op_voucher',
          sourceId: v.id,
          status: 'posted',
          totalDebit: amount,
          totalCredit: amount,
          userId: admin?.id ?? null,
          userName: 'admin',
          postedAt: v.createdAt,
          postedByUserName: 'admin',
          lines: { create: lines },
        },
      })
      await tx.opVoucher.update({ where: { id: v.id }, data: { journalEntryId: entry.id } })
      await tx.auditLog.create({
        data: {
          userId: admin?.id ?? null, userName: 'admin',
          action: 'update', entity: 'journal_entry', entityId: entry.id,
          notes: `ترقيع تكامل بيانات البذرة — إنشاء القيد ${entryNo} المطابق للسند ${v.voucherNo}`,
        },
      })
    })
    created++
    console.log(`fixed ${v.voucherNo} — created ${entryNo} (${amount})`)
  }

  // تصحيح وصف JE-0003 (سردية البذرة: استحقاق وليس صرف)
  const je3 = await db.journalEntry.findUnique({ where: { entryNo: 'JE-0003' } })
  if (je3 && je3.description === 'صرف مستحقات مقاولي النقل') {
    await db.journalEntry.update({ where: { id: je3.id }, data: { description: 'إثبات مستحقات مقاولي النقل — استحقاق شغل منفَّذ', reference: 'ACC-CONTR' } })
    console.log('fixed JE-0003 description (accrual, not payment)')
  }

  // تحقق نهائي: لا سند مالي مكتمل بلا قيد
  const remaining = await db.opVoucher.count({
    where: { type: { in: ['collection', 'cash_disbursement', 'cash_deposit', 'courier_settlement'] }, status: 'completed', journalEntryId: null },
  })
  console.log(`created ${created} entries | financial vouchers still WITHOUT journal: ${remaining}`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
