import { NextResponse } from 'next/server'
import { mock } from '@/lib/mock-data'

export const dynamic = 'force-static'

export function GET() {
  return NextResponse.json({ items: mock.users, total: mock.users.length })
}
