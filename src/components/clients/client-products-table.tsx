"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Package, Trash2, Plus, Pencil, X, Check, Upload as UploadIcon, Video, ChevronRight } from "lucide-react";

type Product = {
  id: string;
  productName: string;
  keyBenefits: string | null;
  imageUrl: string | null;
  videoImageUrl: string | null;
  status: string;
};

// Vercel rejects request bodies over 4.5 MB before /api/upload ever runs (a bare 413),
// so anything bigger is re-encoded in the browser first.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
// What /api/upload accepts as images; anything else (HEIC, AVIF, TIFF…) is re-encoded.
const UPLOADABLE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

async function responseError(res: Response, fallback: string): Promise<string> {
  if (res.status === 413) return "That image is too large to upload.";
  const data = await res.json().catch(() => null);
  return (data && typeof data.error === "string" && data.error) || `${fallback} (${res.status})`;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(src);
      if (!img.naturalWidth || !img.naturalHeight) reject(new Error(`Couldn't read the size of ${file.name} — export it as JPEG or PNG and try again.`));
      else resolve(img);
    };
    // Without this an undecodable file (e.g. HEIC outside Safari) left the spinner running forever.
    img.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error(`This browser can't open ${file.name} — export it as JPEG or PNG and try again.`));
    };
    img.src = src;
  });
}

/** Re-encode as JPEG, scaled to fit maxSide, shrinking further until it fits the upload limit. */
async function toUploadableJpeg(file: File, maxSide: number): Promise<File> {
  const img = await loadImage(file);
  let side = maxSide;
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't prepare the image for upload.");
    // JPEG has no transparency: paint white first or transparent areas come out black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) throw new Error("Couldn't re-encode the image for upload.");
    if (blob.size <= MAX_UPLOAD_BYTES) {
      return new File([blob], `${file.name.replace(/\.[^.]*$/, "") || "product"}.jpg`, { type: "image/jpeg" });
    }
    side = Math.round(Math.max(w, h) * 0.8);
  }
  throw new Error("That image is still too large after compressing — try a smaller file.");
}

/**
 * `clientId` must be the id of the brand `clientSlug` names — the brand on the page,
 * not the sidebar's selection. /api/upload files the image under that id's storage prefix.
 */
export function ClientProductsTable({ clientSlug, clientId }: { clientSlug: string; clientId: string | null }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [convertProgress, setConvertProgress] = useState("");

  // Add
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [adding, setAdding] = useState(false);

  // Edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Product>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [converting, setConverting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/clients/${clientSlug}/products`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await responseError(r, "Couldn't load products"));
        const data = await r.json();
        setProducts(Array.isArray(data) ? data : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load products"))
      .finally(() => setLoading(false));
  }, [clientSlug]);

  useEffect(() => { load(); }, [load]);

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === products.length) setSelected(new Set());
    else setSelected(new Set(products.map((p) => p.id)));
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError("");
    const deleted = new Set<string>();
    const failures: string[] = [];
    try {
      for (const id of selected) {
        const res = await fetch(`/api/clients/${clientSlug}/products/${id}`, { method: "DELETE" });
        if (res.ok) deleted.add(id);
        else {
          const name = products.find((p) => p.id === id)?.productName ?? "a product";
          failures.push(`${name}: ${await responseError(res, "delete failed")}`);
        }
      }
    } catch {
      failures.push("Network error — some products may not have been deleted.");
    } finally {
      // Only drop what the server actually deleted; failures stay listed and selected.
      setProducts((prev) => prev.filter((p) => !deleted.has(p.id)));
      setSelected((prev) => new Set([...prev].filter((id) => !deleted.has(id))));
      if (failures.length) setError(`Couldn't delete ${failures.join("; ")}`);
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName.trim()) return;
    setAdding(true);
    setError("");
    try {
      const res = await fetch(`/api/clients/${clientSlug}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productName: addName.trim() }),
      });
      if (!res.ok) {
        setError(await responseError(res, "Couldn't add the product"));
        return;
      }
      load();
      setAddName("");
      setShowAdd(false);
    } catch {
      setError("Couldn't add the product — check your connection and try again.");
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (p: Product) => {
    setEditingId(p.id);
    setEditForm({ productName: p.productName, keyBenefits: p.keyBenefits || "", imageUrl: p.imageUrl || "", videoImageUrl: p.videoImageUrl || "" });
  };

  const handleImageUpload = async (file: File, field: "imageUrl" | "videoImageUrl") => {
    // Some OSes report HEIC and friends with an empty type; let the decoder decide.
    if (file.type && !file.type.startsWith("image/")) {
      setError(`${file.name} isn't an image.`);
      return;
    }
    const setUpState = field === "imageUrl" ? setUploading : setUploadingVideo;
    setUpState(true);
    setError("");
    try {
      const uploadFile =
        file.size > MAX_UPLOAD_BYTES || !UPLOADABLE_IMAGE_TYPES.includes(file.type)
          ? await toUploadableJpeg(file, field === "videoImageUrl" ? 1920 : 2048)
          : file;
      const formData = new FormData();
      formData.append("file", uploadFile, uploadFile.name);
      formData.append("brandSlug", "dynamic-gift");
      formData.append("clientSlug", clientSlug || "");
      if (clientId) formData.append("clientId", clientId);
      formData.append("assetType", field === "videoImageUrl" ? "video-generation/products" : "products");
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await responseError(res, "Upload failed"));
      const data = await res.json().catch(() => null);
      if (!data || typeof data.url !== "string" || !data.url) throw new Error("Upload finished but returned no image URL.");
      setEditForm((prev) => ({ ...prev, [field]: data.url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUpState(false);
    }
  };

  const triggerFileUpload = (field: "imageUrl" | "videoImageUrl") => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) handleImageUpload(f, field);
    };
    input.click();
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const productName = (editForm.productName || "").trim();
    if (!productName) {
      setError("Product name can't be empty.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/clients/${clientSlug}/products/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Blank means "no image": send null, never "" — capability checks and the
        // generators treat any non-null URL as an image.
        body: JSON.stringify({
          productName,
          keyBenefits: editForm.keyBenefits?.trim() || null,
          imageUrl: editForm.imageUrl || null,
          videoImageUrl: editForm.videoImageUrl || null,
        }),
      });
      if (!res.ok) {
        setError(await responseError(res, "Couldn't save the product"));
        return;
      }
      load();
      setEditingId(null);
    } catch {
      setError("Couldn't save the product — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const eligibleForConvert = products.filter((p) => p.imageUrl && !p.videoImageUrl).length;

  const handleConvertAll = async () => {
    const eligible = products.filter((p) => p.imageUrl && !p.videoImageUrl);
    if (eligible.length === 0) return;
    setConverting(true);
    setError("");
    let pending = eligible.map((p) => p.id);
    let converted = 0;
    const failures: string[] = [];
    try {
      // The route converts a bounded batch per call and hands back the rest.
      while (pending.length > 0) {
        setConvertProgress(`${converted}/${eligible.length}`);
        const res = await fetch(`/api/clients/${clientSlug}/products/convert-video-image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productIds: pending }),
        });
        if (!res.ok) {
          failures.push(await responseError(res, "Conversion failed"));
          break;
        }
        const data = await res.json();
        converted += Number(data.converted) || 0;
        for (const r of Array.isArray(data.results) ? data.results : []) {
          if (r.status === "error") failures.push(`${r.name}: ${r.error}`);
        }
        const remaining: string[] = Array.isArray(data.remaining) ? data.remaining : [];
        if (remaining.length >= pending.length) break; // no progress — don't loop forever
        pending = remaining;
      }
    } catch {
      failures.push("Network error during conversion.");
    } finally {
      if (failures.length) setError(`Converted ${converted} of ${eligible.length}. ${failures.join("; ")}`);
      setConvertProgress("");
      setConverting(false);
      load();
    }
  };

  return (
    <Card>
      <CardHeader
        className="flex flex-row items-center justify-between space-y-0 cursor-pointer select-none"
        onClick={() => !editingId && setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-3">
          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${collapsed ? "" : "rotate-90"}`} />
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 dark:bg-primary/10">
            <Package className="h-4 w-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Products ({products.length})</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Product catalogue with descriptions and images — used by AI systems for ad generation.
            </p>
          </div>
        </div>
        {!collapsed && (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {selected.size > 0 && (
              <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete {selected.size}
              </Button>
            )}
            {eligibleForConvert > 0 && (
              <Button size="sm" variant="outline" onClick={handleConvertAll} disabled={converting}>
                {converting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Video className="mr-1.5 h-3.5 w-3.5" />}
                {converting ? `Converting${convertProgress ? ` ${convertProgress}` : ""}...` : `Convert ${eligibleForConvert} to 9:16`}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> {showAdd ? "Cancel" : "Add"}
            </Button>
          </div>
        )}
      </CardHeader>

      {error && (
        <div className="mx-6 mb-4 flex items-start justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} className="shrink-0" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {!collapsed && (
        <CardContent>
          {/* Add form */}
          {showAdd && (
            <form onSubmit={handleAdd} className="mb-6 space-y-3 rounded-lg border border-border p-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Product Name</label>
                <input
                  type="text"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="e.g. Printed Polyester Lanyards"
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground/30"
                  autoFocus
                />
              </div>
              <Button type="submit" size="sm" disabled={adding}>
                {adding ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
                {adding ? "Adding..." : "Add Product"}
              </Button>
            </form>
          )}

          {/* Products list */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Package className="h-10 w-10 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">No products yet. Add products to use them in generation systems.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Select all */}
              <div className="flex items-center gap-3 px-1">
                <input
                  type="checkbox"
                  checked={selected.size === products.length && products.length > 0}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-input"
                />
                <span className="text-xs text-muted-foreground">Select all</span>
              </div>

              {products.map((product) => (
                <div key={product.id} className="rounded-lg border border-border hover:border-border/80 transition-colors">
                  {/* Header row */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(product.id)}
                      onChange={() => {}}
                      onClick={(e) => toggleSelect(product.id, e)}
                      className="h-4 w-4 rounded border-input"
                    />
                    <div className="flex-1 min-w-0">
                      {editingId === product.id ? (
                        <input
                          value={editForm.productName || ""}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, productName: e.target.value }))}
                          className="h-8 w-full rounded border border-border bg-background px-2 text-sm font-semibold outline-none focus:border-foreground/30"
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-sm">{product.productName}</h3>
                          {product.videoImageUrl && (
                            <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5">
                              <Video className="h-3 w-3 text-primary" />
                              <span className="text-[10px] font-medium text-primary">9:16</span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {editingId === product.id ? (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => setEditingId(null)} disabled={saving} className="h-7 w-7 p-0">
                            <X className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={saveEdit} disabled={saving} className="h-7 w-7 p-0 text-green-600">
                            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          </Button>
                        </>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => startEdit(product)} className="h-7 w-7 p-0">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Edit panel */}
                  {editingId === product.id && (
                    <div className="border-t border-border px-4 py-4 space-y-4 bg-muted/20">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Product Description</label>
                        <textarea
                          value={editForm.keyBenefits || ""}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, keyBenefits: e.target.value }))}
                          rows={3}
                          placeholder="Product description, key benefits, target use case..."
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                        />
                      </div>

                      {/* Product Reference Image */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Product Reference Image</label>
                        {editForm.imageUrl ? (
                          <div className="relative group">
                            <img src={editForm.imageUrl} alt="Product" className="w-full max-h-40 object-contain rounded-lg border border-border bg-card" />
                            <button
                              type="button"
                              onClick={() => setEditForm((prev) => ({ ...prev, imageUrl: "" }))}
                              className="absolute top-1 right-1 p-1 rounded-full bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity"
                            ><X className="h-3 w-3" /></button>
                            {uploading && <div className="absolute inset-0 flex items-center justify-center bg-background/60 rounded-lg"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>}
                          </div>
                        ) : (
                          <div
                            onClick={() => triggerFileUpload("imageUrl")}
                            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-4 cursor-pointer transition-colors hover:border-muted-foreground"
                          >
                            {uploading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <UploadIcon className="h-4 w-4 text-muted-foreground" />}
                            <span className="text-xs text-muted-foreground">Click to upload product image</span>
                          </div>
                        )}
                      </div>

                      {/* Video Reference Image (9:16) */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                          Video Reference Image (9:16)
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary normal-case tracking-normal">
                            <Video className="h-3 w-3" /> Video System
                          </span>
                        </label>
                        {editForm.videoImageUrl ? (
                          <div className="relative group">
                            <div className="flex justify-center bg-card rounded-lg border border-border p-2">
                              <img src={editForm.videoImageUrl} alt="Video reference" className="max-h-60 object-contain rounded" />
                            </div>
                            <button
                              type="button"
                              onClick={() => setEditForm((prev) => ({ ...prev, videoImageUrl: "" }))}
                              className="absolute top-3 right-3 p-1 rounded-full bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity"
                            ><X className="h-3 w-3" /></button>
                            {uploadingVideo && <div className="absolute inset-0 flex items-center justify-center bg-background/60 rounded-lg"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>}
                          </div>
                        ) : (
                          <div
                            onClick={() => triggerFileUpload("videoImageUrl")}
                            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-6 cursor-pointer transition-colors hover:border-primary/50 hover:bg-primary/10"
                          >
                            {uploadingVideo ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : (
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10"><Video className="h-5 w-5 text-primary" /></div>
                            )}
                            <span className="text-xs font-medium text-primary">Upload 9:16 product image</span>
                            <span className="text-[10px] text-muted-foreground text-center max-w-[220px]">Required for the Video Generation System. Must be portrait (9:16) format.</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Preview row (collapsed) */}
                  {editingId !== product.id && (product.imageUrl || product.videoImageUrl || product.keyBenefits) && (
                    <div className="border-t border-border/50 px-4 py-2.5">
                      <div className="flex gap-4">
                        {product.imageUrl && (
                          <img src={product.imageUrl} alt={product.productName} className="h-16 w-16 object-contain rounded border border-border bg-card shrink-0" />
                        )}
                        {product.videoImageUrl && (
                          <div className="relative shrink-0">
                            <img src={product.videoImageUrl} alt="" className="h-16 w-9 object-cover rounded border border-primary/30 bg-card" />
                            <div className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                              <Video className="h-2.5 w-2.5 text-primary-foreground" />
                            </div>
                          </div>
                        )}
                        <p className="flex-1 text-xs text-muted-foreground line-clamp-2">{product.keyBenefits || "No description"}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmDelete(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">Delete {selected.size} product{selected.size > 1 ? "s" : ""}?</h3>
            <p className="mt-2 text-sm text-muted-foreground">This will remove the selected products and their images.</p>
            <div className="flex justify-end gap-3 mt-4">
              <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                {deleting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                {deleting ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
