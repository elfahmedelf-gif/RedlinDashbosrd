'use client'

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type Field =
  | { name: string; label: string; type: 'text' | 'number' | 'date' | 'textarea' | 'tel' | 'email'; placeholder?: string; span?: 1 | 2 }
  | { name: string; label: string; type: 'select'; options: { value: string; label: string }[]; placeholder?: string; span?: 1 | 2 }
  | { name: string; label: string; type: 'switch'; span?: 1 | 2 }

interface EntityFormDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description?: string
  fields: Field[]
  initial?: Record<string, any>
  onSubmit: (values: Record<string, any>) => Promise<void>
  submitLabel?: string
}

export function EntityFormDialog({
  open,
  onOpenChange,
  title,
  description,
  fields,
  initial,
  onSubmit,
  submitLabel = 'حفظ',
}: EntityFormDialogProps) {
  const [values, setValues] = React.useState<Record<string, any>>({})
  const [loading, setLoading] = React.useState(false)
  const [err, setErr] = React.useState('')

  React.useEffect(() => {
    if (open) {
      const init: Record<string, any> = {}
      for (const f of fields) init[f.name] = initial?.[f.name] ?? (f.type === 'switch' ? false : f.type === 'number' ? '' : '')
      setValues(init)
      setErr('')
    }
  }, [open, initial, fields])

  const set = (name: string, v: any) => setValues((s) => ({ ...s, [name]: v }))

  const submit = async () => {
    setLoading(true)
    setErr('')
    try {
      // normalize numbers
      const out: Record<string, any> = {}
      for (const f of fields) {
        const v = values[f.name]
        if (f.type === 'number') out[f.name] = v === '' || v == null ? null : Number(v)
        else if (f.type === 'switch') out[f.name] = !!v
        else if (v === '') out[f.name] = null
        else out[f.name] = v
      }
      await onSubmit(out)
      onOpenChange(false)
    } catch (e: any) {
      setErr(e.message || 'حدث خطأ')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          {fields.map((f) => (
            <div key={f.name} className={cn('space-y-1.5', f.span === 2 && 'col-span-2')}>
              <Label className="text-xs font-medium">{f.label}</Label>
              {f.type === 'textarea' ? (
                <Textarea
                  value={values[f.name] ?? ''}
                  onChange={(e) => set(f.name, e.target.value)}
                  placeholder={(f as any).placeholder}
                  rows={3}
                />
              ) : f.type === 'select' ? (
                <Select value={values[f.name] || ''} onValueChange={(v) => set(f.name, v === '__none__' ? null : v)}>
                  <SelectTrigger><SelectValue placeholder={(f as any).placeholder || 'اختر...'} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— غير محدد —</SelectItem>
                    {f.options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : f.type === 'switch' ? (
                <div className="flex items-center h-9">
                  <Switch checked={!!values[f.name]} onCheckedChange={(v) => set(f.name, v)} />
                </div>
              ) : (
                <Input
                  type={f.type === 'number' ? 'number' : f.type}
                  value={values[f.name] ?? ''}
                  onChange={(e) => set(f.name, e.target.value)}
                  placeholder={(f as any).placeholder}
                  dir={f.type === 'tel' || f.type === 'email' ? 'ltr' : undefined}
                />
              )}
            </div>
          ))}
        </div>
        {err && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>إلغاء</Button>
          <Button onClick={submit} disabled={loading}>
            {loading && <Loader2 className="size-4 ml-1 animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
