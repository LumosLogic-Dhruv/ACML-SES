"use client"

import { useState, useEffect, useCallback } from "react"
import { AlertTriangle, Search, X, Download } from "lucide-react"
import { getAdminClientEmails, getClientEmails } from "@/lib/api"
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
  status: string
  delivered?: boolean
  bounced?: boolean
  bounceReason?: string
  bounceType?: string // Permanent | Transient | Undetermined
}

type BounceFilter = "all" | "hard" | "soft"

function isHard(e: EmailLogEntry) { return e.bounceType === "Permanent" }
function isSoft(e: EmailLogEntry) { return e.bounceType === "Transient" || (e.bounceType !== "Permanent" && e.bounceType != null) }

function maskEmail(email: string): string {
  const [local, domain] = email.split("@")
  if (local.length <= 2) return `${local[0]}***@${domain}`
  return `${local.slice(0, 2)}***@${domain}`
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  })
}

function getTodayIST(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split("T")[0]
}

type Preset = "1" | "7" | "30" | "90" | "custom"
const LIMIT_OPTIONS = [100, 200, 500, 1000, 3000, 5000]

function exportCSV(emails: EmailLogEntry[], periodLabel: string) {
  const headers = ["#", "Email", "Subject", "Type", "Bounce Reason", "Time (IST)"]
  const rows = emails.map((e, i) => {
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`
    const type = e.bounceType === "Permanent" ? "Hard" : e.bounceType === "Transient" ? "Soft" : "Unknown"
    return [i + 1, escape(e.recipient), escape(e.subject), type, escape(e.bounceReason || ""), escape(formatTime(e.sentAt))].join(",")
  })
  const csv = [headers.join(","), ...rows].join("\n")
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `bounce-report-${periodLabel.replace(/\s+/g, "-")}-${getTodayIST()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function BounceBadge({ bounceType }: { bounceType?: string }) {
  if (bounceType === "Permanent") return <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/15 text-red-500">Hard</span>
  if (bounceType === "Transient") return <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-600">Soft</span>
  return <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)]">Unknown</span>
}

function SkeletonRow() {
  return (
    <tr className="border-b border-[var(--border)]">
      {[...Array(6)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded bg-[var(--muted)] animate-pulse" />
        </td>
      ))}
    </tr>
  )
}

export default function BouncesPage() {
  const { selectedClientId, selectedClientName } = useClient()
  const [bounces, setBounces] = useState<EmailLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(1000)
  const [preset, setPreset] = useState<Preset>("1")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")
  const [search, setSearch] = useState("")
  const [bounceFilter, setBounceFilter] = useState<BounceFilter>("all")

  const fetchBounces = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = preset === "custom" && customFrom && customTo
        ? { limit, from: customFrom, to: customTo }
        : { limit, days: parseInt(preset) }

      const effectiveRole = decodeToken()?.role
      let emails: EmailLogEntry[]

      if (effectiveRole === "admin" && selectedClientId) {
        const data = await getAdminClientEmails(selectedClientId, params)
        emails = data.emails as EmailLogEntry[]
      } else {
        const data = await getClientEmails(params)
        emails = data.emails as unknown as EmailLogEntry[]
      }

      setBounces(emails.filter(e => e.bounced))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bounces")
    } finally {
      setLoading(false)
    }
  }, [limit, preset, customFrom, customTo, selectedClientId])

  useEffect(() => {
    if (preset === "custom") return
    const token = decodeToken()
    if (token?.role === "admin" && !selectedClientId) return
    fetchBounces()
  }, [preset, limit, selectedClientId, fetchBounces])

  const handleCustomApply = () => {
    if (customFrom && customTo) fetchBounces()
  }

  const hardCount = bounces.filter(isHard).length
  const softCount = bounces.filter(isSoft).length

  const searchTerm = search.trim().toLowerCase()
  const filtered = bounces.filter(e => {
    if (bounceFilter === "hard" && !isHard(e)) return false
    if (bounceFilter === "soft" && !isSoft(e)) return false
    return !searchTerm ||
      e.recipient.toLowerCase().includes(searchTerm) ||
      e.subject.toLowerCase().includes(searchTerm) ||
      (e.bounceReason?.toLowerCase().includes(searchTerm) ?? false)
  })

  const presetLabel: Record<Preset, string> = {
    "1": "Today", "7": "Last 7 days", "30": "Last 30 days",
    "90": "Last 3 months",
    "custom": customFrom && customTo ? `${customFrom} to ${customTo}` : "Custom",
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Header */}
      <header className="sticky top-14 lg:top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
        <div className="px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-start sm:items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3 min-w-0">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
              <div>
                <h1 className="text-base sm:text-lg font-bold leading-none">Bounce Report</h1>
                {!loading && (
                  <p className="text-xs text-red-500 font-medium mt-0.5">
                    {bounces.length} bounced · {presetLabel[preset]}
                    {selectedClientName && ` · ${selectedClientName}`}
                  </p>
                )}
                {loading && <p className="text-xs text-[var(--muted-foreground)] mt-0.5">Loading…</p>}
              </div>
            </div>

            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <div className="flex items-center gap-2">
                <Select value={preset} onValueChange={v => setPreset(v as Preset)}>
                  <SelectTrigger className="w-28 sm:w-36 text-xs sm:text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Today</SelectItem>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="90">Last 3 months</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
                <select
                  value={limit}
                  onChange={e => setLimit(Number(e.target.value))}
                  className="text-xs sm:text-sm border border-[var(--border)] rounded-md px-2 py-1.5 bg-[var(--background)] text-[var(--foreground)] cursor-pointer"
                >
                  {LIMIT_OPTIONS.map(opt => <option key={opt} value={opt}>Limit {opt}</option>)}
                </select>
              </div>
              {preset === "custom" && (
                <div className="flex items-center gap-2">
                  <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                    className="text-xs border border-[var(--border)] rounded-md px-2 py-1.5 bg-[var(--background)] text-[var(--foreground)]" />
                  <span className="text-xs text-[var(--muted-foreground)]">to</span>
                  <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                    className="text-xs border border-[var(--border)] rounded-md px-2 py-1.5 bg-[var(--background)] text-[var(--foreground)]" />
                  <Button size="sm" onClick={handleCustomApply} disabled={!customFrom || !customTo} className="h-7 text-xs">Apply</Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="px-4 sm:px-6 py-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Stats — clickable filters */}
        {!loading && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            <button
              onClick={() => setBounceFilter("all")}
              className={`rounded-xl border p-4 text-left transition-all ${bounceFilter === "all" ? "border-red-400 bg-red-500/15 ring-1 ring-red-400" : "border-[var(--border)] bg-red-500/10 hover:bg-red-500/15"}`}
            >
              <p className="text-xs text-[var(--muted-foreground)] mb-1">Total Bounced</p>
              <p className="text-2xl font-bold text-red-500">{bounces.length}</p>
            </button>
            <button
              onClick={() => setBounceFilter(bounceFilter === "hard" ? "all" : "hard")}
              className={`rounded-xl border p-4 text-left transition-all ${bounceFilter === "hard" ? "border-orange-400 bg-orange-500/15 ring-1 ring-orange-400" : "border-[var(--border)] bg-orange-500/10 hover:bg-orange-500/15"}`}
            >
              <p className="text-xs text-[var(--muted-foreground)] mb-1">Hard Bounces</p>
              <p className="text-2xl font-bold text-orange-500">{hardCount}</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">Permanent failure</p>
            </button>
            <button
              onClick={() => setBounceFilter(bounceFilter === "soft" ? "all" : "soft")}
              className={`rounded-xl border p-4 text-left transition-all ${bounceFilter === "soft" ? "border-yellow-400 bg-yellow-500/15 ring-1 ring-yellow-400" : "border-[var(--border)] bg-yellow-500/10 hover:bg-yellow-500/15"}`}
            >
              <p className="text-xs text-[var(--muted-foreground)] mb-1">Soft Bounces</p>
              <p className="text-2xl font-bold text-yellow-500">{softCount}</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">Temporary failure</p>
            </button>
          </div>
        )}

        {/* Search + Filter chips + Export */}
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
              <input
                type="text"
                placeholder="Search email, subject, reason..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 pr-8 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 w-56"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {/* Filter chips */}
            <div className="flex items-center gap-1.5">
              {(["all", "hard", "soft"] as BounceFilter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setBounceFilter(f)}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${
                    bounceFilter === f
                      ? f === "hard" ? "bg-red-500 text-white border-red-500"
                        : f === "soft" ? "bg-yellow-500 text-white border-yellow-500"
                        : "bg-[var(--foreground)] text-[var(--background)] border-[var(--foreground)]"
                      : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]"
                  }`}
                >
                  {f === "all" ? "All" : f === "hard" ? "Hard" : "Soft"}
                </button>
              ))}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportCSV(filtered, presetLabel[preset])}
            disabled={loading || filtered.length === 0}
            className="flex items-center gap-1.5 text-xs"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>

        {!loading && (
          <p className="text-sm text-[var(--muted-foreground)] mb-4">
            {filtered.length} bounce{filtered.length !== 1 ? "s" : ""}
            {bounceFilter !== "all" && ` · ${bounceFilter} only`}
            {search && ` · matching "${search}"`}
          </p>
        )}

        {/* Mobile list */}
        <div className="sm:hidden rounded-lg border border-[var(--border)] overflow-hidden">
          {loading ? (
            [...Array(5)].map((_, i) => (
              <div key={i} className="p-4 border-b border-[var(--border)] animate-pulse">
                <div className="h-4 w-40 rounded bg-[var(--muted)] mb-2" />
                <div className="h-3 w-52 rounded bg-[var(--muted)] mb-1.5" />
                <div className="h-3 w-32 rounded bg-[var(--muted)]" />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--muted-foreground)]">
              <AlertTriangle className="h-10 w-10 opacity-30" />
              <p className="text-sm">No bounces in this period</p>
            </div>
          ) : (
            filtered.map((email, idx) => (
              <div key={email.id} className="px-4 py-3.5 border-b border-[var(--border)] last:border-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] text-[var(--muted-foreground)]">#{idx + 1}</span>
                  <span className="font-mono text-xs text-[var(--foreground)] truncate">{maskEmail(email.recipient)}</span>
                  <BounceBadge bounceType={email.bounceType} />
                </div>
                <p className="text-sm truncate mb-1">{email.subject}</p>
                {email.bounceReason && (
                  <p className="text-xs text-red-500 break-words leading-relaxed mb-1">{email.bounceReason}</p>
                )}
                <p className="text-xs text-[var(--muted-foreground)]">{formatTime(email.sentAt)}</p>
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
                <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Email</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Subject</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)] whitespace-nowrap">Type</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Bounce Reason</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)] whitespace-nowrap">Time</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(6)].map((_, i) => <SkeletonRow key={i} />)
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--muted-foreground)]">
                      <AlertTriangle className="h-10 w-10 opacity-30" />
                      <p className="text-sm">No bounces for this period</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((email, idx) => (
                  <tr key={email.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/30 transition-colors">
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">{idx + 1}</td>
                    <td className="px-4 py-3 font-mono text-xs">{maskEmail(email.recipient)}</td>
                    <td className="px-4 py-3 max-w-[180px] truncate">{email.subject}</td>
                    <td className="px-4 py-3"><BounceBadge bounceType={email.bounceType} /></td>
                    <td className="px-4 py-3 max-w-[300px]">
                      {email.bounceReason ? (
                        <span className="text-xs text-red-500 break-words leading-relaxed">{email.bounceReason}</span>
                      ) : (
                        <span className="text-xs text-[var(--muted-foreground)]">No reason captured</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)] whitespace-nowrap text-xs">{formatTime(email.sentAt)}</td>
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
