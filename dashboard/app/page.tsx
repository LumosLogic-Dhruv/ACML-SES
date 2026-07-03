"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Send,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Activity,
  Clock,
  ServerOff,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatCard } from "@/components/StatCard"
import { getStats, getJobs, getHealth, getAdminClientStats, getClientStats, DbStats, JobsData, HealthData } from "@/lib/api"
import { useClient } from "@/lib/clientContext"
import { decodeToken } from "@/lib/auth"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"

type Preset = "1" | "7" | "30" | "90" | "custom"

const CHART_COLORS = {
  Sent: "#6366f1",
  Delivered: "#10b981",
  Bounced: "#ef4444",
  Failed: "#f97316",
}

export default function Dashboard() {
  const { role, selectedClientId, selectedClientName } = useClient()
  const [preset, setPreset] = useState<Preset>("1")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")
  const [stats, setStats] = useState<DbStats | null>(null)
  const [jobs, setJobs] = useState<JobsData | null>(null)
  const [health, setHealth] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchData = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const days = parseInt(preset)
      const effectiveRole = decodeToken()?.role
      const isAdmin = effectiveRole === "admin"
      const isClient = effectiveRole === "client"

      const [statsData, jobsData, healthData] = await Promise.allSettled([
        isAdmin && selectedClientId
          ? getAdminClientStats(selectedClientId, preset === "custom" ? 7 : days)
          : isClient
            ? getClientStats(preset === "custom" && customFrom && customTo ? { from: customFrom, to: customTo } : { days })
            : getStats(preset === "custom" && customFrom && customTo ? { from: customFrom, to: customTo } : { days }),
        getJobs(),
        getHealth(),
      ])

      if (statsData.status === "fulfilled") setStats(statsData.value)
      else setError(statsData.reason instanceof Error ? statsData.reason.message : "Failed to load stats")

      if (jobsData.status === "fulfilled") setJobs(jobsData.value)
      if (healthData.status === "fulfilled") setHealth(healthData.value)

      setLastUpdated(new Date())
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [preset, customFrom, customTo, role, selectedClientId])

  useEffect(() => {
    if (preset !== "custom") {
      const token = decodeToken()
      if (token?.role === "admin" && !selectedClientId) return
      fetchData()
    }
  }, [preset, selectedClientId, fetchData])

  useEffect(() => {
    const interval = setInterval(() => {
      if (preset !== "custom") fetchData()
    }, 60_000)
    return () => clearInterval(interval)
  }, [preset, fetchData])

  const handleCustomApply = () => {
    if (customFrom && customTo) fetchData()
  }

  const exportDashboardPDF = () => {
    if (!stats) return
    const { sent, delivered, bounced, failed, delivery_rate, bounce_rate } = stats.summary
    const clientName = selectedClientName || "Dashboard"
    const generatedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    const presetLabelMap: Record<string, string> = { "1": "Today", "7": "Last 7 days", "30": "Last 30 days", "90": "Last 3 months", "custom": "Custom range" }
    const periodLabel = presetLabelMap[preset] || preset

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Email Performance Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; background: #fff; padding: 40px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 3px solid #6366f1; }
    .brand { font-size: 24px; font-weight: 900; color: #6366f1; }
    .brand span { color: #1e293b; }
    .meta-right { text-align: right; }
    .report-title { font-size: 18px; font-weight: 700; }
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
    .banner-item .b-label { font-size: 11px; opacity: 0.75; font-weight: 600; text-transform: uppercase; }
    .banner-item .b-value { font-size: 22px; font-weight: 800; margin-top: 4px; }
    .footer { margin-top: 36px; padding-top: 14px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; }
    .footer-brand { font-weight: 700; color: #6366f1; }
    @media print { body { padding: 24px; } }
  </style>
</head>
<body>
  <div class="header">
    <div><div class="brand">Lumos<span>Mails</span></div><div style="font-size:11px;color:#94a3b8;margin-top:3px;">by LumosLogic</div></div>
    <div class="meta-right">
      <div class="report-title">Email Performance Report</div>
      <div class="report-sub">${clientName} · ${periodLabel}</div>
      <div class="report-sub" style="margin-top:2px;">Generated: ${generatedAt} IST</div>
    </div>
  </div>
  <div class="section-label">Performance Summary</div>
  <div class="stats-grid">
    <div class="stat-card blue"><div class="stat-label">Total Sent</div><div class="stat-value blue">${sent}</div><div class="rate-pill gray">emails</div></div>
    <div class="stat-card green"><div class="stat-label">Delivered</div><div class="stat-value green">${delivered}</div><div class="rate-pill green">${delivery_rate}% rate</div></div>
    <div class="stat-card red"><div class="stat-label">Bounced</div><div class="stat-value red">${bounced}</div><div class="rate-pill red">${bounce_rate}% rate</div></div>
    <div class="stat-card orange"><div class="stat-label">Failed</div><div class="stat-value orange">${failed}</div><div class="rate-pill gray">emails</div></div>
  </div>
  <div class="banner">
    <div class="banner-item"><div class="b-label">Period</div><div class="b-value" style="font-size:15px;margin-top:6px;">${periodLabel}</div></div>
    <div class="banner-item"><div class="b-label">Delivery Rate</div><div class="b-value">${delivery_rate}%</div></div>
    <div class="banner-item"><div class="b-label">Bounce Rate</div><div class="b-value">${bounce_rate}%</div></div>
    <div class="banner-item"><div class="b-label">Success</div><div class="b-value">${delivered}<span style="font-size:14px;opacity:0.7"> / ${sent}</span></div></div>
  </div>
  <div class="footer"><div class="footer-brand">LumosMails</div><div>Confidential · For internal use only</div><div>${new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}</div></div>
</body>
</html>`

    const win = window.open('', '_blank', 'width=960,height=720')
    if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 600) }
  }

  const serverStatus =
    health && typeof health === "object" && "status" in health
      ? String((health as { status: string }).status)
      : null

  const presetLabel: Record<Preset, string> = {
    "1": "Today",
    "7": "Last 7 days",
    "30": "Last 30 days",
    "90": "Last 3 months",
    "custom": "Custom range",
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="sticky top-14 lg:top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500">
                <Activity className="h-4 w-4 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold leading-none">Email Dashboard</h1>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {serverStatus && (
                <Badge variant={serverStatus === "ok" ? "success" : "warning"}>
                  {serverStatus === "ok" ? "Server Online" : serverStatus}
                </Badge>
              )}

              {lastUpdated && (
                <div className="hidden sm:flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                  <Clock className="h-3 w-3" />
                  <span>Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              )}

              <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Today</SelectItem>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 3 months</SelectItem>
                  <SelectItem value="custom">Custom range</SelectItem>
                </SelectContent>
              </Select>

              <Button variant="outline" size="sm" onClick={() => fetchData(true)} disabled={refreshing || loading}>
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            </div>
          </div>

          {/* Custom date range row */}
          {preset === "custom" && (
            <div className="flex items-center gap-3 pb-3">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="text-sm border border-[var(--border)] rounded-md px-3 py-1.5 bg-[var(--background)] text-[var(--foreground)]"
              />
              <span className="text-sm text-[var(--muted-foreground)]">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="text-sm border border-[var(--border)] rounded-md px-3 py-1.5 bg-[var(--background)] text-[var(--foreground)]"
              />
              <Button size="sm" onClick={handleCustomApply} disabled={!customFrom || !customTo}>
                Apply
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/30">
            <ServerOff className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-400">Unable to reach the API server</p>
              <p className="text-xs text-red-600/70 dark:text-red-500/70 mt-1">
                {error}
              </p>
            </div>
          </div>
        )}

        <div className="mb-6">
          <h2 className="text-2xl font-bold">{presetLabel[preset]} Overview</h2>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {selectedClientName ? `Viewing: ${selectedClientName}` : "Email delivery metrics"}
          </p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 mb-6">
          <StatCard title="Emails Sent"  value={stats?.summary.sent ?? 0}       icon={Send}          iconColor="text-indigo-500"  loading={loading} />
          <StatCard title="Delivered"    value={stats?.summary.delivered ?? 0}   icon={CheckCircle2}  iconColor="text-emerald-500" loading={loading}
            rate={stats?.summary.delivery_rate} rateLabel="delivery rate" badgeVariant="success" />
          <StatCard title="Bounced"      value={stats?.summary.bounced ?? 0}     icon={AlertTriangle} iconColor="text-red-500"     loading={loading}
            rate={stats?.summary.bounce_rate} rateLabel="bounce rate" badgeVariant="destructive" />
          <StatCard title="Failed"       value={stats?.summary.failed ?? 0}      icon={XCircle}       iconColor="text-orange-500"  loading={loading} />
        </div>

        {/* Chart */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Email Activity Over Time</CardTitle>
            <CardDescription>Day-by-day sending activity</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-72 w-full rounded-lg bg-[var(--muted)] animate-pulse" />
            ) : !stats?.timeseries.length ? (
              <div className="flex h-72 items-center justify-center text-[var(--muted-foreground)] text-sm">
                No data for selected period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart
                  data={stats.timeseries.map((r) => ({
                    date: new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                    Sent: r.sent,
                    Delivered: r.delivered,
                    Bounced: r.bounced,
                    Failed: r.failed,
                  }))}
                  margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "12px" }} />
                  <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "16px" }} />
                  {(Object.keys(CHART_COLORS) as (keyof typeof CHART_COLORS)[]).map((key) => (
                    <Line key={key} type="monotone" dataKey={key} stroke={CHART_COLORS[key]} strokeWidth={2} dot={{ r: 4, fill: CHART_COLORS[key] }} activeDot={{ r: 6 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Queue Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Queue Status
            </CardTitle>
            <CardDescription>Email processing job queue</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                <div className="h-16 rounded-lg bg-[var(--muted)] animate-pulse" />
                <div className="h-24 rounded-lg bg-[var(--muted)] animate-pulse" />
              </div>
            ) : !jobs ? (
              <div className="flex items-center justify-center h-16 text-sm text-[var(--muted-foreground)]">No queue data available</div>
            ) : (
              <div className="space-y-5">
                {/* Live queue counts */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-[var(--border)] p-4 flex items-center gap-3">
                    <div className={`h-2.5 w-2.5 rounded-full ${jobs.queue.active > 0 ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`} />
                    <div>
                      <p className="text-xs text-[var(--muted-foreground)]">Active</p>
                      <p className="text-2xl font-bold text-emerald-500">{jobs.queue.active}</p>
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] p-4 flex items-center gap-3">
                    <div className={`h-2.5 w-2.5 rounded-full ${jobs.queue.waiting > 0 ? "bg-amber-500" : "bg-slate-400"}`} />
                    <div>
                      <p className="text-xs text-[var(--muted-foreground)]">Waiting</p>
                      <p className="text-2xl font-bold text-amber-500">{jobs.queue.waiting}</p>
                    </div>
                  </div>
                </div>

                {/* Recent completed jobs */}
                <div>
                  <p className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-2">Recent Completed</p>
                  {jobs.recent_completed.length === 0 ? (
                    <p className="text-sm text-[var(--muted-foreground)] py-2">No completed jobs</p>
                  ) : (
                    <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
                      {jobs.recent_completed.map((job) => {
                        const rate = job.total > 0 ? Math.round((job.sent / job.total) * 100) : 0
                        return (
                          <div key={job.job_id} className="flex items-center justify-between px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-[var(--muted-foreground)]">#{job.job_id}</span>
                              <span className="text-sm font-medium">{job.total.toLocaleString()} recipients</span>
                            </div>
                            <div className="flex items-center gap-4 text-sm">
                              <span className="text-emerald-500 font-medium">{job.sent.toLocaleString()} sent</span>
                              {job.failed > 0 && <span className="text-red-500 font-medium">{job.failed} failed</span>}
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${rate === 100 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"}`}>
                                {rate}%
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Recent failed jobs */}
                {jobs.recent_failed.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-2">Recent Failed</p>
                    <div className="rounded-lg border border-red-200 dark:border-red-900/50 divide-y divide-red-100 dark:divide-red-900/30">
                      {jobs.recent_failed.map((job) => (
                        <div key={job.job_id} className="flex items-start gap-3 px-4 py-3">
                          <span className="text-xs font-mono text-[var(--muted-foreground)] mt-0.5">#{job.job_id}</span>
                          <span className="text-sm text-red-600 dark:text-red-400">{job.error}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <footer className="border-t border-[var(--border)] mt-12 py-6">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs text-[var(--muted-foreground)]">
            Auto-refreshes every 60 seconds
          </p>
        </div>
      </footer>
    </div>
  )
}
