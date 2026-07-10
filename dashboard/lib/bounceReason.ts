// Turns a raw SMTP/SES bounce diagnostic string into a short, human-readable
// label. Mail servers pack their real message together with routing/protocol
// metadata ([AGT=PFA], [MxId=...], server hostnames, timestamps) that's noise
// to anyone reading the dashboard — this pulls out just the useful part.

export interface ParsedBounceReason {
  label: string
  raw: string
}

const PATTERNS: { match: RegExp; label: string }[] = [
  { match: /block ?list|on our block list|blocked/i, label: "Blocked by recipient's mail server (block list)" },
  { match: /mailbox (is )?full|quota exceeded|over quota/i, label: "Recipient's mailbox is full" },
  { match: /no such user|user unknown|recipient (address )?rejected|doesn'?t exist/i, label: "Invalid or unknown recipient address" },
  { match: /spam|content policy|message content/i, label: "Flagged as spam by recipient's mail server" },
  { match: /mailbox (is )?disabled|account (is )?disabled|account has been closed/i, label: "Recipient's mailbox is disabled" },
  { match: /timed? ?out|timeout/i, label: "Delivery attempt timed out" },
  { match: /domain not found|no mx record|host unknown/i, label: "Recipient domain not found" },
  { match: /message (size|too large)|exceeds? (the )?(size|maximum)/i, label: "Message too large for recipient" },
]

export function parseBounceReason(reason: string | undefined | null): ParsedBounceReason | null {
  if (!reason) return null

  const known = PATTERNS.find(p => p.match.test(reason))
  if (known) return { label: known.label, raw: reason }

  // Fallback: take the first sentence before any bracketed metadata block or URL.
  const firstChunk = reason.split(/\s*\[|https?:\/\//)[0].trim()
  const label = firstChunk.length > 4 && firstChunk.length < 140
    ? firstChunk.replace(/^smtp;\s*/i, "").replace(/^\d{3}[\s\d.]*\s*/, "")
    : reason.slice(0, 100).trim() + (reason.length > 100 ? "…" : "")

  return { label: label || "Delivery failed", raw: reason }
}
