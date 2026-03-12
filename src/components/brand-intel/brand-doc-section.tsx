"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Brain, Pencil, Save, X, Loader2, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface BrandIntel {
  id: string;
  title: string;
  rawContent: string | null;
  updatedAt: string | null;
}

export function BrandDocSection() {
  const [intel, setIntel] = useState<BrandIntel | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/brand-intel")
      .then((res) => res.json())
      .then((data) => {
        setIntel(data);
        setDraft(data?.rawContent || "");
      })
      .catch(() => setError("Failed to load brand intelligence"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.max(500, textareaRef.current.scrollHeight) + "px";
    }
  }, [editing]);

  const handleEdit = () => {
    setDraft(intel?.rawContent || "");
    setEditing(true);
    setError(null);
  };

  const handleCancel = () => {
    setDraft(intel?.rawContent || "");
    setEditing(false);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/brand-intel", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawContent: draft }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      const updated = await res.json();
      setIntel(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.max(500, e.target.scrollHeight) + "px";
  };

  return (
    <Card>
      <CardHeader
        className="flex flex-row items-center justify-between space-y-0 cursor-pointer select-none"
        onClick={() => !editing && setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-3">
          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${collapsed ? "" : "rotate-90"}`} />
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 dark:bg-primary/10">
            <Brain className="h-4 w-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Brand Intelligence Document</CardTitle>
            {intel?.updatedAt && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Last updated: {new Date(intel.updatedAt).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
        {!collapsed && (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {editing ? (
              <>
                <Button variant="outline" size="sm" onClick={handleCancel} disabled={saving}>
                  <X className="mr-1 h-3.5 w-3.5" />
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="mr-1 h-3.5 w-3.5" />
                  )}
                  {saving ? "Saving..." : "Save"}
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={handleEdit}>
                <Pencil className="mr-1 h-3.5 w-3.5" />
                Edit
              </Button>
            )}
          </div>
        )}
      </CardHeader>

      {!collapsed && (
        <>
          {error && (
            <div className="mx-6 mb-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
              {error}
            </div>
          )}

          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : editing ? (
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={handleTextareaInput}
                placeholder="Write your brand intelligence document here... (Markdown supported)"
                className="w-full min-h-[500px] rounded-lg border border-input bg-background p-4 text-sm font-mono leading-relaxed outline-none resize-none focus:border-foreground/20 focus:ring-2 focus:ring-foreground/5 placeholder:text-muted-foreground transition-all duration-150"
                spellCheck
              />
            ) : intel?.rawContent ? (
              <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed [&_strong]:text-foreground [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-8 [&_h1]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-5 [&_h3]:mb-2 [&_p]:text-secondary-foreground [&_p]:mb-3 [&_li]:text-secondary-foreground [&_code]:text-foreground">
                <ReactMarkdown>{intel.rawContent}</ReactMarkdown>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Brain className="h-10 w-10 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">
                  No brand intelligence document yet.
                </p>
                <Button variant="outline" size="sm" className="mt-4" onClick={handleEdit}>
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  Add Brand Intel
                </Button>
              </div>
            )}
          </CardContent>
        </>
      )}
    </Card>
  );
}
