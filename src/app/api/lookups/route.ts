import { NextResponse } from 'next/server'
import { mock } from '@/lib/mock-data'

export const dynamic = 'force-static'

export function GET(req: Request) {
  const url = new URL(req.url)
  const category = url.searchParams.get('category')
  const activeOnly = url.searchParams.get('active') === '1'

  let items = mock.lookups
  if (category) items = items.filter((i: any) => i.category === category)
  if (activeOnly) items = items.filter((i: any) => i.active)

  const byCategory: Record<string, any[]> = {}
  for (const it of items) {
    if (!byCategory[it.category]) byCategory[it.category] = []
    byCategory[it.category].push(it)
  }
  return NextResponse.json({ items, byCategory, total: items.length })
}

export function POST() {
  return NextResponse.json({ id: 'mock-' + Date.now() }, { status: 201 })
}
