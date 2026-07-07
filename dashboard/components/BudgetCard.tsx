import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Gauge } from "lucide-react"
import { cn } from "@/lib/utils"

interface BudgetCardProps {
  date: string
  isToday: boolean
  maxDate: string
  onDateChange: (date: string) => void
  dailyLimit: number
  sent: number
  usagePct: number | null
  remaining: number | null
  loading?: boolean
}

function barColor(pct: number): string {
  if (pct >= 90) return "bg-red-500"
  if (pct >= 70) return "bg-amber-500"
  return "bg-emerald-500"
}

export function BudgetCard({ date, isToday, maxDate, onDateChange, dailyLimit, sent, usagePct, remaining, loading = false }: BudgetCardProps) {
  return (
    <Card className="relative overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-[var(--muted-foreground)] flex items-center gap-2">
          <Gauge className="h-4 w-4 text-indigo-500" />
          Daily Email Budget
        </CardTitle>
        <input
          type="date"
          value={date}
          max={maxDate}
          onChange={(e) => onDateChange(e.target.value)}
          className="text-xs border border-[var(--border)] rounded-md px-2 py-1.5 bg-[var(--background)] text-[var(--foreground)]"
        />
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <div className="h-8 w-32 rounded bg-[var(--muted)] animate-pulse" />
            <div className="h-2 w-full rounded bg-[var(--muted)] animate-pulse" />
          </div>
        ) : dailyLimit <= 0 ? (
          <div>
            <div className="text-3xl font-bold tracking-tight">{sent.toLocaleString()}</div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              sent {isToday ? "today" : `on ${date}`} &middot; no daily limit set
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold tracking-tight">{sent.toLocaleString()}</span>
              <span className="text-sm text-[var(--muted-foreground)]">/ {dailyLimit.toLocaleString()}</span>
            </div>
            <div className="mt-3 h-2 w-full rounded-full bg-[var(--muted)] overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", barColor(usagePct ?? 0))}
                style={{ width: `${Math.min(100, usagePct ?? 0)}%` }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
              <span>{usagePct ?? 0}% used{!isToday && ` on ${date}`}</span>
              {isToday ? (
                <span>{(remaining ?? 0).toLocaleString()} remaining today</span>
              ) : (
                <span>{(remaining ?? 0).toLocaleString()} unused that day</span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
