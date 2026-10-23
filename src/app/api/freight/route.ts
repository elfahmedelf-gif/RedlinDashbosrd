import { NextResponse } from 'next/server'
import { mock } from '@/lib/mock-data'

export const dynamic = 'force-static'

export function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  let items = mock.freight
  if (q) {
    const ql = q.toLowerCase()
    items = items.filter((r: any) =>
      String(r.regionAr ?? '').toLowerCase().includes(ql) ||
      String(r.regionEn ?? '').toLowerCase().includes(ql) ||
      String(r.routeName ?? '').toLowerCase().includes(ql)
    )
  }
  return NextResponse.json({ items, total: items.length })
}

export function POST() {
  return NextResponse.json({ id: 'mock-' + Date.now() }, { status: 201 })
}
