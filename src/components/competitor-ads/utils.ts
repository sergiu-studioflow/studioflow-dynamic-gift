import type { ParsedMedia } from "./types";

export function parseIsoDateUTC(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function computeBadge(snapshotDate: string, adStartDate: string) {
  const snap = parseIsoDateUTC(snapshotDate);
  const start = parseIsoDateUTC(adStartDate);
  const days = Math.floor((snap.getTime() - start.getTime()) / 86400000);
  if (days <= 7) return { label: "New", days, variant: "info" as const };
  if (days <= 21) return { label: "Running", days, variant: "warning" as const };
  if (days <= 60) return { label: "Long Run", days, variant: "destructive" as const };
  return { label: "Evergreen", days, variant: "success" as const };
}

export function parseMedia(raw: string | null): ParsedMedia {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function timeAgo(date: Date | string | null): string {
  if (!date) return "Never";
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
