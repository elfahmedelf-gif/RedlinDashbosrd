// ============================================================================
// محرك الفواتير الرسمية للعملاء — دورة حياة كاملة مع القيد المزدوج
// ----------------------------------------------------------------------------
// قاعدة العمل الحاسمة (مصدر واحد للحقيقة — الإيراد لا يُحتسب مرتين أبدًا):
//   • المسودة (draft): لا قيد محاسبي إطلاقًا.
//   • الإصدار (issued): داخل معاملة واحدة:
//       1) عكس قيود استحقاق التسليم النشطة للشحنات المُدخلة (مصدر: shipment_delivery)
//          — لإزالة الإيراد المستحق سابقًا + مستحقات المقاول المجمّعة معه.
//       2) ترحيل قيد الفاتورة: مدين العملاء 1103 بالإجمالي شامل الضريبة /
//          دائن إيراد الشحن 4101 بصافي القيمة (بعد الخصم) /
//          دائن ضريبة القيمة المضافة 2103 بقيمة الضريبة (إن وُجدت).
//       3) إعادة إثبات مستحقات المقاول لكل شحنة بحساب مستقل (مصدر: shipment_cost):
//          مدين تكلفة النقل 5101 / دائن مقاولو النقل 2102 — بلا أي إيراد.
//       4) ربط الشحنات بالفاتورة (invoiceId) فلا تُفوترة مرة أخرى.
//   • الإلغاء (cancelled): عكس قيد الفاتورة + عكس قيود مستحقات المقاول المستقلة
//       + إعادة إثبات قيود استحقاق التسليم الأصلية + فك ربط الشحنات.
//   • الدفعات: سند قبض مكتمل (collection) مرتبط بالفاتورة عبر OpVoucher.invoiceId
//       مع قيده المزدوج (مدين الصندوق/البنك / دائن العملاء) — وتتحدث حالة الفاتورة
//       تلقائيًا (partially_paid / paid)، والعكس يعيد الحالة للخلف.
//   • لا يمكن إلغاء فاتورة عليها دفعات — تُعكس الدفعات أولًا.
// ============================================================================

import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ApiError, num, round2 } from './http'
import { logAudit } from './audit'
import { ACC, accountByCode, createJournal, reverseJournal } from './accounting'
import { getActiveDeliveryJournal, postShipmentDeliveryJournal, postShipmentCostOnlyJournal } from './shipment-accounting'
import { nextVoucherNo, postFinancialVoucherJournal } from './vouchers'
import type { SessionUser } from '../permissions'

type Tx = Prisma.TransactionClient

export const INVOICE_SOURCE = 'invoice'
const EPS = 0.005

export const INVOICE_STATUSES = ['draft', 'issued', 'partially_paid', 'paid', 'cancelled'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'مسودة',
  issued: 'صادرة',
  partially_paid: 'مسددة جزئيًا',
  paid: 'مسددة بالكامل',
  cancelled: 'ملغاة',
}

const REVENUE_ACCOUNT = '4101' // إيراد الشحن
const VAT_ACCOUNT = '2103'     // ضريبة القيمة المضافة

interface ItemInput {
  shipmentId?: string | null
  description?: string
  quantity?: number
  unitPrice?: number
}

interface TotalsResult {
  subtotal: number
  discount: number
  net: number
  vatAmount: number
  totalAmount: number
}

/** حساب إجماليات الفاتورة من بنودها — الخصم لا يتجاوز الإجمالي والضريبة على الصافي */
export function computeInvoiceTotals(
  items: { quantity: number; unitPrice: number }[],
  vatRate: number,
  discountAmount: number,
): TotalsResult {
  const subtotal = round2(items.reduce((s, it) => s + round2(Math.max(0, Number(it.quantity) || 0) * Math.max(0, Number(it.unitPrice) || 0)), 0))
  const discount = round2(Math.min(Math.max(round2(Number(discountAmount) || 0), 0), subtotal))
  const net = round2(subtotal - discount)
  const vatAmount = round2((net * Math.max(0, Number(vatRate) || 0)) / 100)
  const totalAmount = round2(net + vatAmount)
  return { subtotal, discount, net, vatAmount, totalAmount }
}

/** تطبيع بنود الفاتورة القادمة من العميل — وصف مطلوب وسعر ≥ 0 */
function normalizeItems(rawItems: any): { shipmentId: string | null; description: string; quantity: number; unitPrice: number; total: number }[] {
  if (!Array.isArray(rawItems)) throw new ApiError(400, 'بنود الفاتورة مطلوبة (قائمة بنود)')
  const items = rawItems
    .map((it: any, i: number) => {
      const description = String(it?.description ?? '').trim()
      const quantity = round2(Math.max(0, Number(it?.quantity) || 0))
      const unitPrice = round2(Math.max(0, Number(it?.unitPrice) || 0))
      const shipmentId = it?.shipmentId ? String(it.shipmentId) : null
      if (!description) throw new ApiError(400, `البند رقم ${i + 1}: وصف البند مطلوب`)
      if (quantity <= 0) throw new ApiError(400, `البند "${description}": الكمية يجب أن تكون أكبر من صفر`)
      if (unitPrice <= 0) throw new ApiError(400, `البند "${description}": سعر الوحدة يجب أن يكون أكبر من صفر`)
      return { shipmentId, description: description.slice(0, 300), quantity, unitPrice, total: round2(quantity * unitPrice) }
    })
  if (!items.length) throw new ApiError(400, 'الفاتورة تحتاج بندًا واحدًا على الأقل')
  return items
}

/** الحالة الفعالة لفواتير الشحنة — أي فاتورة غير ملغاة تحتويها تحجب إعادة الفوترة */
async function activeInvoiceItemForShipment(tx: Tx, shipmentId: string, exceptInvoiceId?: string) {
  return tx.invoiceItem.findFirst({
    where: {
      shipmentId,
      invoice: {
        status: { not: 'cancelled' },
        ...(exceptInvoiceId ? { id: { not: exceptInvoiceId } } : {}),
      },
    },
    include: { invoice: { select: { id: true, invoiceNumber: true, status: true } } },
  })
}

/** تحقق موحد من صلاحية شحنة للفوترة — يعيد بيانات الشحنة الكاملة عند النجاح */
async function assertShipmentInvoiceable(
  tx: Tx,
  shipmentId: string,
  customerId: string,
  exceptInvoiceId: string | undefined,
) {
  const s = await tx.shipment.findUnique({
    where: { id: shipmentId },
    include: { customer: { select: { id: true, name: true } }, contractor: { select: { id: true, name: true } } },
  })
  if (!s) throw new ApiError(400, 'أحد بنود الفاتورة يشير إلى شحنة غير موجودة')
  if (s.customerId !== customerId) {
    throw new ApiError(400, `الشحنة ${s.shipmentNo ?? s.deliveryNumber ?? ''} تابعة لعميل آخر (${s.customer?.name ?? 'بدون عميل'}) — لا يمكن فوترتها على عميل مختلف`)
  }
  if (s.collectionStatus === 'collected') {
    throw new ApiError(400, `الشحنة ${s.shipmentNo ?? ''} محصّلة بالفعل — الشحنات المحصّلة لا تُفوتر`)
  }
  if (['cancelled', 'written_off'].includes(s.status)) {
    throw new ApiError(400, `الشحنة ${s.shipmentNo ?? ''} ${s.status === 'cancelled' ? 'ملغاة' : 'مشطوبة'} — لا تصلح للفوترة`)
  }
  const dup = await activeInvoiceItemForShipment(tx, shipmentId, exceptInvoiceId)
  if (dup && dup.invoice) {
    throw new ApiError(409, `الشحنة ${s.shipmentNo ?? ''} مفوترة مسبقًا بفاتورة ${dup.invoice.invoiceNumber} (${INVOICE_STATUS_LABELS[dup.invoice.status as InvoiceStatus] ?? dup.invoice.status}) — لا يمكن الفوترة مرتين`)
  } else if (dup) {
    throw new ApiError(409, `الشحنة ${s.shipmentNo ?? ''} مفوترة مسبقًا بفاتورة نشطة — لا يمكن الفوترة مرتين`)
  }
  return s
}

// ---------------------------------------------------------------------------
// القائمة + الملخصات
// ---------------------------------------------------------------------------
export async function listInvoices(q: URLSearchParams, user: SessionUser) {
  void user
  const status = q.get('status') ?? ''
  const customerId = q.get('customerId') ?? ''
  const search = (q.get('q') ?? '').trim().toLowerCase()
  const page = Math.max(1, Number(q.get('page') ?? 1) || 1)
  const pageSize = Math.min(200, Math.max(5, Number(q.get('pageSize') ?? 20) || 20))

  const where: Prisma.InvoiceWhereInput = {}
  if (status && INVOICE_STATUSES.includes(status as InvoiceStatus)) where.status = status
  if (customerId && customerId !== 'all') where.customerId = customerId

  const [rows, total] = await Promise.all([
    db.invoice.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, code: true, taxNumber: true } },
        journalEntry: { select: { id: true, entryNo: true, status: true } },
        items: { select: { id: true } },
        payments: { where: { status: 'completed' }, select: { id: true, voucherNo: true, amount: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.invoice.count({ where }),
  ])

  let items = rows
  if (search) {
    items = items.filter((v) =>
      [v.invoiceNumber, v.customer?.name, v.customer?.code, v.notes]
        .some((f) => String(f ?? '').toLowerCase().includes(search)))
  }

  const today = new Date().toISOString().slice(0, 10)
  const openStatuses = ['issued', 'partially_paid']
  const allForSummary = await db.invoice.findMany({
    where: customerId && customerId !== 'all' ? { customerId } : {},
    select: { status: true, totalAmount: true, paidAmount: true, dueDate: true },
  })
  const sumWhere = (pred: (v: any) => boolean, field: 'totalAmount' | 'paidAmount') =>
    round2(allForSummary.filter(pred).reduce((s, v) => s + (v[field] ?? 0), 0))
  const isOverdue = (v: any) =>
    openStatuses.includes(v.status) && v.dueDate && new Date(v.dueDate).toISOString().slice(0, 10) < today

  const summary = {
    count: allForSummary.length,
    drafts: allForSummary.filter((v) => v.status === 'draft').length,
    open: allForSummary.filter((v) => openStatuses.includes(v.status)).length,
    overdue: allForSummary.filter(isOverdue).length,
    totalIssued: sumWhere((v) => openStatuses.includes(v.status), 'totalAmount'),
    totalPaid: sumWhere((v) => openStatuses.includes(v.status), 'paidAmount'),
    totalOutstanding: sumWhere((v) => openStatuses.includes(v.status), 'totalAmount') - sumWhere((v) => openStatuses.includes(v.status), 'paidAmount'),
    totalVat: 0,
  }

  return {
    items: items.map((v) => ({
      id: v.id,
      invoiceNumber: v.invoiceNumber,
      customerId: v.customerId,
      customer: v.customer,
      issueDate: v.issueDate,
      dueDate: v.dueDate,
      status: v.status,
      statusLabel: INVOICE_STATUS_LABELS[v.status as InvoiceStatus] ?? v.status,
      subtotal: round2(v.subtotal),
      vatRate: v.vatRate,
      vatAmount: round2(v.vatAmount),
      discountAmount: round2(v.discountAmount),
      totalAmount: round2(v.totalAmount),
      paidAmount: round2(v.paidAmount),
      remaining: round2(Math.max(0, v.totalAmount - v.paidAmount)),
      itemsCount: v.items.length,
      paymentsCount: v.payments.length,
      journalEntryNo: v.journalEntry?.entryNo ?? null,
      journalEntryStatus: v.journalEntry?.status ?? null,
      overdue: isOverdue({ status: v.status, dueDate: v.dueDate }),
      notes: v.notes,
      createdByName: v.createdByName,
      issuedByName: v.issuedByName,
      createdAt: v.createdAt,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    summary,
  }
}

/** تفاصيل فاتورة — بنود + دفعات + القيد المحاسبي */
export async function getInvoice(id: string) {
  const v = await db.invoice.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, code: true, taxNumber: true, phone: true, phones: true, address: true, city: true } },
      items: {
        include: {
          shipment: { select: { id: true, shipmentNo: true, deliveryNumber: true, destination: true, freightTotal: true, status: true } },
        },
        orderBy: { id: 'asc' },
      },
      payments: {
        where: { invoiceId: id },
        orderBy: { createdAt: 'desc' },
        include: { journalEntry: { select: { entryNo: true, status: true } } },
      },
      journalEntry: { include: { lines: { include: { account: { select: { code: true, name: true } } } } } },
    },
  })
  if (!v) throw new ApiError(404, 'الفاتورة غير موجودة')
  return {
    ...v,
    statusLabel: INVOICE_STATUS_LABELS[v.status as InvoiceStatus] ?? v.status,
    remaining: round2(Math.max(0, v.totalAmount - v.paidAmount)),
  }
}

/** الشحنات غير المفوترة لعميل — جاهزة للاستيراد داخل فاتورة جديدة */
export async function listUninvoicedShipments(q: URLSearchParams) {
  const customerId = q.get('customerId') ?? ''
  if (!customerId) throw new ApiError(400, 'اختيار العميل مطلوب لجلب شحناته غير المفوترة')

  // الشحنات المحجوزة داخل مسودات/فواتير أخرى (غير ملغاة) تُستبعد أيضًا
  const reservedIds = (
    await db.invoiceItem.findMany({
      where: { shipmentId: { not: null }, invoice: { status: { not: 'cancelled' } } },
      select: { shipmentId: true },
    })
  ).map((r) => r.shipmentId as string)

  const rows = await db.shipment.findMany({
    where: {
      customerId,
      invoiceId: null,
      collectionStatus: { not: 'collected' },
      status: { notIn: ['cancelled', 'written_off'] },
      ...(reservedIds.length ? { id: { notIn: reservedIds } } : {}),
    },
    include: { contractor: { select: { id: true, name: true } } },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: 500,
  })

  return {
    items: rows.map((s) => ({
      id: s.id,
      shipmentNo: s.shipmentNo,
      deliveryNumber: s.deliveryNumber,
      destination: s.destination,
      recipientName: s.recipientName,
      status: s.status,
      date: s.date,
      freightTotal: round2(Number(s.freightTotal ?? 0)),
      contractor: s.contractor ? { id: s.contractor.id, name: s.contractor.name } : null,
      delivered: s.status === 'delivered',
    })),
    total: rows.length,
  }
}

// ---------------------------------------------------------------------------
// إنشاء/تعديل/حذف المسودات
// ---------------------------------------------------------------------------
export async function createInvoice(user: SessionUser, body: any) {
  const customerId = String(body.customerId ?? '').trim()
  if (!customerId) throw new ApiError(400, 'اختيار العميل مطلوب — الفاتورة بلا عميل مرفوضة')
  const items = normalizeItems(body.items)
  const vatRate = [0, 14].includes(Number(body.vatRate)) ? Number(body.vatRate) : 14
  const discountAmount = round2(Math.max(0, Number(body.discountAmount) || 0))
  const dueDate = body.dueDate ? new Date(`${String(body.dueDate)}T12:00:00`) : null
  if (dueDate && isNaN(dueDate.getTime())) throw new ApiError(400, 'تاريخ الاستحقاق غير صحيح')
  const notes = body.notes ? String(body.notes).slice(0, 500) : null

  const result = await db.$transaction(async (tx) => {
    const customer = await tx.party.findUnique({ where: { id: customerId }, select: { id: true, name: true, isCustomer: true, active: true } })
    if (!customer) throw new ApiError(400, 'العميل المحدد غير موجود')
    if (!customer.isCustomer) throw new ApiError(400, `«${customer.name}» غير مسجل كعميل — اختر طرفًا من العملاء`)
    if (!customer.active) throw new ApiError(400, `العميل «${customer.name}» موقوف`)

    // تحقق مسبق من الشحنات (بدون استثناء فاتورة — إنشاء جديد)
    for (const it of items) {
      if (it.shipmentId) await assertShipmentInvoiceable(tx, it.shipmentId, customerId, undefined)
    }
    // منع تكرار نفس الشحنة داخل الفاتورة الواحدة
    const shipmentIds = items.map((i) => i.shipmentId).filter(Boolean) as string[]
    if (new Set(shipmentIds).size !== shipmentIds.length) {
      throw new ApiError(400, 'لا يمكن تكرار نفس الشحنة كبنود متعددة داخل الفاتورة')
    }

    const totals = computeInvoiceTotals(items, vatRate, discountAmount)
    const n = await tx.seqCounter.upsert({
      where: { key: 'invoice' },
      update: { value: { increment: 1 } },
      create: { key: 'invoice', value: 1 },
    })
    const invoiceNumber = `INV-${String(n.value).padStart(4, '0')}`

    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber,
        customerId,
        status: 'draft',
        subtotal: totals.subtotal,
        vatRate,
        vatAmount: totals.vatAmount,
        discountAmount: totals.discount,
        totalAmount: totals.totalAmount,
        notes,
        dueDate,
        createdById: user.userId,
        createdByName: user.username,
        items: {
          create: items.map((it) => ({
            shipmentId: it.shipmentId,
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            total: it.total,
          })),
        },
      },
      include: { items: true },
    })

    await logAudit(tx, {
      action: 'create', entity: 'invoice', entityId: invoice.id,
      notes: `إنشاء مسودة فاتورة ${invoiceNumber} — العميل: ${customer.name} — ${items.length} بند — إجمالي ${totals.totalAmount} ج.م`,
      user: { userId: user.userId, username: user.username },
      after: { invoiceNumber, customerId, items: items.length, ...totals },
    })
    return invoice
  })

  return { id: result.id, invoiceNumber: result.invoiceNumber, totalAmount: result.totalAmount, itemsCount: result.items.length }
}

/** تعديل مسودة — استبدال كامل للبنود والبيانات (المسودات فقط) */
export async function updateInvoiceDraft(user: SessionUser, id: string, body: any) {
  const result = await db.$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id }, include: { items: true } })
    if (!inv) throw new ApiError(404, 'الفاتورة غير موجودة')
    if (inv.status !== 'draft') {
      throw new ApiError(409, 'لا يمكن تعديل فاتورة صادرة — ألغِها ثم أنشئ فاتورة جديدة وفق سياسة النظام')
    }
    const items = normalizeItems(body.items)
    const vatRate = [0, 14].includes(Number(body.vatRate)) ? Number(body.vatRate) : inv.vatRate
    const discountAmount = body.discountAmount !== undefined ? round2(Math.max(0, Number(body.discountAmount) || 0)) : inv.discountAmount
    let dueDate = inv.dueDate
    if (body.dueDate !== undefined) {
      dueDate = body.dueDate ? new Date(`${String(body.dueDate)}T12:00:00`) : null
      if (dueDate && isNaN(dueDate.getTime())) throw new ApiError(400, 'تاريخ الاستحقاق غير صحيح')
    }
    const notes = body.notes !== undefined ? (body.notes ? String(body.notes).slice(0, 500) : null) : inv.notes

    for (const it of items) {
      if (it.shipmentId) await assertShipmentInvoiceable(tx, it.shipmentId, inv.customerId, id)
    }
    const shipmentIds = items.map((i) => i.shipmentId).filter(Boolean) as string[]
    if (new Set(shipmentIds).size !== shipmentIds.length) {
      throw new ApiError(400, 'لا يمكن تكرار نفس الشحنة كبنود متعددة داخل الفاتورة')
    }

    const totals = computeInvoiceTotals(items, vatRate, discountAmount)
    const updated = await tx.invoice.update({
      where: { id },
      data: {
        subtotal: totals.subtotal,
        vatRate,
        vatAmount: totals.vatAmount,
        discountAmount: totals.discount,
        totalAmount: totals.totalAmount,
        dueDate,
        notes,
        items: {
          deleteMany: {},
          create: items.map((it) => ({
            shipmentId: it.shipmentId,
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            total: it.total,
          })),
        },
      },
    })
    await logAudit(tx, {
      action: 'update', entity: 'invoice', entityId: id,
      notes: `تعديل مسودة الفاتورة ${inv.invoiceNumber} — ${items.length} بند — إجمالي ${totals.totalAmount} ج.م`,
      user: { userId: user.userId, username: user.username },
      before: { totalAmount: inv.totalAmount, items: inv.items.length, vatRate: inv.vatRate, discountAmount: inv.discountAmount },
      after: { totalAmount: totals.totalAmount, items: items.length, vatRate, discountAmount: totals.discount },
    })
    return updated
  })
  return { id: result.id, invoiceNumber: result.invoiceNumber, totalAmount: result.totalAmount }
}

/** حذف مسودة — بلا أي أثر محاسبي */
export async function deleteInvoiceDraft(user: SessionUser, id: string) {
  await db.$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id } })
    if (!inv) throw new ApiError(404, 'الفاتورة غير موجودة')
    if (inv.status !== 'draft') throw new ApiError(409, 'لا يمكن حذف فاتورة صادرة — استخدم الإلغاء (قيد عكسي)')
    await tx.invoice.delete({ where: { id } })
    await logAudit(tx, {
      action: 'delete', entity: 'invoice', entityId: id,
      notes: `حذف مسودة الفاتورة ${inv.invoiceNumber}`,
      user: { userId: user.userId, username: user.username },
      before: { invoiceNumber: inv.invoiceNumber, totalAmount: inv.totalAmount },
    })
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// الإصدار — القيد المزدوج + إعادة تصنيف الإيراد المستحق (بدون تكرار)
// ---------------------------------------------------------------------------
export async function issueInvoice(user: SessionUser, id: string) {
  const result = await db.$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({
      where: { id },
      include: {
        items: true,
        customer: { select: { id: true, name: true } },
        journalEntry: { select: { id: true } },
      },
    })
    if (!inv) throw new ApiError(404, 'الفاتورة غير موجودة')
    if (inv.status !== 'draft') throw new ApiError(409, 'الفاتورة صادرة بالفعل — لا يمكن الإصدار مرتين')
    if (!inv.items.length) throw new ApiError(400, 'لا يمكن إصدار فاتورة بلا بنود')
    if (inv.totalAmount <= 0) throw new ApiError(400, 'لا يمكن إصدار فاتورة بإجمالي صفر — راجع البنود')
    if (inv.journalEntryId) throw new ApiError(409, 'الفاتورة مرتبطة بقيد مسبقًا — راجع القيود اليومية')

    const u = { userId: user.userId, username: user.username }

    // 1) تحقق نهائي من كل شحنة + جمع الشحنات المرتبطة
    const shipmentIds: string[] = []
    for (const it of inv.items) {
      if (!it.shipmentId) continue
      await assertShipmentInvoiceable(tx, it.shipmentId, inv.customerId, inv.id)
      shipmentIds.push(it.shipmentId)
    }

    // 2) عكس قيود استحقاق التسليم النشطة للشحنات المُدخلة (إزالة الإيراد المستحق مسبقًا)
    const reversedNos: string[] = []
    for (const sid of shipmentIds) {
      const deliveryJE = await getActiveDeliveryJournal(tx, sid)
      if (deliveryJE) {
        const rev = await reverseJournal(tx, deliveryJE.id, u, `إصدار الفاتورة ${inv.invoiceNumber} — إعادة تصنيف الإيراد المستحق ضمن الفاتورة`)
        reversedNos.push(rev.entryNo)
      }
    }

    // 3) قيد الفاتورة المزدوج: مدين العملاء بالإجمالي / دائن الإيراد بالصافي / دائن الضريبة
    const ar = await accountByCode(tx, ACC.AR)
    const revenue = await accountByCode(tx, REVENUE_ACCOUNT)
    const net = round2(inv.subtotal - inv.discountAmount)
    const vatAmount = round2(inv.vatAmount)
    const lines: { accountId: string; debit: number; credit: number; description: string; partyId?: string | null }[] = [
      {
        accountId: ar.id, debit: round2(inv.totalAmount), credit: 0,
        description: `فاتورة ${inv.invoiceNumber} — ${inv.customer.name}`,
        partyId: inv.customerId,
      },
      {
        accountId: revenue.id, debit: 0, credit: net,
        description: `إيراد نولون — فاتورة ${inv.invoiceNumber}${inv.discountAmount > 0 ? ` (بعد خصم ${round2(inv.discountAmount)})` : ''}`,
        partyId: inv.customerId,
      },
    ]
    if (vatAmount > 0) {
      const vat = await accountByCode(tx, VAT_ACCOUNT)
      lines.push({
        accountId: vat.id, debit: 0, credit: vatAmount,
        description: `ضريبة القيمة المضافة ${inv.vatRate}% — فاتورة ${inv.invoiceNumber}`,
        partyId: inv.customerId,
      })
    }
    const je = await createJournal(tx, {
      description: `فاتورة مبيعات ${inv.invoiceNumber} — ${inv.customer.name}${vatAmount > 0 ? ` (شاملة ضريبة ${vatAmount})` : ''}`,
      reference: inv.invoiceNumber,
      sourceType: INVOICE_SOURCE,
      sourceId: inv.id,
      status: 'posted',
      lines,
      user: u,
      preventDuplicateSource: true,
    })

    // 4) إعادة إثبات مستحقات المقاول لكل شحنة بحساب مستقل (بلا إيراد)
    const repostedNos: string[] = []
    for (const sid of shipmentIds) {
      const s = await tx.shipment.findUnique({
        where: { id: sid },
        include: { contractor: { select: { id: true, name: true } } },
      })
      if (!s) continue
      const costJE = await postShipmentCostOnlyJournal(tx, s, u)
      if (costJE) repostedNos.push(costJE.entryNo)
    }

    // 5) ربط الشحنات بالفاتورة + ملاحظة في سجل الحالات
    for (const sid of shipmentIds) {
      const s = await tx.shipment.findUnique({ where: { id: sid }, select: { status: true, shipmentNo: true } })
      await tx.shipment.update({
        where: { id: sid },
        data: {
          invoiceId: inv.id,
          statusHistory: {
            create: {
              fromStatus: s?.status ?? null, toStatus: s?.status ?? 'unknown',
              userName: user.username,
              notes: `فُوترت ضمن الفاتورة ${inv.invoiceNumber} (قيد ${je.entryNo})`,
            },
          },
        },
      })
    }

    // 6) تحديث الفاتورة
    await tx.invoice.update({
      where: { id: inv.id },
      data: {
        status: 'issued',
        journalEntryId: je.id,
        issuedById: user.userId,
        issuedByName: user.username,
        issuedAt: new Date(),
      },
    })

    await logAudit(tx, {
      action: 'issue', entity: 'invoice', entityId: inv.id,
      notes: `إصدار الفاتورة ${inv.invoiceNumber} — العميل: ${inv.customer.name} — إجمالي ${round2(inv.totalAmount)} ج.م (ضريبة ${vatAmount}) — قيد ${je.entryNo}${reversedNos.length ? ` — عكس قيود الاستحقاق: ${reversedNos.join('، ')}` : ''}${repostedNos.length ? ` — إعادة إثبات مستحقات المقاول: ${repostedNos.join('، ')}` : ''}`,
      user: u,
      after: { invoiceNumber: inv.invoiceNumber, totalAmount: round2(inv.totalAmount), vatAmount, journalEntryNo: je.entryNo, reversedNos, repostedNos },
    })

    return { journalEntryNo: je.entryNo, reversedNos, repostedNos, invoiceNumber: inv.invoiceNumber, totalAmount: round2(inv.totalAmount) }
  })
  return result
}

// ---------------------------------------------------------------------------
// الإلغاء — قيد عكسي + فك ربط الشحنات + إعادة إثبات استحقاق التسليم
// ---------------------------------------------------------------------------
export async function cancelInvoice(user: SessionUser, id: string, reason?: string) {
  const result = await db.$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({
      where: { id },
      include: {
        items: { select: { shipmentId: true } },
        customer: { select: { id: true, name: true } },
      },
    })
    if (!inv) throw new ApiError(404, 'الفاتورة غير موجودة')
    if (!['issued', 'partially_paid'].includes(inv.status)) {
      throw new ApiError(409, inv.status === 'draft' ? 'المسودة تُحذف مباشرة — لا تحتاج إلغاء' : inv.status === 'paid' ? 'لا يمكن إلغاء فاتورة مسددة بالكامل' : 'الفاتورة ملغاة بالفعل')
    }
    if (round2(inv.paidAmount) > EPS) {
      throw new ApiError(409, `لا يمكن إلغاء الفاتورة — عليها دفعات تحصيل بمقدار ${round2(inv.paidAmount)} ج.م — عكس الدفعات أولًا من تفاصيل الفاتورة`)
    }
    if (!inv.journalEntryId) throw new ApiError(500, 'الفاتورة الصادرة بلا قيد محاسبي مرتبط — راجع القيود اليومية')

    const u = { userId: user.userId, username: user.username }
    const shipmentIds = inv.items.map((i) => i.shipmentId).filter(Boolean) as string[]

    // 1) عكس قيد الفاتورة
    const reversal = await reverseJournal(tx, inv.journalEntryId, u, reason ? `إلغاء الفاتورة ${inv.invoiceNumber} — ${reason}` : `إلغاء الفاتورة ${inv.invoiceNumber}`)

    // 2) عكس قيود مستحقات المقاول المستقلة ثم إعادة إثبات قيود استحقاق التسليم الأصلية
    const repostedNos: string[] = []
    for (const sid of shipmentIds) {
      const activeCostJEs = await tx.journalEntry.findMany({
        where: { sourceType: 'shipment_cost', sourceId: sid, status: 'posted', reversalOfId: null },
        select: { id: true, entryNo: true },
      })
      for (const cje of activeCostJEs) {
        await reverseJournal(tx, cje.id, u, `إلغاء الفاتورة ${inv.invoiceNumber} — إعادة بناء قيد الاستحقاق الأصلي`)
      }
      const s = await tx.shipment.findUnique({
        where: { id: sid },
        include: { customer: { select: { id: true, name: true } }, contractor: { select: { id: true, name: true } } },
      })
      if (!s) continue
      const deliveryJE = await postShipmentDeliveryJournal(tx, s, u)
      if (deliveryJE) repostedNos.push(deliveryJE.entryNo)
    }

    // 3) فك ربط الشحنات (تُفوترة من جديد) + ملاحظة في سجل الحالات
    for (const sid of shipmentIds) {
      const s = await tx.shipment.findUnique({ where: { id: sid }, select: { status: true } })
      await tx.shipment.update({
        where: { id: sid },
        data: {
          invoiceId: null,
          statusHistory: {
            create: {
              fromStatus: s?.status ?? null, toStatus: s?.status ?? 'unknown',
              userName: user.username,
              notes: `فُك ربطها بالفاتورة ${inv.invoiceNumber} الملغاة (عكس بالقيد ${reversal.entryNo}) — أصبحت جاهزة للفوترة من جديد`,
            },
          },
        },
      })
    }

    // 4) تحديث الفاتورة
    await tx.invoice.update({
      where: { id: inv.id },
      data: {
        status: 'cancelled',
        cancelledById: user.userId,
        cancelledByName: user.username,
        cancelledAt: new Date(),
        cancelReason: reason ? String(reason).slice(0, 300) : null,
      },
    })

    await logAudit(tx, {
      action: 'cancel', entity: 'invoice', entityId: inv.id,
      notes: `إلغاء الفاتورة ${inv.invoiceNumber} — عكس القيد ${reversal.entryNo}${repostedNos.length ? ` — إعادة إثبات الاستحقاق: ${repostedNos.join('، ')}` : ''}${reason ? ` — السبب: ${reason}` : ''}`,
      user: u,
      before: { status: inv.status, totalAmount: inv.totalAmount },
      after: { status: 'cancelled', reversalNo: reversal.entryNo, repostedNos },
    })

    return { reversalNo: reversal.entryNo, repostedNos, invoiceNumber: inv.invoiceNumber }
  })
  return result
}

// ---------------------------------------------------------------------------
// الدفعات — سند قبض مرتبط + تحديث حالة السداد تلقائيًا
// ---------------------------------------------------------------------------
const PAY_METHODS: Record<string, { code: string; label: string }> = {
  cash: { code: ACC.CASH, label: 'نقدي من الصندوق' },
  bank: { code: ACC.BANK, label: 'تحويل بنكي' },
}

/** دفعات الفاتورة (السندات المكتملة فعليًا) */
async function invoicePayments(tx: Tx, invoiceId: string) {
  return tx.opVoucher.findMany({
    where: { invoiceId },
    orderBy: { createdAt: 'desc' },
    include: { journalEntry: { select: { entryNo: true, status: true } } },
  })
}

/** إعادة حساب المسدد والحالة من سندات القبض المكتملة — مصدر واحد للحقيقة */
function paidStatusFromPayments(paid: number, total: number): InvoiceStatus {
  if (paid <= EPS) return 'issued'
  if (paid >= total - EPS) return 'paid'
  return 'partially_paid'
}

export async function recordInvoicePayment(user: SessionUser, invoiceId: string, body: any) {
  const amount = round2(num(body.amount) ?? 0)
  const method = String(body.method ?? 'cash').trim()
  const notes = body.notes ? String(body.notes).slice(0, 300) : null
  if (!(amount > 0)) throw new ApiError(400, 'أدخل مبلغ دفعة صحيحًا أكبر من صفر')
  const methodDef = PAY_METHODS[method]
  if (!methodDef) throw new ApiError(400, 'طريقة الدفع غير معروفة — المسموح: نقدي أو بنكي')

  const result = await db.$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { customer: { select: { id: true, name: true } } } })
    if (!inv) throw new ApiError(404, 'الفاتورة غير موجودة')
    if (!['issued', 'partially_paid'].includes(inv.status)) {
      throw new ApiError(409, inv.status === 'draft' ? 'الفاتورة مسودة — أصدرها أولًا قبل تسجيل الدفعات' : inv.status === 'cancelled' ? 'لا يمكن التحصيل على فاتورة ملغاة' : 'الفاتورة مسددة بالكامل بالفعل')
    }
    const remaining = round2(inv.totalAmount - inv.paidAmount)
    if (amount > remaining + EPS) {
      throw new ApiError(400, `الدفعة ${amount} ج.م تتجاوز المتبقي على الفاتورة (${remaining} ج.م) — سجل دفعة أصغر أو عكس دفعة سابقة`)
    }

    const u = { userId: user.userId, username: user.username }
    const cashAccount = await accountByCode(tx, methodDef.code)

    const voucherNo = await nextVoucherNo(tx, 'collection')
    const voucher = await tx.opVoucher.create({
      data: {
        voucherNo,
        type: 'collection',
        status: 'completed',
        partyId: inv.customerId,
        invoiceId: inv.id,
        amount,
        totalValue: amount,
        notes: notes ?? `دفعة تحصيل للفاتورة ${inv.invoiceNumber}`,
        accountName: methodDef.label,
        cashAccountId: cashAccount.id,
        userId: user.userId,
        userName: user.username,
        actions: {
          create: [
            { action: 'create', userId: user.userId, userName: user.username, notes: `دفعة تحصيل للفاتورة ${inv.invoiceNumber}` },
            { action: 'submit', userId: user.userId, userName: user.username },
            { action: 'approve', userId: user.userId, userName: user.username, notes: 'اعتماد تلقائي — دفعة فاتورة' },
            { action: 'execute', userId: user.userId, userName: user.username },
            { action: 'complete', userId: user.userId, userName: user.username, notes: 'إكمال تلقائي مع القيد المزدوج' },
          ],
        },
      },
    })

    // القيد المزدوج للسند: مدين الصندوق/البنك / دائن العملاء (خفض المديونية)
    const je = await postFinancialVoucherJournal(tx, voucher.id, user)

    const paidAmount = round2(inv.paidAmount + amount)
    const newStatus = paidStatusFromPayments(paidAmount, inv.totalAmount)
    await tx.invoice.update({
      where: { id: inv.id },
      data: { paidAmount, status: newStatus },
    })

    await logAudit(tx, {
      action: 'create', entity: 'invoice_payment', entityId: voucher.id,
      notes: `دفعة تحصيل للفاتورة ${inv.invoiceNumber} — ${amount} ج.م (${methodDef.label}) — سند ${voucherNo} — قيد ${je?.entryNo ?? '—'} — المسدد ${paidAmount}/${round2(inv.totalAmount)}`,
      user: u,
      after: { voucherNo, amount, method, journalEntryNo: je?.entryNo ?? null, paidAmount, status: newStatus },
    })

    return {
      voucherNo,
      journalEntryNo: je?.entryNo ?? null,
      paidAmount,
      status: newStatus,
      remaining: round2(Math.max(0, inv.totalAmount - paidAmount)),
      customerName: inv.customer.name,
      invoiceNumber: inv.invoiceNumber,
    }
  })
  return result
}

/** عكس دفعة تحصيل — يعكس قيد السند ويُلغيه ويعيد حالة السداد للخلف */
export async function reverseInvoicePayment(user: SessionUser, invoiceId: string, paymentId: string, body: any) {
  const reason = body?.reason ? String(body.reason).slice(0, 300) : 'عكس دفعة تحصيل من شاشة الفواتير'
  const result = await db.$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } })
    if (!inv) throw new ApiError(404, 'الفاتورة غير موجودة')
    const voucher = await tx.opVoucher.findUnique({
      where: { id: paymentId },
      include: { party: { select: { id: true, name: true } } },
    })
    if (!voucher) throw new ApiError(404, 'الدفعة غير موجودة')
    if (voucher.invoiceId !== invoiceId) throw new ApiError(400, 'الدفعة لا تنتمي لهذه الفاتورة')
    if (voucher.type !== 'collection') throw new ApiError(400, 'السجل المحدد ليس سند قبض')
    if (voucher.status !== 'completed') throw new ApiError(409, 'الدفعة ملغاة أو معكوسة مسبقًا — لا يمكن العكس مرتين')
    if (!voucher.journalEntryId) throw new ApiError(409, 'الدفعة بلا قيد محاسبي مرتبط — راجع القيود اليومية')

    const u = { userId: user.userId, username: user.username }
    const reversal = await reverseJournal(tx, voucher.journalEntryId, u, `${reason} — الفاتورة ${inv.invoiceNumber}`)

    await tx.opVoucher.update({
      where: { id: voucher.id },
      data: {
        status: 'cancelled',
        updatedAt: new Date(),
        actions: { create: { action: 'cancel', userId: user.userId, userName: user.username, notes: `عكس دفعة الفاتورة — عكس القيد ${reversal.entryNo}` } },
      },
    })

    const paidAmount = round2(Math.max(0, inv.paidAmount - round2(Number(voucher.amount ?? 0))))
    const newStatus = paidStatusFromPayments(paidAmount, inv.totalAmount)
    await tx.invoice.update({
      where: { id: inv.id },
      data: { paidAmount, status: newStatus },
    })

    await logAudit(tx, {
      action: 'reverse', entity: 'invoice_payment', entityId: voucher.id,
      notes: `عكس دفعة ${voucher.voucherNo} للفاتورة ${inv.invoiceNumber} — ${round2(Number(voucher.amount ?? 0))} ج.م — عكس بالقيد ${reversal.entryNo}`,
      user: u,
      before: { voucherNo: voucher.voucherNo, amount: voucher.amount, paidAmount: inv.paidAmount, status: inv.status },
      after: { reversalNo: reversal.entryNo, paidAmount, status: newStatus, reason },
    })

    return { voucherNo: voucher.voucherNo, reversalNo: reversal.entryNo, paidAmount, status: newStatus }
  })
  return result
}

void invoicePayments
