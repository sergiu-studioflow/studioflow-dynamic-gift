"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Package, Trash2, Plus, Pencil, X, Check, Upload as UploadIcon, Video, ChevronRight } from "lucide-react";
import { useClient } from "@/lib/client-context";

type Product = {
  id: string;
  productName: string;
  keyBenefits: string | null;
  imageUrl: string | null;
  videoImageUrl: string | null;
  status: string;
};

export function ClientProductsTable({ clientSlug }: { clientSlug: string }) {
  const { clientId } = useClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

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

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/clients/${clientSlug}/products`)
      .then((r) => r.json())
      .then(setProducts)
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
    try {
      for (const id of selected) {
        await fetch(`/api/clients/${clientSlug}/products/${id}`, { method: "DELETE" });
      }
      setProducts((prev) => prev.filter((p) => !selected.has(p.id)));
      setSelected(new Set());
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName.trim()) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/clients/${clientSlug}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productName: addName.trim() }),
      });
      if (res.ok) { load(); setAddName(""); setShowAdd(false); }
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (p: Product) => {
    setEditingId(p.id);
    setEditForm({ productName: p.productName, keyBenefits: p.keyBenefits || "", imageUrl: p.imageUrl || "", videoImageUrl: p.videoImageUrl || "" });
  };

  const resizeImage = (file: File, maxW: number, maxH: number): Promise<Blob> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width: w, height: h } = img;
        if (w > maxW || h > maxH) { const r = Math.min(maxW / w, maxH / h); w = Math.round(w * r); h = Math.round(h * r); }
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        canvas.toBlob((b) => resolve(b!), "image/png", 0.95);
      };
      img.src = URL.createObjectURL(file);
    });

  const handleImageUpload = async (file: File, field: "imageUrl" | "videoImageUrl") => {
    if (!file.type.startsWith("image/")) return;
    const setUpState = field === "imageUrl" ? setUploading : setUploadingVideo;
    setUpState(true);
    try {
      let uploadFile: File | Blob = file;
      if (file.size > 4 * 1024 * 1024) {
        uploadFile = await resizeImage(file, field === "videoImageUrl" ? 1920 : 2048, field === "videoImageUrl" ? 1920 : 2048);
      }
      const formData = new FormData();
      formData.append("file", uploadFile, file.name);
      if (clientId) formData.append("clientId", clientId);
      formData.append("assetType", field === "videoImageUrl" ? "video-generation/products" : "products");
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      const { url } = await res.json();
      setEditForm((prev) => ({ ...prev, [field]: url }));
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
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientSlug}/products/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (res.ok) { load(); setEditingId(null); }
    } finally {
      setSaving(false);
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
            <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> {showAdd ? "Cancel" : "Add"}
            </Button>
          </div>
        )}
      </CardHeader>

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
                  placeholder="e.g. Whitening Strips"
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
