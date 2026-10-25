import { NextResponse } from 'next/server'
export const dynamic = 'force-static'
export function POST() {
  return NextResponse.json({
    sheets: [{
      name: 'مبيعات 8-2026',
      headers: ['المخزن', 'Name of the ship-to party', 'Destination', 'policy QTY', '1.5 TON', '3 TON', '6 M', 'Date', 'المقاول', 'تكويد', 'النولون', 'اجمالى النولون'],
      sampleRows: [],
      totalRows: 184,
      columns: 32,
    }],
    suggestedMapping: {},
    fileName: 'مبيعات العاشر 3.xlsx',
  })
}
