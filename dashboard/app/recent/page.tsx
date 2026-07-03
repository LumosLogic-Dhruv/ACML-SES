"use client"

import { useState, useEffect, useCallback } from "react"
import { Mail, Download, X, Search } from "lucide-react"
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

type Preset = "1" | "7" | "30" | "90" | "custom"
type StatusFilter = "all" | "sent" | "delivered" | "bounced" | "failed"

const LIMIT_OPTIONS = [100, 200, 500, 1000, 3000, 5000]
const PAGE_SIZE = 100

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

// ── CSV Export ───────────────────────────────────────────────────────────────
function exportCSV(emails: EmailLogEntry[], periodLabel: string) {
  const headers = ['#', 'Email', 'Subject', 'Status', 'Delivered', 'Bounced', 'Time (IST)']
  const rows = emails.map((e, i) => [
    i + 1,
    e.recipient,
    `"${e.subject.replace(/"/g, '""')}"`,
    getEmailStatus(e),
    e.delivered ? 'Yes' : 'No',
    e.bounced ? 'Yes' : 'No',
    formatTime(e.sentAt),
  ])
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `email-logs-${periodLabel.replace(/\s/g, '-')}-${getTodayIST()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── PDF Export (auto-download via jsPDF) ─────────────────────────────────────
async function exportPDF(emails: EmailLogEntry[], clientName: string, periodLabel: string) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const total = emails.length
  const delivered = emails.filter(e => e.delivered).length
  const bounced = emails.filter(e => e.bounced).length
  const failed = emails.filter(e => e.status === 'failed').length
  const deliveryRate = total > 0 ? ((delivered / total) * 100).toFixed(1) : '0.0'
  const bounceRate = total > 0 ? ((bounced / total) * 100).toFixed(1) : '0.0'
  const generatedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  const pageW = doc.internal.pageSize.getWidth()

  // Header bar
  doc.setFillColor(99, 102, 241)
  doc.rect(0, 0, pageW, 22, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16); doc.setFont('helvetica', 'bold')
  doc.text('LumosMails', 14, 13)
  doc.setFontSize(10); doc.setFont('helvetica', 'normal')
  doc.text('Email Performance Report', pageW - 14, 9, { align: 'right' })
  doc.text(`${clientName} · ${periodLabel}`, pageW - 14, 15, { align: 'right' })

  // Generated line
  doc.setTextColor(100, 116, 139)
  doc.setFontSize(8)
  doc.text(`Generated: ${generatedAt} IST`, 14, 30)

  // Section label
  doc.setFontSize(9); doc.setFont('helvetica', 'bold')
  doc.setTextColor(148, 163, 184)
  doc.text('PERFORMANCE SUMMARY', 14, 40)

  // Stat cards
  const cardW = (pageW - 28 - 9) / 4
  const cardH = 28
  const cardY = 44
  const cards = [
    { label: 'Total Sent', value: String(total), sub: 'emails', color: [99, 102, 241] as [number,number,number] },
    { label: 'Delivered', value: String(delivered), sub: `${deliveryRate}% rate`, color: [16, 185, 129] as [number,number,number] },
    { label: 'Bounced', value: String(bounced), sub: `${bounceRate}% rate`, color: [239, 68, 68] as [number,number,number] },
    { label: 'Failed', value: String(failed), sub: 'emails', color: [249, 115, 22] as [number,number,number] },
  ]

  cards.forEach((card, i) => {
    const x = 14 + i * (cardW + 3)
    doc.setFillColor(248, 250, 252)
    doc.roundedRect(x, cardY, cardW, cardH, 2, 2, 'F')
    doc.setFillColor(...card.color)
    doc.rect(x, cardY, cardW, 1.5, 'F')
    doc.setTextColor(100, 116, 139); doc.setFontSize(7); doc.setFont('helvetica', 'bold')
    doc.text(card.label.toUpperCase(), x + cardW / 2, cardY + 7, { align: 'center' })
    doc.setTextColor(...card.color); doc.setFontSize(18); doc.setFont('helvetica', 'bold')
    doc.text(card.value, x + cardW / 2, cardY + 18, { align: 'center' })
    doc.setTextColor(100, 116, 139); doc.setFontSize(7); doc.setFont('helvetica', 'normal')
    doc.text(card.sub, x + cardW / 2, cardY + 24, { align: 'center' })
  })

  // Banner
  const bannerY = cardY + cardH + 8
  doc.setFillColor(99, 102, 241)
  doc.roundedRect(14, bannerY, pageW - 28, 22, 3, 3, 'F')
  const bannerCols = [
    { label: 'PERIOD', value: periodLabel },
    { label: 'DELIVERY RATE', value: `${deliveryRate}%` },
    { label: 'BOUNCE RATE', value: `${bounceRate}%` },
    { label: 'SUCCESS', value: `${delivered} / ${total}` },
  ]
  const colW = (pageW - 28) / 4
  bannerCols.forEach((col, i) => {
    const x = 14 + i * colW + colW / 2
    doc.setTextColor(255, 255, 255); doc.setFontSize(7); doc.setFont('helvetica', 'normal')
    doc.text(col.label, x, bannerY + 7, { align: 'center' })
    doc.setFontSize(11); doc.setFont('helvetica', 'bold')
    doc.text(col.value, x, bannerY + 16, { align: 'center' })
  })

  // Footer
  const footerY = 275
  doc.setDrawColor(226, 232, 240)
  doc.line(14, footerY, pageW - 14, footerY)
  doc.setTextColor(148, 163, 184); doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  doc.text('LumosMails by LumosLogic', 14, footerY + 6)
  doc.text('Confidential · For internal use only', pageW / 2, footerY + 6, { align: 'center' })
  doc.text(new Date().toLocaleDateString('en-IN'), pageW - 14, footerY + 6, { align: 'right' })

  doc.save(`email-report-${clientName}-${getTodayIST()}.pdf`)
}

// ── Export Modal ─────────────────────────────────────────────────────────────
function ExportModal({ onClose, emails, clientName, periodLabel }: {
  onClose: () => void
  emails: EmailLogEntry[]
  clientName: string
  periodLabel: string
}) {
  const [exportLogs, setExportLogs] = useState(true)
  const [exportReport, setExportReport] = useState(false)

  const handleExport = async () => {
    if (exportLogs) exportCSV(emails, periodLabel)
    if (exportReport) await exportPDF(emails, clientName, periodLabel)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[var(--background)] border border-[var(--border)] rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-bold">Export Report</h2>
          <button onClick={onClose} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-[var(--muted-foreground)] mb-4">Select what to export based on current filters</p>

        <div className="space-y-2 mb-6">
          <label className="flex items-start gap-3 p-3 rounded-lg border border-[var(--border)] cursor-pointer hover:bg-[var(--muted)]/30 transition-colors">
            <input type="checkbox" checked={exportLogs} onChange={e => setExportLogs(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-500" />
            <div>
              <div className="text-sm font-semibold">Email Logs</div>
              <div className="text-xs text-[var(--muted-foreground)] mt-0.5">CSV file with all email records</div>
            </div>
          </label>
          <label className="flex items-start gap-3 p-3 rounded-lg border border-[var(--border)] cursor-pointer hover:bg-[var(--muted)]/30 transition-colors">
            <input type="checkbox" checked={exportReport} onChange={e => setExportReport(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-500" />
            <div>
              <div className="text-sm font-semibold">Dashboard Performance</div>
              <div className="text-xs text-[var(--muted-foreground)] mt-0.5">PDF with delivery stats &amp; metrics</div>
            </div>
          </label>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose} className="flex-1">Cancel</Button>
          <Button size="sm" onClick={handleExport} disabled={!exportLogs && !exportReport} className="flex-1 bg-indigo-500 hover:bg-indigo-600 text-white">
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Pagination ───────────────────────────────────────────────────────────────
function Pagination({ total, page, onPage }: { total: number; page: number; onPage: (p: number) => void }) {
  const totalPages = Math.ceil(total / PAGE_SIZE)
  if (totalPages <= 1) return null

  const getPages = (): (number | '...')[] => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    if (page <= 4) return [1, 2, 3, 4, 5, '...', totalPages]
    if (page >= totalPages - 3) return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
    return [1, '...', page - 1, page, page + 1, '...', totalPages]
  }

  return (
    <div className="flex items-center justify-center gap-1 mt-6 flex-wrap">
      <button onClick={() => onPage(page - 1)} disabled={page === 1}
        className="px-3 py-1.5 text-sm rounded-md border border-[var(--border)] disabled:opacity-40 hover:bg-[var(--muted)]/50 transition-colors">
        ‹
      </button>
      {getPages().map((p, i) =>
        p === '...' ? (
          <span key={`e${i}`} className="px-2 text-[var(--muted-foreground)] text-sm">...</span>
        ) : (
          <button key={p} onClick={() => onPage(p as number)}
            className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
              page === p
                ? 'bg-indigo-500 text-white border-indigo-500'
                : 'border-[var(--border)] hover:bg-[var(--muted)]/50'
            }`}>
            {p}
          </button>
        )
      )}
      <button onClick={() => onPage(page + 1)} disabled={page === Math.ceil(total / PAGE_SIZE)}
        className="px-3 py-1.5 text-sm rounded-md border border-[var(--border)] disabled:opacity-40 hover:bg-[var(--muted)]/50 transition-colors">
        ›
      </button>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function RecentEmailsPage() {
  const { role, selectedClientId, selectedClientName } = useClient()
  const [emails, setEmails] = useState<EmailLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(100)
  const [preset, setPreset] = useState<Preset>("1")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [countDate, setCountDate] = useState<string>(getTodayIST())
  const [showExport, setShowExport] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [search, setSearch] = useState("")

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
      setCurrentPage(1)
      setSearch("")
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

  const searchTerm = search.trim().toLowerCase()
  const filteredEmails = emails.filter(e => {
    const matchStatus = statusFilter === "all" || getEmailStatus(e) === statusFilter
    const matchSearch = !searchTerm ||
      e.recipient.toLowerCase().includes(searchTerm) ||
      e.subject.toLowerCase().includes(searchTerm)
    return matchStatus && matchSearch
  })

  const paginatedEmails = filteredEmails.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const counts = {
    all: emails.length,
    sent: emails.filter(e => getEmailStatus(e) === "sent").length,
    delivered: emails.filter(e => getEmailStatus(e) === "delivered").length,
    bounced: emails.filter(e => getEmailStatus(e) === "bounced").length,
    failed: emails.filter(e => getEmailStatus(e) === "failed").length,
  }

  const selectedDateIST = countDate
  const dayCount = emails.filter(e => getDateIST(e.sentAt) === selectedDateIST).length
  const dayLabel = selectedDateIST === getTodayIST()
    ? "Today"
    : new Date(selectedDateIST + "T00:00:00").toLocaleDateString("en-IN", { month: "short", day: "numeric" })

  const presetLabel: Record<Preset, string> = {
    "1": "Today",
    "7": "Last 7 days",
    "30": "Last 30 days",
    "90": "Last 3 months",
    "custom": customFrom && customTo ? `${customFrom} to ${customTo}` : "Custom",
  }

  const clientName = selectedClientName || "Dashboard"

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {showExport && (
        <ExportModal
          onClose={() => setShowExport(false)}
          emails={filteredEmails}
          clientName={clientName}
          periodLabel={presetLabel[preset]}
        />
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="sticky top-14 lg:top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
        <div className="px-4 sm:px-6 py-3 sm:py-4">
          {/* Title row */}
          <div className="flex items-start sm:items-center justify-between gap-3 mb-3">
            {/* Left: title + day count badge */}
            <div className="flex items-center gap-3 min-w-0">
              <Mail className="h-5 w-5 text-indigo-500 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold leading-none">Recent Emails</h1>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5 hidden sm:block">
                  Sent email history and delivery status
                </p>
                {/* Day count badge under title */}
                <div className="flex items-center gap-2 mt-1.5">
                  <input
                    type="date"
                    value={selectedDateIST}
                    max={getTodayIST()}
                    onChange={(e) => setCountDate(e.target.value)}
                    className="text-xs border border-[var(--border)] rounded-md px-2 py-0.5 bg-[var(--background)] text-[var(--foreground)] cursor-pointer"
                  />
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800">
                    {loading ? (
                      <span className="text-xs text-indigo-400">...</span>
                    ) : (
                      <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                        <span className="font-bold">{dayCount}</span> emails sent on {dayLabel}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right: controls */}
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              {/* Row 1: export + preset + limit */}
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowExport(true)}
                  className="text-xs h-8 px-3 border-indigo-200 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-400">
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Export
                </Button>

                <Select value={preset} onValueChange={(v) => { setPreset(v as Preset); setCurrentPage(1) }}>
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
                  onChange={(e) => { setLoading(true); setLimit(Number(e.target.value)); setCurrentPage(1) }}
                  className="text-xs sm:text-sm border border-[var(--border)] rounded-md px-2 py-1.5 bg-[var(--background)] text-[var(--foreground)] cursor-pointer"
                >
                  {LIMIT_OPTIONS.map(opt => (
                    <option key={opt} value={opt}>Limit {opt}</option>
                  ))}
                </select>
              </div>

              {/* Row 2: custom date range (only when custom selected) */}
              {preset === "custom" && (
                <div className="flex items-center gap-2">
                  <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                    className="text-xs border border-[var(--border)] rounded-md px-2 py-1.5 bg-[var(--background)] text-[var(--foreground)]" />
                  <span className="text-xs text-[var(--muted-foreground)]">to</span>
                  <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                    className="text-xs border border-[var(--border)] rounded-md px-2 py-1.5 bg-[var(--background)] text-[var(--foreground)]" />
                  <Button size="sm" onClick={handleCustomApply} disabled={!customFrom || !customTo} className="h-7 text-xs">Apply</Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main className="px-4 sm:px-6 py-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Search bar */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
          <input
            type="text"
            placeholder="Search by email or subject..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1) }}
            className="w-full sm:max-w-sm pl-9 pr-4 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
          />
          {search && (
            <button onClick={() => { setSearch(""); setCurrentPage(1) }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Status filter chips */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {(["all", "sent", "delivered", "bounced", "failed"] as StatusFilter[]).map((f) => (
            <button key={f} onClick={() => { setStatusFilter(f); setCurrentPage(1) }}
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
            {filteredEmails.length > PAGE_SIZE && ` · Page ${currentPage} of ${Math.ceil(filteredEmails.length / PAGE_SIZE)}`}
            {statusFilter !== "all" && ` · filtered by "${statusFilter}"`}
          </p>
        )}

        {/* ── Mobile card list ──────────────────────────────────────────── */}
        <div className="sm:hidden rounded-lg border border-[var(--border)] overflow-hidden">
          {loading ? (
            [...Array(6)].map((_, i) => <SkeletonCard key={i} />)
          ) : paginatedEmails.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--muted-foreground)]">
              <Mail className="h-10 w-10 opacity-30" />
              <p className="text-sm">No emails found</p>
            </div>
          ) : (
            paginatedEmails.map((email, index) => (
              <div key={email.id} className="px-4 py-3.5 border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/30 transition-colors">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] text-[var(--muted-foreground)] shrink-0">#{(currentPage - 1) * PAGE_SIZE + index + 1}</span>
                    <span className="font-mono text-xs text-[var(--foreground)] truncate">{maskEmail(email.recipient)}</span>
                  </div>
                  <StatusBadge email={email} />
                </div>
                <p className="text-sm text-[var(--foreground)] truncate mb-1">{email.subject}</p>
                <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
                  <span>{formatTime(email.sentAt)}</span>
                  {email.delivered && <span className="text-emerald-500">• Delivered</span>}
                  {email.bounced   && <span className="text-red-500">• Bounced</span>}
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── Desktop table ─────────────────────────────────────────────── */}
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
              ) : paginatedEmails.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--muted-foreground)]">
                      <Mail className="h-10 w-10 opacity-30" />
                      <p className="text-sm">No emails found for this period</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedEmails.map((email, index) => (
                  <tr key={email.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/30 transition-colors">
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">{(currentPage - 1) * PAGE_SIZE + index + 1}</td>
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

        {/* Pagination */}
        {!loading && <Pagination total={filteredEmails.length} page={currentPage} onPage={setCurrentPage} />}
      </main>
    </div>
  )
}
