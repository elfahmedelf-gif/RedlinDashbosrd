// ============================================================================
// Shared CSV/Excel export utilities (browser-only, no server).
// - exportToCSV: produces a UTF-8 BOM CSV that Excel opens correctly with Arabic
// - exportToHTML: produces an Excel-friendly .xls (HTML table) for styled sheets
// ============================================================================

type CellValue = string | number | boolean | null | undefined

/**
 * Convert an array of records into CSV text (with UTF-8 BOM for Arabic compatibility).
 * - Nested objects are flattened via a dot path so they remain readable.
 * - Strings containing commas, quotes, or newlines are quoted and escaped.
 */
export function toCSV(rows: Record<string, any>[], columns?: { key: string; header?: string }[]): string {
  if (!rows.length) return ''
  const cols =
    columns ??
    Object.keys(rows[0]).map((k) => ({ key: k, header: k }))
  const escape = (v: CellValue) => {
    if (v == null) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  const headerLine = cols.map((c) => escape(c.header ?? c.key)).join(',')
  const lines = rows.map((row) => cols.map((c) => escape(readPath(row, c.key))).join(','))
  return [headerLine, ...lines].join('\n')
}

/** Read a possibly-nested path like "customer.name" or "contractor.id". */
function readPath(row: any, path: string): CellValue {
  if (!row) return null
  if (!path.includes('.')) return row[path] ?? null
  let cur: any = row
  for (const part of path.split('.')) {
    cur = cur?.[part]
    if (cur == null) return null
  }
  return cur ?? null
}

/** Trigger a browser download for a Blob with the given filename. */
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Export rows as a CSV file (Excel-compatible with Arabic via UTF-8 BOM). */
export function exportToCSV(
  rows: Record<string, any>[],
  filename: string,
  columns?: { key: string; header?: string }[],
) {
  if (!rows.length) {
    triggerDownload(new Blob(['\ufeff'], { type: 'text/csv;charset=utf-8' }), filename)
    return
  }
  const text = '\ufeff' + toCSV(rows, columns)
  triggerDownload(new Blob([text], { type: 'text/csv;charset=utf-8' }), filename)
}

/**
 * Export rows as an Excel-compatible .xls file (HTML table with RTL direction).
 * Excel and LibreOffice open this with full Arabic + column alignment preserved.
 */
export function exportToExcel(
  rows: Record<string, any>[],
  filename: string,
  columns?: { key: string; header?: string }[],
) {
  if (!rows.length) {
    triggerDownload(new Blob(['<table></table>'], { type: 'application/vnd.ms-excel' }), filename)
    return
  }
  const cols = columns ?? Object.keys(rows[0]).map((k) => ({ key: k, header: k }))
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const head = `<tr>${cols.map((c) => `<th style="background:#f1f5f9;text-align:right;font-weight:700;padding:6px;border:1px solid #cbd5e1">${esc(c.header ?? c.key)}</th>`).join('')}</tr>`
  const body = rows
    .map(
      (row) =>
        `<tr>${cols
          .map((c) => {
            const v = readPath(row, c.key)
            const txt = v == null ? '' : typeof v === 'object' ? esc(JSON.stringify(v)) : esc(String(v))
            const align = typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) ? 'left' : 'right'
            return `<td style="text-align:${align};padding:5px;border:1px solid #e2e8f0;mso-number-format:'\\@'">${txt}</td>`
          })
          .join('')}</tr>`,
    )
    .join('')
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Sheet1</x:Name><x:WorksheetOptions><x:RTL/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body dir="rtl"><table dir="rtl" style="border-collapse:collapse;font-family:'Tahoma','Arial',sans-serif;font-size:11px">${head}${body}</table></body></html>`
  triggerDownload(new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel;charset=utf-8' }), filename)
}
