const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// UTC instant corresponding to midnight IST, `daysAgo` days before today (0 = today's IST midnight).
export function istMidnight(daysAgo: number = 0): Date {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  const midnightUTC = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() - daysAgo, 0, 0, 0);
  return new Date(midnightUTC - IST_OFFSET_MS);
}

// Next IST midnight — used as the reset boundary for daily quotas/budgets.
export function nextMidnightIST(): string {
  return istMidnight(-1).toISOString();
}
