import { NextResponse } from 'next/server'
export const dynamic = 'force-static'
export function POST() {
  return NextResponse.json({ imported: 0, skipped: 0, errors: 0, total: 0 })
}
