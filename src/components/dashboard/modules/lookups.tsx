'use client'

import * as React from 'react'
import useSWR from 'swr'
import {
  Plus, Pencil, Trash2, ListChecks, Check, X, ArrowUp, ArrowDown,
  PackageSearch, Banknote, Truck, ArrowRightLeft, BookOpen, Landmark,
  Scale, Users, Power, AlertCircle, Loader2,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { useAllLookups, LOOKUP_CATEGORIES, type LookupItem } from '@/lib/lookups'
import { fetcher, apiPost, apiPatch, apiDelete } from '@/lib/api'
import { useToast } from '@/hooks/use-toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  PackageSearch, Banknote, Truck, ArrowRightLeft, BookOpen, Landmark, Scale, Users,
}

// Tones palette for new items
const TONE_PALETTE = [
  { value: '', label: 'بدون لون' },
  { value: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300', label: 'أزرق سماوي' },
  { value: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', label: 'أخضر' },
  { value: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', label: 'كهرماني' },
  { value: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300', label: 'وردي' },
  { value: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300', label: 'بنفسجي' },
  { value: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300', label: 'نيلي' },
  { value: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300', label: 'فيروزي' },
  { value: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', label: 'برتقالي' },
  { value: 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-300', label: 'رمادي' },
]

export function LookupsModule() {
  const { toast } = useToast()
  const { confirmDelete } = useConfirm()
  const { byCategory, all, loading, mutate } = useAllLookups()
  const [activeCategory, setActiveCategory] = React.useState<string>('shipment_status')
  const [editing, setEditing] = React.useState<LookupItem | null>(null)
  const [open, setOpen] = React.useState(false)
  const [v, setV] = React.useState<any>({ key: '', label: '', labelEn: '', tone: '', sortOrder: 0, active: true })

  React.useEffect(() => {
    if (open) {
      if (editing) {
        setV({ key: editing.key, label: editing.label, labelEn: editing.labelEn || '', tone: editing.tone || '', sortOrder: editing.sortOrder, active: editing.active })
      } else {
        setV({ key: '', label: '', labelEn: '', tone: '', sortOrder: (byCategory[activeCategory]?.length ?? 0) + 1, active: true })
      }
    }
  }, [open, editing, activeCategory, byCategory])

  const items = byCategory[activeCategory] ?? []
  const categoryMeta = LOOKUP_CATEGORIES.find((c) => c.key === activeCategory)

  const submit = async () => {
    if (!v.label.trim() || !v.key.trim()) {
      toast({ title: 'المفتاح والاسم مطلوبان', variant: 'destructive' })
      return
    }
    try {
      if (editing) {
        await apiPatch(`/api/lookups/${editing.id}`, { ...v, userName: 'admin' })
        toast({ title: 'تم تحديث العنصر' })
      } else {
        await apiPost('/api/lookups', { ...v, category: activeCategory, userName: 'admin' })
        toast({ title: 'تمت إضافة العنصر' })
      }
      setOpen(false); setEditing(null); mutate()
    } catch (e: any) {
      toast({ title: 'خطأ', description: e.message, variant: 'destructive' })
    }
  }

  const del = async (item: LookupItem) => {
    const ok = await confirmDelete({
      title: 'حذف العنصر',
      message: `حذف «${item.label}»؟ لا يمكن التراجع.`,
    })
    if (!ok) return
    try {
      await apiDelete(`/api/lookups/${item.id}`)
      mutate(); toast({ title: 'تم الحذف' })
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  const toggleActive = async (item: LookupItem) => {
    try {
      await apiPatch(`/api/lookups/${item.id}`, { active: !item.active, userName: 'admin' })
      mutate()
      toast({ title: item.active ? 'تم التعطيل' : 'تم التفعيل' })
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  const move = async (item: LookupItem, dir: -1 | 1) => {
    const arr = [...items].sort((a, b) => a.sortOrder - b.sortOrder)
    const idx = arr.findIndex((i) => i.id === item.id)
    const swap = arr[idx + dir]
    if (!swap) return
    try {
      await Promise.all([
        apiPatch(`/api/lookups/${item.id}`, { sortOrder: swap.sortOrder, userName: 'admin' }),
        apiPatch(`/api/lookups/${swap.id}`, { sortOrder: item.sortOrder, userName: 'admin' }),
      ])
      mutate()
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
  }

  return (
    <div className="space-y-4">
      {/* Header banner */}
      <Card className="overflow-hidden print:hidden">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center size-11 rounded-xl bg-primary/10 text-primary shrink-0">
              <ListChecks className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-base">إدارة القوائم المنسدلة</h3>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                تتحكم في كل القيم التي تظهر في القوائم المنسدلة عبر كل الوحدات (حالات الشحنات، أنواع الحمولة، حركات المخزون، أنواع الحسابات...). يمكنك إضافة عناصر جديدة، تعديلها، حذفها، تعطيلها، أو إعادة ترتيبها.
              </p>
            </div>
            <div className="text-xs text-muted-foreground tnum shrink-0 hidden sm:block">
              <b className="text-foreground">{all.length}</b> عنصر
              <br />في <b className="text-foreground">{Object.keys(byCategory).length}</b> فئة
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 print:hidden">
        {/* Categories list (left) — horizontal scroll on mobile, vertical on desktop */}
        <Card className="lg:col-span-1 h-fit overflow-hidden">
          <CardHeader className="pb-2 hidden lg:block">
            <CardTitle className="text-sm">الفئات</CardTitle>
            <CardDescription className="text-xs">{LOOKUP_CATEGORIES.length} فئة من القوائم</CardDescription>
          </CardHeader>
          <CardContent className="p-2 lg:space-y-0.5">
            {/* On mobile, render as horizontal scroll */}
            <div className="flex lg:flex-col gap-1.5 lg:gap-0.5 overflow-x-auto no-scrollbar pb-1 lg:pb-0 -mx-1 px-1">
              {loading && !items.length ? (
                <div className="p-2 space-y-1.5 w-full">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : (
              LOOKUP_CATEGORIES.map((c) => {
                const Icon = CATEGORY_ICONS[c.icon] || ListChecks
                const count = byCategory[c.key]?.length ?? 0
                const isActive = activeCategory === c.key
                return (
                  <button
                    key={c.key}
                    onClick={() => setActiveCategory(c.key)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all shrink-0 lg:shrink',
                      isActive ? 'nav-item-active shadow-md' : 'hover:bg-sidebar-accent text-sidebar-foreground/90',
                    )}
                  >
                    <Icon className={cn('size-4 shrink-0', isActive ? '' : 'text-muted-foreground')} />
                    <span className="flex-1 text-right font-medium leading-tight">{c.label}</span>
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-full tnum font-semibold',
                      isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-secondary text-secondary-foreground',
                    )}>{count}</span>
                  </button>
                )
              })
            )}
            </div>
          </CardContent>
        </Card>

        {/* Items of selected category (right) */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <CardTitle className="text-base flex items-center gap-2">
                  {(() => {
                    const Icon = CATEGORY_ICONS[categoryMeta?.icon || ''] || ListChecks
                    return <Icon className="size-4.5 text-primary" />
                  })()}
                  {categoryMeta?.label}
                </CardTitle>
                <CardDescription className="text-xs mt-1">{categoryMeta?.desc}</CardDescription>
              </div>
              <Button onClick={() => { setEditing(null); setOpen(true) }} size="sm" className="shrink-0">
                <Plus className="size-4" /> <span className="hidden sm:inline">إضافة عنصر</span><span className="sm:hidden">عنصر</span>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading && !items.length ? (
              <div className="p-3 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
              </div>
            ) : items.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground text-sm">
                <ListChecks className="size-10 mx-auto mb-2 opacity-50" />
                لا توجد عناصر في هذه الفئة بعد
              </div>
            ) : (
              <div className="divide-y divide-border">
                {items.map((item, idx) => (
                  <div key={item.id} className={cn(
                    'flex flex-wrap items-center gap-2 p-2.5 sm:p-3 hover:bg-muted/30 transition-colors',
                    !item.active && 'opacity-50',
                  )}>
                    {/* Left: reorder + sort order */}
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        onClick={() => move(item, -1)}
                        disabled={idx === 0}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 size-4 flex items-center justify-center"
                        title="تحريك لأعلى"
                      ><ArrowUp className="size-3.5" /></button>
                      <button
                        onClick={() => move(item, 1)}
                        disabled={idx === items.length - 1}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 size-4 flex items-center justify-center"
                        title="تحريك لأسفل"
                      ><ArrowDown className="size-3.5" /></button>
                    </div>
                    <span className="text-[10px] text-muted-foreground/70 tnum w-5 text-center shrink-0">{item.sortOrder}</span>
                    {/* Label badge */}
                    <div className="min-w-0 flex-1">
                      {item.tone ? (
                        <Badge variant="outline" className={cn('font-bold', item.tone)}>{item.label}</Badge>
                      ) : (
                        <Badge variant="outline" className="font-bold">{item.label}</Badge>
                      )}
                      <div className="text-[10px] text-muted-foreground/60 tnum mt-1 truncate-1" dir="ltr">
                        <span className="font-mono">{item.key}</span>
                        {item.labelEn && <span className="mx-1.5">·</span>}
                        {item.labelEn && <span>{item.labelEn}</span>}
                      </div>
                    </div>
                    {/* System badge */}
                    {item.isSystem && (
                      <Badge variant="outline" className="text-[9px] bg-primary/5 text-primary shrink-0" title="عنصر أساسي لا يمكن حذفه">
                        أساسي
                      </Badge>
                    )}
                    {/* Actions */}
                    <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                      <button
                        onClick={() => toggleActive(item)}
                        className={cn(
                          'size-7 sm:size-8 rounded-lg flex items-center justify-center transition-colors',
                          item.active ? 'text-emerald-600 hover:bg-emerald-500/10' : 'text-muted-foreground hover:bg-secondary',
                        )}
                        title={item.active ? 'تعطيل' : 'تفعيل'}
                      >
                        <Power className="size-3.5" />
                      </button>
                      <button
                        onClick={() => { setEditing(item); setOpen(true) }}
                        className="size-7 sm:size-8 rounded-lg flex items-center justify-center hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                        title="تعديل"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        onClick={() => del(item)}
                        disabled={item.isSystem}
                        className={cn(
                          'size-7 sm:size-8 rounded-lg flex items-center justify-center transition-colors',
                          item.isSystem ? 'text-muted-foreground/30 cursor-not-allowed' : 'text-destructive hover:bg-destructive/10',
                        )}
                        title={item.isSystem ? 'لا يمكن حذف عنصر أساسي — عطّله بدلًا من ذلك' : 'حذف'}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'تعديل عنصر' : 'إضافة عنصر جديد'}</DialogTitle>
            <DialogDescription>
              في فئة: <b>{categoryMeta?.label}</b>
              {editing?.isSystem && ' — عنصر أساسي (يمكن تعديل الاسم واللون فقط، لا يمكن تغيير المفتاح أو حذفه)'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <div>
              <Label className="text-xs">المفتاح (Key) *</Label>
              <Input
                value={v.key}
                onChange={(e) => setV({ ...v, key: e.target.value })}
                placeholder="مثل: new, delivered"
                dir="ltr"
                disabled={editing?.isSystem}
                className="font-mono"
              />
              <p className="text-[10px] text-muted-foreground mt-1">يُستخدم داخليًا (بالإنجليزية بدون مسافات)</p>
            </div>
            <div>
              <Label className="text-xs">الترتيب</Label>
              <Input
                type="number"
                value={v.sortOrder}
                onChange={(e) => setV({ ...v, sortOrder: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label className="text-xs">الاسم (عربي) *</Label>
              <Input value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} placeholder="مثل: جديدة، تم التسليم" />
            </div>
            <div>
              <Label className="text-xs">الاسم (EN) اختياري</Label>
              <Input value={v.labelEn} onChange={(e) => setV({ ...v, labelEn: e.target.value })} dir="ltr" placeholder="New, Delivered..." />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">اللون (Tone)</Label>
              <Select value={v.tone || '__'} onValueChange={(val) => setV({ ...v, tone: val === '__' ? '' : val })}>
                <SelectTrigger><SelectValue placeholder="بدون لون" /></SelectTrigger>
                <SelectContent>
                  {TONE_PALETTE.map((t) => <SelectItem key={t.value || '__'} value={t.value || '__'}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {v.tone && (
                <div className="mt-2">
                  <Badge variant="outline" className={cn('font-bold', v.tone)}>{v.label || 'معاينة'}</Badge>
                </div>
              )}
            </div>
            <div className="sm:col-span-2 flex items-center gap-2 pt-1">
              <Switch checked={v.active} onCheckedChange={(c) => setV({ ...v, active: c })} id="active" />
              <Label htmlFor="active" className="text-xs cursor-pointer">نشط (يظهر في القوائم المنسدلة)</Label>
            </div>
          </div>
          {!editing?.isSystem && (
            <div className="flex items-start gap-2 p-2.5 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 rounded-lg text-[11px]">
              <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
              <span>تنبيه: تغيير المفتاح قد يؤثر على البيانات الحالية المرتبطة به. العناصر التي تنشئها لا تُحذف عند تعطيلها — تبقى في قاعدة البيانات ويمكن إعادة تفعيلها.</span>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit} disabled={!v.label.trim() || !v.key.trim()}>
              {editing ? 'تحديث' : 'إضافة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
