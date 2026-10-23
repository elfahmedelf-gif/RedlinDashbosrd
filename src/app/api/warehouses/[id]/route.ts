import { NextResponse } from 'next/server'
export const dynamic = 'force-static'
export function GET() { return NextResponse.json({ error: 'Mock mode' }, { status: 404 }) }
export function PATCH() { return NextResponse.json({ ok: true }) }
export function DELETE() { return new NextResponse(null, { status: 204 }) }
