// ============================================================================
// إثراء الأذونات للقراءة — فصل لتجنب التبعيات الدائرية
// ============================================================================
import type { Prisma } from '@prisma/client'
import { enrichVoucher } from './vouchers'

export function voucherInclude() {
  return {
    sourceBranch: true, destBranch: true,
    employee: { select: { id: true, name: true } },
    courier: { select: { id: true, name: true } },
    party: { select: { id: true, name: true } },
    journalEntry: { select: { id: true, entryNo: true } },
    items: { include: { shipment: { include: { customer: { select: { id: true, name: true } } } } } },
    actions: { orderBy: { at: 'asc' } },
  } satisfies Prisma.OpVoucherInclude
}

export function enrichVoucherRows(rows: any[]): any[] {
  return rows.map((v) => enrichVoucher(v))
}
