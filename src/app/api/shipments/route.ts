import { NextResponse } from 'next/server'
import { mock, paginate, enrichShipments } from '@/lib/mock-data'

export const dynamic = 'force-dynamic'

export function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const status = url.searchParams.get('status')
  const destination = url.searchParams.get('destination')
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '20', 10)))

  let items = enrichShipments([...mock.shipments].sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0
    const db = b.date ? new Date(b.date).getTime() : 0
    return db - da
  }))

  if (q) {
    const ql = q.toLowerCase()
    items = items.filter((s) =>
      String(s.shipmentNo ?? '').toLowerCase().includes(ql) ||
      String(s.billNo ?? '').toLowerCase().includes(ql) ||
      String(s.recipientName ?? '').toLowerCase().includes(ql) ||
      String(s.destination ?? '').toLowerCase().includes(ql) ||
      String(s.destinationEn ?? '').toLowerCase().includes(ql) ||
      String(s.routeCode ?? '').toLowerCase().includes(ql) ||
      String(s.deliveryPhones ?? '').toLowerCase().includes(ql)
    )
  }
  if (status && status !== 'all') items = items.filter((s) => s.status === status)
  if (destination && destination !== 'all') items = items.filter((s) => s.destination === destination)

  const result = paginate(items, page, pageSize)
  return NextResponse.json(result)
}

export function POST() {
  return NextResponse.json({ id: 'mock-' + Date.now(), shipmentNo: 'SH-NEW' }, { status: 201 })
}
