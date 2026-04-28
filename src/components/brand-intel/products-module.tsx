"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Package, Trash2, Plus, ChevronRight, Pencil, X, Check, Upload as UploadIcon, Video, RefreshCw } from "lucide-react";

type Product = {
  id: string;
  name: string;
  targetAudience: string | null;
  solution: string | null;
  painPoint: string | null;
  brandDna: string | null;
  imageUrl: string | null;
  imagePreviewUrl: string | null;
  videoImageUrl: string | null;
  videoImagePreviewUrl: string | null;
  visualDescription: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export function ProductsModule() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Add form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  // Edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Product>>({});
  const [editPreviewUrls, setEditPreviewUrls] = useState<{ image: string | null; video: string | null }>({ image: null, video: null });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [converting, setConverting] = useState(false);
  const [convertResult, setConvertResult] = useState<{ converted: number; skipped: number; errors: number } | null>(null);

  const load = () => {
    setLoading(true);
    fetch("/api/products?full=true")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setProducts(data); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === products.length) setSelected(new Set());
    else setSelected(new Set(products.map((p) => p.id)));
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch("/api/products", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (res.ok) {
        setProducts((prev) => prev.filter((p) => !selected.has(p.id)));
        setSelected(new Set());
      }
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError("");
    if (!addName.trim()) {
      setAddError("Product name is required.");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: addName.trim() }),
      });
      if (res.ok) {
        const created = await res.json();
        setProducts((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
        setAddName("");
        setShowAddForm(false);
      } else {
        const err = await res.json();
        setAddError(err.error || "Failed to add product.");
      }
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (product: Product) => {
    setEditingId(product.id);
    setUploadError("");
    setEditForm({
      name: product.name,
      visualDescription: product.visualDescription || "",
      imageUrl: product.imageUrl || "",
      videoImageUrl: product.videoImageUrl || "",
    });
    setEditPreviewUrls({
      image: product.imagePreviewUrl || null,
      video: product.videoImagePreviewUrl || null,
    });
  };

  const resizeImage = (file: File, maxWidth: number, maxHeight: number): Promise<Blob> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => resolve(blob!), "image/png", 0.95);
      };
      img.src = URL.createObjectURL(file);
    });
  };

  const handleImageUpload = async (file: File, field: "imageUrl" | "videoImageUrl") => {
    if (!file.type.startsWith("image/")) return;
    const setUploadState = field === "imageUrl" ? setUploading : setUploadingVideo;
    setUploadState(true);
    setUploadError("");
    try {
      let uploadFile: File | Blob = file;
      if (file.size > 4 * 1024 * 1024) {
        const maxDim = field === "videoImageUrl" ? 1920 : 2048;
        uploadFile = await resizeImage(file, maxDim, maxDim);
      }
      const formData = new FormData();
      formData.append("file", uploadFile, file.name);
      formData.append("brandSlug", "dynamic-gift");
      formData.append("assetType", field === "videoImageUrl" ? "video-generation/products" : "products");
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Upload failed (${res.status})`);
      }
      const { url } = await res.json();
      setEditForm((prev) => ({ ...prev, [field]: url }));
      const previewUrl = URL.createObjectURL(uploadFile);
      if (field === "imageUrl") setEditPreviewUrls((prev) => ({ ...prev, image: previewUrl }));
      else setEditPreviewUrls((prev) => ({ ...prev, video: previewUrl }));
    } catch (err) {
      console.error("[upload]", err);
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadState(false);
    }
  };

  const triggerFileUpload = (field: "imageUrl" | "videoImageUrl") => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) handleImageUpload(file, field);
    };
    input.click();
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, ...editForm }),
      });
      if (res.ok) {
        const updated = await res.json();
        setProducts((prev) => prev.map((p) => p.id === editingId ? updated : p));
        setEditingId(null);
        setEditForm({});
      }
    } finally {
      setSaving(false);
    }
  };

  const handleConvertAll = async () => {
    const eligible = products.filter((p) => p.imageUrl && !p.videoImageUrl);
    if (eligible.length === 0) return;
    setConverting(true);
    setConvertResult(null);
    try {
      const res = await fetch("/api/products/convert-video-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: eligible.map((p) => p.id) }),
      });
      if (res.ok) {
        const data = await res.json();
        setConvertResult({ converted: data.converted, skipped: data.skipped, errors: data.errors });
        load();
      }
    } catch (err) {
      console.error("[convert]", err);
    } finally {
      setConverting(false);
    }
  };

  const eligibleForConvert = products.filter((p) => p.imageUrl && !p.videoImageUrl).length;

  const textareaClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring resize-none";

  return (
    <>
      <Card>
        <CardHeader
          className="flex flex-row items-center justify-between space-y-0 cursor-pointer select-none"
          onClick={() => setCollapsed(!collapsed)}
        >
          <div className="flex items-center gap-3">
            <ChevronRight
              className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${collapsed ? "" : "rotate-90"}`}
            />
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
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Delete {selected.size}
                </Button>
              )}
              {eligibleForConvert > 0 && (
                <Button size="sm" variant="outline" onClick={handleConvertAll} disabled={converting}>
                  {converting ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Video className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {converting ? "Converting..." : `Convert ${eligibleForConvert} to 9:16`}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setShowAddForm(!showAddForm)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {showAddForm ? "Cancel" : "Add"}
              </Button>
            </div>
          )}
        </CardHeader>

        {!collapsed && (
          <CardContent>
            {/* Add form */}
            {showAddForm && (
              <form onSubmit={handleAdd} className="mb-6 space-y-3 rounded-lg border border-border p-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Product Name</label>
                  <Input
                    placeholder="e.g. Printed Polyester Lanyards"
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                  />
                </div>
                {addError && <p className="text-sm text-destructive">{addError}</p>}
                <Button type="submit" size="sm" disabled={adding}>
                  {adding ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {adding ? "Adding..." : "Add Product"}
                </Button>
              </form>
            )}

            {/* Convert result banner */}
            {convertResult && (
              <div className="mb-4 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <Video className="h-4 w-4 text-primary shrink-0" />
                <p className="text-xs text-foreground">
                  <span className="font-semibold">{convertResult.converted}</span> converted to 9:16
                  {convertResult.skipped > 0 && <>, <span className="font-semibold">{convertResult.skipped}</span> skipped</>}
                  {convertResult.errors > 0 && <>, <span className="font-semibold text-destructive">{convertResult.errors}</span> errors</>}
                </p>
                <button onClick={() => setConvertResult(null)} className="ml-auto text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Products list */}
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Package className="h-10 w-10 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">
                  No products yet. Add products to use them in generation systems.
                </p>
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
                  <div
                    key={product.id}
                    className="rounded-lg border border-border hover:border-border/80 transition-colors"
                  >
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
                          <Input
                            value={editForm.name || ""}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                            className="h-8 text-sm font-semibold"
                          />
                        ) : (
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-sm">{product.name}</h3>
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
                            <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving} className="h-7 w-7 p-0">
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
                        {uploadError && (
                          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                            Upload failed: {uploadError}
                          </div>
                        )}
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Product Description</label>
                          <textarea
                            value={editForm.visualDescription || ""}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, visualDescription: e.target.value }))}
                            rows={3}
                            placeholder="Product type, materials, available colours, branding options, key features..."
                            className={textareaClass}
                          />
                        </div>

                        {/* Product Reference Image */}
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Product Reference Image</label>
                          {editForm.imageUrl ? (
                            <div className="relative group">
                              <img src={editPreviewUrls.image || editForm.imageUrl} alt="Product" className="w-full max-h-40 object-contain rounded-lg border border-border bg-card" />
                              <button
                                type="button"
                                onClick={() => { setEditForm((prev) => ({ ...prev, imageUrl: "" })); setEditPreviewUrls((prev) => ({ ...prev, image: null })); }}
                                className="absolute top-1 right-1 p-1 rounded-full bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="h-3 w-3" />
                              </button>
                              {uploading && (
                                <div className="absolute inset-0 flex items-center justify-center bg-background/60 rounded-lg">
                                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                </div>
                              )}
                            </div>
                          ) : (
                            <div
                              onClick={() => triggerFileUpload("imageUrl")}
                              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-4 cursor-pointer transition-colors hover:border-muted-foreground"
                            >
                              {uploading ? (
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                              ) : (
                                <UploadIcon className="h-4 w-4 text-muted-foreground" />
                              )}
                              <span className="text-xs text-muted-foreground">Click to upload product image</span>
                            </div>
                          )}
                        </div>

                        {/* Video Reference Image (9:16) */}
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                            Video Reference Image (9:16)
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary normal-case tracking-normal">
                              <Video className="h-3 w-3" />
                              Video System
                            </span>
                          </label>
                          {editForm.videoImageUrl ? (
                            <div className="relative group">
                              <div className="flex justify-center bg-card rounded-lg border border-border p-2">
                                <img src={editPreviewUrls.video || editForm.videoImageUrl} alt="Video reference" className="max-h-60 object-contain rounded" />
                              </div>
                              <button
                                type="button"
                                onClick={() => { setEditForm((prev) => ({ ...prev, videoImageUrl: "" })); setEditPreviewUrls((prev) => ({ ...prev, video: null })); }}
                                className="absolute top-3 right-3 p-1 rounded-full bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="h-3 w-3" />
                              </button>
                              {uploadingVideo && (
                                <div className="absolute inset-0 flex items-center justify-center bg-background/60 rounded-lg">
                                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                </div>
                              )}
                            </div>
                          ) : (
                            <div
                              onClick={() => triggerFileUpload("videoImageUrl")}
                              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-6 cursor-pointer transition-colors hover:border-primary/50 hover:bg-primary/10"
                            >
                              {uploadingVideo ? (
                                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                              ) : (
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                                  <Video className="h-5 w-5 text-primary" />
                                </div>
                              )}
                              <span className="text-xs font-medium text-primary">Upload 9:16 product image</span>
                              <span className="text-[10px] text-muted-foreground text-center max-w-[220px]">
                                Required for the Video Generation System. Must be portrait (9:16) format.
                              </span>
                            </div>
                          )}
                        </div>

                      </div>
                    )}

                    {/* Preview row (collapsed) */}
                    {editingId !== product.id && (
                      <div className="border-t border-border/50 px-4 py-2.5">
                        <div className="flex gap-4">
                          {product.imagePreviewUrl && (
                            <img src={product.imagePreviewUrl} alt={product.name} className="h-16 w-16 object-contain rounded border border-border bg-card shrink-0" />
                          )}
                          {product.videoImagePreviewUrl && (
                            <div className="relative shrink-0">
                              <img src={product.videoImagePreviewUrl} alt={`${product.name} (9:16)`} className="h-16 w-9 object-cover rounded border border-primary/30 bg-card" />
                              <div className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                                <Video className="h-2.5 w-2.5 text-primary-foreground" />
                              </div>
                            </div>
                          )}
                          <div className="flex-1">
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {product.visualDescription || product.solution || "No description"}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Delete confirmation */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Delete {selected.size} product{selected.size > 1 ? "s" : ""}?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will remove the selected products. Any generations linked to them will lose their product reference.
          </p>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
