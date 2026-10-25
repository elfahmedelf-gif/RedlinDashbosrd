import { NextResponse } from 'next/server'
import { mock, enrichShipments } from '@/lib/mock-data'

export const dynamic = 'force-static'

export function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return NextResponse.json({ error: 'Mock mode' }, { status: 404 })
}
export function PATCH() { return NextResponse.json({ ok: true }) }
export function DELETE() { return new NextResponse(null, { status: 204 }) }
