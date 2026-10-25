import { NextResponse } from 'next/server'
import { mock } from '@/lib/mock-data'

export const dynamic = 'force-static'

export function GET(req: Request, { params }: { params: Promise<{ type: string }> }) {
  return NextResponse.json({ items: [] })
}
