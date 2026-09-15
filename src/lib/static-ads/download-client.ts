/**
 * Browser-side download for generated assets. Asks /api/static-ads/download for a signed
 * R2 link (so the Quality Control gate's message can be shown instead of a raw JSON tab),
 * then opens it. The link carries `Content-Disposition: attachment`, so the browser saves
 * the file.
 *
 * Call it straight from a click handler: the tab is opened before the first await, while the
 * click still counts as a user gesture (a window.open after the fetch would be popup-blocked).
 * Using a separate tab — as the old proxy download did — also means the page, and any
 * in-progress work on it, is never navigated away from.
 */
export async function downloadGeneratedAsset(imageUrl: string, filename: string): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const params = new URLSearchParams({ url: imageUrl, filename, format: "json" });
    const res = await fetch(`/api/static-ads/download?${params.toString()}`);
    const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (!res.ok || !data?.url) {
      throw new Error(data?.error || `Download failed (${res.status})`);
    }

    if (tab) {
      tab.opener = null;
      tab.location.href = data.url;
    } else {
      // Popup blocked — fall back to following the attachment link in place.
      const a = document.createElement("a");
      a.href = data.url;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  } catch (err) {
    tab?.close();
    throw err;
  }
}
