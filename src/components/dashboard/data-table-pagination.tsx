'use client'

// ============================================================================
// DataTablePagination — unified pagination bar for ALL module tables.
//
// Layout (RTL): [range status] --- [السابق 1 2 … n التالي] --- [rows per page]
// Purely presentational + controlled: all state lives in the parent
// (DataTable client-side, or server-side modules like shipments).
// ============================================================================

import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

export interface DataTablePaginationProps {
  currentPage: number
  totalPages: number
  totalItems: number
  pageSize: number
  onPageChange: (page: number) => void
  /** Omit to hide the rows-per-page selector (e.g. fixed-size server tables). */
  onPageSizeChange?: (size: number) => void
  /** Item noun shown in the range text (default: سجل). */
  itemLabel?: string
  className?: string
}

function fmt(n: number) {
  return n.toLocaleString('en-US')
}

/**
 * Builds the numbered-page list with ellipsis windows.
 * Always ≤5 numeric buttons: [1] … [c-1, c, c+1] … [totalPages].
 */
export function buildPageList(current: number, totalPages: number): (number | 'ellipsis')[] {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const pages: (number | 'ellipsis')[] = [1]
  let start = Math.max(2, current - 1)
  let end = Math.min(totalPages - 1, current + 1)
  if (current <= 3) {
    start = 2
    end = Math.min(4, totalPages - 1)
  } else if (current >= totalPages - 2) {
    start = Math.max(totalPages - 3, 2)
    end = totalPages - 1
  }
  if (start > 2) pages.push('ellipsis')
  for (let i = start; i <= end; i++) pages.push(i)
  if (end < totalPages - 1) pages.push('ellipsis')
  pages.push(totalPages)
  return pages
}

export function DataTablePagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  itemLabel = 'سجل',
  className,
}: DataTablePaginationProps) {
  const from = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const to = Math.min(currentPage * pageSize, totalItems)
  const pageList = React.useMemo(
    () => buildPageList(currentPage, totalPages),
    [currentPage, totalPages],
  )

  return (
    <div
      className={cn(
        'flex items-center justify-between px-4 py-3 bg-card border-t border-border flex-wrap gap-3',
        className,
      )}
    >
      {/* Right (RTL start): range status — عرض X إلى Y من إجمالي Z سجل */}
      <div className="text-xs text-muted-foreground tnum whitespace-nowrap order-1">
        عرض{' '}
        <span className="font-semibold text-foreground">{fmt(from)}</span>
        {' '}إلى{' '}
        <span className="font-semibold text-foreground">{fmt(to)}</span>
        {' '}من إجمالي{' '}
        <span className="font-semibold text-foreground">{fmt(totalItems)}</span>
        {' '}{itemLabel}
      </div>

      {/* Center: prev / numbered pages / next */}
      <div className="flex items-center gap-1 order-3 sm:order-2 mx-auto">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 px-2.5 text-xs"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          aria-label="الصفحة السابقة"
        >
          <ChevronRight className="size-3.5" />
          <span className="hidden sm:inline">السابق</span>
        </Button>

        {pageList.map((p, i) =>
          p === 'ellipsis' ? (
            <span
              key={`ellipsis-${i}`}
              className="size-8 flex items-center justify-center text-xs text-muted-foreground select-none"
              aria-hidden="true"
            >
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              aria-label={`صفحة ${p}`}
              aria-current={p === currentPage ? 'page' : undefined}
              className={cn(
                'size-8 shrink-0 rounded-md border text-xs font-semibold tnum transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                p === currentPage
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-card text-foreground border-border hover:bg-muted/60',
              )}
            >
              {fmt(p)}
            </button>
          ),
        )}

        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 px-2.5 text-xs"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          aria-label="الصفحة التالية"
        >
          <span className="hidden sm:inline">التالي</span>
          <ChevronLeft className="size-3.5" />
        </Button>
      </div>

      {/* Left (RTL end): rows per page */}
      {onPageSizeChange && (
        <div className="flex items-center gap-2 order-2 sm:order-3">
          <span className="hidden md:inline text-xs text-muted-foreground whitespace-nowrap">
            عدد السجلات بالصفحة
          </span>
          <span className="md:hidden text-xs text-muted-foreground whitespace-nowrap">الصفحة</span>
          <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
            <SelectTrigger className="w-[74px] h-8 text-xs" aria-label="عدد السجلات بالصفحة">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)} className="text-xs">
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}
