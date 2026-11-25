# Task 3 — Frontend: Operational Vouchers Module (`vouchers-ops.tsx` + `voucher-print-ops.tsx`)

**Agent**: Frontend agent (Z.ai Code)
**Task ID**: 3
**Status**: ✅ Completed

## Files created (exactly 2)
1. `/home/z/my-project/src/components/dashboard/modules/vouchers-ops.tsx` — exports `VouchersModule`
2. `/home/z/my-project/src/components/dashboard/voucher-print-ops.tsx` — exports `VoucherOpsPrint`

## What was implemented

### `VouchersModule` (vouchers-ops.tsx)
A full operational-vouchers UI matching the spec, organized into:

1. **Stats dashboard row** — 8 KPI cards in `grid-cols-2 lg:grid-cols-4 gap-2.5`, exactly matching accounting.tsx density (`Card py-0 gap-0`, `CardContent p-3.5`, icon `size-9 rounded-lg` + `size-4.5` icon, `text-xl font-extrabold tnum leading-none`, `text-[11px] text-muted-foreground`):
   - إجمالي الأذونات (slate / Landmark)
   - بانتظار الاعتماد (amber / Clock)
   - مكتملة (emerald / CheckCircle2)
   - مسودات (slate / FileText)
   - قيد التنفيذ (indigo / Loader2)
   - محصّلات (emerald / Banknote + "ج.م")
   - مصروفات (rose / BanknoteArrowDown + "ج.م")
   - شحنات مرتبطة (sky / Link2)

2. **By-category mini-distribution** — small badges using `VOUCHER_CATEGORIES` colors, showing counts per category from `stats.byType`.

3. **Filter bar** — left group: `Landmark` icon, count text, type `<Select>` grouped by 4 categories (optgroups via `SelectGroup`/`SelectLabel`), status `<Select>` listing the 7 `VOUCHER_STATES`, two date inputs (from/to), and a "مسح الفلاتر" button when filters active. Right group: export `<Button variant="outline">` (requires `vouchers.export`), new `<Button>` (requires `vouchers.create`).

4. **DataTable** — `minW={1100}` with 9 columns: voucherNo (mono bold center), type (Badge with typeColor center), status (Badge with statusColor center), date (hideInCard), route (src ← dst), party/courier/employee priority, items count badge, total value, actions (print/delete on draft|cancelled). Row click opens detail dialog. `searchFn` matches voucherNo/party/notes/typeLabel/courier/employee. `searchPlaceholder` "بحث برقم الإذن/الطرف/البيان...".

5. **Create dialog** (`max-w-3xl`, scrollable):
   - Type `<Select>` grouped by category.
   - Conditional fields driven by `tdef.requiresX` flags: employee (from `/api/users`), courier (parties filtered `isContractor`), party (filtered `isCustomer` for collection, all for others), source/dest branch (from `/api/branches`), amount + accountName (only when `isFinancial`).
   - `ShipmentPicker` shown when `tdef.requiresShipments`. Shows a hint listing `preStatuses`, a search Input + "بحث" button that fetches `/api/shipments?q=...&pageSize=30`, a dropdown of results (disabled when added or wrong status), and a list of added shipments with remove buttons + total.
   - notes Textarea.
   - Validation collecting errors and showing inline. On submit → `apiPost('/api/vouchers', {…, userName})` → toast "تم إنشاء الإذن" with voucherNo → closes dialog, `mutate()` list + stats.
   - Footer: إلغاء + حفظ كمسودة.

6. **Detail / lifecycle dialog** (`max-w-4xl`, scrollable):
   - Header: voucherNo (mono) + type Badge + status Badge.
   - Info grid (`grid-cols-2 sm:grid-cols-3`): 12 DetailItems — التاريخ (fmtDateTime createdAt), آخر تحديث, أنشأه, الموظف, المندوب, الطرف, الفرع المصدر, فرع الاستلام, الحساب, القيمة, القيد (mono), عدد الشحنات.
   - Notes block if present.
   - Separator.
   - الشحنات المرتبطة table (when `requiresShipments`): columns shipmentNo (mono), status (Badge using merged `shipmentStatusMap` from `/api/lookups?category=shipment_status`), destination, recipientName, freightTotal, and a remove button (when draft + `vouchers.edit`).
   - Inline `ShipmentPicker` to add shipments (when draft + `vouchers.edit`) calling `POST /:id/items`.
   - سجل الاعتماد timeline (approvalLog) — vertical list with colored dot per action (`ACTION_DOT`), label via `ACTION_LABELS` (submit→رفع, approve→اعتماد, etc.), userName, fmtDateTime(at), notes.
   - Action notes input (for approve/reject/cancel/complete) shown only when not completed/cancelled.
   - Action buttons (footer) per status & permission:
     - draft: [رفع للاعتماد submit], [تعديل edit → opens edit dialog], [حذف delete], [طباعة]
     - pending: [اعتماد approve], [رفض reject], [إلغاء cancel], [طباعة]
     - approved: [بدء التنفيذ execute], [إلغاء cancel], [طباعة]
     - in_progress: [إكمال complete], [إلغاء cancel], [طباعة]
     - rejected: [إعادة كمسودة resubmit], [طباعة]
     - cancelled: [حذف delete], [طباعة]
     - completed: [طباعة]
   - All transitions call `POST /:id/transition {action, notes, userName}`. Errors (e.g., segregation-of-duties) surfaced via toast.
   - On success, refreshes list + stats + detail.

7. **Edit dialog** (`max-w-2xl`) — separate dialog opened by "تعديل" in detail. Loads the voucher, shows editable fields (employee/courier/party/source-dest branch/amount/accountName/notes). Submits via `apiPatch('/api/vouchers/:id', {…})` (draft|rejected only, enforced server-side).

8. **Export** — `exportToCSV` with columns: رقم الإذن / النوع / الحالة / التاريخ / الفرع المصدر / فرع الاستلام / الموظف / المندوب / الطرف / عدد الشحنات / القيمة / البيان. Requires `vouchers.export`.

9. **Print** — clicking the print button (in row actions OR in detail dialog) sets `printVoucher` state; renders `<VoucherOpsPrint voucher={printVoucher} open={!!printVoucher} onOpenChange={...} />`.

### `VoucherOpsPrint` (voucher-print-ops.tsx)
- Props: `{ voucher, open, onOpenChange }`.
- Dialog `max-w-3xl` with class `voucher-ops-dialog` + `aria-describedby={undefined}`.
- Injects print CSS via `<style dangerouslySetInnerHTML>` (pattern copied from chart.tsx). Print CSS mirrors the existing voucher-dialog/waybill-dialog print rules, scoped to `.voucher-ops-dialog`, with `@page { size: A4 portrait; margin: 10mm; }`.
- Header: "شركة الشحن الدولية" + voucherNo (mono) + date + status badge.
- Title strip with type label + category title (operational/financial/inventory/special).
- Inventory placeholder box.
- Info grid (2 cols): 8 InfoRows — الفرع المصدر / فرع الاستلام / الموظف / المندوب / الطرف / الحساب / القيمة الإجمالية / القيد المحاسبي.
- Financial prominent amount box when `isFinancial`.
- Shipments table when `requiresShipments && items.length` (shipmentNo, status badge, destination, recipientName, freightTotal, totals row).
- Notes block.
- Approval log summary (compact list).
- Signature lines (4): أنشأه / اعتمده / نفّذ / استلم — populated from `approvalLog` when found, else dotted line.
- Footer actions: "إغلاق" + "طباعة الإذن" (window.print()).

## Sub-components defined inside vouchers-ops.tsx
- `ShipmentPicker({ preStatuses, excludeIds, onAdd, onRemove, selected, emptyHint })` — reusable for both create and detail dialogs.
- `StatCard({ icon, color, value, label })` — uses a static `STAT_COLORS` map to avoid Tailwind v4 dynamic-class pitfalls.
- `DetailItem({ label, value, mono })` — small bordered label/value cell.

## API endpoints consumed
- `GET /api/vouchers?type=&status=&from=&to=` → `{ items, total }` (filtered list)
- `GET /api/vouchers/stats` → KPI numbers
- `GET /api/vouchers/:id` → full voucher (detail dialog)
- `GET /api/shipments?q=&pageSize=30` → ShipmentPicker search
- `GET /api/users` → employee picker
- `GET /api/parties` → courier/party pickers (filtered client-side by `isContractor`/`isCustomer`)
- `GET /api/branches` → branch pickers
- `GET /api/lookups?category=shipment_status` → merged into shipmentStatusMap (covers the new opStatus keys: received/loaded/in_transit/arrived/assigned_courier/received_returned/written_off)
- `POST /api/vouchers` → create
- `PATCH /api/vouchers/:id` → edit (draft/rejected only)
- `DELETE /api/vouchers/:id` → delete (draft/cancelled only)
- `POST /api/vouchers/:id/items` → add shipment (draft only)
- `DELETE /api/vouchers/:id/items/:itemId` → remove shipment (draft only)
- `POST /api/vouchers/:id/transition` → submit/approve/reject/execute/complete/cancel/resubmit

## Permissions checked (via `useAuth().has`)
- `vouchers.view` — implicit (module is shown; sidebar wires it)
- `vouchers.create` — "إذن جديد" button
- `vouchers.edit` — "تعديل" + add/remove items in draft + "إعادة كمسودة" on rejected
- `vouchers.delete` — delete in row actions (draft/cancelled) + "حذف" in detail (draft/cancelled)
- `vouchers.submit` — "رفع للاعتماد"
- `vouchers.approve` — "اعتماد"
- `vouchers.reject` — "رفض"
- `vouchers.execute` — "بدء التنفيذ" + "إكمال"
- `vouchers.cancel` — "إلغاء"
- `vouchers.print` — print button (row + detail)
- `vouchers.export` — export button

## Self-verification performed
- `bunx tsc --noEmit` — no TypeScript errors in either new file (errors elsewhere are pre-existing in scripts/, examples/, skills/, src/lib/api.ts, src/lib/mock-data.ts).
- Dev log shows `✓ Compiled` continuously; no new compile errors.
- Did not run `bun run build` or `bun run lint` (per task instructions).

## Assumptions
- The existing `VouchersModule` export in `accounting.tsx` remains as-is; the parent agent will swap `page.tsx` to import the new `VouchersModule` from `vouchers-ops.tsx`.
- The existing `voucher-dialog` and `waybill-dialog` print CSS in `globals.css` is not reused — the new `VoucherOpsPrint` injects its own scoped `@media print` block via `<style dangerouslySetInnerHTML>` keyed on `.voucher-ops-dialog`, with `@page { size: A4 portrait; margin: 10mm; }`. This keeps it self-contained and avoids modifying `globals.css`.
- `print-hidden` (without Tailwind's `:` colon) is used as a custom class for the dialog's action buttons row, hidden by the injected print CSS.
- The 4 new shipment statuses (received/loaded/in_transit/arrived/assigned_courier/received_returned/written_off) are merged from `/api/lookups?category=shipment_status` with a hardcoded fallback base map.
- `me?.username || 'admin'` is passed as `userName` for all mutations.
- Date filters pass through query params (`from`/`to`) — handled by `api.ts` `inRange()`.

## Imports adjusted after reading source
- The spec listed imports including `User`, `Building2`, `Check`, `ArrowRight`, `CardHeader`, `CardTitle`, `CardDescription` — these were trimmed from `vouchers-ops.tsx` because they are not used there. `User` and `Building2` ARE used in `voucher-print-ops.tsx`.
- `fmtMoney` was not needed — `fmtNum(n)` (which is also what `fmtMoney` calls internally) is used directly with manual ` ج.م` suffix.
- `SelectGroup` and `SelectLabel` are confirmed exported from `@/components/ui/select` and used for grouped category optgroups.
- `Separator` from `@/components/ui/separator` (Radix SeparatorPrimitive) — used as visual divider in detail dialog.
- `useToast` returns `{ toast }` — confirmed via `src/hooks/use-toast.ts`.
- `useAuth()` returns `{ user, loading, login, logout, has }` — used `has` and `user` (`user.username`).
- `cn` from `@/lib/utils` — used to merge conditional class names.
- shadcn `<style dangerouslySetInnerHTML>` pattern copied from existing `chart.tsx` (line 82-89) rather than `<style>{css}</style>` to avoid React 19 hydration warnings.

## Notes for parent agent wiring
- To enable the new module in the running app, `page.tsx` line 16 and 169 need updating:
  - Change `import { …, VouchersModule } from '@/components/dashboard/modules/accounting'` → drop `VouchersModule`.
  - Add `import { VouchersModule } from '@/components/dashboard/modules/vouchers-ops'`.
  - The `{tab === 'vouchers' && <VouchersModule />}` line stays the same and will render the new module.
- Optionally the sidebar can add a separate tab for the new operational vouchers vs the financial ones, depending on UX decision.
