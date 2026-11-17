// ============================================================================
// HTTP helpers for API routes — uniform errors + idempotency guard
// ============================================================================
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export class ApiError extends Error {
  status: number
  /** بيانات إضافية اختيارية تُرجع للعميل (مثل بيانات السجل المكرر لعرض رابط سريع) */
  details?: Record<string, any>
  constructor(status: number, message: string, details?: Record<string, any>) {
    super(message)
    this.status = status
    this.details = details
  }
}

export async function handle(fn: () => Promise<any>): Promise<NextResponse> {
  try {
    const data = await fn()
    return NextResponse.json(data ?? { ok: true })
  } catch (e: any) {
    const status = e instanceof ApiError ? e.status : 500
    if (status >= 500) console.error('[api-error]', e)
    return NextResponse.json(
      { error: e?.message ?? 'خطأ غير متوقع في الخادم', ...(e?.details ? { details: e.details } : {}) },
      { status },
    )
  }
}

/** يقرأ جسم الطلب بأمان */
export async function readBody(req: Request): Promise<any> {
  try { return await req.json() } catch { return {} }
}

/**
 * Idempotency guard — يمنع تكرار نفس العملية المنطقية عند إعادة المحاولة/الضغط المكرر.
 * العميل يرسل ترويسة Idempotency-Key ثابتة لنفس العملية؛ يُخزن أول نتيجة وتُعاد كما هي.
 */
export async function withIdempotency<T>(
  req: Request,
  action: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = req.headers.get('idempotency-key')?.trim()
  if (!key) return fn()
  const existing = await db.idempotencyKey.findUnique({ where: { key } })
  if (existing) {
    if (existing.action !== action) {
      throw new ApiError(409, 'تعارض في مفتاح التكرار (Idempotency-Key) — عملية مختلفة بنفس المفتاح')
    }
    return (existing.result ? JSON.parse(existing.result) : { ok: true, replayed: true }) as T
  }
  const result = await fn()
  try {
    await db.idempotencyKey.create({ data: { key, action, result: JSON.stringify(result ?? { ok: true }) } })
  } catch {
    // مفتاح متزامن من طلب آخر — النتيجة الأولى هي المعتمدة
  }
  return result
}

export function num(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}
