"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Brain,
  Pencil,
  Save,
  X,
  ChevronRight,
  BookOpen,
  Clock,
  FileText,
  Eye,
  Code2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type Section = {
  id: string;
  title: string;
  content: string | null;
  sectionType: string | null;
  sortOrder: number;
};

function preprocessBrandIntel(text: string): string {
  if (!text) return "";
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  const isTitleLine = (raw: string, prevBlank: boolean, nextBlank: boolean): boolean => {
    const line = raw.trim();
    if (line.length === 0 || line.length > 80) return false;
    if (!prevBlank || !nextBlank) return false;
    if (/^[#\-*>]/.test(line) || /^```/.test(line) || /^\d+\.\s/.test(line)) return false;
    if (/[.!?:,;]$/.test(line)) return false;
    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 10) return false;
    if (!/[A-Z]/.test(line)) return false;
    return true;
  };

  let firstHeadingApplied = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prevBlank = i === 0 || lines[i - 1].trim() === "";
    const nextBlank = i === lines.length - 1 || lines[i + 1].trim() === "";
    if (isTitleLine(line, prevBlank, nextBlank)) {
      const prefix = firstHeadingApplied ? "## " : "# ";
      firstHeadingApplied = true;
      out.push(prefix + line.trim());
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function extractToc(processed: string): Array<{ id: string; text: string; level: 1 | 2 | 3 }> {
  const headings: Array<{ id: string; text: string; level: 1 | 2 | 3 }> = [];
  const seen = new Set<string>();
  for (const line of processed.split("\n")) {
    const m = line.match(/^(#{1,3})\s+(.+)/);
    if (!m) continue;
    const level = m[1].length as 1 | 2 | 3;
    const text = m[2].trim();
    let id = slugify(text);
    let n = 2;
    while (seen.has(id)) id = `${slugify(text)}-${n++}`;
    seen.add(id);
    headings.push({ id, text, level });
  }
  return headings;
}

function readingStats(text: string): { words: number; minutes: number } {
  const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 220));
  return { words, minutes };
}

export function ClientBrandIntelEditor({ clientSlug }: { clientSlug: string }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [editPreview, setEditPreview] = useState<"split" | "edit" | "preview">("split");
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const proseRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/clients/${clientSlug}/brand-intel`)
      .then((r) => r.json())
      .then((data) => {
        const list: Section[] = Array.isArray(data) ? data : [];
        setSections(list);
        const doc = list
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((s) => `## ${s.title}\n\n${s.content || ""}`)
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

  const handleEdit = () => {
    setEditing(true);
    setCollapsed(false);
  };

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
          body: JSON.stringify({
            title: section.title,
            content: section.content,
            sortOrder: section.sortOrder,
          }),
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

  const sourceContent = draft;
  const processed = useMemo(() => preprocessBrandIntel(sourceContent), [sourceContent]);
  const toc = useMemo(() => extractToc(processed), [processed]);
  const stats = useMemo(() => readingStats(sourceContent), [sourceContent]);

  const handleHeadingIntersection = useCallback(() => {
    if (!proseRef.current) return;
    const headings = proseRef.current.querySelectorAll("h1[id], h2[id], h3[id]");
    if (headings.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveHeadingId(visible[0].target.id);
      },
      { rootMargin: "-100px 0px -60% 0px", threshold: 0 },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (collapsed || editing) return;
    const cleanup = handleHeadingIntersection();
    return cleanup;
  }, [collapsed, editing, processed, handleHeadingIntersection]);

  return (
    <Card>
      <CardHeader
        className="flex flex-row items-center justify-between space-y-0 cursor-pointer select-none"
        onClick={() => !editing && setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-3">
          <ChevronRight
            className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${collapsed ? "" : "rotate-90"}`}
          />
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 dark:bg-primary/10">
            <Brain className="h-4 w-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Brand Intelligence Document</CardTitle>
            {!editing && (
              <p className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                {sourceContent ? (
                  <>
                    <span className="inline-flex items-center gap-1">
                      <FileText className="h-3 w-3" />
                      {stats.words.toLocaleString()} words
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {stats.minutes} min read
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <BookOpen className="h-3 w-3" />
                      {sections.length} section{sections.length !== 1 ? "s" : ""}
                    </span>
                  </>
                ) : (
                  <span>No content yet</span>
                )}
              </p>
            )}
          </div>
        </div>
        {!collapsed && (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {editing ? (
              <>
                <div className="hidden md:flex items-center rounded-md border border-border bg-card p-0.5 mr-1">
                  <button
                    onClick={() => setEditPreview("edit")}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-medium transition-all",
                      editPreview === "edit"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent/40",
                    )}
                  >
                    <Code2 className="inline h-3 w-3 mr-1" />
                    Edit
                  </button>
                  <button
                    onClick={() => setEditPreview("split")}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-medium transition-all",
                      editPreview === "split"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent/40",
                    )}
                  >
                    Split
                  </button>
                  <button
                    onClick={() => setEditPreview("preview")}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-medium transition-all",
                      editPreview === "preview"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent/40",
                    )}
                  >
                    <Eye className="inline h-3 w-3 mr-1" />
                    Preview
                  </button>
                </div>
                <Button variant="outline" size="sm" onClick={handleCancel} disabled={saving}>
                  <X className="mr-1 h-3.5 w-3.5" /> Cancel
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
            <EditView
              draft={draft}
              onChange={(v) => setDraft(v)}
              onInput={handleTextareaInput}
              processed={processed}
              mode={editPreview}
              textareaRef={textareaRef}
            />
          ) : sourceContent.trim() ? (
            <ReadView
              processed={processed}
              toc={toc}
              activeHeadingId={activeHeadingId}
              proseRef={proseRef}
            />
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

/* ─── Reading view ─── */

function ReadView({
  processed,
  toc,
  activeHeadingId,
  proseRef,
}: {
  processed: string;
  toc: Array<{ id: string; text: string; level: 1 | 2 | 3 }>;
  activeHeadingId: string | null;
  proseRef: React.RefObject<HTMLDivElement | null>;
}) {
  const showToc = toc.filter((h) => h.level === 2).length >= 3;

  return (
    <div className={cn("relative grid gap-8", showToc ? "lg:grid-cols-[1fr_220px]" : "grid-cols-1")}>
      <article
        ref={proseRef}
        className={cn(
          "max-w-3xl",
          "prose prose-base dark:prose-invert max-w-none",
          // Headings — Nunito heavy, primary-coloured (cyan)
          "prose-headings:font-display prose-headings:font-extrabold prose-headings:text-primary prose-headings:tracking-tight",
          "prose-h1:text-4xl prose-h1:mt-0 prose-h1:mb-2 prose-h1:pb-3 prose-h1:border-b prose-h1:border-primary/15",
          "prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-3 prose-h2:scroll-mt-24",
          "prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-2 prose-h3:scroll-mt-24",
          // Paragraphs
          "prose-p:text-foreground/85 prose-p:leading-[1.8] prose-p:my-4",
          // First paragraph drop cap
          "[&>p:first-of-type]:first-letter:font-display [&>p:first-of-type]:first-letter:font-extrabold [&>p:first-of-type]:first-letter:text-primary [&>p:first-of-type]:first-letter:text-6xl [&>p:first-of-type]:first-letter:leading-[0.85] [&>p:first-of-type]:first-letter:float-left [&>p:first-of-type]:first-letter:mr-2 [&>p:first-of-type]:first-letter:mt-1.5",
          // Strong / em
          "prose-strong:text-foreground prose-strong:font-semibold",
          "prose-em:text-foreground/90",
          // Lists
          "prose-ul:my-4 prose-ol:my-4 prose-li:my-1.5 prose-li:text-foreground/85 prose-li:leading-relaxed",
          "prose-li:marker:text-primary",
          // Blockquote
          "prose-blockquote:border-l-4 prose-blockquote:border-primary prose-blockquote:bg-secondary/40 prose-blockquote:rounded-r-lg prose-blockquote:px-4 prose-blockquote:py-1 prose-blockquote:not-italic prose-blockquote:text-foreground/85",
          // Code
          "prose-code:bg-muted prose-code:text-foreground prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.9em] prose-code:font-medium prose-code:before:hidden prose-code:after:hidden",
          // Links
          "prose-a:text-primary prose-a:underline-offset-4 hover:prose-a:text-accent",
          // hr
          "prose-hr:my-10 prose-hr:border-border",
        )}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children, ...props }) => {
              const text = String(children);
              const id = slugify(text);
              return (
                <h1 id={id} {...props}>
                  {children}
                </h1>
              );
            },
            h2: ({ children, ...props }) => {
              const text = String(children);
              const id = slugify(text);
              return (
                <h2 id={id} {...props}>
                  {children}
                </h2>
              );
            },
            h3: ({ children, ...props }) => {
              const text = String(children);
              const id = slugify(text);
              return (
                <h3 id={id} {...props}>
                  {children}
                </h3>
              );
            },
          }}
        >
          {processed}
        </ReactMarkdown>
      </article>

      {showToc && (
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              On this page
            </p>
            <nav className="flex flex-col gap-1">
              {toc
                .filter((h) => h.level <= 3)
                .map((h) => (
                  <a
                    key={h.id}
                    href={`#${h.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                      history.replaceState(null, "", `#${h.id}`);
                    }}
                    className={cn(
                      "block rounded-md px-2.5 py-1.5 text-xs leading-snug transition-all",
                      h.level === 3 && "pl-6",
                      activeHeadingId === h.id
                        ? "bg-primary/12 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/40",
                    )}
                  >
                    {h.text}
                  </a>
                ))}
            </nav>
          </div>
        </aside>
      )}
    </div>
  );
}

/* ─── Edit view ─── */

function EditView({
  draft,
  onChange,
  onInput,
  processed,
  mode,
  textareaRef,
}: {
  draft: string;
  onChange: (v: string) => void;
  onInput: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  processed: string;
  mode: "edit" | "split" | "preview";
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const showEdit = mode === "edit" || mode === "split";
  const showPreview = mode === "preview" || mode === "split";

  return (
    <div className={cn("grid gap-4", mode === "split" ? "lg:grid-cols-2" : "grid-cols-1")}>
      {showEdit && (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => {
            onChange(e.target.value);
            onInput(e);
          }}
          placeholder={"## Core Identity & Mission\n\nDescribe the brand's core identity...\n\n---\n\n## Target Customer Profile\n\nDescribe the ideal customer..."}
          className="w-full min-h-[400px] rounded-lg border border-input bg-background p-4 text-sm font-mono leading-relaxed outline-none resize-none focus:border-foreground/20 focus:ring-2 focus:ring-foreground/5 transition-all"
          spellCheck
        />
      )}
      {showPreview && (
        <article
          className={cn(
            "rounded-lg border border-border bg-card p-5 max-h-[600px] overflow-y-auto",
            "prose prose-sm dark:prose-invert max-w-none",
            "prose-headings:font-display prose-headings:font-extrabold prose-headings:text-primary prose-headings:tracking-tight",
            "prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg",
            "prose-p:text-foreground/85 prose-p:leading-relaxed",
            "prose-li:marker:text-primary",
          )}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{processed}</ReactMarkdown>
        </article>
      )}
    </div>
  );
}
