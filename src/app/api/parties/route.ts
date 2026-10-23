import { NextResponse } from 'next/server'
import { mock } from '@/lib/mock-data'

export const dynamic = 'force-dynamic'

export function GET(req: Request) {
  const url = new URL(req.url)
  const type = url.searchParams.get('type')
  const q = url.searchParams.get('q')?.trim() ?? ''

  let items = mock.parties.map((p: any) => ({
    ...p,
    branch: p.branchId ? { id: p.branchId, name: 'الفرع الرئيسي' } : null,
    _count: { shipments: Math.floor(Math.random() * 10) + 1 },
    _sum: {
      freightTotal: Math.floor(Math.random() * 50000) + 5000,
      totalSuppliers: Math.floor(Math.random() * 60000) + 5000,
      customerPay: Math.floor(Math.random() * 5000),
    },
  }))

  if (type === 'customer') items = items.filter((p: any) => p.isCustomer)
  if (type === 'contractor') items = items.filter((p: any) => p.isContractor)
  if (type === 'supplier') items = items.filter((p: any) => p.isSupplier)
  if (q) {
    const ql = q.toLowerCase()
    items = items.filter((p: any) => String(p.name ?? '').toLowerCase().includes(ql))
  }

  return NextResponse.json({ items, total: items.length })
}

export function POST() {
  return NextResponse.json({ id: 'mock-' + Date.now() }, { status: 201 })
}
