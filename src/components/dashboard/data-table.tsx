'use client'

import * as React from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { DataTablePagination } from './data-table-pagination'

interface Column<T> {
  key: string
  header: string
  className?: string
  /** Fixed column width (Tailwind class like 'w-28' or CSS value like '120px'). Applied to <th>. Columns without width share the remaining space. */
  width?: string
  align?: 'right' | 'center' | 'left'
  // Whether this column is "primary" (shown prominently in card mode as a title).
  // If no primary column is marked, the first column is used.
  primary?: boolean
  // Whether this column should be hidden in card mode (mobile). Default: false.
  hideInCard?: boolean
  render: (row: T, index: number) => React.ReactNode
}

interface DataTableProps<T> {
  rows: T[]
  columns: Column<T>[]
  loading?: boolean
  emptyText?: string
  getRowKey: (row: T, index: number) => string
  onRowClick?: (row: T) => void
  minW?: number
  /** Initial rows per page (default 10). Changeable from the pagination bar. */
  pageSize?: number
  /** When this value changes (external filters/search URL), the page resets to 1. */
  resetKey?: string | number
  initialQ?: string
  searchPlaceholder?: string
  searchFn?: (row: T, q: string) => boolean
  // Custom card renderer for mobile. If omitted, a default card layout is generated from columns.
  cardRender?: (row: T, index: number) => React.ReactNode
}

export function DataTable<T>({
  rows,
  columns,
  loading,
  emptyText = 'لا توجد بيانات',
  getRowKey,
  onRowClick,
  minW = 800,
  pageSize: initialPageSize = 10,
  resetKey,
  searchPlaceholder = 'بحث...',
  searchFn,
  cardRender,
}: DataTableProps<T>) {
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(initialPageSize)
  const [q, setQ] = React.useState('')

  const filtered = React.useMemo(() => {
    if (!q || !searchFn) return rows
    const qq = q.toLowerCase()
    return rows.filter((r) => searchFn(r, qq))
  }, [rows, q, searchFn])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  // Reset to page 1 whenever the search term or external filters (resetKey) change.
  React.useEffect(() => { setPage(1) }, [q, resetKey])
  // Clamp page if the dataset shrinks below the current page.
  React.useEffect(() => { if (page > totalPages) setPage(totalPages) }, [page, totalPages])

  const handlePageSizeChange = React.useCallback((n: number) => {
    setPageSize(n)
    setPage(1)
  }, [])

  const alignClass = (a?: string) =>
    a === 'center' ? 'text-center' : a === 'left' ? 'text-left' : 'text-right'

  // Find primary column (first one marked primary, else first column)
  const primaryCol = columns.find((c) => c.primary) ?? columns[0]
  // Secondary columns for cards = all columns except the primary, not hidden in cards
  const cardColumns = columns.filter((c) => c !== primaryCol && !c.hideInCard)
  // Print columns = all columns except the actions column (we don't want action buttons in print)
  const printColumns = columns.filter((c) => {
    const k = c.key.toLowerCase()
    const h = c.header
    return k !== 'actions' && k !== 'action' && h !== 'إجراءات' && h !== 'إجراء'
  })

  const emptyContent = q ? `لا نتائج للبحث "${q}"` : emptyText

  return (
    <div className="space-y-2">
      {searchFn && (
        <div className="relative w-full sm:max-w-md print:hidden">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="pr-9 bg-card" />
          {q && (
            <button onClick={() => setQ('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          )}
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="rounded-2xl border border-border bg-card elev-sm p-3 space-y-2 print:hidden">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card elev-sm py-16 text-center text-muted-foreground">
          {emptyContent}
        </div>
      ) : (
        <>
          {/* ===== Print-only: full filtered list in a clean A4 table ===== */}
          <div className="hidden print:block">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  {printColumns.map((c) => (
                    <th
                      key={c.key}
                      className={cn('px-2 py-1.5 font-bold text-slate-900 text-right', alignClass(c.align))}
                    >
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <tr key={getRowKey(row, i)} className="print-avoid-break">
                    {printColumns.map((c) => (
                      <td key={c.key} className={cn('px-2 py-1.5 text-right align-top', alignClass(c.align))}>
                        {c.render(row, i)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[10px] text-slate-500 mt-1 text-left">
              إجمالي السجلات: {filtered.length}
            </div>
          </div>

          {/* ===== Screen-only views (hidden in print) ===== */}
          {/* Mobile: card view */}
          <div className="sm:hidden space-y-2 print:hidden">
            {pageRows.map((row, i) => {
              const idx = (safePage - 1) * pageSize + i
              const key = getRowKey(row, idx)
              if (cardRender) {
                return (
                  <div
                    key={key}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(onRowClick && 'cursor-pointer')}
                  >
                    {cardRender(row, idx)}
                  </div>
                )
              }
              // Default card layout: primary column shown as the title, others as label/value rows
              return (
                <div
                  key={key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'rounded-2xl border border-border bg-card elev-sm p-3 space-y-2',
                    onRowClick && 'cursor-pointer hover:bg-muted/40 transition-colors active:scale-[0.99]',
                  )}
                >
                  {/* Title row: primary column + first 1-2 secondary columns inline */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-muted-foreground/70 mb-0.5">{primaryCol.header}</div>
                      <div className="font-semibold text-sm truncate-1 leading-tight">
                        {primaryCol.render(row, idx)}
                      </div>
                    </div>
                    {/* Show up to 2 inline secondary badges/values (typically the status/amount) */}
                    {cardColumns.slice(-2).map((c) => (
                      <div key={c.key} className="shrink-0 text-left">
                        <div className="text-[9px] text-muted-foreground/70 mb-0.5">{c.header}</div>
                        {c.render(row, idx)}
                      </div>
                    ))}
                  </div>
                  {/* Remaining columns as label/value grid */}
                  {cardColumns.length > 2 && (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-1 border-t border-border/60 mt-1">
                      {cardColumns.slice(0, -2).map((c) => (
                        <div key={c.key} className="min-w-0">
                          <div className="text-[10px] text-muted-foreground/70 truncate-1">{c.header}</div>
                          <div className="text-xs font-medium truncate-1">{c.render(row, idx)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Desktop: table view */}
          <div className="hidden sm:block rounded-2xl border border-border overflow-hidden bg-card elev-sm print:hidden">
            <div className="w-full overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full table-fixed text-sm text-right" style={{ minWidth: minW }}>
                <thead className="bg-muted/50 text-xs text-muted-foreground sticky top-0 z-10 backdrop-blur-sm">
                  <tr>
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        className={cn('font-medium px-4 py-3 whitespace-nowrap', alignClass(c.align), c.width, c.className)}
                      >
                        {c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, i) => {
                    const idx = (safePage - 1) * pageSize + i
                    return (
                      <tr
                        key={getRowKey(row, idx)}
                        onClick={onRowClick ? () => onRowClick(row) : undefined}
                        className={cn(
                          'border-t border-border hover:bg-muted/40 transition-colors',
                          i % 2 ? 'bg-card' : 'bg-muted/15',
                          onRowClick && 'cursor-pointer',
                        )}
                      >
                        {columns.map((c) => (
                          <td key={c.key} className={cn('px-4 py-3 align-middle', alignClass(c.align), c.className)}>
                            {c.render(row, idx)}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {/* Unified pagination bar — directly below the table container */}
            <DataTablePagination
              currentPage={safePage}
              totalPages={totalPages}
              totalItems={filtered.length}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={handlePageSizeChange}
            />
          </div>

          {/* Mobile: pagination bar below the cards */}
          <div className="sm:hidden rounded-2xl border border-border bg-card elev-sm overflow-hidden print:hidden">
            <DataTablePagination
              currentPage={safePage}
              totalPages={totalPages}
              totalItems={filtered.length}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={handlePageSizeChange}
              className="border-t-0"
            />
          </div>
        </>
      )}
    </div>
  )
}

function fmt(n: number) {
  return n.toLocaleString('en-US')
}

// Generic toolbar header for module pages
export function ModuleToolbar({
  title,
  count,
  onAdd,
  addLabel = 'إضافة جديد',
  extra,
}: {
  title: string
  count?: number
  onAdd?: () => void
  addLabel?: string
  extra?: React.ReactNode
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <h3 className="text-base md:text-lg font-semibold">{title}</h3>
        {typeof count === 'number' && (
          <span className="text-xs text-muted-foreground tnum">{fmt(count)} سجل</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {extra}
        {onAdd && (
          <Button onClick={onAdd} size="sm">
            {addLabel}
          </Button>
        )}
      </div>
    </div>
  )
}
