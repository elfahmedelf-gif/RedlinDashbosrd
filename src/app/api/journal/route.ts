import { NextResponse } from 'next/server'
export const dynamic = 'force-static'
export function GET() { return NextResponse.json({ items: [], total: 0 }) }
export function POST() { return NextResponse.json({ id: 'mock-' + Date.now() }, { status: 201 }) }
