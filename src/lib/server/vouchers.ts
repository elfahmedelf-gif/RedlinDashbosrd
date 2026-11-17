// ============================================================================
// محرك الأذونات التشغيلية — دورة حياة كاملة على الخادم
// الانتقالات + الصلاحيات + ربط الشحنات + منع التعارض/التكرار + الأثر التشغيلي
// والمالي (قيود مزدوجة) — كل شيء داخل معاملات DB وسجل تدقيق
// ============================================================================
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ApiError, round2 } from './http'
import { logAudit, nextSeq } from './audit'
import { matchPermission } from '../permissions'
import { ACTIVE_VOUCHER_STATUSES, TRANSITIONS, VOUCHER_CATEGORIES, VOUCHER_STATES, VOUCHER_TYPES, voucherActionLabel, voucherTypeDef } from '../voucher-catalog'
import { ACC, accountByCode, createJournal, reverseJournal } from './accounting'
import { postShipmentDeliveryJournal, postShipmentReturnReversal } from './shipment-accounting'
import type { SessionUser } from '../permissions'

type Tx = Prisma.TransactionClient

const EPS = 0.005

function stateLabel(key: string): string {
  return VOUCHER_STATES.find((s) => s.key === key)?.label ?? key
}

function stateColor(key: string): string {
  return VOUCHER_STATES.find((s) => s.key === key)?.color ?? ''
}

function typeMeta(code: string) {
  const tdef = voucherTypeDef(code)
  return {
    typeLabel: tdef?.label ?? code,
    typeLabelEn: tdef?.labelEn ?? code,
    typeCategory: tdef?.category ?? 'operational',
    typeColor: tdef?.color ?? '',
    typeIcon: tdef?.icon ?? 'FileText',
    typePrefix: tdef?.prefix ?? 'VCH',
    isFinancial: tdef?.isFinancial ?? false,
    requiresShipments: tdef?.requiresShipments ?? false,
    preStatuses: tdef?.preStatuses ?? null,
    postStatus: tdef?.postStatus ?? null,
  }
}

/** التحقق من وجود الأطراف/الفروع/الحسابات المشار إليها (منع مفاتيح أجنبية مكسورة) */
async function assertVoucherRefs(
  tx: Tx,
  refs: { partyId?: string | null; courierId?: string | null; employeeId?: string | null; destBranchId?: string | null; cashAccountId?: string | null },
) {
  if (refs.partyId && !(await tx.party.findUnique({ where: { id: refs.partyId } }))) {
    throw new ApiError(400, 'الطرف (العميل/المورد) المحدد غير موجود')
  }
  if (refs.courierId && !(await tx.party.findUnique({ where: { id: refs.courierId } }))) {
    throw new ApiError(400, 'المندوب المحدد غير موجود')
  }
  if (refs.employeeId && !(await tx.user.findUnique({ where: { id: refs.employeeId } }))) {
    throw new ApiError(400, 'الموظف المسؤول المحدد غير موجود')
  }
  if (refs.destBranchId && !(await tx.branch.findUnique({ where: { id: refs.destBranchId } }))) {
    throw new ApiError(400, 'الفرع المستلم المحدد غير موجود')
  }
  if (refs.cashAccountId && !(await tx.account.findUnique({ where: { id: refs.cashAccountId } }))) {
    throw new ApiError(400, 'الحساب النقدي (الخزينة) المحدد غير موجود')
  }
}

function branchRef(b?: { id: string; name: string } | null) {
  return b ? { id: b.id, name: b.name } : null
}

/** التحقق من صلاحية على مستوى المستخدم الحالي (الجلسة قادمة من الخادم) */
function assertPerm(user: SessionUser, key: string) {
  if (!matchPermission(user.permissions, key)) {
    throw new ApiError(403, `غير مصرح — هذه العملية تتطلب صلاحية "${key}"`)
  }
}

// ---------------------------------------------------------------------------
// Enrichment — نفس أشكال الاستجابة السابقة حتى تبقى الواجهة متوافقة
// ---------------------------------------------------------------------------
type VoucherRow = Prisma.OpVoucherGetPayload<{
  include: {
    sourceBranch: true; destBranch: true; employee: { select: { id: true; name: true } }
    courier: { select: { id: true; name: true } }; party: { select: { id: true; name: true } }
    cashAccount: { select: { id: true; code: true; name: true } }
    journalEntry: { select: { id: true; entryNo: true } }
    items: { include: { shipment: { include: { customer: { select: { id: true; name: true } } } } } }
    actions: { orderBy: { at: 'asc' } }
  }
}>

export function enrichVoucher(v: VoucherRow) {
  const meta = typeMeta(v.type)
  const items = (v.items ?? []).map((it) => ({
    id: it.id,
    shipmentId: it.shipmentId,
    notes: it.notes,
    addedAt: it.addedAt,
    addedBy: it.addedBy,
    shipment: it.shipment
      ? {
          id: it.shipment.id,
          shipmentNo: it.shipment.shipmentNo,
          status: it.shipment.status,
          destination: it.shipment.destination,
          recipientName: it.shipment.recipientName,
          freightTotal: it.shipment.freightTotal,
          customer: branchRef(it.shipment.customer),
        }
      : null,
  }))
  const shipmentSum = round2(items.reduce((acc, it) => acc + Number(it.shipment?.freightTotal ?? 0), 0))
  const totalValue = meta.isFinancial ? Number(v.amount ?? 0) : shipmentSum
  return {
    id: v.id,
    voucherNo: v.voucherNo,
    type: v.type,
    status: v.status,
    sourceBranchId: v.sourceBranchId,
    destBranchId: v.destBranchId,
    employeeId: v.employeeId,
    courierId: v.courierId,
    partyId: v.partyId,
    amount: v.amount,
    notes: v.notes,
    attachments: [] as any[],
    accountName: v.accountName,
    cashAccountId: v.cashAccountId,
    cashAccount: branchRef(v.cashAccount),
    vehicleNo: v.vehicleNo,
    driverName: v.driverName,
    journalEntryId: v.journalEntryId,
    journalEntryNo: v.journalEntry?.entryNo ?? null,
    createdBy: v.userId,
    createdByName: v.userName,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    approvalLog: (v.actions ?? []).map((a) => ({ action: a.action, userId: a.userId, userName: a.userName, at: a.at, notes: a.notes })),
    ...meta,
    statusLabel: stateLabel(v.status),
    statusColor: stateColor(v.status),
    sourceBranch: branchRef(v.sourceBranch),
    destBranch: branchRef(v.destBranch),
    employee: branchRef(v.employee),
    courier: branchRef(v.courier),
    party: branchRef(v.party),
    items,
    itemCount: items.length,
    totalValue,
  }
}

async function loadVoucher(tx: Tx, id: string): Promise<VoucherRow> {
  const v = await (tx as any).opVoucher.findUnique({
    where: { id },
    include: {
      sourceBranch: true, destBranch: true, employee: { select: { id: true, name: true } },
      courier: { select: { id: true, name: true } }, party: { select: { id: true, name: true } },
      journalEntry: { select: { id: true, entryNo: true } },
      items: { include: { shipment: { include: { customer: { select: { id: true, name: true } } } } } },
      actions: { orderBy: { at: 'asc' } },
    },
  })
  if (!v) throw new ApiError(404, 'الإذن غير موجود')
  return v as VoucherRow
}

export async function nextVoucherNo(tx: Tx, type: string): Promise<string> {
  const tdef = voucherTypeDef(type)
  const n = await nextSeq(tx, `voucher:${type}`)
  return `${tdef?.prefix ?? 'VCH'}-${String(n).padStart(4, '0')}`
}

/** فحص بيانات الإذن الإلزامية حسب نوعه (يُستخدم عند التنفيذ والإكمال) */
function assertCompleteData(v: VoucherRow) {
  const tdef = voucherTypeDef(v.type)
  if (!tdef) throw new ApiError(400, 'نوع الإذن غير معروف')
  if (tdef.requiresEmployee && !v.employeeId) throw new ApiError(400, 'لا يمكن التنفيذ — الموظف المسؤول غير محدد')
  if (tdef.requiresCourier && !v.courierId) throw new ApiError(400, 'لا يمكن التنفيذ — المندوب غير محدد')
  if (tdef.requiresDestBranch && !v.destBranchId) throw new ApiError(400, 'لا يمكن التنفيذ — الفرع المستلم غير محدد')
  if (tdef.requiresParty && !v.partyId) throw new ApiError(400, 'لا يمكن التنفيذ — الطرف (العميل/المورد) غير محدد')
  if (tdef.isFinancial && !(Number(v.amount ?? 0) > 0)) throw new ApiError(400, 'لا يمكن التنفيذ — المبلغ غير محدد')
  if ((v.type === 'loading' || v.type === 'branch_transfer') && (!v.vehicleNo || !v.driverName)) {
    throw new ApiError(400, 'لا يمكن التنفيذ — يجب تسجيل السيارة والسائق لإذن التحميل/التحويل')
  }
  return tdef
}

/** التأكد من صلاحية حالات الشحنات المرتبطة (قبل التنفيذ وعند الإكمال) */
async function assertShipmentsForType(tx: Tx, v: VoucherRow, phase: 'execute' | 'complete') {
  const tdef = voucherTypeDef(v.type)
  if (!tdef?.requiresShipments) return
  if (!v.items?.length) throw new ApiError(400, 'هذا الإذن يتطلب شحنة واحدة على الأقل')
  for (const it of v.items) {
    const s = await tx.shipment.findUnique({ where: { id: it.shipmentId } })
    if (!s) throw new ApiError(409, `الشحنة المرتبطة ${it.shipmentId} لم تعد موجودة`)
    if (tdef.preStatuses && !tdef.preStatuses.includes(s.status)) {
      throw new ApiError(409, `الشحنة ${s.shipmentNo ?? ''} حالتها "${s.status}" لا تصلح لـ${phase === 'execute' ? 'التنفيذ' : 'الإكمال'} — المطلوب: ${tdef.preStatuses.join(' أو ')}`)
    }
  }
}

// ---------------------------------------------------------------------------
// الأثر المالي — إنشاء قيد مزدوج لكل سند مالي مكتمل (مرة واحدة فقط)
// ---------------------------------------------------------------------------
export async function postFinancialVoucherJournal(tx: Tx, voucherId: string, user: SessionUser) {
  const v = await loadVoucher(tx, voucherId)
  if (v.journalEntryId) {
    // أثر مالي مسجل مسبقًا — لا تكرار (منع الترحيل المزدوج)
    return v.journalEntry
  }
  const amount = round2(Number(v.amount ?? 0))
  if (!(amount > 0)) throw new ApiError(400, 'المبلغ مطلوب لإنشاء القيد المحاسبي')
  const cashAcc = v.cashAccountId
    ? await tx.account.findUnique({ where: { id: v.cashAccountId } })
    : await accountByCode(tx, ACC.CASH)
  if (!cashAcc) throw new ApiError(400, 'خزينة/حساب نقدي غير صحيح')
  // ربط سطر القيد بالطرف: العميل/المورد مباشرة، أو المندوب في تسوية العهدة
  // (حتى تظهر حركة المندوب في كشف حسابه) — إصلاح: تسوية المندوب كانت بلا طرف
  const partyLine = { partyId: v.partyId ?? v.courierId ?? null }
  const u = { userId: user.userId, username: user.username }
  const firstShipmentId = v.items?.[0]?.shipmentId ?? null

  let lines
  switch (v.type) {
    case 'collection': {
      // قبض نقدية من العميل: مدين الصندوق / دائن العملاء (تخفيض المديونية)
      const ar = await accountByCode(tx, ACC.AR)
      lines = [
        { accountId: cashAcc.id, debit: amount, credit: 0, description: 'نقدية محصلة', ...partyLine, shipmentId: firstShipmentId },
        { accountId: ar.id, debit: 0, credit: amount, description: 'تحصيل من العميل', ...partyLine, shipmentId: firstShipmentId },
      ]
      break
    }
    case 'cash_disbursement': {
      // صرف نقدية لمقاول/مورد: مدين مستحقات المقاولين / دائن الصندوق
      const ctr = await accountByCode(tx, ACC.CONTRACTORS)
      lines = [
        { accountId: ctr.id, debit: amount, credit: 0, description: 'صرف مستحقات مقاول', ...partyLine },
        { accountId: cashAcc.id, debit: 0, credit: amount, description: 'نقدية مدفوعة', ...partyLine },
      ]
      break
    }
    case 'cash_deposit': {
      // توريد الخزينة للبنك: مدين البنوك / دائن الصندوق
      const bank = await accountByCode(tx, ACC.BANK)
      lines = [
        { accountId: bank.id, debit: amount, credit: 0, description: 'إيداع نقدي بالبنك' },
        { accountId: cashAcc.id, debit: 0, credit: amount, description: 'نقدية موردة من الصندوق' },
      ]
      break
    }
    case 'courier_settlement': {
      // تسوية عهدة مندوب: مدين الصندوق / دائن عهد المندوبين
      const custody = await accountByCode(tx, ACC.COURIER_CUSTODY)
      lines = [
        { accountId: cashAcc.id, debit: amount, credit: 0, description: 'نقدية مستلمة من المندوب', ...partyLine },
        { accountId: custody.id, debit: 0, credit: amount, description: 'إغلاق عهدة المندوب', ...partyLine },
      ]
      break
    }
    default:
      throw new ApiError(400, 'هذا النوع ليس سندًا ماليًا')
  }

  const tdef = voucherTypeDef(v.type)!
  const entry = await createJournal(tx, {
    description: `${tdef.label} ${v.voucherNo}${v.party?.name ? ` — ${v.party.name}` : ''}${v.items?.length ? ` (شحنات: ${v.items.map((it) => it.shipment?.shipmentNo ?? '').filter(Boolean).join('، ')})` : ''}`,
    reference: v.voucherNo,
    branchId: v.sourceBranchId,
    sourceType: 'op_voucher',
    sourceId: v.id,
    status: 'posted',
    lines,
    user: u,
    preventDuplicateSource: true,
  })
  await tx.opVoucher.update({ where: { id: v.id }, data: { journalEntryId: entry.id } })
  return entry
}

/** تحصيل مبالغ الشحنات المرتبطة بسند تحصيل/تسوية (مع منع التكرار) */
async function markLinkedShipmentsCollected(tx: Tx, v: VoucherRow, user: SessionUser) {
  for (const it of v.items ?? []) {
    const s = await tx.shipment.findUnique({ where: { id: it.shipmentId } })
    if (!s) continue
    if (s.collectionStatus === 'collected') {
      throw new ApiError(409, `الشحنة ${s.shipmentNo ?? ''} تم تحصيلها مسبقًا — لا يمكن تسوية نفس الشحنة مرتين`)
    }
    await tx.shipment.update({
      where: { id: s.id },
      data: {
        collectionStatus: 'collected',
        updatedAt: new Date(),
        statusHistory: {
          create: { fromStatus: s.status, toStatus: s.status, userName: user.username, notes: `تحصيل/تسوية عبر ${v.voucherNo}` },
        },
      },
    })
  }
}

// ---------------------------------------------------------------------------
// عمليات الأذونات
// ---------------------------------------------------------------------------
export async function createVoucher(user: SessionUser, body: any) {
  assertPerm(user, 'vouchers.create')
  const type = body.type ?? 'receiving'
  const tdef = voucherTypeDef(type)
  if (!tdef) throw new ApiError(400, 'نوع الإذن غير معروف')
  // السندات المالية (تحصيل/صرف/توريد/تسوية) تتطلب صلاحية رؤية المبالغ — حماية خادمية فعلية
  // (كانت مخفية على الواجهة فقط فيمكن تجاوزها عبر API)
  if (tdef.isFinancial) assertPerm(user, 'prices.view')
  const branchId = body.sourceBranchId || null
  const shipmentIds: string[] = Array.isArray(body.shipmentIds)
    ? body.shipmentIds
    : body.shipmentId ? [body.shipmentId] : []
  if (tdef.requiresShipments && shipmentIds.length === 0) throw new ApiError(400, 'هذا الإذن يتطلب شحنة واحدة على الأقل')
  if (tdef.requiresParty && !body.partyId) throw new ApiError(400, 'هذا الإذن يتطلب تحديد الطرف (العميل/المورد)')
  if (tdef.requiresCourier && !body.courierId) throw new ApiError(400, 'هذا الإذن يتطلب تحديد المندوب')
  if (tdef.requiresEmployee && !body.employeeId) throw new ApiError(400, 'هذا الإذن يتطلب تحديد الموظف المسؤول')
  if (tdef.isFinancial && !(Number(body.amount) > 0)) throw new ApiError(400, 'المبلغ مطلوب للأذونات المالية')

  return db.$transaction(async (tx) => {
    const items: { shipmentId: string; notes: string | null; addedBy: string }[] = []
    let shipmentSum = 0
    for (const sid of shipmentIds) {
      const s = await tx.shipment.findUnique({ where: { id: sid } })
      if (!s) throw new ApiError(400, `الشحنة غير موجودة`)
      if (tdef.preStatuses && !tdef.preStatuses.includes(s.status)) {
        throw new ApiError(409, `الشحنة ${s.shipmentNo} حالتها "${s.status}" لا تصلح لهذا الإذن — المطلوب: ${tdef.preStatuses.join(' أو ')}`)
      }
      await assertVoucherRefs(tx, { partyId: body.partyId, courierId: body.courierId, employeeId: body.employeeId, destBranchId: body.destBranchId, cashAccountId: body.cashAccountId })
      // منع التعارض: نفس الشحنة في إذن نشط آخر من نفس النوع = تكرار العملية
      const clash = await tx.opVoucherItem.findFirst({
        where: { shipmentId: sid, voucher: { type, status: { in: ACTIVE_VOUCHER_STATUSES } } },
        include: { voucher: { select: { voucherNo: true, status: true } } },
      })
      if (clash) {
        throw new ApiError(409, `الشحنة ${s.shipmentNo} مرتبطة بالفعل بإذن ${clash.voucher.voucherNo} (${stateLabel(clash.voucher.status)}) من نفس النوع — لا يمكن تكرار العملية`)
      }
      items.push({ shipmentId: sid, notes: null, addedBy: user.username })
      shipmentSum += Number(s.freightTotal ?? 0)
    }
    const amount = tdef.isFinancial ? round2(Number(body.amount) || 0) : null
    const voucherNo = await nextVoucherNo(tx, type)
    const v = await tx.opVoucher.create({
      data: {
        voucherNo,
        type,
        status: 'draft',
        sourceBranchId: branchId,
        destBranchId: tdef.requiresDestBranch ? (body.destBranchId || branchId) : null,
        employeeId: body.employeeId ?? null,
        courierId: body.courierId ?? null,
        partyId: body.partyId ?? null,
        amount,
        totalValue: tdef.isFinancial ? (amount ?? 0) : round2(shipmentSum),
        notes: body.notes ?? null,
        accountName: tdef.isFinancial ? (body.accountName ?? 'الصندوق') : null,
        cashAccountId: body.cashAccountId ?? null,
        vehicleNo: body.vehicleNo ?? null,
        driverName: body.driverName ?? null,
        userId: user.userId,
        userName: user.username,
        items: { create: items },
        actions: { create: { action: 'create', userId: user.userId, userName: user.username, notes: 'إنشاء الإذن' } },
      },
    })
    await logAudit(tx, {
      action: 'create', entity: 'voucher', entityId: v.id,
      notes: `إنشاء ${tdef.label} ${voucherNo}${items.length ? ` (${items.length} شحنة)` : ''}${amount ? ` بمبلغ ${amount}` : ''}`,
      user: { userId: user.userId, username: user.username },
      after: { voucherNo, type, status: 'draft' },
    })
    return { id: v.id, voucherNo: v.voucherNo }
  })
}

export async function addVoucherItem(user: SessionUser, voucherId: string, body: any) {
  assertPerm(user, 'vouchers.edit')
  return db.$transaction(async (tx) => {
    const v = await loadVoucher(tx, voucherId)
    if (v.status !== 'draft') throw new ApiError(409, 'لا يمكن إضافة شحنات إلا في إذن مسودة')
    const sid = body.shipmentId
    const s = await tx.shipment.findUnique({ where: { id: sid } })
    if (!s) throw new ApiError(400, 'الشحنة غير موجودة')
    if (v.items?.some((it) => it.shipmentId === sid)) throw new ApiError(409, 'الشحنة مضافة لهذا الإذن بالفعل')
    const tdef = voucherTypeDef(v.type)
    if (tdef?.preStatuses && !tdef.preStatuses.includes(s.status)) {
      throw new ApiError(409, `حالة الشحنة ${s.shipmentNo} (${s.status}) لا تصلح — المطلوب: ${tdef.preStatuses.join(' أو ')}`)
    }
    const clash = await tx.opVoucherItem.findFirst({
      where: { shipmentId: sid, voucher: { type: v.type, status: { in: ACTIVE_VOUCHER_STATUSES } } },
      include: { voucher: { select: { voucherNo: true } } },
    })
    if (clash) throw new ApiError(409, `الشحنة ${s.shipmentNo} مرتبطة بإذن نشط آخر من نفس النوع (${clash.voucher.voucherNo})`)
    await tx.opVoucherItem.create({ data: { voucherId: v.id, shipmentId: sid, notes: body.notes ?? null, addedBy: user.username } })
    await recomputeTotalValue(tx, v.id)
    await tx.opVoucherAction.create({ data: { voucherId: v.id, userId: user.userId, userName: user.username, action: 'add_item', notes: `إضافة شحنة ${s.shipmentNo}` } })
    await logAudit(tx, { action: 'update', entity: 'voucher', entityId: v.id, notes: `إضافة شحنة ${s.shipmentNo} للإذن ${v.voucherNo}`, user: { userId: user.userId, username: user.username } })
    return { ok: true, itemCount: (v.items?.length ?? 0) + 1 }
  })
}

export async function removeVoucherItem(user: SessionUser, voucherId: string, itemId: string) {
  assertPerm(user, 'vouchers.edit')
  return db.$transaction(async (tx) => {
    const v = await loadVoucher(tx, voucherId)
    if (v.status !== 'draft') throw new ApiError(409, 'لا يمكن حذف شحنات إلا من إذن مسودة')
    const item = await tx.opVoucherItem.findUnique({ where: { id: itemId }, include: { shipment: { select: { shipmentNo: true } } } })
    if (!item || item.voucherId !== v.id) throw new ApiError(404, 'الشحنة غير موجودة في هذا الإذن')
    await tx.opVoucherItem.delete({ where: { id: itemId } })
    await recomputeTotalValue(tx, v.id)
    // إثبات الحذف في سجل الإذن وسجل التدقيق (كان الحذف بلا أثر)
    await tx.opVoucherAction.create({ data: { voucherId: v.id, userId: user.userId, userName: user.username, action: 'remove_item', notes: `إزالة شحنة ${item.shipment?.shipmentNo ?? ''}` } })
    await logAudit(tx, { action: 'update', entity: 'voucher', entityId: v.id, notes: `إزالة شحنة ${item.shipment?.shipmentNo ?? ''} من الإذن ${v.voucherNo}`, user: { userId: user.userId, username: user.username } })
    return { ok: true, itemCount: (v.items?.length ?? 1) - 1 }
  })
}

async function recomputeTotalValue(tx: Tx, voucherId: string) {
  const rows = await tx.opVoucherItem.findMany({
    where: { voucherId },
    include: { shipment: { select: { freightTotal: true } } },
  })
  const v = await tx.opVoucher.findUnique({ where: { id: voucherId }, select: { type: true, amount: true } })
  const tdef = voucherTypeDef(v?.type ?? '')
  const total = tdef?.isFinancial ? (v?.amount ?? 0) : round2(rows.reduce((s, r) => s + Number(r.shipment?.freightTotal ?? 0), 0))
  await tx.opVoucher.update({ where: { id: voucherId }, data: { totalValue: total } })
}

export async function patchVoucher(user: SessionUser, voucherId: string, body: any) {
  assertPerm(user, 'vouchers.edit')
  return db.$transaction(async (tx) => {
    const v = await loadVoucher(tx, voucherId)
    if (v.status !== 'draft' && v.status !== 'rejected') throw new ApiError(409, 'لا يمكن تعديل إذن بهذه الحالة')
    // تعديل سند مالي (مبلغ/حساب الخزينة) يتطلب صلاحية رؤية المبالغ أيضًا
    if (voucherTypeDef(v.type)?.isFinancial) assertPerm(user, 'prices.view')
    if (body.type && body.type !== v.type) throw new ApiError(400, 'لا يمكن تغيير نوع الإذن بعد الإنشاء')
    await assertVoucherRefs(tx, { partyId: body.partyId, courierId: body.courierId, employeeId: body.employeeId, destBranchId: body.destBranchId, cashAccountId: body.cashAccountId })
    const tdef = voucherTypeDef(v.type)
    const data: any = { updatedAt: new Date() }
    if (tdef?.isFinancial && body.amount != null) data.amount = round2(Number(body.amount) || 0)
    if (body.notes != null) data.notes = body.notes
    if (body.partyId !== undefined) data.partyId = body.partyId || null
    if (body.courierId !== undefined) data.courierId = body.courierId || null
    if (body.employeeId !== undefined) data.employeeId = body.employeeId || null
    if (body.sourceBranchId !== undefined) data.sourceBranchId = body.sourceBranchId || null
    if (body.destBranchId !== undefined) data.destBranchId = body.destBranchId || null
    if (body.accountName != null) data.accountName = body.accountName
    if (body.vehicleNo !== undefined) data.vehicleNo = body.vehicleNo || null
    if (body.driverName !== undefined) data.driverName = body.driverName || null
    if (body.cashAccountId !== undefined) data.cashAccountId = body.cashAccountId || null
    await tx.opVoucher.update({ where: { id: v.id }, data })
    await tx.opVoucherAction.create({ data: { voucherId: v.id, userId: user.userId, userName: user.username, action: 'edit', notes: 'تعديل بيانات الإذن' } })
    await logAudit(tx, { action: 'update', entity: 'voucher', entityId: v.id, notes: `تعديل الإذن ${v.voucherNo}`, user: { userId: user.userId, username: user.username }, after: data })
    return { ok: true }
  })
}

export async function deleteVoucher(user: SessionUser, voucherId: string) {
  assertPerm(user, 'vouchers.delete')
  return db.$transaction(async (tx) => {
    const v = await loadVoucher(tx, voucherId)
    if (v.status !== 'draft' && v.status !== 'cancelled') {
      throw new ApiError(409, 'لا يمكن حذف إذن معتمد أو منفذ — استخدم الإلغاء وفق سياسة التصحيح')
    }
    if (v.journalEntryId) throw new ApiError(409, 'الإذن مرتبط بقيد محاسبي — لا يمكن حذفه')
    await tx.opVoucher.delete({ where: { id: v.id } })
    await logAudit(tx, { action: 'delete', entity: 'voucher', entityId: v.id, notes: `حذف الإذن ${v.voucherNo}`, user: { userId: user.userId, username: user.username }, before: { voucherNo: v.voucherNo, status: v.status } })
    return null
  })
}

/** الانتقال بين الحالات — القواعد كلها هنا على الخادم (وليس الواجهة) */
export async function transitionVoucher(user: SessionUser, voucherId: string, body: any) {
  const action = String(body.action ?? '')
  return db.$transaction(async (tx) => {
    const v = await loadVoucher(tx, voucherId)
    const allowed = TRANSITIONS[v.status] ?? []
    const tr = allowed.find((t) => t.action === action)
    if (!tr) {
      throw new ApiError(409, `الإجراء "${voucherActionLabel(action)}" غير مسموح للحالة "${stateLabel(v.status)}"`)
    }
    // فرض الصلاحية من الخادم حسب الانتقال
    assertPerm(user, tr.perm)

    const tdef = voucherTypeDef(v.type)
    const u = { userId: user.userId, username: user.username }

    // سياسة فصل المهام: منشئ الإذن لا يعتمده (ما لم تسمح الإعدادات صراحة)
    if (action === 'approve') {
      const policySetting = await tx.setting.findUnique({ where: { key: 'policy.self_approval' } })
      const policy = policySetting?.value ?? 'deny'
      if (policy !== 'allow' && v.userName === user.username) {
        throw new ApiError(403, 'لا يمكن اعتماد إذن أنشأته بنفسك (سياسة فصل المهام)')
      }
    }

    // قبل التنفيذ: بيانات مكتملة + شحنات ما زالت صالحة
    if (action === 'execute') {
      assertCompleteData(v)
      await assertShipmentsForType(tx, v, 'execute')
    }

    // إلغاء سند مالي مكتمل = قيد عكسي (مسار التصحيح الرسمي) — للأذونات المالية فقط
    if (v.status === 'completed' && action === 'cancel') {
      if (!tdef?.isFinancial) {
        throw new ApiError(409, 'لا يمكن إلغاء إذن تشغيلي مكتمل — الحالات التشغيلية نهائية، استخدم إذنًا عكسيًا')
      }
      // قيد عكسي للقيد المرتبط (إن وُجد) + فك الربط + رد التحصيل عن الشحنات المرتبطة
      if (v.journalEntryId) {
        await reverseJournal(tx, v.journalEntryId, { userId: user.userId, username: user.username }, `إلغاء السند ${v.voucherNo}`)
        await tx.opVoucher.update({ where: { id: v.id }, data: { journalEntryId: null } })
      }
      if ((v.type === 'collection' || v.type === 'courier_settlement') && v.items?.length) {
        for (const it of v.items) {
          const s = await tx.shipment.findUnique({ where: { id: it.shipmentId } })
          if (!s || s.collectionStatus !== 'collected') continue
          await tx.shipment.update({
            where: { id: s.id },
            data: {
              collectionStatus: 'uncollected',
              updatedAt: new Date(),
              statusHistory: { create: { fromStatus: s.status, toStatus: s.status, userName: user.username, notes: `رد تحصيل — إلغاء السند ${v.voucherNo}` } },
            },
          })
        }
      }
    }

    // عند الإكمال: إعادة التحقق ثم تطبيق الأثر التشغيلي/المالي
    if (action === 'complete') {
      assertCompleteData(v)
      await assertShipmentsForType(tx, v, 'complete')

      if (tdef?.postStatus && v.items?.length) {
        for (const it of v.items) {
          const s = await tx.shipment.findUnique({ where: { id: it.shipmentId }, include: { customer: { select: { id: true, name: true } }, contractor: { select: { id: true, name: true } } } })
          if (!s) continue
          await tx.shipment.update({
            where: { id: s.id },
            data: {
              status: tdef.postStatus,
              updatedAt: new Date(),
              // إذن التحويل ينقل عهدة الشحنة للفرع المستلم
              ...(v.type === 'branch_transfer' && v.destBranchId ? { branchId: v.destBranchId } : {}),
              // ملاحظة: إذن التسليم لا يثبت التحصيل — التحصيل يثبت بسند قبض/تسوية COD فقط
              statusHistory: {
                create: { fromStatus: s.status, toStatus: tdef.postStatus, userName: user.username, notes: `${tdef.label} ${v.voucherNo} — اكتمل` },
              },
            },
          })
          // التكامل المالي التلقائي: عند التسليم يُثبت النولون على العميل ومستحقات المقاول
          // (قيد مزدوج مرتبط بالشحنة — مرة واحدة فقط لكل شحنة)
          if (tdef.postStatus === 'delivered') {
            await postShipmentDeliveryJournal(tx, s, { userId: user.userId, username: user.username })
          }
        }
      }
      // تحصيل/تسوية عهدة مع شحنات مرتبطة → تسجيل التحصيل ومنع التكرار
      if ((v.type === 'collection' || v.type === 'courier_settlement') && v.items?.length) {
        await markLinkedShipmentsCollected(tx, v, user)
      }
      // الأثر المالي للسندات — قيد مزدوج مرتبط (مرة واحدة فقط)
      if (tdef?.isFinancial) {
        await postFinancialVoucherJournal(tx, v.id, user)
      }
    }

    await tx.opVoucher.update({ where: { id: v.id }, data: { status: tr.to, updatedAt: new Date() } })
    await tx.opVoucherAction.create({
      data: { voucherId: v.id, userId: user.userId, userName: user.username, action, notes: body.notes ?? null },
    })
    await logAudit(tx, {
      action, entity: 'voucher', entityId: v.id,
      notes: `${voucherActionLabel(action)} ${v.voucherNo} → ${stateLabel(tr.to)}`,
      user: u,
      before: { status: v.status },
      after: { status: tr.to },
    })
    return { ok: true, status: tr.to }
  })
}

// ---------------------------------------------------------------------------
// تسوية COD لشحنة (سند قبض + سند صرف + قيدان — مرة واحدة فقط)
// ---------------------------------------------------------------------------
export async function settleShipmentCOD(user: SessionUser, shipmentId: string, body: any) {
  assertPerm(user, 'shipments.settle')
  return db.$transaction(async (tx) => {
    const s = await tx.shipment.findUnique({ where: { id: shipmentId } })
    if (!s) throw new ApiError(404, 'الشحنة غير موجودة')
    // التسوية المالية تتم فقط بعد التسليم الفعلي للعميل (الشحنة مع المندوب = عهدة بضاعة وليست نقدية)
    if (s.status !== 'delivered') {
      throw new ApiError(409, `لا يمكن تسوية COD إلا للشحنات المسلّمة — الحالة الحالية "${s.status}" (سلّم الشحنة أولًا)`)
    }
    if (s.collectionStatus === 'collected') {
      throw new ApiError(409, `الشحنة ${s.shipmentNo} تمت تسويتها مسبقًا — لا يمكن تسوية نفس الشحنة مرتين`)
    }
    const dup = await tx.opVoucherItem.findFirst({
      where: { shipmentId, voucher: { type: 'collection', status: 'completed' } },
      include: { voucher: { select: { voucherNo: true } } },
    })
    if (dup) throw new ApiError(409, `الشحنة ${s.shipmentNo} مرتبطة بسند تحصيل مكتمل (${dup.voucher.voucherNo}) — لا يمكن التسوية مرتين`)
    if (!s.customerId && !s.contractorId) throw new ApiError(400, 'الشحنة لا تحتوي على عميل أو مقاول')
    const u = { userId: user.userId, username: user.username }
    const created: any = {}

    // 1) سند قبض من العميل
    const customerAmount = round2(Number(body.customerAmount ?? s.freightTotal ?? 0))
    if (customerAmount <= 0) throw new ApiError(400, 'مبلغ التحصيل من العميل يجب أن يكون أكبر من صفر — لا يمكن تسوية بمبلغ صفر وإثبات التحصيل')
    if (s.customerId) {
      const voucherNo = await nextVoucherNo(tx, 'collection')
      const v1 = await tx.opVoucher.create({
        data: {
          voucherNo, type: 'collection', status: 'completed',
          sourceBranchId: s.branchId ?? null, partyId: s.customerId,
          amount: customerAmount, totalValue: customerAmount,
          notes: `تسوية COD — تحصيل من العميل ضد الشحنة ${s.shipmentNo}`,
          accountName: 'الصندوق',
          userId: user.userId, userName: user.username,
          items: { create: { shipmentId: s.id, notes: 'تسوية COD', addedBy: user.username } },
          actions: {
            create: [
              { action: 'create', userId: user.userId, userName: user.username, notes: 'إنشاء (تسوية COD)' },
              { action: 'submit', userId: user.userId, userName: user.username },
              { action: 'approve', userId: user.userId, userName: user.username, notes: 'اعتماد تلقائي للتسوية' },
              { action: 'execute', userId: user.userId, userName: user.username },
              { action: 'complete', userId: user.userId, userName: user.username, notes: 'إكمال تلقائي للتسوية' },
            ],
          },
        },
      })
      await postFinancialVoucherJournal(tx, v1.id, user)
      created.receiptVoucherNo = v1.voucherNo
    }

    // 2) سند صرف للمقاول
    const contractorAmount = round2(Number(body.contractorAmount ?? s.totalSuppliers ?? s.freightCost ?? 0))
    if (contractorAmount < 0) throw new ApiError(400, 'مبلغ الصرف للمقاول لا يمكن أن يكون سالبًا')
    if (s.contractorId && contractorAmount > 0) {
      const voucherNo = await nextVoucherNo(tx, 'cash_disbursement')
      const v2 = await tx.opVoucher.create({
        data: {
          voucherNo, type: 'cash_disbursement', status: 'completed',
          sourceBranchId: s.branchId ?? null, partyId: s.contractorId,
          amount: contractorAmount, totalValue: contractorAmount,
          notes: `تسوية COD — صرف للمقاول مقابل نقل الشحنة ${s.shipmentNo}`,
          accountName: 'الصندوق',
          userId: user.userId, userName: user.username,
          items: { create: { shipmentId: s.id, notes: 'تسوية COD', addedBy: user.username } },
          actions: {
            create: [
              { action: 'create', userId: user.userId, userName: user.username, notes: 'إنشاء (تسوية COD)' },
              { action: 'submit', userId: user.userId, userName: user.username },
              { action: 'approve', userId: user.userId, userName: user.username, notes: 'اعتماد تلقائي للتسوية' },
              { action: 'execute', userId: user.userId, userName: user.username },
              { action: 'complete', userId: user.userId, userName: user.username, notes: 'إكمال تلقائي للتسوية' },
            ],
          },
        },
      })
      await postFinancialVoucherJournal(tx, v2.id, user)
      created.paymentVoucherNo = v2.voucherNo
    }

    // 3) تسجيل التسوية على الشحنة
    await tx.shipment.update({
      where: { id: s.id },
      data: {
        collectionStatus: 'collected',
        updatedAt: new Date(),
        statusHistory: {
          create: {
            fromStatus: s.status, toStatus: s.status, userName: user.username,
            notes: `تسوية COD — قبض ${created.receiptVoucherNo ?? '—'} / صرف ${created.paymentVoucherNo ?? '—'}`,
          },
        },
      },
    })
    await logAudit(tx, { action: 'settle', entity: 'shipment', entityId: s.id, notes: `تسوية COD للشحنة ${s.shipmentNo}`, user: u, after: created })
    return { ok: true, ...created }
  })
}

export { VOUCHER_TYPES, VOUCHER_STATES, VOUCHER_CATEGORIES }

// ---------------------------------------------------------------------------
// تسليم مرتجع — يأخذ إذن المرتجع المكتمل ويُنشئ تلقائيًا إذن استلام مرتجعات
// مكتمل لكل شحنة لا تزال بحالة "returned" (مع المندوب)، ثم يحدّث حالتها إلى
// "received_returned" (تم التسليم). يُسجّل فعل "mark_received" على إذن المرتجع
// الأصلي + قيد تدقيق. يدعم التسليم الجزئي (الشحنات التي لم تُستلم فقط).
// ---------------------------------------------------------------------------
export async function markReturnReceived(user: SessionUser, returnVoucherId: string, body: any) {
  assertPerm(user, 'vouchers.execute')
  return db.$transaction(async (tx) => {
    const rv = await loadVoucher(tx, returnVoucherId)
    if (rv.type !== 'return') throw new ApiError(400, 'هذا الإجراء مخصص لإذن المرتجع فقط')
    if (rv.status !== 'completed') throw new ApiError(409, 'لا يمكن التسليم إلا بعد إكمال إذن المرتجع')
    if (!rv.items?.length) throw new ApiError(400, 'لا توجد شحنات مرتجعة في هذا الإذن')

    const results: { shipmentId: string; shipmentNo: string | null; receivingVoucherNo: string | null; ok: boolean; reason?: string; reversalEntryNo?: string | null }[] = []

    for (const it of rv.items) {
      const s = await tx.shipment.findUnique({ where: { id: it.shipmentId }, include: { customer: { select: { id: true, name: true } }, contractor: { select: { id: true, name: true } } } })
      if (!s) {
        results.push({ shipmentId: it.shipmentId, shipmentNo: null, receivingVoucherNo: null, ok: false, reason: 'الشحنة غير موجودة' })
        continue
      }
      if (s.status !== 'returned') {
        results.push({ shipmentId: s.id, shipmentNo: s.shipmentNo, receivingVoucherNo: null, ok: false, reason: `حالة الشحنة "${s.status}" — لا يمكن التسليم` })
        continue
      }
      // منع التكرار: لا يمكن تسليم مرتجع سبق استلامه
      const existing = await tx.opVoucherItem.findFirst({
        where: { shipmentId: s.id, voucher: { type: 'returned_receiving', status: 'completed' } },
        include: { voucher: { select: { voucherNo: true } } },
      })
      if (existing) {
        results.push({ shipmentId: s.id, shipmentNo: s.shipmentNo, receivingVoucherNo: existing.voucher.voucherNo, ok: false, reason: 'تم استلام هذا المرتجع مسبقًا' })
        continue
      }
      // إنشاء إذن استلام مرتجعات مكتمل تلقائيًا
      const voucherNo = await nextVoucherNo(tx, 'returned_receiving')
      const v = await tx.opVoucher.create({
        data: {
          voucherNo, type: 'returned_receiving', status: 'completed',
          sourceBranchId: rv.sourceBranchId ?? s.branchId ?? null,
          employeeId: rv.employeeId ?? null,
          courierId: rv.courierId ?? null,
          totalValue: round2(Number(s.freightTotal ?? 0)),
          notes: `تسليم مرتجع تلقائي من ${rv.voucherNo} — ${body.notes ?? 'تم التسليم'}`,
          userId: user.userId, userName: user.username,
          items: { create: { shipmentId: s.id, notes: `تسليم من إذن ${rv.voucherNo}`, addedBy: user.username } },
          actions: { create: [
            { action: 'create', userId: user.userId, userName: user.username, notes: 'إنشاء تلقائي (تسليم مرتجع)' },
            { action: 'submit', userId: user.userId, userName: user.username },
            { action: 'approve', userId: user.userId, userName: user.username, notes: 'اعتماد تلقائي للتسليم' },
            { action: 'execute', userId: user.userId, userName: user.username },
            { action: 'complete', userId: user.userId, userName: user.username, notes: 'إكمال تلقائي للتسليم' },
          ] },
        },
      })
      // تحديث حالة الشحنة إلى "received_returned" + التكامل المالي:
      // عكس النولون المستحق على العميل صافيًا بعد رسوم المرتجع (حسب سياسة التسعير)
      // — وإلا كان رصيد العميل يبقى مدينًا على بضاعة لم تُسلّم
      await tx.shipment.update({
        where: { id: s.id },
        data: {
          status: 'received_returned',
          updatedAt: new Date(),
          statusHistory: {
            create: { fromStatus: 'returned', toStatus: 'received_returned', userName: user.username, notes: `تم التسليم — ${v.voucherNo}` },
          },
        },
      })
      const reversal = await postShipmentReturnReversal(tx, s, { userId: user.userId, username: user.username })
      results.push({ shipmentId: s.id, shipmentNo: s.shipmentNo, receivingVoucherNo: v.voucherNo, ok: true, reversalEntryNo: reversal?.entryNo ?? null })
    }

    // تسجيل فعل "mark_received" على إذن المرتجع الأصلي + تدقيق
    const succeeded = results.filter((r) => r.ok).length
    const failed = results.length - succeeded
    await tx.opVoucherAction.create({
      data: {
        voucherId: rv.id, userId: user.userId, userName: user.username, action: 'mark_received',
        notes: body.notes ?? `تم التسليم (${succeeded}/${results.length} شحنة${failed ? ` — ${failed} فشل` : ''})`,
      },
    })
    await logAudit(tx, {
      action: 'mark_received', entity: 'voucher', entityId: rv.id,
      notes: `تسليم مرتجع ${rv.voucherNo} (${succeeded}/${results.length} شحنة)`,
      user: { userId: user.userId, username: user.username },
      after: { results },
    })
    return { ok: true, results, total: results.length, succeeded, failed }
  })
}
