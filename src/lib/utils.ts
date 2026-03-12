import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getStatusColor(status: string): { bg: string; text: string; dot: string } {
  switch (status) {
    case "new":
      return { bg: "bg-blue-50 dark:bg-blue-950", text: "text-blue-700 dark:text-blue-300", dot: "bg-blue-500" };
    case "processing":
      return { bg: "bg-amber-50 dark:bg-amber-950", text: "text-amber-700 dark:text-amber-300", dot: "bg-amber-500" };
    case "complete":
    case "approved":
      return { bg: "bg-emerald-50 dark:bg-emerald-950", text: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" };
    case "error":
    case "rejected":
      return { bg: "bg-red-50 dark:bg-red-950", text: "text-red-700 dark:text-red-300", dot: "bg-red-500" };
    case "in_production":
      return { bg: "bg-purple-50 dark:bg-purple-950", text: "text-purple-700 dark:text-purple-300", dot: "bg-purple-500" };
    case "draft":
    case "pending":
      return { bg: "bg-gray-50 dark:bg-gray-900", text: "text-gray-700 dark:text-gray-300", dot: "bg-gray-400" };
    case "revision_needed":
    case "send_back":
      return { bg: "bg-orange-50 dark:bg-orange-950", text: "text-orange-700 dark:text-orange-300", dot: "bg-orange-500" };
    default:
      return { bg: "bg-gray-50 dark:bg-gray-900", text: "text-gray-700 dark:text-gray-300", dot: "bg-gray-400" };
  }
}
