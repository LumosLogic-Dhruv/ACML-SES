import { getStoredApiKey, getToken } from './auth'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3006'

// ── Admin fetch (JWT Bearer) ──────────────────────────────────────────────────
async function fetchAdmin(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken()
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers as Record<string, string> ?? {}),
    },
  })
}

// Admin types
export interface ClientKey {
  id: string
  client_name: string
  allowed_domain: string
  key: string
  key_preview: string
  is_active: boolean
  created_at: string
}

export interface AdminUser {
  id: string
  username: string
  email?: string
  role: string
  client_id: string | null
  client_name?: string
  created_at: string
}

export interface AdminClientStats {
  summary: {
    sent: number; delivered: number; bounced: number; failed: number
    delivery_rate: number; bounce_rate: number
  }
  timeseries: { date: string; sent: number; delivered: number; bounced: number; failed: number }[]
  from?: string
  to?: string
}

export interface AdminClientEmails {
  total: number
  limit: number
  offset: number
  emails: {
    id: string; messageId: string; recipient: string; subject: string
    sentAt: string; status: string; delivered: boolean; bounced: boolean; bounceReason?: string; bounceType?: string
  }[]
}

// Admin API functions
export async function getAdminClients(): Promise<{ keys: ClientKey[] }> {
  const res = await fetchAdmin('/admin/keys')
  if (!res.ok) throw new Error('Failed to fetch clients')
  return res.json()
}

export async function createAdminClient(body: { client_name: string; allowed_domain: string }): Promise<{ api_key: string; client_name: string }> {
  const res = await fetchAdmin('/admin/keys', { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed to create client') }
  return res.json()
}

export async function revokeAdminClient(id: string): Promise<void> {
  const res = await fetchAdmin(`/admin/keys/${id}/revoke`, { method: 'PATCH' })
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed to revoke') }
}

export async function activateAdminClient(id: string): Promise<void> {
  const res = await fetchAdmin(`/admin/keys/${id}/activate`, { method: 'PATCH' })
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed to activate') }
}

export async function getAdminClientStats(clientId: string, days: number): Promise<AdminClientStats> {
  const res = await fetchAdmin(`/admin/clients/${clientId}/stats?days=${days}`)
  if (!res.ok) throw new Error('Failed to fetch client stats')
  return res.json()
}

export async function getAdminClientEmails(clientId: string, params: { limit?: number; offset?: number; from?: string; to?: string; days?: number } = {}): Promise<AdminClientEmails> {
  const q = new URLSearchParams({ limit: String(params.limit ?? 100), offset: String(params.offset ?? 0) })
  if (params.from && params.to) { q.set('from', params.from); q.set('to', params.to) }
  else if (params.days) { q.set('days', String(params.days)) }
  const res = await fetchAdmin(`/admin/clients/${clientId}/emails?${q}`)
  if (!res.ok) throw new Error('Failed to fetch client emails')
  return res.json()
}

export async function getAdminUsers(): Promise<{ users: AdminUser[] }> {
  const res = await fetchAdmin('/admin/users')
  if (!res.ok) throw new Error('Failed to fetch users')
  return res.json()
}

export async function createAdminUser(body: { username: string; password: string; role: string; client_id?: string }): Promise<void> {
  const res = await fetchAdmin('/admin/users', { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed to create user') }
}

export async function resetAdminUserPassword(id: string, password: string): Promise<void> {
  const res = await fetchAdmin(`/admin/users/${id}/password`, { method: 'PATCH', body: JSON.stringify({ password }) })
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed to reset password') }
}

export async function deleteAdminUser(id: string): Promise<void> {
  const res = await fetchAdmin(`/admin/users/${id}`, { method: 'DELETE' })
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed to delete user') }
}

// ── Client self-service API (JWT auth, scoped to own client_id) ──────────────

export interface ClientInfo {
  id: string
  client_name: string
  allowed_domain: string
}

export async function getClientInfo(): Promise<{ client: ClientInfo }> {
  const res = await fetchAdmin('/client/info')
  if (!res.ok) throw new Error('Failed to fetch client info')
  return res.json()
}

export async function getClientStats(params: { days?: number; from?: string; to?: string }): Promise<DbStats> {
  const query = params.from && params.to
    ? `from=${params.from}&to=${params.to}`
    : `days=${params.days ?? 7}`
  const res = await fetchAdmin(`/client/stats?${query}`)
  if (!res.ok) throw new Error('Failed to fetch client stats')
  return res.json()
}

export async function getClientEmails(params: { limit?: number; offset?: number; search?: string; from?: string; to?: string; days?: number } = {}): Promise<AdminClientEmails> {
  const q = new URLSearchParams({
    limit: String(params.limit ?? 100),
    offset: String(params.offset ?? 0),
    ...(params.search ? { search: params.search } : {}),
  })
  if (params.from && params.to) { q.set('from', params.from); q.set('to', params.to) }
  else if (params.days) { q.set('days', String(params.days)) }
  const res = await fetchAdmin(`/client/emails?${q}`)
  if (!res.ok) throw new Error('Failed to fetch client emails')
  return res.json()
}

export interface MetricsSummary {
  period_days: number
  summary: {
    sent: number
    delivered: number
    bounced: number
    complained: number
    rejected: number
    opened: number
    clicked: number
  }
  rates: {
    delivery_rate_percent: number
    bounce_rate_percent: number
    open_rate_percent: number
    click_rate_percent: number
  }
}

export interface TimeseriesMetric {
  timestamps: string[]
  values: number[]
}

export interface MetricsTimeseries {
  period_days: number
  metrics: {
    send: TimeseriesMetric
    delivery: TimeseriesMetric
    open: TimeseriesMetric
    click: TimeseriesMetric
    bounce: TimeseriesMetric
  }
}

export interface JobsData {
  queue: { active: number; waiting: number }
  recent_completed: { job_id: string; total: number; sent: number; failed: number }[]
  recent_failed: { job_id: string; error: string }[]
}

export interface HealthData {
  status: string
  [key: string]: unknown
}

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: (() => { const k = getStoredApiKey(); return k ? { 'X-Api-Key': k } : {} })(),
    })
    clearTimeout(id)
    return res
  } catch (err) {
    clearTimeout(id)
    throw err
  }
}

export async function getMetricsSummary(days: number): Promise<MetricsSummary> {
  const res = await fetchWithTimeout(`${BASE_URL}/api/metrics?days=${days}&format=summary`)
  if (!res.ok) throw new Error(`Failed to fetch summary: ${res.status}`)
  return res.json()
}

export async function getMetricsTimeseries(days: number): Promise<MetricsTimeseries> {
  const res = await fetchWithTimeout(`${BASE_URL}/api/metrics?days=${days}&format=timeseries`)
  if (!res.ok) throw new Error(`Failed to fetch timeseries: ${res.status}`)
  return res.json()
}

export async function getJobs(): Promise<JobsData> {
  const res = await fetchWithTimeout(`${BASE_URL}/api/jobs`)
  if (!res.ok) throw new Error(`Failed to fetch jobs: ${res.status}`)
  return res.json()
}

export async function getHealth(): Promise<HealthData> {
  const res = await fetchWithTimeout(`${BASE_URL}/health`)
  if (!res.ok) throw new Error(`Failed to fetch health: ${res.status}`)
  return res.json()
}

export async function getRecentEmails(params: {
  limit?: number
  days?: number
  from?: string
  to?: string
} = {}) {
  const { limit = 100, days, from, to } = params
  let query = `limit=${limit}`
  if (from && to) query += `&from=${from}&to=${to}`
  else if (days) query += `&days=${days}`
  const res = await fetchWithTimeout(`${BASE_URL}/api/recent-emails?${query}`)
  if (!res.ok) throw new Error('Failed to fetch recent emails')
  return res.json()
}

export interface DbStatsSummary {
  sent: number
  delivered: number
  bounced: number
  failed: number
  delivery_rate: number
  bounce_rate: number
}

export interface DbStatsRow {
  date: string
  sent: number
  delivered: number
  bounced: number
  failed: number
}

export interface DbStats {
  summary: DbStatsSummary
  timeseries: DbStatsRow[]
  from?: string
  to?: string
}

export async function getStats(params: { days?: number; from?: string; to?: string }): Promise<DbStats> {
  const query = params.from && params.to
    ? `from=${params.from}&to=${params.to}`
    : `days=${params.days ?? 7}`
  const res = await fetchWithTimeout(`${BASE_URL}/api/stats?${query}`)
  if (!res.ok) throw new Error('Failed to fetch stats')
  return res.json()
}

// ── Settings ──────────────────────────────────────────────────────────────────
export interface SettingsData {
  report_email: string | null
  notify_hard_bounce_email: string | null
  notify_soft_bounce_email: string | null
}

export async function getSettings(clientId?: string): Promise<SettingsData> {
  const query = clientId ? `?clientId=${clientId}` : ''
  const res = await fetchAdmin(`/client/settings${query}`)
  if (!res.ok) throw new Error('Failed to fetch settings')
  return res.json()
}

export async function updateSettings(fields: Partial<SettingsData>, clientId?: string): Promise<SettingsData & { success: boolean }> {
  const query = clientId ? `?clientId=${clientId}` : ''
  const res = await fetchAdmin(`/client/settings${query}`, {
    method: 'PUT',
    body: JSON.stringify(fields),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Failed to update settings')
  }
  return res.json()
}
