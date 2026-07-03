"use client"

import { useState, useEffect } from "react"
import { Settings, Mail, CheckCircle2, AlertCircle, Loader2 } from "lucide-react"
import { getSettings, updateSettings } from "@/lib/api"
import { useClient } from "@/lib/clientContext"
import { Button } from "@/components/ui/button"

const EMAIL_REGEX = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/

function validateEmail(email: string): string | null {
  if (!email) return null // empty is allowed (clears setting)
  if (!EMAIL_REGEX.test(email)) return "Enter a valid email address (e.g. reports@yourdomain.com)"
  return null
}

export default function SettingsPage() {
  const { role, selectedClientId, selectedClientName } = useClient()
  const [reportEmail, setReportEmail] = useState("")
  const [savedEmail, setSavedEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const clientId = role === "admin" ? selectedClientId : undefined
    if (role === "admin" && !selectedClientId) return
    setLoading(true)
    getSettings(clientId || undefined)
      .then(data => {
        setReportEmail(data.report_email || "")
        setSavedEmail(data.report_email)
      })
      .catch(() => setError("Failed to load settings"))
      .finally(() => setLoading(false))
  }, [role, selectedClientId])

  const handleEmailChange = (val: string) => {
    setReportEmail(val)
    setSuccess(false)
    setValidationError(validateEmail(val))
  }

  const handleSave = async () => {
    const vErr = validateEmail(reportEmail)
    if (vErr) { setValidationError(vErr); return }

    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const clientId = role === "admin" ? selectedClientId : undefined
      const data = await updateSettings(reportEmail, clientId || undefined)
      setSavedEmail(data.report_email)
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  const isDirty = reportEmail !== (savedEmail || "")

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Header */}
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

      <main className="px-4 sm:px-6 py-6 max-w-2xl">
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Settings saved successfully.
          </div>
        )}

        {/* Report Email Card */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 sm:p-6">
          <div className="flex items-start gap-3 mb-5">
            <div className="h-9 w-9 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
              <Mail className="h-4.5 w-4.5 text-indigo-500" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Report Email</h2>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                Daily and monthly email reports (PDF + CSV) will be sent to this address every day at 8:00 AM IST.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="h-10 rounded-lg bg-[var(--muted)] animate-pulse" />
          ) : (
            <>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
                <input
                  type="email"
                  value={reportEmail}
                  onChange={e => handleEmailChange(e.target.value)}
                  placeholder="reports@yourdomain.com"
                  className={`w-full pl-9 pr-4 py-2.5 text-sm border rounded-lg bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 transition-colors ${
                    validationError
                      ? "border-red-400 focus:ring-red-500/30 focus:border-red-400"
                      : "border-[var(--border)] focus:ring-indigo-500/30 focus:border-indigo-400"
                  }`}
                />
              </div>

              {validationError && (
                <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {validationError}
                </p>
              )}

              <p className="text-xs text-[var(--muted-foreground)] mt-2">
                Supports Gmail, custom domains, and subdomains. Leave empty to disable reports.
              </p>

              <div className="flex items-center gap-2 mt-4">
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving || !!validationError || !isDirty}
                  className="bg-indigo-500 hover:bg-indigo-600 text-white"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      Saving…
                    </>
                  ) : "Save"}
                </Button>
                {isDirty && !saving && (
                  <button
                    onClick={() => { setReportEmail(savedEmail || ""); setValidationError(null); setSuccess(false) }}
                    className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Info card */}
        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 p-4">
          <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-2">Report Schedule</p>
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-indigo-500 font-bold text-xs mt-0.5">Daily</span>
              <p className="text-xs text-[var(--muted-foreground)]">Every day at <strong className="text-[var(--foreground)]">8:00 AM IST</strong> — previous day's email activity (PDF + CSV)</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-indigo-500 font-bold text-xs mt-0.5">Monthly</span>
              <p className="text-xs text-[var(--muted-foreground)]">1st of every month at <strong className="text-[var(--foreground)]">8:00 AM IST</strong> — full previous month report (PDF + CSV)</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
