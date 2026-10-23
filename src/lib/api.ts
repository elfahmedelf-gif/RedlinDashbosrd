// Shared client-side fetch helper + types
export const fetcher = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) {
    const txt = await r.text()
    throw new Error(txt || `HTTP ${r.status}`)
  }
  return r.json()
}

// POST/PUT/PATCH with JSON body
export async function apiPost(url: string, body?: any) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  const data = text ? JSON.parse(text) : null
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
  return data
}

export async function apiPatch(url: string, body?: any) {
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  const data = text ? JSON.parse(text) : null
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
  return data
}

export async function apiDelete(url: string) {
  const r = await fetch(url, { method: 'DELETE' })
  if (!r.ok) {
    const txt = await r.text()
    throw new Error(txt || `HTTP ${r.status}`)
  }
  return r.status === 204 ? null : r.json()
}

// Audit helper (server-side)
export function auditData(obj: any): string | null {
  if (!obj) return null
  try {
    return JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
  } catch {
    return null
  }
}
