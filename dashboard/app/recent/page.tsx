"use client"

import { useState, useEffect, useCallback } from "react"
import { Mail, Download, X } from "lucide-react"
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

// ── PDF Export ───────────────────────────────────────────────────────────────
function exportPDF(emails: EmailLogEntry[], clientName: string, periodLabel: string) {
  const total = emails.length
  const delivered = emails.filter(e => e.delivered).length
  const bounced = emails.filter(e => e.bounced).length
  const failed = emails.filter(e => e.status === 'failed').length
  const deliveryRate = total > 0 ? ((delivered / total) * 100).toFixed(1) : '0.0'
  const bounceRate = total > 0 ? ((bounced / total) * 100).toFixed(1) : '0.0'
  const generatedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Email Performance Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; background: #fff; padding: 40px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 3px solid #6366f1; }
    .brand { font-size: 24px; font-weight: 900; color: #6366f1; letter-spacing: -0.5px; }
    .brand span { color: #1e293b; }
    .meta-right { text-align: right; }
    .report-title { font-size: 18px; font-weight: 700; color: #1e293b; }
    .report-sub { font-size: 12px; color: #64748b; margin-top: 3px; }
    .section-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px; margin-top: 28px; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
    .stat-card { border-radius: 12px; padding: 18px; text-align: center; position: relative; overflow: hidden; }
    .stat-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; }
    .stat-card.blue { background: #eff6ff; } .stat-card.blue::before { background: #6366f1; }
    .stat-card.green { background: #f0fdf4; } .stat-card.green::before { background: #10b981; }
    .stat-card.red { background: #fef2f2; } .stat-card.red::before { background: #ef4444; }
    .stat-card.orange { background: #fff7ed; } .stat-card.orange::before { background: #f97316; }
    .stat-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
    .stat-value { font-size: 32px; font-weight: 900; margin: 8px 0 4px; }
    .stat-value.blue { color: #6366f1; } .stat-value.green { color: #10b981; }
    .stat-value.red { color: #ef4444; } .stat-value.orange { color: #f97316; }
    .rate-pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .rate-pill.green { background: #bbf7d0; color: #14532d; }
    .rate-pill.red { background: #fecaca; color: #7f1d1d; }
    .rate-pill.gray { background: #e2e8f0; color: #475569; }
    .banner { margin-top: 20px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 12px; padding: 20px 24px; color: white; display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .banner-item .b-label { font-size: 11px; opacity: 0.75; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .banner-item .b-value { font-size: 22px; font-weight: 800; margin-top: 4px; }
    .footer { margin-top: 36px; padding-top: 14px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #94a3b8; }
    .footer-brand { font-weight: 700; color: #6366f1; }
    @media print { body { padding: 24px; } @page { margin: 1cm; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">Lumos<span>Mails</span></div>
      <div style="font-size:11px;color:#94a3b8;margin-top:3px;">by LumosLogic</div>
    </div>
    <div class="meta-right">
      <div class="report-title">Email Performance Report</div>
      <div class="report-sub">${clientName} &nbsp;·&nbsp; ${periodLabel}</div>
      <div class="report-sub" style="margin-top:2px;">Generated: ${generatedAt} IST</div>
    </div>
  </div>

  <div class="section-label">Performance Summary</div>
  <div class="stats-grid">
    <div class="stat-card blue">
      <div class="stat-label">Total Sent</div>
      <div class="stat-value blue">${total}</div>
      <div class="rate-pill gray">emails</div>
    </div>
    <div class="stat-card green">
      <div class="stat-label">Delivered</div>
      <div class="stat-value green">${delivered}</div>
      <div class="rate-pill green">${deliveryRate}% rate</div>
    </div>
    <div class="stat-card red">
      <div class="stat-label">Bounced</div>
      <div class="stat-value red">${bounced}</div>
      <div class="rate-pill red">${bounceRate}% rate</div>
    </div>
    <div class="stat-card orange">
      <div class="stat-label">Failed</div>
      <div class="stat-value orange">${failed}</div>
      <div class="rate-pill gray">${total > 0 ? ((failed/total)*100).toFixed(1) : '0.0'}% rate</div>
    </div>
  </div>

  <div class="banner">
    <div class="banner-item"><div class="b-label">Period</div><div class="b-value" style="font-size:15px;margin-top:6px;">${periodLabel}</div></div>
    <div class="banner-item"><div class="b-label">Delivery Rate</div><div class="b-value">${deliveryRate}%</div></div>
    <div class="banner-item"><div class="b-label">Bounce Rate</div><div class="b-value">${bounceRate}%</div></div>
    <div class="banner-item"><div class="b-label">Success</div><div class="b-value">${delivered}<span style="font-size:14px;opacity:0.7"> / ${total}</span></div></div>
  </div>

  <div class="footer">
    <div class="footer-brand">LumosMails</div>
    <div>Confidential · For internal use only</div>
    <div>${new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}</div>
  </div>
</body>
</html>`

  const win = window.open('', '_blank', 'width=960,height=720')
  if (win) {
    win.document.write(html)
    win.document.close()
    setTimeout(() => win.print(), 600)
  }
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

  const handleExport = () => {
    if (exportLogs) exportCSV(emails, periodLabel)
    if (exportReport) exportPDF(emails, clientName, periodLabel)
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
            <div className="flex items-center gap-3 min-w-0">
              <Mail className="h-5 w-5 text-indigo-500 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold leading-none">Recent Emails</h1>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5 hidden sm:block">
                  Sent email history and delivery status
                </p>
              </div>
            </div>

            {/* Controls top right */}
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              {/* Row 1: dropdowns + export */}
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

          {/* Custom date range — below header row */}
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
