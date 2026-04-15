"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Brain, Pencil, Save, X, ChevronRight } from "lucide-react";

type Section = {
  id: string;
  title: string;
  content: string | null;
  sectionType: string | null;
  sortOrder: number;
};

export function ClientBrandIntelEditor({ clientSlug }: { clientSlug: string }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/clients/${clientSlug}/brand-intel`)
      .then((r) => r.json())
      .then((data) => {
        setSections(Array.isArray(data) ? data : []);
        const doc = (Array.isArray(data) ? data : [])
          .sort((a: Section, b: Section) => a.sortOrder - b.sortOrder)
          .map((s: Section) => `## ${s.title}\n\n${s.content || ""}`)
          .join("\n\n---\n\n");
        setDraft(doc);
      })
      .finally(() => setLoading(false));
  }, [clientSlug]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.max(400, textareaRef.current.scrollHeight) + "px";
    }
  }, [editing]);

  const handleEdit = () => { setEditing(true); setCollapsed(false); };

  const handleCancel = () => {
    const doc = sections
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => `## ${s.title}\n\n${s.content || ""}`)
      .join("\n\n---\n\n");
    setDraft(doc);
    setEditing(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const rawSections = draft.split(/(?=^## )/m).filter((s) => s.trim());
      const parsed = rawSections.map((raw, i) => {
        const lines = raw.trim().split("\n");
        const title = lines[0].replace(/^##\s*/, "").trim();
        const content = lines.slice(1).join("\n").replace(/^---\s*$/m, "").trim();
        return { title, content, sortOrder: i };
      });

      for (const existing of sections) {
        await fetch(`/api/clients/${clientSlug}/brand-intel/${existing.id}`, { method: "DELETE" });
      }

      const newSections: Section[] = [];
      for (const section of parsed) {
        const res = await fetch(`/api/clients/${clientSlug}/brand-intel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: section.title, content: section.content, sortOrder: section.sortOrder }),
        });
        if (res.ok) newSections.push(await res.json());
      }

      setSections(newSections);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.max(400, e.target.scrollHeight) + "px";
  };

  const charCount = draft.trim().length;

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
            <p className="text-xs text-muted-foreground mt-0.5">
              {charCount > 0 ? `${charCount.toLocaleString()} chars · ${sections.length} sections` : "No content yet"}
            </p>
          </div>
        </div>
        {!collapsed && (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {editing ? (
              <>
                <Button variant="outline" size="sm" onClick={handleCancel} disabled={saving}>
                  <X className="mr-1 h-3.5 w-3.5" /> Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
                  {saving ? "Saving..." : "Save"}
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={handleEdit}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
              </Button>
            )}
          </div>
        )}
      </CardHeader>

      {!collapsed && (
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : editing ? (
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={handleTextareaInput}
              placeholder={"## Core Identity & Mission\n\nDescribe the brand's core identity...\n\n---\n\n## Target Customer Profile\n\nDescribe the ideal customer..."}
              className="w-full min-h-[400px] rounded-lg border border-input bg-background p-4 text-sm font-mono leading-relaxed outline-none resize-none focus:border-foreground/20 focus:ring-2 focus:ring-foreground/5 transition-all"
              spellCheck
            />
          ) : draft.trim() ? (
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed whitespace-pre-wrap [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-2 first:[&_h2]:mt-0">
              {draft}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Brain className="h-10 w-10 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">No brand intelligence document yet.</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={handleEdit}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> Add Brand Intel
              </Button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
