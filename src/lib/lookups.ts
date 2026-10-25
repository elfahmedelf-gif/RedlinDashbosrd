'use client'

import useSWR from 'swr'
import { fetcher } from './api'

export interface LookupItem {
  id: string
  category: string
  key: string
  label: string
  labelEn: string | null
  tone: string | null
  icon: string | null
  active: boolean
  sortOrder: number
  isSystem: boolean
}

// Map of cache keys per category — single shared fetch
const cache = new Map<string, LookupItem[]>()

// useLookup(category) — returns active items for the category, sorted
export function useLookup(category: string | null): {
  items: LookupItem[]
  loading: boolean
  error: any
  mutate: () => void
} {
  const { data, error, isLoading, mutate } = useSWR<{ byCategory: Record<string, LookupItem[]> }>(
    category ? `/api/lookups?category=${encodeURIComponent(category)}` : null,
    fetcher,
    {
      refreshInterval: 60000,
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    },
  )

  const items = (category && data?.byCategory?.[category])
    ? data.byCategory[category].filter((i) => i.active).sort((a, b) => a.sortOrder - b.sortOrder)
    : []

  return { items, loading: isLoading, error, mutate }
}

// useAllLookups() — returns all items grouped by category (for the management page)
export function useAllLookups(): {
  byCategory: Record<string, LookupItem[]>
  all: LookupItem[]
  loading: boolean
  mutate: () => void
} {
  const { data, error, isLoading, mutate } = useSWR<{ byCategory: Record<string, LookupItem[]>; items: LookupItem[] }>(
    '/api/lookups',
    fetcher,
    { refreshInterval: 60000, revalidateOnFocus: false },
  )
  return {
    byCategory: data?.byCategory ?? {},
    all: data?.items ?? [],
    loading: isLoading,
    mutate,
  }
}

// Helper: get label for a key in a category (returns the key if not found)
export function lookupLabel(items: LookupItem[], key: string | null | undefined): string {
  if (!key) return '-'
  const item = items.find((i) => i.key === key)
  return item?.label ?? key
}

// Helper: get tone for a key in a category
export function lookupTone(items: LookupItem[], key: string | null | undefined): string {
  if (!key) return ''
  const item = items.find((i) => i.key === key)
  return item?.tone ?? ''
}

// Categories metadata (for management UI)
export const LOOKUP_CATEGORIES: { key: string; label: string; desc: string; icon: string }[] = [
  { key: 'shipment_status', label: 'حالات الشحنات', desc: 'الحالات المتاحة للشحنة (جديدة، قيد التجهيز، مسلّمة...)', icon: 'PackageSearch' },
  { key: 'collection_status', label: 'حالات التحصيل', desc: 'حالة تحصيل قيمة الشحنة من العميل', icon: 'Banknote' },
  { key: 'load_type', label: 'أنواع الحمولة', desc: 'أحجام الشاحنات (1.5 طن، 3 طن، 6 متر...)', icon: 'Truck' },
  { key: 'movement_type', label: 'أنواع حركة المخزون', desc: 'استلام، صرف، تحويل، مرتجع، تسوية...', icon: 'ArrowRightLeft' },
  { key: 'account_type', label: 'أنواع الحسابات', desc: 'أصول، خصوم، حقوق ملكية، إيرادات، مصروفات', icon: 'BookOpen' },
  { key: 'voucher_type', label: 'أنواع السندات', desc: 'سند قبض، سند صرف', icon: 'Landmark' },
  { key: 'opening_balance_type', label: 'نوع الرصيد الافتتاحي', desc: 'مدين أو دائن', icon: 'Scale' },
  { key: 'party_type', label: 'أنواع الأطراف', desc: 'عميل، مقاول/ناقل، مورد', icon: 'Users' },
]
