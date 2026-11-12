// ============================================================================
// كتالوج الأذونات التشغيلية — مصدر واحد مشترك للواجهة والخادم
// (16 نوعًا) + دورة الحياة (7 حالات) + جدول الانتقالات
// ============================================================================

export interface VoucherTypeDef {
  code: string
  label: string
  labelEn: string
  category: 'operational' | 'financial' | 'inventory' | 'special'
  prefix: string
  requiresCourier: boolean
  requiresDestBranch: boolean
  requiresParty: boolean
  requiresEmployee: boolean
  isFinancial: boolean
  requiresShipments: boolean
  preStatuses: string[] | null
  postStatus: string | null
  color: string
  icon: string
}

export const VOUCHER_TYPES: VoucherTypeDef[] = [
  { code: 'receiving', label: 'إذن استلام شحنات', labelEn: 'Receiving Voucher', category: 'operational', prefix: 'RCV', requiresCourier: false, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: ['new','preparing'], postStatus: 'received', color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300', icon: 'PackageCheck' },
  { code: 'loading', label: 'إذن تحميل شحنات', labelEn: 'Loading Voucher', category: 'operational', prefix: 'LDG', requiresCourier: false, requiresDestBranch: true, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: ['received','preparing'], postStatus: 'loaded', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', icon: 'Truck' },
  { code: 'unloading', label: 'إذن تفريغ شحنات', labelEn: 'Unloading Voucher', category: 'operational', prefix: 'UNL', requiresCourier: false, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: ['in_transit','loaded'], postStatus: 'arrived', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', icon: 'PackageMinus' },
  { code: 'branch_transfer', label: 'إذن تحويل بين الفروع', labelEn: 'Branch Transfer', category: 'operational', prefix: 'TRN', requiresCourier: false, requiresDestBranch: true, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: ['received','loaded'], postStatus: 'in_transit', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300', icon: 'ArrowRightLeft' },
  { code: 'courier_assignment', label: 'إذن تسليم لمندوب', labelEn: 'Courier Assignment', category: 'operational', prefix: 'CRA', requiresCourier: true, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: ['arrived','received','preparing'], postStatus: 'assigned_courier', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300', icon: 'UserCheck' },
  { code: 'courier_receiving', label: 'إذن استلام من مندوب', labelEn: 'Courier Receiving', category: 'operational', prefix: 'CRV', requiresCourier: true, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: ['assigned_courier','out_for_delivery'], postStatus: 'received', color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300', icon: 'Hand' },
  { code: 'delivery', label: 'إذن تسليم شحنات', labelEn: 'Delivery Voucher', category: 'operational', prefix: 'DLV', requiresCourier: true, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: ['assigned_courier','out_for_delivery'], postStatus: 'delivered', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', icon: 'CheckCircle2' },
  { code: 'return', label: 'إذن مرتجع شحنات', labelEn: 'Return Voucher', category: 'operational', prefix: 'RET', requiresCourier: true, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: ['delivered','out_for_delivery','failed','postponed','assigned_courier'], postStatus: 'returned', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300', icon: 'Undo2' },
  { code: 'returned_receiving', label: 'إذن استلام مرتجعات', labelEn: 'Returned Receiving', category: 'operational', prefix: 'RTR', requiresCourier: false, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: ['returned'], postStatus: 'received_returned', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', icon: 'Undo2' },
  { code: 'collection', label: 'إذن تحصيل نقدية', labelEn: 'Collection Voucher', category: 'financial', prefix: 'COL', requiresCourier: false, requiresDestBranch: false, requiresParty: true, requiresEmployee: true, isFinancial: true, requiresShipments: false, preStatuses: null, postStatus: null, color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', icon: 'Banknote' },
  { code: 'cash_deposit', label: 'إذن توريد خزينة', labelEn: 'Cash Deposit', category: 'financial', prefix: 'DEP', requiresCourier: false, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: true, requiresShipments: false, preStatuses: null, postStatus: null, color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300', icon: 'Landmark' },
  { code: 'cash_disbursement', label: 'إذن صرف نقدية', labelEn: 'Cash Disbursement', category: 'financial', prefix: 'CSH', requiresCourier: false, requiresDestBranch: false, requiresParty: true, requiresEmployee: true, isFinancial: true, requiresShipments: false, preStatuses: null, postStatus: null, color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300', icon: 'BanknoteArrowDown' },
  { code: 'courier_settlement', label: 'إذن تسوية عهدة مندوب', labelEn: 'Courier Settlement', category: 'financial', prefix: 'STL', requiresCourier: true, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: true, requiresShipments: false, preStatuses: null, postStatus: null, color: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300', icon: 'Scale' },
  { code: 'inventory_count', label: 'إذن جرد مخزون', labelEn: 'Inventory Count', category: 'inventory', prefix: 'INV', requiresCourier: false, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: false, preStatuses: null, postStatus: null, color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300', icon: 'ClipboardCheck' },
  { code: 'waybill_amendment', label: 'إذن تعديل بوليصة', labelEn: 'Waybill Amendment', category: 'special', prefix: 'AMD', requiresCourier: false, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: null, postStatus: null, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', icon: 'FileEdit' },
  { code: 'write_off', label: 'إذن شطب/إتلاف شحنة', labelEn: 'Write-off Voucher', category: 'special', prefix: 'WOF', requiresCourier: false, requiresDestBranch: false, requiresParty: false, requiresEmployee: true, isFinancial: false, requiresShipments: true, preStatuses: null, postStatus: 'written_off', color: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300', icon: 'Trash2' },
]

export const VOUCHER_STATES = [
  { key: 'draft', label: 'مسودة', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  { key: 'pending', label: 'بانتظار الاعتماد', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  { key: 'approved', label: 'معتمد', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  { key: 'in_progress', label: 'قيد التنفيذ', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
  { key: 'completed', label: 'مكتمل', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  { key: 'rejected', label: 'مرفوض', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  { key: 'cancelled', label: 'ملغي', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
] as const

export const VOUCHER_CATEGORIES = [
  { key: 'operational', label: 'أذونات تشغيلية', color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  { key: 'financial', label: 'أذونات مالية', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  { key: 'inventory', label: 'أذونات جرد', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
  { key: 'special', label: 'أذونات خاصة', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
] as const

/** حالات الإذن التي تُعتبر "نشطة" لفحص تعارض ربط الشحنات (منع تكرار نفس العملية) */
export const ACTIVE_VOUCHER_STATUSES = ['draft', 'pending', 'approved', 'in_progress']

export const TRANSITIONS: Record<string, { action: string; to: string; perm: string }[]> = {
  draft: [
    { action: 'submit', to: 'pending', perm: 'vouchers.submit' },
    { action: 'cancel', to: 'cancelled', perm: 'vouchers.cancel' },
  ],
  pending: [
    { action: 'approve', to: 'approved', perm: 'vouchers.approve' },
    { action: 'reject', to: 'rejected', perm: 'vouchers.reject' },
    { action: 'cancel', to: 'cancelled', perm: 'vouchers.cancel' },
  ],
  rejected: [
    { action: 'resubmit', to: 'draft', perm: 'vouchers.edit' },
  ],
  approved: [
    { action: 'execute', to: 'in_progress', perm: 'vouchers.execute' },
    { action: 'cancel', to: 'cancelled', perm: 'vouchers.cancel' },
  ],
  in_progress: [
    { action: 'complete', to: 'completed', perm: 'vouchers.execute' },
    { action: 'cancel', to: 'cancelled', perm: 'vouchers.cancel' },
  ],
  /** مكتمل: قابل للإلغاء فقط للأذونات المالية (قيد عكسي) — يُفرض على الخادم */
  completed: [
    { action: 'cancel', to: 'cancelled', perm: 'vouchers.approve' },
  ],
  cancelled: [],
}

export function voucherActionLabel(action: string): string {
  const map: Record<string, string> = { submit: 'رفع', approve: 'اعتماد', reject: 'رفض', execute: 'تنفيذ', complete: 'إكمال', cancel: 'إلغاء', resubmit: 'إعادة', edit: 'تعديل', create: 'إنشاء', add_item: 'إضافة شحنة', remove_item: 'إزالة شحنة', mark_received: 'تسليم مرتجع' }
  return map[action] ?? action
}

export function voucherTypeDef(code: string): VoucherTypeDef | undefined {
  return VOUCHER_TYPES.find((t) => t.code === code)
}
