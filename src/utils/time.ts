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

// Start of an IST calendar day (00:00:00.000 IST) for a "YYYY-MM-DD" date string,
// as an absolute UTC instant. Used to anchor custom date-range filters to real IST days.
export function istDateStart(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - IST_OFFSET_MS);
}

// End of an IST calendar day (23:59:59.999 IST) for a "YYYY-MM-DD" date string,
// as an absolute UTC instant — i.e. 1ms before the next day's IST midnight.
export function istDateEnd(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0) - IST_OFFSET_MS - 1);
}
