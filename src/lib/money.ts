import type { Entry } from "./types";

/** Project names are matched the way the backend matches them. */
export function rateFor(rates: Record<string, number>, project: string): number {
  const wanted = project.trim().toLowerCase();
  for (const [name, rate] of Object.entries(rates)) {
    if (name.trim().toLowerCase() === wanted) return rate;
  }
  return 0;
}

export function amountOf(rates: Record<string, number>, project: string, seconds: number): number {
  return (Math.max(0, seconds) / 3600) * rateFor(rates, project);
}

export function totalAmount(
  rates: Record<string, number>,
  entries: Entry[],
  seconds: (entry: Entry) => number,
): number {
  return entries.reduce((sum, entry) => sum + amountOf(rates, entry.project, seconds(entry)), 0);
}

/** `€ 1,240.00`. The symbol is whatever the user typed, so it stays a prefix. */
export function formatMoney(amount: number, currency: string): string {
  const value = amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency.trim() ? `${currency.trim()} ${value}` : value;
}

/** True once any project has a rate — the switch that makes money visible. */
export const anyRates = (rates: Record<string, number>) =>
  Object.values(rates).some((rate) => rate > 0);
