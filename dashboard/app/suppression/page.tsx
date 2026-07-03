"use client"

import { useState, useEffect } from "react"
import { ShieldOff, Trash2, RefreshCw, AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import { getSuppressionList, removeFromSuppressionList, SuppressionItem } from "@/lib/api"
import { decodeToken } from "@/lib/auth"
import { Button } from "@/components/ui/button"

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
}

function ReasonBadge({ reason }: { reason: string }) {
  const isComplaint = reason?.toLowerCase().includes("complaint")
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
      isComplaint
        ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
    }`}>
      {reason || "BOUNCE"}
    </span>
  )
}

export default function SuppressionPage() {
  const [items, setItems] = useState<SuppressionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [removingEmail, setRemovingEmail] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const isAdmin = decodeToken()?.role === "admin"

  async function fetchList() {
    setLoading(true)
    setError(null)
    try {
      const data = await getSuppressionList()
      setItems(data.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load suppression list")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isAdmin) return
    fetchList()
  }, [isAdmin])

  async function handleRemove(email: string) {
    setRemovingEmail(email)
    setSuccessMsg(null)
    setError(null)
    try {
      await removeFromSuppressionList(email)
      setItems(prev => prev.filter(i => i.email !== email))
      setSuccessMsg(`${email} removed from suppression list`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove")
    } finally {
      setRemovingEmail(null)
    }
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="text-center">
          <ShieldOff className="h-12 w-12 text-[var(--muted-foreground)] mx-auto mb-3 opacity-40" />
          <p className="text-sm text-[var(--muted-foreground)]">Admin access required</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Header */}
      <header className="sticky top-14 lg:top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
        <div className="px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <ShieldOff className="h-5 w-5 text-red-500 shrink-0" />
              <div>
                <h1 className="text-base sm:text-lg font-bold leading-none">Suppression List</h1>
                {!loading && (
                  <p className="text-xs text-red-500 font-medium mt-0.5">{items.length} suppressed address{items.length !== 1 ? "es" : ""}</p>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchList}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="px-4 sm:px-6 py-6">
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {successMsg && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {successMsg}
          </div>
        )}

        {/* Info card */}
        <div className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 p-4">
          <p className="text-xs text-[var(--muted-foreground)]">
            These email addresses are suppressed by AWS SES due to hard bounces or spam complaints.
            Emails to suppressed addresses will <strong className="text-[var(--foreground)]">not be delivered</strong> by SES.
            Remove an address only if you are sure the issue is resolved.
          </p>
        </div>

        {/* Mobile list */}
        <div className="sm:hidden rounded-lg border border-[var(--border)] overflow-hidden">
          {loading ? (
            [...Array(5)].map((_, i) => (
              <div key={i} className="p-4 border-b border-[var(--border)] animate-pulse">
                <div className="h-4 w-48 rounded bg-[var(--muted)] mb-2" />
                <div className="h-3 w-24 rounded bg-[var(--muted)] mb-1.5" />
                <div className="h-3 w-32 rounded bg-[var(--muted)]" />
              </div>
            ))
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--muted-foreground)]">
              <ShieldOff className="h-10 w-10 opacity-30" />
              <p className="text-sm">No suppressed addresses</p>
            </div>
          ) : (
            items.map(item => (
              <div key={item.email} className="px-4 py-3.5 border-b border-[var(--border)] last:border-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-[var(--foreground)] truncate mb-1.5">{item.email}</p>
                    <ReasonBadge reason={item.reason} />
                    <p className="text-xs text-[var(--muted-foreground)] mt-1.5">{formatDate(item.suppressedAt)}</p>
                  </div>
                  <button
                    onClick={() => handleRemove(item.email)}
                    disabled={removingEmail === item.email}
                    className="shrink-0 flex items-center gap-1 text-xs text-red-500 hover:text-red-600 disabled:opacity-50 transition-colors mt-0.5"
                  >
                    {removingEmail === item.email ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block rounded-lg border border-[var(--border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50">
                <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)] w-10">#</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Email Address</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Reason</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Suppressed At (IST)</th>
                <th className="px-4 py-3 text-center font-medium text-[var(--muted-foreground)]">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="border-b border-[var(--border)]">
                    {[...Array(5)].map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 rounded bg-[var(--muted)] animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--muted-foreground)]">
                      <ShieldOff className="h-10 w-10 opacity-30" />
                      <p className="text-sm">No suppressed email addresses</p>
                      <p className="text-xs">All addresses are eligible to receive emails</p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item, idx) => (
                  <tr key={item.email} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/30 transition-colors">
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">{idx + 1}</td>
                    <td className="px-4 py-3 font-mono text-xs">{item.email}</td>
                    <td className="px-4 py-3"><ReasonBadge reason={item.reason} /></td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)] text-xs whitespace-nowrap">{formatDate(item.suppressedAt)}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleRemove(item.email)}
                        disabled={removingEmail === item.email}
                        className="inline-flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 disabled:opacity-50 transition-colors font-medium"
                      >
                        {removingEmail === item.email ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        {removingEmail === item.email ? "Removing…" : "Remove"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
