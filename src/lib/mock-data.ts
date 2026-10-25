// Mock data module — loads static JSON data instead of using Prisma
import fs from 'fs'
import path from 'path'

const dataPath = path.join(process.cwd(), 'mock-data.json')
const rawData = fs.readFileSync(dataPath, 'utf-8')
const mockJson = JSON.parse(rawData)

export const mock = mockJson as any

export function paginate<T>(arr: T[], page: number, pageSize: number) {
  const total = arr.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = (page - 1) * pageSize
  return { items: arr.slice(start, start + pageSize), total, page, pageSize, totalPages }
}

export function searchArr<T>(arr: T[], q: string, fields: (keyof T)[]): T[] {
  if (!q) return arr
  const ql = q.toLowerCase()
  return arr.filter((item) => fields.some((f) => String(item[f] ?? '').toLowerCase().includes(ql)))
}

const partyMap = new Map((mock.parties || []).map((p: any) => [p.id, p.name]))
export function partyName(id: string | null): string {
  if (!id) return '-'
  return partyMap.get(id) ?? '-'
}

export function enrichShipments(shipments: any[]) {
  return shipments.map((s) => ({
    ...s,
    customer: s.customerId ? { id: s.customerId, name: partyName(s.customerId) } : null,
    contractor: s.contractorId ? { id: s.contractorId, name: partyName(s.contractorId) } : null,
    branch: s.branchId ? { id: s.branchId, name: 'الفرع الرئيسي' } : null,
  }))
}
