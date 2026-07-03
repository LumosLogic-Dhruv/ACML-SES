"use client"

import { useState, useEffect } from "react"
import { Settings, Mail, CheckCircle2, AlertCircle, Loader2, AlertTriangle } from "lucide-react"
import { getSettings, updateSettings } from "@/lib/api"
import { useClient } from "@/lib/clientContext"
import { Button } from "@/components/ui/button"

const EMAIL_REGEX = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/

function validateEmail(email: string): string | null {
  if (!email) return null
  if (!EMAIL_REGEX.test(email)) return "Enter a valid email address"
  return null
}

interface FieldState {
  value: string
  saved: string
  saving: boolean
  error: string | null
  validationError: string | null
  success: boolean
}

function initField(): FieldState {
  return { value: "", saved: "", saving: false, error: null, validationError: null, success: false }
}

interface EmailCardProps {
  icon: React.ReactNode
  title: string
  description: string
  placeholder: string
  field: FieldState
  onChange: (val: string) => void
  onSave: () => void
  onCancel: () => void
  loading: boolean
  accentColor: string
}

function EmailCard({ icon, title, description, placeholder, field, onChange, onSave, onCancel, loading, accentColor }: EmailCardProps) {
  const isDirty = field.value !== field.saved
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 sm:p-6">
      <div className="flex items-start gap-3 mb-5">
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${accentColor}`}>
          {icon}
        </div>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{description}</p>
        </div>
      </div>

      {field.error && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />{field.error}
        </div>
      )}
      {field.success && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />Saved successfully.
        </div>
      )}

      {loading ? (
        <div className="h-10 rounded-lg bg-[var(--muted)] animate-pulse" />
      ) : (
        <>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
            <input
              type="email"
              value={field.value}
              onChange={e => onChange(e.target.value)}
              placeholder={placeholder}
              className={`w-full pl-9 pr-4 py-2.5 text-sm border rounded-lg bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 transition-colors ${
                field.validationError
                  ? "border-red-400 focus:ring-red-500/30 focus:border-red-400"
                  : "border-[var(--border)] focus:ring-indigo-500/30 focus:border-indigo-400"
              }`}
            />
          </div>
          {field.validationError && (
            <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />{field.validationError}
            </p>
          )}
          <p className="text-xs text-[var(--muted-foreground)] mt-2">Leave empty to disable.</p>
          <div className="flex items-center gap-2 mt-4">
            <Button
              size="sm"
              onClick={onSave}
              disabled={field.saving || !!field.validationError || !isDirty}
              className="bg-indigo-500 hover:bg-indigo-600 text-white"
            >
              {field.saving ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</> : "Save"}
            </Button>
            {isDirty && !field.saving && (
              <button onClick={onCancel} className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
                Cancel
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function SettingsPage() {
  const { role, selectedClientId, selectedClientName } = useClient()
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)

  const [reportField, setReportField] = useState<FieldState>(initField())
  const [hardField, setHardField] = useState<FieldState>(initField())
  const [softField, setSoftField] = useState<FieldState>(initField())

  useEffect(() => {
    const clientId = role === "admin" ? selectedClientId : undefined
    if (role === "admin" && !selectedClientId) return
    setLoading(true)
    getSettings(clientId || undefined)
      .then(data => {
        const r = data.report_email || ""
        const h = data.notify_hard_bounce_email || ""
        const s = data.notify_soft_bounce_email || ""
        setReportField(f => ({ ...f, value: r, saved: r }))
        setHardField(f => ({ ...f, value: h, saved: h }))
        setSoftField(f => ({ ...f, value: s, saved: s }))
      })
      .catch(() => setPageError("Failed to load settings"))
      .finally(() => setLoading(false))
  }, [role, selectedClientId])

  function makeHandlers(
    setter: React.Dispatch<React.SetStateAction<FieldState>>,
    fieldKey: string
  ) {
    const onChange = (val: string) => {
      setter(f => ({ ...f, value: val, validationError: validateEmail(val), success: false }))
    }
    const onSave = async () => {
      const vErr = validateEmail
      setter(f => {
        const err = vErr(f.value)
        if (err) return { ...f, validationError: err }
        return { ...f, saving: true, error: null, success: false }
      })
      // Read current state via a ref-like pattern
      setter(prev => {
        if (prev.validationError) return prev
        const clientId = role === "admin" ? selectedClientId : undefined
        updateSettings({ [fieldKey]: prev.value }, clientId || undefined)
          .then(data => {
            const saved = (data as Record<string, string | null>)[fieldKey] ?? null
            setter(f => ({ ...f, saving: false, saved: saved || "", success: true }))
          })
          .catch(err => {
            setter(f => ({ ...f, saving: false, error: err instanceof Error ? err.message : "Failed to save" }))
          })
        return { ...prev, saving: true }
      })
    }
    const onCancel = () => setter(f => ({ ...f, value: f.saved, validationError: null, success: false }))
    return { onChange, onSave, onCancel }
  }

  const reportHandlers = makeHandlers(setReportField, "report_email")
  const hardHandlers = makeHandlers(setHardField, "notify_hard_bounce_email")
  const softHandlers = makeHandlers(setSoftField, "notify_soft_bounce_email")

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="sticky top-14 lg:top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
        <div className="px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-3">
            <Settings className="h-5 w-5 text-indigo-500 shrink-0" />
            <div>
              <h1 className="text-base sm:text-lg font-bold leading-none">Settings</h1>
              {role === "admin" && selectedClientName && (
                <p className="text-xs text-indigo-500 font-medium mt-0.5">{selectedClientName}</p>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="px-4 sm:px-6 py-6 max-w-2xl space-y-4">
        {pageError && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />{pageError}
          </div>
        )}

        {/* Report Email + Schedule side by side */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
          <EmailCard
            icon={<Mail className="h-4.5 w-4.5 text-indigo-500" />}
            title="Report Email"
            description="Daily and monthly email reports (PDF + CSV) will be sent to this address every day at 8:00 AM IST."
            placeholder="reports@yourdomain.com"
            field={reportField}
            loading={loading}
            accentColor="bg-indigo-500/10"
            {...reportHandlers}
          />

          {/* Report Schedule */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 p-5 sm:p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="h-9 w-9 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
                <Settings className="h-4 w-4 text-indigo-500" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">Report Schedule</h2>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">When reports are automatically sent.</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--background)] border border-[var(--border)]">
                <span className="text-indigo-500 font-bold text-xs mt-0.5 w-12 shrink-0">Daily</span>
                <p className="text-xs text-[var(--muted-foreground)]">Every day at <strong className="text-[var(--foreground)]">8:00 AM IST</strong> — previous day's activity (PDF + CSV)</p>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--background)] border border-[var(--border)]">
                <span className="text-indigo-500 font-bold text-xs mt-0.5 w-12 shrink-0">Monthly</span>
                <p className="text-xs text-[var(--muted-foreground)]">1st of every month at <strong className="text-[var(--foreground)]">8:00 AM IST</strong> — full previous month (PDF + CSV)</p>
              </div>
            </div>
          </div>
        </div>

        {/* Hard Bounce Alert */}
        <EmailCard
          icon={<AlertTriangle className="h-4.5 w-4.5 text-red-500" />}
          title="Hard Bounce Alert Email (ID X)"
          description="Get an instant alert when a hard bounce (permanent failure — invalid or unknown email address) is detected."
          placeholder="bounces@yourdomain.com"
          field={hardField}
          loading={loading}
          accentColor="bg-red-500/10"
          {...hardHandlers}
        />

        {/* Soft Bounce Alert */}
        <EmailCard
          icon={<AlertTriangle className="h-4.5 w-4.5 text-yellow-500" />}
          title="Soft Bounce Alert Email (ID Z)"
          description="Get an instant alert when a soft bounce (temporary failure — mailbox full, server down) is detected."
          placeholder="soft-bounces@yourdomain.com"
          field={softField}
          loading={loading}
          accentColor="bg-yellow-500/10"
          {...softHandlers}
        />
      </main>
    </div>
  )
}
