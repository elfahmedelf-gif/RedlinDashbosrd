import { NextResponse } from 'next/server'
import { mock } from '@/lib/mock-data'

export const dynamic = 'force-static'

export function GET() {
  const items = mock.accounts.map((a: any) => ({
    ...a,
    parent: a.parentId ? { id: a.parentId, name: mock.accounts.find((x: any) => x.id === a.parentId)?.name ?? null } : null,
    debit: 0, credit: 0, balance: 0,
  }))
  return NextResponse.json({ items })
}

export function POST() {
  return NextResponse.json({ id: 'mock-' + Date.now() }, { status: 201 })
}
