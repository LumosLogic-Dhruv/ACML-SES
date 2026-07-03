"use client"

import { useState, useEffect, useCallback } from "react"
import { Mail } from "lucide-react"
import { getRecentEmails, getAdminClientEmails, getClientEmails } from "@/lib/api"
import { useClient } from "@/lib/clientContext"
import { decodeToken } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface EmailLogEntry {
  id: string
  messageId: string
  recipient: string
  subject: string
  sentAt: string
  status: "sent" | "failed"
  jobId: string
  delivered?: boolean
  opened?: boolean
  bounced?: boolean
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@")
  if (local.length <= 2) return `${local[0]}***@${domain}`
  return `${local.slice(0, 2)}***@${domain}`
}

function formatTime(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

function getDateIST(isoString: string): string {
  const istDate = new Date(new Date(isoString).getTime() + IST_OFFSET_MS)
  return istDate.toISOString().split("T")[0]
}

function getTodayIST(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().split("T")[0]
}

type Preset = "all" | "1" | "7" | "30" | "90" | "custom"
type StatusFilter = "all" | "sent" | "delivered" | "bounced" | "failed"

const LIMIT_OPTIONS = [100, 200, 500, 1000]

function getEmailStatus(email: EmailLogEntry): StatusFilter {
  if (email.bounced) return "bounced"
  if (email.delivered) return "delivered"
  if (email.status === "sent") return "sent"
  return "failed"
}

function StatusBadge({ email }: { email: EmailLogEntry }) {
  if (email.bounced) return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Bounced</span>
  )
  if (email.delivered) return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Delivered</span>
  )
  if (email.status === "sent") return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">Sent</span>
  )
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Failed</span>
  )
}

// ── Skeleton for mobile card ────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="p-4 border-b border-[var(--border)] animate-pulse">
      <div className="flex items-center justify-between mb-2">
        <div className="h-4 w-36 rounded bg-[var(--muted)]" />
        <div className="h-5 w-16 rounded-full bg-[var(--muted)]" />
      </div>
      <div className="h-3.5 w-48 rounded bg-[var(--muted)] mb-1.5" />
      <div className="h-3 w-24 rounded bg-[var(--muted)]" />
    </div>
  )
}

// ── Skeleton for desktop table row ──────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr className="border-b border-[var(--border)]">
      {[...Array(8)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded bg-[var(--muted)] animate-pulse" />
        </td>
      ))}
    </tr>
  )
}

export default function RecentEmailsPage() {
  const { role, selectedClientId } = useClient()
  const [emails, setEmails] = useState<EmailLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(100)
  const [preset, setPreset] = useState<Preset>("all")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [countDate, setCountDate] = useState<string>(getTodayIST())

  const fetchEmails = useCallback(async () => {
    setLoading(true)
    try {
      let params: Parameters<typeof getRecentEmails>[0] = { limit }

      if (preset === "custom" && customFrom && customTo) {
        params = { limit, from: customFrom, to: customTo }
      } else if (preset !== "all") {
        params = { limit, days: parseInt(preset) }
      }

      const effectiveRole = decodeToken()?.role
      const isAdmin = effectiveRole === "admin"
      const isClient = effectiveRole === "client"
      let data: { emails: EmailLogEntry[] }
      if (isAdmin && selectedClientId) {
        const adminData = await getAdminClientEmails(selectedClientId, params)
        data = { emails: adminData.emails as EmailLogEntry[] }
      } else if (isClient) {
        const clientData = await getClientEmails(params)
        data = { emails: clientData.emails as unknown as EmailLogEntry[] }
      } else {
        data = await getRecentEmails(params)
      }
      setEmails(data.emails ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }, [limit, preset, customFrom, customTo, role, selectedClientId])

  useEffect(() => {
    if (preset !== "custom") {
      const token = decodeToken()
      if (token?.role === "admin" && !selectedClientId) return
      fetchEmails()
      const interval = setInterval(fetchEmails, 30_000)
      return () => clearInterval(interval)
    }
  }, [preset, limit, selectedClientId, fetchEmails])

  const handleCustomApply = () => {
    if (customFrom && customTo) fetchEmails()
  }

  const filteredEmails = statusFilter === "all"
    ? emails
    : emails.filter(e => getEmailStatus(e) === statusFilter)

  const counts = {
    all: emails.length,
    sent: emails.filter(e => getEmailStatus(e) === "sent").length,
    delivered: emails.filter(e => getEmailStatus(e) === "delivered").length,
    bounced: emails.filter(e => getEmailStatus(e) === "bounced").length,
    failed: emails.filter(e => getEmailStatus(e) === "failed").length,
  }

  // Count for the selected day in IST
  const selectedDateIST = countDate
  const dayCount = emails.filter(e => getDateIST(e.sentAt) === selectedDateIST).length
  const dayLabel = selectedDateIST === getTodayIST() ? "Today" : new Date(selectedDateIST + "T00:00:00").toLocaleDateString("en-IN", { month: "short", day: "numeric" })

  return (
    <div className="min-h-screen bg-[var(--background)]">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="sticky top-14 lg:top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
        <div className="px-4 sm:px-6 py-3 sm:py-4">
          {/* Title row */}
          <div className="flex items-start sm:items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3 min-w-0">
              <Mail className="h-5 w-5 text-indigo-500 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold leading-none">Recent Emails</h1>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5 hidden sm:block">
                  Sent email history and delivery status
                </p>
              </div>
            </div>

            {/* Controls — top right */}
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              {/* Row 1: dropdowns */}
              <div className="flex items-center gap-2">
                <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
                  <SelectTrigger className="w-28 sm:w-36 text-xs sm:text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All time</SelectItem>
                    <SelectItem value="1">Today</SelectItem>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="90">Last 3 months</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>

                <select
                  value={limit}
                  onChange={(e) => { setLoading(true); setLimit(Number(e.target.value)) }}
                  className="text-xs sm:text-sm border border-[var(--border)] rounded-md px-2 py-1.5 bg-[var(--background)] text-[var(--foreground)] cursor-pointer"
                >
                  {LIMIT_OPTIONS.map(opt => (
                    <option key={opt} value={opt}>Limit {opt}</option>
                  ))}
                </select>
              </div>

              {/* Row 2: day count badge with date picker */}
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={selectedDateIST}
                  max={getTodayIST()}
                  onChange={(e) => setCountDate(e.target.value)}
                  className="text-xs border border-[var(--border)] rounded-md px-2 py-1 bg-[var(--background)] text-[var(--foreground)] cursor-pointer"
                />
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800">
                  {loading ? (
                    <span className="text-xs text-indigo-400">...</span>
                  ) : (
                    <>
                      <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">{dayCount}</span>
                      <span className="text-xs text-indigo-500">{dayLabel} (IST)</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Custom date range */}
          {preset === "custom" && (
            <div className="flex flex-wrap items-center gap-2 pb-1">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                className="text-sm border border-[var(--border)] rounded-md px-3 py-1.5 bg-[var(--background)] text-[var(--foreground)]" />
              <span className="text-sm text-[var(--muted-foreground)]">to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                className="text-sm border border-[var(--border)] rounded-md px-3 py-1.5 bg-[var(--background)] text-[var(--foreground)]" />
              <Button size="sm" onClick={handleCustomApply} disabled={!customFrom || !customTo}>Apply</Button>
            </div>
          )}
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main className="px-4 sm:px-6 py-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Status filter chips */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {(["all", "sent", "delivered", "bounced", "failed"] as StatusFilter[]).map((f) => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors capitalize ${
                statusFilter === f
                  ? f === "bounced" || f === "failed"
                    ? "bg-red-500 text-white border-red-500"
                    : f === "delivered"
                    ? "bg-emerald-500 text-white border-emerald-500"
                    : f === "sent"
                    ? "bg-yellow-500 text-white border-yellow-500"
                    : "bg-indigo-500 text-white border-indigo-500"
                  : "bg-[var(--background)] text-[var(--muted-foreground)] border-[var(--border)] hover:border-[var(--foreground)]"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}{!loading && ` (${counts[f]})`}
            </button>
          ))}
        </div>

        {!loading && (
          <p className="text-sm text-[var(--muted-foreground)] mb-4">
            Showing {filteredEmails.length} email{filteredEmails.length !== 1 ? "s" : ""}
            {statusFilter !== "all" && ` · filtered by "${statusFilter}"`}
          </p>
        )}

        {/* ── Mobile card list (hidden on sm+) ─────────────────────────── */}
        <div className="sm:hidden rounded-lg border border-[var(--border)] overflow-hidden">
          {loading ? (
            [...Array(6)].map((_, i) => <SkeletonCard key={i} />)
          ) : filteredEmails.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--muted-foreground)]">
              <Mail className="h-10 w-10 opacity-30" />
              <p className="text-sm">No emails found</p>
            </div>
          ) : (
            filteredEmails.map((email, index) => (
              <div key={email.id} className="px-4 py-3.5 border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/30 transition-colors">
                {/* Row 1: email + status */}
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] text-[var(--muted-foreground)] shrink-0">#{index + 1}</span>
                    <span className="font-mono text-xs text-[var(--foreground)] truncate">{maskEmail(email.recipient)}</span>
                  </div>
                  <StatusBadge email={email} />
                </div>
                {/* Row 2: subject */}
                <p className="text-sm text-[var(--foreground)] truncate mb-1">{email.subject}</p>
                {/* Row 3: time + delivery flags */}
                <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
                  <span>{formatTime(email.sentAt)}</span>
                  {email.delivered && <span className="text-emerald-500">• Delivered</span>}
                  {email.bounced   && <span className="text-red-500">• Bounced</span>}
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── Desktop table (hidden below sm) ──────────────────────────── */}
        <div className="hidden sm:block rounded-lg border border-[var(--border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50">
                <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)] w-10">#</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Email</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Subject</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Status</th>
                <th className="px-4 py-3 text-center font-medium text-[var(--muted-foreground)]">Sent</th>
                <th className="px-4 py-3 text-center font-medium text-[var(--muted-foreground)]">Delivered</th>
                <th className="px-4 py-3 text-center font-medium text-[var(--muted-foreground)]">Bounced</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Time</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(8)].map((_, i) => <SkeletonRow key={i} />)
              ) : filteredEmails.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--muted-foreground)]">
                      <Mail className="h-10 w-10 opacity-30" />
                      <p className="text-sm">No emails found for this period</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredEmails.map((email, index) => (
                  <tr key={email.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/30 transition-colors">
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">{index + 1}</td>
                    <td className="px-4 py-3 font-mono text-xs">{maskEmail(email.recipient)}</td>
                    <td className="px-4 py-3 text-[var(--foreground)] max-w-xs truncate">{email.subject}</td>
                    <td className="px-4 py-3"><StatusBadge email={email} /></td>
                    <td className="px-4 py-3 text-center text-emerald-500">✓</td>
                    <td className="px-4 py-3 text-center">
                      {email.delivered ? <span className="text-emerald-500">✓</span> : <span className="text-[var(--muted-foreground)]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {email.bounced ? <span className="text-red-500">✓</span> : <span className="text-[var(--muted-foreground)]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)] whitespace-nowrap">{formatTime(email.sentAt)}</td>
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
