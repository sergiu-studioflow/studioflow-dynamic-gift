"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tags,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Loader2,
  ChevronRight,
  GripVertical,
} from "lucide-react";

interface Brand {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

export function BrandsManager() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add brand state
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function fetchBrands() {
    try {
      const res = await fetch("/api/brands");
      if (!res.ok) throw new Error("Failed to load brands");
      const data = await res.json();
      setBrands(data);
    } catch {
      setError("Failed to load brands");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchBrands();
  }, []);

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to add brand");
      }
      setNewName("");
      await fetchBrands();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add brand");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(brand: Brand) {
    setEditingId(brand.id);
    setEditName(brand.name);
    setError(null);
  }

  async function handleSaveEdit() {
    if (!editingId || !editName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/brands/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update brand");
      }
      setEditingId(null);
      setEditName("");
      await fetchBrands();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update brand");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/brands/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete brand");
      }
      await fetchBrands();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete brand");
    } finally {
      setDeletingId(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent, action: () => void) {
    if (e.key === "Enter") {
      e.preventDefault();
      action();
    }
  }

  return (
    <Card>
      <CardHeader
        className="flex flex-row items-center justify-between space-y-0 cursor-pointer select-none"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-3">
          <ChevronRight
            className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
              collapsed ? "" : "rotate-90"
            }`}
          />
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 dark:bg-primary/10">
            <Tags className="h-4 w-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Brands</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {brands.length} brand{brands.length !== 1 ? "s" : ""} configured
            </p>
          </div>
        </div>
      </CardHeader>

      {!collapsed && (
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Brand List */}
              <div className="space-y-1.5">
                {brands.map((brand) => (
                  <div
                    key={brand.id}
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 transition-colors hover:bg-muted/50"
                  >
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />

                    {editingId === brand.id ? (
                      <>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, handleSaveEdit)}
                          className="h-8 text-sm flex-1"
                          autoFocus
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={handleSaveEdit}
                          disabled={saving}
                        >
                          {saving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5 text-green-600" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() => setEditingId(null)}
                          disabled={saving}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="text-sm flex-1 text-foreground">
                          {brand.name}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 hover:opacity-100 focus:opacity-100"
                          style={{ opacity: undefined }}
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(brand);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(brand.id);
                          }}
                          disabled={deletingId === brand.id}
                        >
                          {deletingId === brand.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                          )}
                        </Button>
                      </>
                    )}
                  </div>
                ))}

                {brands.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No brands yet. Add your first brand below.
                  </p>
                )}
              </div>

              {/* Add Brand */}
              <div className="flex items-center gap-2 pt-2 border-t border-border">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, handleAdd)}
                  placeholder="New brand name..."
                  className="h-9 text-sm flex-1"
                  disabled={adding}
                />
                <Button
                  size="sm"
                  onClick={handleAdd}
                  disabled={adding || !newName.trim()}
                  className="shrink-0"
                >
                  {adding ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Add Brand
                </Button>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
