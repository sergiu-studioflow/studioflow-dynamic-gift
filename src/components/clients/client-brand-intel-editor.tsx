"use client";

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
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
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
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

/**
 * A section being edited. Sections are edited one by one, never re-parsed out of one
 * big Markdown document: that lost `sectionType` (which the Static-Ad Prompt Builder
 * and QC use to find the voice, audience, USP… sections) and turned any `## ` line
 * inside a section into a new section. `id` and `sectionType` ride along untouched.
 */
type DraftSection = {
  key: string;
  id: string | null;
  title: string;
  content: string;
  sectionType: string | null;
};

const JSON_HEADERS = { "Content-Type": "application/json" };

let draftKeySeq = 0;
const blankDraft = (): DraftSection => ({ key: `new-${++draftKeySeq}`, id: null, title: "", content: "", sectionType: null });

function sortSections(list: Section[]): Section[] {
  return [...list].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** The read/preview document: every section as a `## Title` block. Display only — never parsed back. */
function toDocument(list: Array<{ title: string; content: string | null }>): string {
  return list.map((s) => `## ${s.title}\n\n${s.content || ""}`).join("\n\n---\n\n");
}

async function responseError(res: Response): Promise<string> {
  const data = await res.json().catch(() => null);
  return (data && typeof data.error === "string" && data.error) || `HTTP ${res.status}`;
}

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
  // The slug whose sections are loaded; anything else means still loading.
  const [loadedSlug, setLoadedSlug] = useState<string | null>(null);
  const loading = loadedSlug !== clientSlug;
  const [loadError, setLoadError] = useState("");
  const [collapsed, setCollapsed] = useState(true);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<DraftSection[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [editPreview, setEditPreview] = useState<"split" | "edit" | "preview">("split");
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const proseRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clients/${clientSlug}/brand-intel`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Couldn't load brand intel (${await responseError(r)}). Refresh to try again.`);
        const data = await r.json();
        if (cancelled) return;
        setSections(Array.isArray(data) ? data : []);
        setLoadError("");
      })
      // Editing is disabled until a load succeeds: saving over a list that never
      // loaded would duplicate every section the brand already has.
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Couldn't load brand intel.");
      })
      .finally(() => {
        if (!cancelled) setLoadedSlug(clientSlug);
      });
    return () => {
      cancelled = true;
    };
  }, [clientSlug]);

  const handleEdit = () => {
    const existing = sortSections(sections).map((s) => ({
      key: s.id,
      id: s.id,
      title: s.title,
      content: s.content ?? "",
      sectionType: s.sectionType,
    }));
    setDrafts(existing.length ? existing : [blankDraft()]);
    setSaveError("");
    setEditing(true);
    setCollapsed(false);
  };

  const handleCancel = () => {
    setDrafts([]);
    setSaveError("");
    setEditing(false);
  };

  const updateDraft = (key: string, patch: Partial<Pick<DraftSection, "title" | "content">>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const moveDraft = (key: string, delta: -1 | 1) =>
    setDrafts((prev) => {
      const from = prev.findIndex((d) => d.key === key);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });

  const removeDraft = (draft: DraftSection) => {
    if (
      draft.id &&
      draft.sectionType &&
      !confirm(`Remove “${draft.title || "this section"}”? Other systems (the Ad Prompt builder, Quality Control) read it.`)
    ) {
      return;
    }
    setDrafts((prev) => prev.filter((d) => d.key !== draft.key));
  };

  /**
   * Save section by section: kept sections are updated in place (id and sectionType
   * unchanged), new ones created, removed ones deleted — deletes last, so a failure
   * part-way never costs content. Every response is checked; if anything fails the
   * editor stays open, showing what didn't save, and saving again retries only that.
   */
  const handleSave = async () => {
    // A new section left completely blank is ignored rather than blocking the save.
    const next = drafts.filter((d) => d.id || d.title.trim() || d.content.trim()).map((d) => ({ ...d }));
    if (next.some((d) => !d.title.trim())) {
      setSaveError("Every section needs a title.");
      return;
    }
    setSaving(true);
    setSaveError("");
    const base = `/api/clients/${clientSlug}/brand-intel`;
    // What the server holds, as confirmed by each response.
    let saved = [...sections];
    const failures: string[] = [];

    try {
      for (const [sortOrder, draft] of next.entries()) {
        const title = draft.title.trim();
        const content = draft.content.trim();
        if (draft.id) {
          const current = saved.find((s) => s.id === draft.id);
          const unchanged =
            current &&
            current.title.trim() === title &&
            (current.content ?? "").trim() === content &&
            current.sortOrder === sortOrder;
          if (unchanged) continue;
          const res = await fetch(`${base}/${draft.id}`, {
            method: "PUT",
            headers: JSON_HEADERS,
            body: JSON.stringify({ title, content, sortOrder }),
          });
          if (!res.ok) {
            failures.push(`“${title}” wasn't saved (${await responseError(res)})`);
            continue;
          }
          const row: Section = await res.json();
          saved = saved.map((s) => (s.id === row.id ? row : s));
        } else {
          const res = await fetch(base, {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ title, content, sortOrder }),
          });
          if (!res.ok) {
            failures.push(`“${title}” wasn't created (${await responseError(res)})`);
            continue;
          }
          const row: Section = await res.json();
          draft.id = row.id;
          saved = [...saved, row];
        }
      }

      const kept = new Set(next.map((d) => d.id));
      for (const section of saved.filter((s) => !kept.has(s.id))) {
        const res = await fetch(`${base}/${section.id}`, { method: "DELETE" });
        // 404: already gone, which is what removing it asked for.
        if (!res.ok && res.status !== 404) {
          failures.push(`“${section.title}” wasn't removed (${await responseError(res)})`);
          continue;
        }
        saved = saved.filter((s) => s.id !== section.id);
      }
    } catch {
      failures.push("Network error — check your connection and save again.");
    }

    setSections(saved);
    setSaving(false);
    if (failures.length) {
      setDrafts(next);
      setSaveError(`Some changes didn't save: ${failures.join("; ")}.`);
    } else {
      setDrafts([]);
      setEditing(false);
    }
  };

  const sourceContent = useMemo(
    () => (editing ? toDocument(drafts) : toDocument(sortSections(sections))),
    [editing, drafts, sections],
  );
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
                {loadError ? (
                  <span className="text-red-600 dark:text-red-400">Couldn&apos;t load</span>
                ) : sourceContent ? (
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
              !loading &&
              !loadError && (
                <Button variant="outline" size="sm" onClick={handleEdit}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                </Button>
              )
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
          ) : loadError ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {loadError}
            </p>
          ) : editing ? (
            <>
              {saveError && (
                <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  {saveError}
                </p>
              )}
              <EditView
                drafts={drafts}
                processed={processed}
                mode={editPreview}
                disabled={saving}
                onChange={updateDraft}
                onMove={moveDraft}
                onRemove={removeDraft}
                onAdd={() => setDrafts((prev) => [...prev, blankDraft()])}
              />
            </>
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

function AutoGrowTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(120, el.scrollHeight)}px`;
  }, [props.value]);
  return <textarea ref={ref} {...props} />;
}

function EditView({
  drafts,
  processed,
  mode,
  disabled,
  onChange,
  onMove,
  onRemove,
  onAdd,
}: {
  drafts: DraftSection[];
  processed: string;
  mode: "edit" | "split" | "preview";
  disabled: boolean;
  onChange: (key: string, patch: Partial<Pick<DraftSection, "title" | "content">>) => void;
  onMove: (key: string, delta: -1 | 1) => void;
  onRemove: (draft: DraftSection) => void;
  onAdd: () => void;
}) {
  const showEdit = mode === "edit" || mode === "split";
  const showPreview = mode === "preview" || mode === "split";

  return (
    <div className={cn("grid gap-4", mode === "split" ? "lg:grid-cols-2" : "grid-cols-1")}>
      {showEdit && (
        <div className="space-y-3">
          {drafts.map((d, i) => (
            <div
              key={d.key}
              className="rounded-lg border border-input bg-background transition-all focus-within:border-foreground/20 focus-within:ring-2 focus-within:ring-foreground/5"
            >
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <input
                  value={d.title}
                  onChange={(e) => onChange(d.key, { title: e.target.value })}
                  placeholder="Section title"
                  disabled={disabled}
                  className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
                />
                {d.sectionType && (
                  <span
                    title="Other systems find this section by its type"
                    className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                  >
                    {d.sectionType}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onMove(d.key, -1)}
                  disabled={disabled || i === 0}
                  aria-label="Move section up"
                  className="rounded p-1 text-muted-foreground hover:bg-accent/40 disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(d.key, 1)}
                  disabled={disabled || i === drafts.length - 1}
                  aria-label="Move section down"
                  className="rounded p-1 text-muted-foreground hover:bg-accent/40 disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(d)}
                  disabled={disabled}
                  aria-label="Remove section"
                  className="rounded p-1 text-muted-foreground hover:bg-accent/40 hover:text-red-600 disabled:opacity-30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <AutoGrowTextarea
                value={d.content}
                onChange={(e) => onChange(d.key, { content: e.target.value })}
                placeholder="Write this section in Markdown…"
                disabled={disabled}
                className="block w-full resize-none bg-transparent p-3 text-sm font-mono leading-relaxed outline-none"
                spellCheck
              />
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={onAdd} disabled={disabled}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add section
          </Button>
        </div>
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
