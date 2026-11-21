'use client'

// ============================================================================
// حدود خطأ وحدات لوحة التحكم — يحتوي أخطاء الرندر المتقطعة داخل الوحدة النشطة
// دون إسقاط التطبيق كله، مع محاولة استرجاع تلقائي واحدة ثم زر يدوي.
// (الخطأ المتقطع "Maximum update depth exceeded" هو سباق معروف في React 19 مع
// refs في Radix Presence عند إغلاق الحوارات — البيانات محفوظة قبل حدوثه دائمًا)
// ============================================================================

import * as React from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: React.ReactNode
}

interface State {
  failed: boolean
  attempt: number // عدد محاولات الاسترجاع التلقائي المستهلكة
}

export class ModuleErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { failed: false, attempt: 0 }
  }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    // سجل هادئ — الخطأ معروف ومتقطع والبيانات محفوظة دائمًا قبل حدوثه
    console.warn('[module-boundary] تم احتواء خطأ عرض:', error?.message)
  }

  componentDidUpdate(prevProps: Props, _prevState: State) {
    // تبديل التبويب يصفّر الحالة — الوحدة الجديدة تبدأ نظيفة
    if (prevProps.children !== this.props.children && this.state.failed) {
      this.setState({ failed: false, attempt: 0 })
    }
  }

  handleRetry = () => {
    this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))
  }

  render() {
    if (this.state.failed) {
      // محاولة استرجاع تلقائية واحدة — إعادة رندر الوحدة (بدون حوارات مفتوحة = بلا حلقة)
      if (this.state.attempt < 1) {
        // setState داخل render محظور — نجريها بعد إطار واحد
        setTimeout(() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 })), 50)
        return null
      }
      return (
        <div className="border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 rounded-xl p-8 text-center space-y-3 max-w-md mx-auto mt-8">
          <AlertTriangle className="size-8 mx-auto text-amber-600" />
          <div className="font-bold text-sm">حدث خطأ مؤقت في عرض هذه الشاشة</div>
          <div className="text-xs text-muted-foreground leading-relaxed">
            تم احتواء الخطأ تلقائيًا — بياناتك محفوظة. اضغط «إعادة المحاولة» لتحديث الشاشة، أو انتقل لتبويب آخر وعُد.
          </div>
          <Button onClick={this.handleRetry} size="sm" variant="outline">
            <RotateCcw className="size-3.5" /> إعادة المحاولة
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
