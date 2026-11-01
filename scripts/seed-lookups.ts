// Seed LookupItem table with default dropdown values
// Run: bun run scripts/seed-lookups.ts
import { db } from '../src/lib/db'

const ITEMS: { category: string; key: string; label: string; labelEn?: string; tone?: string; sortOrder: number; isSystem: boolean }[] = [
  // ---- shipment_status ----
  { category: 'shipment_status', key: 'new', label: 'جديدة', labelEn: 'New', tone: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300', sortOrder: 1, isSystem: true },
  { category: 'shipment_status', key: 'preparing', label: 'قيد التجهيز', labelEn: 'Preparing', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', sortOrder: 2, isSystem: true },
  { category: 'shipment_status', key: 'out_for_delivery', label: 'خرجت للتوصيل', labelEn: 'Out for Delivery', tone: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300', sortOrder: 3, isSystem: true },
  { category: 'shipment_status', key: 'delivered', label: 'تم التسليم', labelEn: 'Delivered', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', sortOrder: 4, isSystem: true },
  { category: 'shipment_status', key: 'postponed', label: 'مؤجلة', labelEn: 'Postponed', tone: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', sortOrder: 5, isSystem: true },
  { category: 'shipment_status', key: 'failed', label: 'فشل التسليم', labelEn: 'Failed', tone: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300', sortOrder: 6, isSystem: true },
  { category: 'shipment_status', key: 'returned', label: 'مرتجعة', labelEn: 'Returned', tone: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', sortOrder: 7, isSystem: true },
  { category: 'shipment_status', key: 'cancelled', label: 'ملغاة', labelEn: 'Cancelled', tone: 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-300', sortOrder: 8, isSystem: true },

  // ---- collection_status ----
  { category: 'collection_status', key: 'uncollected', label: 'غير محصّلة', tone: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300', sortOrder: 1, isSystem: true },
  { category: 'collection_status', key: 'partial', label: 'تحصيل جزئي', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', sortOrder: 2, isSystem: true },
  { category: 'collection_status', key: 'collected', label: 'محصّلة', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', sortOrder: 3, isSystem: true },

  // ---- load_type ----
  { category: 'load_type', key: '1.5TON', label: '1.5 طن', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', sortOrder: 1, isSystem: true },
  { category: 'load_type', key: '3TON', label: '3 طن', tone: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300', sortOrder: 2, isSystem: true },
  { category: 'load_type', key: '6M', label: '6 متر', tone: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300', sortOrder: 3, isSystem: true },

  // ---- movement_type ----
  { category: 'movement_type', key: 'opening', label: 'رصيد افتتاحي', tone: 'bg-sky-100 text-sky-700', sortOrder: 1, isSystem: true },
  { category: 'movement_type', key: 'receipt', label: 'استلام مشتريات', tone: 'bg-emerald-100 text-emerald-700', sortOrder: 2, isSystem: true },
  { category: 'movement_type', key: 'issue', label: 'صرف', tone: 'bg-amber-100 text-amber-700', sortOrder: 3, isSystem: true },
  { category: 'movement_type', key: 'transfer', label: 'تحويل', tone: 'bg-indigo-100 text-indigo-700', sortOrder: 4, isSystem: true },
  { category: 'movement_type', key: 'return', label: 'مرتجع', tone: 'bg-purple-100 text-purple-700', sortOrder: 5, isSystem: true },
  { category: 'movement_type', key: 'adjustment', label: 'تسوية جرد', tone: 'bg-orange-100 text-orange-700', sortOrder: 6, isSystem: true },
  { category: 'movement_type', key: 'damage', label: 'تالف', tone: 'bg-rose-100 text-rose-700', sortOrder: 7, isSystem: true },

  // ---- account_type ----
  { category: 'account_type', key: 'asset', label: 'أصول', tone: 'bg-emerald-100 text-emerald-700', sortOrder: 1, isSystem: true },
  { category: 'account_type', key: 'liability', label: 'خصوم', tone: 'bg-rose-100 text-rose-700', sortOrder: 2, isSystem: true },
  { category: 'account_type', key: 'equity', label: 'حقوق ملكية', tone: 'bg-purple-100 text-purple-700', sortOrder: 3, isSystem: true },
  { category: 'account_type', key: 'revenue', label: 'إيرادات', tone: 'bg-sky-100 text-sky-700', sortOrder: 4, isSystem: true },
  { category: 'account_type', key: 'expense', label: 'مصروفات', tone: 'bg-amber-100 text-amber-700', sortOrder: 5, isSystem: true },

  // ---- voucher_type ----
  { category: 'voucher_type', key: 'receipt', label: 'سند قبض (تحصيل)', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', sortOrder: 1, isSystem: true },
  { category: 'voucher_type', key: 'payment', label: 'سند صرف (سداد)', tone: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300', sortOrder: 2, isSystem: true },

  // ---- opening_balance_type ----
  { category: 'opening_balance_type', key: 'debit', label: 'مدين', tone: 'bg-sky-100 text-sky-700', sortOrder: 1, isSystem: true },
  { category: 'opening_balance_type', key: 'credit', label: 'دائن', tone: 'bg-amber-100 text-amber-700', sortOrder: 2, isSystem: true },

  // ---- party_type ----
  { category: 'party_type', key: 'customer', label: 'عميل', tone: 'bg-teal-100 text-teal-700', sortOrder: 1, isSystem: true },
  { category: 'party_type', key: 'contractor', label: 'مقاول/ناقل', tone: 'bg-indigo-100 text-indigo-700', sortOrder: 2, isSystem: true },
  { category: 'party_type', key: 'supplier', label: 'مورد', tone: 'bg-amber-100 text-amber-700', sortOrder: 3, isSystem: true },
]

async function main() {
  console.log(`Seeding ${ITEMS.length} lookup items...`)
  await db.lookupItem.deleteMany({})
  for (const item of ITEMS) {
    await db.lookupItem.create({ data: item })
  }
  const counts = ITEMS.reduce((acc, i) => {
    acc[i.category] = (acc[i.category] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  console.log('Seeded by category:', counts)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
