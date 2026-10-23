'use client'

import * as React from 'react'
import useSWR from 'swr'
import { Upload, FileSpreadsheet, Eye, Check, ArrowRight, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { fetcher, apiPost } from '@/lib/api'
import { fmtNum, fmtDate } from '@/lib/format'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

const SCHEMA_FIELDS = [
  { value: '__ignore__', label: '— تجاهل —' },
  { value: 'warehouseOrig', label: 'المخزن (نص خام)' },
  { value: 'm1', label: 'م 1 (خام)' },
  { value: 'm2', label: 'م 2 (خام)' },
  { value: 'recipientName', label: 'العميل/المستلم' },
  { value: 'deliveryPhones', label: 'هاتف التوصيل' },
  { value: 'destination', label: 'الوجهة (عربي)' },
  { value: 'destinationEn', label: 'الوجهة (EN)' },
  { value: 'policyQty', label: 'كمية السياسات' },
  { value: 'ton15', label: '1.5 طن' },
  { value: 'ton3', label: '3 طن' },
  { value: 'm6', label: '6 متر' },
  { value: 'xCol', label: 'x (خام)' },
  { value: 'drop', label: 'Drop' },
  { value: 'worker', label: 'العامل' },
  { value: 'date', label: 'تاريخ الشحن' },
  { value: 'date2', label: 'تاريخ إضافي' },
  { value: 'routeCode', label: 'التكويد/خط السير' },
  { value: 'freightCost', label: 'النولون (تكلفة)' },
  { value: 'freightTotal', label: 'إجمالي النولون' },
  { value: 'vehicleNo', label: 'رقم السيارة' },
  { value: 'card', label: 'الكارتة (خام)' },
  { value: 'customerPay', label: 'تحصيل العميل' },
  { value: 'aging', label: 'التعتيق' },
  { value: 'overnight', label: 'المبيت' },
  { value: 'returns', label: 'المرتجع' },
  { value: 'transfer', label: 'التحويلة' },
  { value: 'other', label: 'أخرى' },
  { value: 'totalSuppliers', label: 'إجمالي الموردين' },
  { value: 'note1', label: 'ملاحظة ص' },
  { value: 'notes', label: 'ملاحظات' },
  { value: 'sFlag', label: 's (خام)' },
]

export function ImportModule() {
  const { toast } = useToast()
  const [step, setStep] = React.useState<'idle' | 'preview' | 'mapping' | 'committing' | 'done'>('idle')
  const [preview, setPreview] = React.useState<any>(null)
  const [sheet, setSheet] = React.useState('')
  const [mapping, setMapping] = React.useState<Record<string, string>>({})
  const [branchId, setBranchId] = React.useState('')
  const [warehouseId, setWarehouseId] = React.useState('')
  const [result, setResult] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)

  const { data: branches } = useSWR<{ items: any[] }>('/api/branches', fetcher)
  const { data: warehouses } = useSWR<{ items: any[] }>('/api/warehouses', fetcher)
  const { data: logsData } = useSWR<{ items: any[] }>(`/api/audit?entity=shipment&action=import`, fetcher)
  const { data: importLogs } = useSWR<{ items: any[] }>(`/api/audit?entity=shipment&action=import`, fetcher)

  const doPreview = async () => {
    setLoading(true)
    try {
      const r = await apiPost('/api/import/preview', { fileName: 'مبيعات العاشر 3 (Repaired) - Copy.xlsx' })
      setPreview(r)
      setSheet(r.sheets[0].name)
      setMapping(r.suggestedMapping)
      setStep('preview')
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }) }
    finally { setLoading(false) }
  }

  const toMapping = () => setStep('mapping')

  const doCommit = async () => {
    if (!branchId || !warehouseId) { toast({ title: 'اختر الفرع والمخزن أولاً', variant: 'destructive' }); return }
    setStep('committing')
    try {
      const r = await apiPost('/api/import/commit', { fileName: 'مبيعات العاشر 3 (Repaired) - Copy.xlsx', sheetName: sheet, mapping, branchId, warehouseId, userName: 'admin' })
      setResult(r)
      setStep('done')
      toast({ title: `استيراد ${r.imported} شحنة` })
    } catch (e: any) { toast({ title: 'خطأ', description: e.message, variant: 'destructive' }); setStep('mapping') }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center size-12 rounded-xl bg-primary/10 text-primary"><Upload className="size-6" /></div>
            <div className="flex-1">
              <div className="font-semibold">معالج استيراد Excel</div>
              <div className="text-xs text-muted-foreground mt-1">ملف «مبيعات العاشر 3 (Repaired) - Copy.xlsx» جاهز في مجلد التحميل. المعالج يتيح: اختيار الورقة، معاينة الصفوف، تعيين الأعمدة، ثم التزامن والتحقق قبل الاعتماد.</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stepper */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs">
        {(['idle', 'preview', 'mapping', 'committing', 'done'] as const).map((s, i) => {
          const labels = { idle: 'البدء', preview: 'المعاينة', mapping: 'التعيين', committing: 'الاستيراد', done: 'النتيجة' }
          const isActive = step === s
          const isDone = (['idle','preview','mapping','committing','done'].indexOf(step) > i) || (step === 'done' && s === 'done')
          return (
            <React.Fragment key={s}>
              <div className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-full', isActive ? 'bg-primary text-primary-foreground' : isDone ? 'bg-emerald-100 text-emerald-700' : 'bg-secondary text-muted-foreground')}>
                {isDone && !isActive ? <Check className="size-3" /> : <span className="size-1.5 rounded-full bg-current" />}
                <span>{labels[s]}</span>
              </div>
              {i < 4 && <ArrowRight className="size-3 text-muted-foreground rotate-180" />}
            </React.Fragment>
          )
        })}
      </div>

      {step === 'idle' && (
        <Card>
          <CardContent className="py-10 text-center">
            <FileSpreadsheet className="size-12 mx-auto mb-3 text-muted-foreground" />
            <div className="text-sm text-muted-foreground mb-4">للبدء، سيقرأ النظام الملف من مجلد /upload ويستخرج الورقتين «مبيعات 8-2026» و«النولون» مع معاينة أول 10 صفوف.</div>
            <Button onClick={doPreview} disabled={loading}>{loading && <Loader2 className="size-4 ml-1 animate-spin" />}<Eye className="size-4" /> معاينة الملف</Button>
          </CardContent>
        </Card>
      )}

      {step === 'preview' && preview && (
        <div className="space-y-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-semibold text-sm">أوراق الملف</div>
                  <div className="text-xs text-muted-foreground">{preview.sheets.length} ورقة</div>
                </div>
                <Select value={sheet} onValueChange={(v) => { setSheet(v); const sh = preview.sheets.find((s: any) => s.name === v); if (sh && preview.suggestedMapping) setMapping(preview.suggestedMapping) }}>
                  <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {preview.sheets.map((s: any) => <SelectItem key={s.name} value={s.name}>{s.name} ({fmtNum(s.totalRows)} صف)</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {(() => {
                const sh = preview.sheets.find((s: any) => s.name === sheet)
                return (
                  <div>
                    <div className="text-xs text-muted-foreground mb-2">{fmtNum(sh.columns)} عمود، {fmtNum(sh.totalRows)} صف</div>
                    <div className="overflow-x-auto border border-border rounded-lg">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40"><tr>{sh.headers.map((h: string, i: number) => <th key={i} className="px-2 py-1.5 text-right font-medium whitespace-nowrap">{h || `(${i + 1})`}</th>)}</tr></thead>
                        <tbody>
                          {sh.sampleRows.map((row: any[], i: number) => (
                            <tr key={i} className="border-t border-border">
                              {row.map((c: any, j: number) => <td key={j} className="px-2 py-1.5 text-muted-foreground max-w-[160px] truncate">{String(c ?? '')}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}
            </CardContent>
          </Card>
          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep('idle')}>رجوع</Button>
            <Button onClick={toMapping}>التالي: تعيين الأعمدة <ArrowRight className="size-4 rotate-180" /></Button>
          </div>
        </div>
      )}

      {step === 'mapping' && preview && (
        <div className="space-y-3">
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold text-sm mb-1">تعيين الأعمدة إلى حقول النظام</h3>
              <p className="text-xs text-muted-foreground mb-4">الأعمدة الغامضة (م 1، م 2، x، s، الكارتة) تُحفظ كحقول خام ولا يُفترض معناها. يمكنك تعديل التعيين.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {(() => {
                  const sh = preview.sheets.find((s: any) => s.name === sheet)
                  return sh.headers.map((h: string) => (
                    <div key={h} className="flex items-center gap-2">
                      <div className="text-xs font-medium w-40 truncate" title={h}>{h || '(فارغ)'}</div>
                      <ArrowRight className="size-3 text-muted-foreground rotate-180" />
                      <Select value={mapping[h] || '__ignore__'} onValueChange={(v) => setMapping((m) => ({ ...m, [h]: v }))}>
                        <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SCHEMA_FIELDS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))
                })()}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold text-sm mb-3">إعدادات الاستيراد</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">الفرع *</label>
                  <Select value={branchId} onValueChange={setBranchId}>
                    <SelectTrigger><SelectValue placeholder="اختر الفرع..." /></SelectTrigger>
                    <SelectContent>{(branches?.items ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium">المخزن *</label>
                  <Select value={warehouseId} onValueChange={setWarehouseId}>
                    <SelectTrigger><SelectValue placeholder="اختر المخزن..." /></SelectTrigger>
                    <SelectContent>{(warehouses?.items ?? []).filter((w) => !branchId || w.branchId === branchId).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 rounded-lg text-xs">
                ⚠️ سيتم استيراد البيانات في قاعدة البيانات مع كشف التكرار (بناءً على رقم الشحنة + التاريخ + العميل). الشحنات المكررة تُتجاهل.
              </div>
            </CardContent>
          </Card>
          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep('preview')}>رجوع</Button>
            <Button onClick={doCommit} disabled={!branchId || !warehouseId}><Check className="size-4" /> اعتماد الاستيراد</Button>
          </div>
        </div>
      )}

      {step === 'committing' && (
        <Card><CardContent className="py-16 text-center">
          <Loader2 className="size-10 mx-auto mb-3 animate-spin text-primary" />
          <div className="text-sm">جاري الاستيراد والتزامن...</div>
        </CardContent></Card>
      )}

      {step === 'done' && result && (
        <div className="space-y-3">
          <Card>
            <CardContent className="p-6 text-center">
              <div className="flex items-center justify-center size-14 mx-auto rounded-full bg-emerald-100 text-emerald-600 mb-3"><Check className="size-7" /></div>
              <div className="text-lg font-semibold">اكتمل الاستيراد</div>
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="bg-secondary/60 rounded-lg p-3"><div className="text-2xl font-bold tnum">{fmtNum(result.total)}</div><div className="text-xs text-muted-foreground">إجمالي الصفوف</div></div>
                <div className="bg-emerald-100 text-emerald-700 rounded-lg p-3"><div className="text-2xl font-bold tnum">{fmtNum(result.imported)}</div><div className="text-xs">مستورد</div></div>
                <div className="bg-amber-100 text-amber-700 rounded-lg p-3"><div className="text-2xl font-bold tnum">{fmtNum(result.skipped)}</div><div className="text-xs">متكرر متجاهل</div></div>
                <div className="bg-rose-100 text-rose-700 rounded-lg p-3"><div className="text-2xl font-bold tnum">{fmtNum(result.errors)}</div><div className="text-xs">أخطاء</div></div>
              </div>
              <div className="mt-5 flex items-center justify-center gap-2">
                <Button variant="outline" onClick={() => { setStep('idle'); setResult(null) }}>استيراد جديد</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Import logs */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">سجل الاستيرادات</CardTitle><CardDescription>عمليات الاستيراد السابقة</CardDescription></CardHeader>
        <CardContent className="p-0">
          {logsData ? (
            logsData.items.length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">لا سجل بعد</div> : (
              <div className="divide-y divide-border">
                {logsData.items.slice(0, 10).map((l: any) => (
                  <div key={l.id} className="flex items-center justify-between p-3 text-sm">
                    <div>
                      <div className="font-medium">{l.notes || '-'}</div>
                      <div className="text-xs text-muted-foreground tnum">{fmtDate(l.date)} — {l.userName}</div>
                    </div>
                    <Badge variant="outline">استيراد</Badge>
                  </div>
                ))}
              </div>
            )
          ) : <Skeleton className="h-24 m-2" />}
        </CardContent>
      </Card>
    </div>
  )
}
