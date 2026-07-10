"use client"

import { useState } from "react"
import { parseBounceReason } from "@/lib/bounceReason"

export function BounceReason({
  reason,
  className = "",
  emptyText = "No reason captured",
}: {
  reason?: string | null
  className?: string
  emptyText?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const parsed = parseBounceReason(reason)

  if (!parsed) {
    return <span className="text-xs text-[var(--muted-foreground)]">{emptyText}</span>
  }

  return (
    <div className={className}>
      <span className="text-xs text-red-500 leading-relaxed">{parsed.label}</span>
      {parsed.raw !== parsed.label && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="ml-1.5 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline underline-offset-2"
        >
          {expanded ? "hide details" : "show details"}
        </button>
      )}
      {expanded && (
        <p className="mt-1 text-[10px] text-[var(--muted-foreground)] break-words leading-relaxed font-mono">
          {parsed.raw}
        </p>
      )}
    </div>
  )
}
