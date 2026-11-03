// ============================================================================
// سجل التدقيق + العدادات التسلسلية — helpers تعمل داخل المعاملات
// ============================================================================
import type { Prisma, PrismaClient } from '@prisma/client'

type Tx = Prisma.TransactionClient | PrismaClient

export interface AuditInput {
  action: string
  entity: string
  entityId?: string | null
  notes?: string | null
  user?: { userId: string; username: string } | null
  before?: any
  after?: any
}

export async function logAudit(tx: Tx, input: AuditInput): Promise<void> {
  await tx.auditLog.create({
    data: {
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      notes: input.notes ?? null,
      userId: input.user?.userId ?? null,
      userName: input.user?.username ?? null,
      beforeData: input.before != null ? JSON.stringify(input.before) : null,
      afterData: input.after != null ? JSON.stringify(input.after) : null,
    },
  })
}

/** رقم تسلسلي ذري — يمنع تكرار الأرقام حتى بعد الحذف */
export async function nextSeq(tx: Tx, key: string): Promise<number> {
  const row = await tx.seqCounter.upsert({
    where: { key },
    update: { value: { increment: 1 } },
    create: { key, value: 1 },
  })
  return row.value
}

export async function currentSeq(tx: Tx, key: string): Promise<number> {
  const row = await tx.seqCounter.findUnique({ where: { key } })
  return row?.value ?? 0
}
