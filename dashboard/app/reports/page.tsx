"use client"

import { useState, useEffect, useCallback } from "react"
import { FileBarChart2, Download, FileText, Table } from "lucide-react"
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
  bounceReason?: string
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

function getTodayIST(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split("T")[0]
}

function getEmailStatus(email: EmailLogEntry): "bounced" | "delivered" | "sent" | "failed" {
  if (email.bounced) return "bounced"
  if (email.delivered) return "delivered"
  if (email.status === "sent") return "sent"
  return "failed"
}

type Preset = "1" | "7" | "30" | "90" | "custom"
type StatusFilter = "all" | "sent" | "delivered" | "bounced" | "failed"

const LIMIT_OPTIONS = [100, 200, 500, 1000, 3000, 5000]

// ── CSV Export ────────────────────────────────────────────────────────────────
function exportCSV(emails: EmailLogEntry[], periodLabel: string) {
  const headers = ["#", "Email", "Subject", "Status", "Delivered", "Bounced", "Bounce Reason", "Time (IST)"]
  const rows = emails.map((e, i) => [
    i + 1,
    e.recipient,
    `"${e.subject.replace(/"/g, '""')}"`,
    getEmailStatus(e),
    e.delivered ? "Yes" : "No",
    e.bounced ? "Yes" : "No",
    e.bounceReason ? `"${e.bounceReason.replace(/"/g, '""')}"` : "",
    formatTime(e.sentAt),
  ])
  const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n")
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `email-logs-${periodLabel.replace(/\s+/g, "-")}-${getTodayIST()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── PDF Export ────────────────────────────────────────────────────────────────
async function exportPDF(emails: EmailLogEntry[], clientName: string, periodLabel: string) {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })

  const total = emails.length
  const delivered = emails.filter(e => e.delivered).length
  const bounced = emails.filter(e => e.bounced).length
  const failed = emails.filter(e => e.status === "failed").length
  const deliveryRate = total > 0 ? ((delivered / total) * 100).toFixed(1) : "0.0"
  const bounceRate = total > 0 ? ((bounced / total) * 100).toFixed(1) : "0.0"
  const generatedAt = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  // ── Header bar ──────────────────────────────────────────────────────────────
  doc.setFillColor(99, 102, 241)
  doc.rect(0, 0, pageW, 22, "F")
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16); doc.setFont("helvetica", "bold")
  doc.text("LumosMails", 14, 13)
  doc.setFontSize(10); doc.setFont("helvetica", "normal")
  doc.text("Email Performance Report", pageW - 14, 9, { align: "right" })
  doc.text(`${clientName} · ${periodLabel}`, pageW - 14, 15, { align: "right" })

  // Generated line
  doc.setTextColor(100, 116, 139)
  doc.setFontSize(8)
  doc.text(`Generated: ${generatedAt} IST`, 14, 30)

  // Section label
  doc.setFontSize(9); doc.setFont("helvetica", "bold")
  doc.setTextColor(148, 163, 184)
  doc.text("PERFORMANCE SUMMARY", 14, 40)

  // ── Stat cards ──────────────────────────────────────────────────────────────
  const cardW = (pageW - 28 - 9) / 4
  const cardH = 28
  const cardY = 44
  const cards: { label: string; value: string; sub: string; color: [number, number, number] }[] = [
    { label: "Total Sent",  value: String(total),     sub: "emails",          color: [99, 102, 241] },
    { label: "Delivered",   value: String(delivered), sub: `${deliveryRate}% rate`, color: [16, 185, 129] },
    { label: "Bounced",     value: String(bounced),   sub: `${bounceRate}% rate`,   color: [239, 68, 68] },
    { label: "Failed",      value: String(failed),    sub: "emails",          color: [249, 115, 22] },
  ]

  cards.forEach((card, i) => {
    const x = 14 + i * (cardW + 3)
    doc.setFillColor(248, 250, 252)
    doc.roundedRect(x, cardY, cardW, cardH, 2, 2, "F")
    doc.setFillColor(...card.color)
    doc.rect(x, cardY, cardW, 1.5, "F")
    doc.setTextColor(100, 116, 139); doc.setFontSize(7); doc.setFont("helvetica", "bold")
    doc.text(card.label.toUpperCase(), x + cardW / 2, cardY + 7, { align: "center" })
    doc.setTextColor(...card.color); doc.setFontSize(18); doc.setFont("helvetica", "bold")
    doc.text(card.value, x + cardW / 2, cardY + 18, { align: "center" })
    doc.setTextColor(100, 116, 139); doc.setFontSize(7); doc.setFont("helvetica", "normal")
    doc.text(card.sub, x + cardW / 2, cardY + 24, { align: "center" })
  })

  // ── Banner ──────────────────────────────────────────────────────────────────
  const bannerY = cardY + cardH + 8
  doc.setFillColor(99, 102, 241)
  doc.roundedRect(14, bannerY, pageW - 28, 22, 3, 3, "F")
  const bannerCols = [
    { label: "PERIOD",        value: periodLabel },
    { label: "DELIVERY RATE", value: `${deliveryRate}%` },
    { label: "BOUNCE RATE",   value: `${bounceRate}%` },
    { label: "SUCCESS",       value: `${delivered} / ${total}` },
  ]
  const colW = (pageW - 28) / 4
  bannerCols.forEach((col, i) => {
    const x = 14 + i * colW + colW / 2
    doc.setTextColor(255, 255, 255); doc.setFontSize(7); doc.setFont("helvetica", "normal")
    doc.text(col.label, x, bannerY + 7, { align: "center" })
    doc.setFontSize(11); doc.setFont("helvetica", "bold")
    doc.text(col.value, x, bannerY + 16, { align: "center" })
  })

  // ── Email Logs Table ─────────────────────────────────────────────────────────
  const tableStartY = bannerY + 22 + 10
  doc.setFontSize(9); doc.setFont("helvetica", "bold")
  doc.setTextColor(148, 163, 184)
  doc.text("EMAIL LOGS", 14, tableStartY)

  // Table header — widths: # 8, Recipient 38, Subject 42, Status 18, Del 10, Bounced 10, Reason 28, Time 28 = 182mm
  const rowH = 7
  const colXs = [14, 22, 60, 102, 120, 130, 140, 168]
  const colLabels = ["#", "Recipient", "Subject", "Status", "Del", "Bnc", "Bounce Reason", "Time"]
  const headerY = tableStartY + 5

  doc.setFillColor(241, 245, 249)
  doc.rect(14, headerY, pageW - 28, rowH, "F")
  doc.setTextColor(100, 116, 139); doc.setFontSize(7); doc.setFont("helvetica", "bold")
  colLabels.forEach((lbl, i) => {
    doc.text(lbl, colXs[i] + 1, headerY + 5)
  })

  // Table rows
  let currentY = headerY + rowH
  let pageNum = 1

  const addFooter = () => {
    doc.setDrawColor(226, 232, 240)
    doc.line(14, pageH - 12, pageW - 14, pageH - 12)
    doc.setTextColor(148, 163, 184); doc.setFontSize(7); doc.setFont("helvetica", "normal")
    doc.text("LumosMails by LumosLogic", 14, pageH - 7)
    doc.text("Confidential · For internal use only", pageW / 2, pageH - 7, { align: "center" })
    doc.text(`Page ${pageNum}`, pageW - 14, pageH - 7, { align: "right" })
  }

  emails.forEach((email, idx) => {
    if (currentY > pageH - 20) {
      addFooter()
      doc.addPage()
      pageNum++
      currentY = 15

      // Repeat header on new page
      doc.setFillColor(241, 245, 249)
      doc.rect(14, currentY, pageW - 28, rowH, "F")
      doc.setTextColor(100, 116, 139); doc.setFontSize(7); doc.setFont("helvetica", "bold")
      colLabels.forEach((lbl, i) => {
        doc.text(lbl, colXs[i] + 1, currentY + 5)
      })
      currentY += rowH
    }

    const isEven = idx % 2 === 0
    if (isEven) {
      doc.setFillColor(248, 250, 252)
      doc.rect(14, currentY, pageW - 28, rowH, "F")
    }

    const st = getEmailStatus(email)
    const statusColor: [number, number, number] =
      st === "delivered" ? [16, 185, 129]
      : st === "bounced" || st === "failed" ? [239, 68, 68]
      : [234, 179, 8]

    doc.setTextColor(71, 85, 105); doc.setFontSize(6.5); doc.setFont("helvetica", "normal")
    doc.text(String(idx + 1), colXs[0] + 1, currentY + 5)

    // Recipient — truncate (38mm col ~24 chars)
    const recipientTxt = email.recipient.length > 24 ? email.recipient.slice(0, 23) + "..." : email.recipient
    doc.text(recipientTxt, colXs[1] + 1, currentY + 5)

    // Subject — truncate (42mm col ~26 chars)
    const subjectTxt = email.subject.length > 26 ? email.subject.slice(0, 25) + "..." : email.subject
    doc.text(subjectTxt, colXs[2] + 1, currentY + 5)

    // Status
    doc.setTextColor(...statusColor); doc.setFont("helvetica", "bold")
    doc.text(st.charAt(0).toUpperCase() + st.slice(1), colXs[3] + 1, currentY + 5)

    // Delivered
    doc.setTextColor(16, 185, 129); doc.setFont("helvetica", "normal")
    doc.text(email.delivered ? "Yes" : "No", colXs[4] + 1, currentY + 5)

    // Bounced
    doc.setTextColor(email.bounced ? 239 : 100, email.bounced ? 68 : 116, email.bounced ? 68 : 139)
    doc.text(email.bounced ? "Yes" : "No", colXs[5] + 1, currentY + 5)

    // Bounce Reason — truncate (28mm col ~18 chars)
    doc.setTextColor(239, 68, 68)
    const reasonTxt = email.bounceReason ? (email.bounceReason.length > 18 ? email.bounceReason.slice(0, 17) + "..." : email.bounceReason) : "-"
    doc.text(reasonTxt, colXs[6] + 1, currentY + 5)

    // Time
    doc.setTextColor(100, 116, 139)
    const timeStr = formatTime(email.sentAt)
    doc.text(timeStr, colXs[7] + 1, currentY + 5)

    // Row divider
    doc.setDrawColor(226, 232, 240)
    doc.line(14, currentY + rowH, pageW - 14, currentY + rowH)

    currentY += rowH
  })

  addFooter()
  doc.save(`email-report-${clientName.replace(/\s+/g, "-")}-${getTodayIST()}.pdf`)
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const { role, selectedClientId, selectedClientName } = useClient()
  const [emails, setEmails] = useState<EmailLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(1000)
  const [preset, setPreset] = useState<Preset>("7")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [pdfLoading, setPdfLoading] = useState(false)

  const fetchEmails = useCallback(async () => {
    setLoading(true)
    try {
      let params: Parameters<typeof getRecentEmails>[0] = { limit }

      if (preset === "custom" && customFrom && customTo) {
        params = { limit, from: customFrom, to: customTo }
      } else {
        params = { limit, days: parseInt(preset) }
      }

      const effectiveRole = decodeToken()?.role
      let data: { emails: EmailLogEntry[] }
      if (effectiveRole === "admin" && selectedClientId) {
        const adminData = await getAdminClientEmails(selectedClientId, params)
        data = { emails: adminData.emails as EmailLogEntry[] }
      } else if (effectiveRole === "client") {
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
  }, [limit, preset, customFrom, customTo, selectedClientId])

  useEffect(() => {
    if (preset === "custom") return
    const token = decodeToken()
    if (token?.role === "admin" && !selectedClientId) return
    fetchEmails()
  }, [preset, limit, selectedClientId, fetchEmails])

  const handleCustomApply = () => {
    if (customFrom && customTo) fetchEmails()
  }

  const filteredEmails = emails.filter(e =>
    statusFilter === "all" || getEmailStatus(e) === statusFilter
  )

  const counts = {
    all: emails.length,
    sent: emails.filter(e => getEmailStatus(e) === "sent").length,
    delivered: emails.filter(e => getEmailStatus(e) === "delivered").length,
    bounced: emails.filter(e => getEmailStatus(e) === "bounced").length,
    failed: emails.filter(e => getEmailStatus(e) === "failed").length,
  }

  const presetLabel: Record<Preset, string> = {
    "1": "Today",
    "7": "Last 7 days",
    "30": "Last 30 days",
    "90": "Last 3 months",
    "custom": customFrom && customTo ? `${customFrom} to ${customTo}` : "Custom",
  }

  const clientName = selectedClientName || "Dashboard"
  const periodLabel = presetLabel[preset]

  const handleCSV = () => exportCSV(filteredEmails, periodLabel)
  const handlePDF = async () => {
    setPdfLoading(true)
    try {
      await exportPDF(filteredEmails, clientName, periodLabel)
    } finally {
      setPdfLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-14 lg:top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
        <div className="px-4 sm:px-6 py-3 sm:py-4">
          {/* Title row */}
          <div className="flex items-start sm:items-center justify-between gap-3 mb-3">
            {/* Left */}
            <div className="flex items-center gap-3 min-w-0">
              <FileBarChart2 className="h-5 w-5 text-indigo-500 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold leading-none">Reports</h1>
                {!loading && (
                  <p className="text-xs text-indigo-500 font-medium mt-0.5">
                    {filteredEmails.length} emails · {periodLabel}
                  </p>
                )}
                {loading && (
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">Loading…</p>
                )}
              </div>
            </div>

            {/* Right: filters */}
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <div className="flex items-center gap-2">
                <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
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
                  {LIMIT_OPTIONS.map(opt => (
                    <option key={opt} value={opt}>Limit {opt}</option>
                  ))}
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

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <main className="px-4 sm:px-6 py-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}

        {/* ── Stats cards ─────────────────────────────────────────────────── */}
        {!loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Total Sent",  value: counts.all,       color: "text-indigo-500",  bg: "bg-indigo-500/10" },
              { label: "Delivered",   value: counts.delivered, color: "text-emerald-500", bg: "bg-emerald-500/10" },
              { label: "Bounced",     value: counts.bounced,   color: "text-red-500",     bg: "bg-red-500/10" },
              { label: "Failed",      value: counts.failed,    color: "text-orange-500",  bg: "bg-orange-500/10" },
            ].map(card => (
              <div key={card.label} className={`rounded-xl border border-[var(--border)] p-4 ${card.bg}`}>
                <p className="text-xs text-[var(--muted-foreground)] mb-1">{card.label}</p>
                <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
                {counts.all > 0 && card.label !== "Total Sent" && (
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                    {((card.value / counts.all) * 100).toFixed(1)}%
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Status chips + Export buttons ────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <div className="flex items-center gap-2 flex-wrap">
            {(["all", "delivered", "bounced", "failed"] as StatusFilter[]).map(f => (
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
                }`}>
                {f.charAt(0).toUpperCase() + f.slice(1)}{!loading && ` (${counts[f]})`}
              </button>
            ))}
          </div>

          {/* Export buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCSV}
              disabled={loading || filteredEmails.length === 0}
              className="flex items-center gap-1.5 text-xs"
            >
              <Table className="h-3.5 w-3.5" />
              Export CSV
            </Button>
            <Button
              size="sm"
              onClick={handlePDF}
              disabled={loading || filteredEmails.length === 0 || pdfLoading}
              className="flex items-center gap-1.5 text-xs bg-indigo-500 hover:bg-indigo-600 text-white"
            >
              {pdfLoading ? (
                <span className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              {pdfLoading ? "Generating…" : "Export PDF"}
            </Button>
          </div>
        </div>

        {!loading && (
          <p className="text-sm text-[var(--muted-foreground)] mb-4">
            {filteredEmails.length} email{filteredEmails.length !== 1 ? "s" : ""}
            {statusFilter !== "all" && ` · filtered by "${statusFilter}"`}
          </p>
        )}

        {/* ── Preview table ────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          {/* Mobile cards */}
          <div className="sm:hidden">
            {loading ? (
              [...Array(5)].map((_, i) => (
                <div key={i} className="p-4 border-b border-[var(--border)] animate-pulse">
                  <div className="h-4 w-36 rounded bg-[var(--muted)] mb-2" />
                  <div className="h-3.5 w-48 rounded bg-[var(--muted)] mb-1.5" />
                  <div className="h-3 w-24 rounded bg-[var(--muted)]" />
                </div>
              ))
            ) : filteredEmails.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--muted-foreground)]">
                <FileBarChart2 className="h-10 w-10 opacity-30" />
                <p className="text-sm">No emails for this period</p>
              </div>
            ) : (
              filteredEmails.slice(0, 50).map((email, idx) => {
                const st = getEmailStatus(email)
                return (
                  <div key={email.id} className="px-4 py-3.5 border-b border-[var(--border)] last:border-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[10px] text-[var(--muted-foreground)]">#{idx + 1}</span>
                      <span className={`text-xs font-medium capitalize px-2 py-0.5 rounded-full ${
                        st === "delivered" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : st === "bounced" || st === "failed" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                      }`}>{st}</span>
                    </div>
                    <p className="text-xs font-mono text-[var(--foreground)] truncate mb-0.5">{maskEmail(email.recipient)}</p>
                    <p className="text-sm truncate mb-1">{email.subject}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">{formatTime(email.sentAt)}</p>
                  </div>
                )
              })
            )}
            {!loading && filteredEmails.length > 50 && (
              <div className="px-4 py-3 text-center text-xs text-[var(--muted-foreground)] border-t border-[var(--border)]">
                Showing first 50 of {filteredEmails.length} · Export to see all
              </div>
            )}
          </div>

          {/* Desktop table */}
          <table className="hidden sm:table w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50">
                <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)] w-10">#</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Email</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Subject</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Status</th>
                <th className="px-4 py-3 text-center font-medium text-[var(--muted-foreground)]">Delivered</th>
                <th className="px-4 py-3 text-center font-medium text-[var(--muted-foreground)]">Bounced</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Bounce Reason</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Time</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="border-b border-[var(--border)]">
                    {[...Array(8)].map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 rounded bg-[var(--muted)] animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredEmails.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--muted-foreground)]">
                      <FileBarChart2 className="h-10 w-10 opacity-30" />
                      <p className="text-sm">No emails for this period</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredEmails.slice(0, 200).map((email, idx) => {
                  const st = getEmailStatus(email)
                  return (
                    <tr key={email.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/30 transition-colors">
                      <td className="px-4 py-3 text-[var(--muted-foreground)]">{idx + 1}</td>
                      <td className="px-4 py-3 font-mono text-xs">{maskEmail(email.recipient)}</td>
                      <td className="px-4 py-3 max-w-xs truncate">{email.subject}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                          st === "delivered" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : st === "bounced" || st === "failed" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                        }`}>{st}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {email.delivered ? <span className="text-emerald-500">✓</span> : <span className="text-[var(--muted-foreground)]">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {email.bounced ? <span className="text-red-500">✓</span> : <span className="text-[var(--muted-foreground)]">—</span>}
                      </td>
                      <td className="px-4 py-3 max-w-[180px]">
                        {email.bounceReason ? (
                          <span className="text-xs text-red-500 truncate block" title={email.bounceReason}>
                            {email.bounceReason}
                          </span>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--muted-foreground)] whitespace-nowrap">{formatTime(email.sentAt)}</td>
                    </tr>
                  )
                })
              )}
              {!loading && filteredEmails.length > 200 && (
                <tr>
                  <td colSpan={8} className="px-4 py-3 text-center text-xs text-[var(--muted-foreground)] border-t border-[var(--border)]">
                    Showing first 200 of {filteredEmails.length} rows · Export CSV/PDF to see all
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
