"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import Link from "next/link";
import { slugify, cn } from "@/lib/utils";
import { useClient } from "@/lib/client-context";

const CATEGORIES = [
  "Supplements", "Skincare", "Health & Wellness", "Fashion", "Food & Beverage",
  "Beauty", "Fitness", "Home & Living", "Tech", "SaaS", "Finance",
  "E-commerce", "Education", "Entertainment", "Other",
];

const MARKETS = [
  "Australia", "United States", "United Kingdom", "Canada", "Europe",
  "Global", "APAC", "MENA", "LATAM", "Other",
];

const CURRENCIES = ["AUD", "USD", "GBP", "EUR", "CAD", "NZD"];

type FormData = {
  clientName: string;
  website: string;
  category: string;
  primaryMarket: string;
  currency: string;
  cluster: string;
  brandColor: string;
  notes: string;
};

export default function NewClientPage() {
  const router = useRouter();
  const { setClient, refetchClients } = useClient();
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState<FormData>({
    clientName: "",
    website: "",
    category: "",
    primaryMarket: "",
    currency: "",
    cluster: "",
    brandColor: "#b2ff00",
    notes: "",
  });

  const slug = slugify(form.clientName);

  function updateForm(updates: Partial<FormData>) {
    setForm((prev) => ({ ...prev, ...updates }));
    setError("");
  }

  async function handleCreate() {
    if (!form.clientName.trim()) {
      setError("Client name is required");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: form.clientName.trim(),
          website: form.website || undefined,
          category: form.category || undefined,
          primaryMarket: form.primaryMarket || undefined,
          currency: form.currency || undefined,
          cluster: form.cluster || undefined,
          brandColor: form.brandColor || undefined,
          notes: form.notes || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create client");
        setIsSubmitting(false);
        return;
      }

      const client = await res.json();

      // Refresh client list and switch to the new client
      await refetchClients();
      setClient(client.id);

      // Navigate to client detail page
      router.push(`/clients/${client.clientSlug}`);
    } catch (err) {
      setError("Something went wrong. Please try again.");
      setIsSubmitting(false);
    }
  }

  const steps = [
    { title: "Basic Info", description: "Name, website, and category" },
    { title: "Market & Details", description: "Market, currency, and notes" },
    { title: "Review & Create", description: "Confirm and provision" },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Header */}
      <div>
        <Link
          href="/clients"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Clients
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Add New Client</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Set up a new client with auto-provisioned storage and brand intelligence.
        </p>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <button
              onClick={() => i < step && setStep(i)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-all",
                i < step && "bg-[var(--brand-primary,#b2ff00)] text-black cursor-pointer",
                i === step && "bg-foreground text-background",
                i > step && "bg-muted text-muted-foreground"
              )}
            >
              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </button>
            <div className={cn("hidden sm:block", i > step && "opacity-50")}>
              <p className="text-xs font-medium">{s.title}</p>
            </div>
            {i < steps.length - 1 && (
              <div className={cn("mx-1 h-px w-8 bg-border", i < step && "bg-[var(--brand-primary,#b2ff00)]")} />
            )}
          </div>
        ))}
      </div>

      {/* Form Content */}
      <div className="rounded-xl border border-border/50 bg-card p-6">
        {step === 0 && (
          <div className="space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Client / Brand Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.clientName}
                onChange={(e) => updateForm({ clientName: e.target.value })}
                placeholder="e.g. Lifecykel"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30 transition-colors"
                autoFocus
              />
              {slug && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Slug: <code className="rounded bg-muted px-1">{slug}</code>
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Website</label>
              <input
                type="url"
                value={form.website}
                onChange={(e) => updateForm({ website: e.target.value })}
                placeholder="https://example.com"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30 transition-colors"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Category</label>
              <select
                value={form.category}
                onChange={(e) => updateForm({ category: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30 transition-colors"
              >
                <option value="">Select category...</option>
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Brand Color</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={form.brandColor}
                  onChange={(e) => updateForm({ brandColor: e.target.value })}
                  className="h-9 w-12 cursor-pointer rounded border border-border"
                />
                <input
                  type="text"
                  value={form.brandColor}
                  onChange={(e) => updateForm({ brandColor: e.target.value })}
                  className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30 transition-colors"
                />
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Primary Market</label>
              <select
                value={form.primaryMarket}
                onChange={(e) => updateForm({ primaryMarket: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30 transition-colors"
              >
                <option value="">Select market...</option>
                {MARKETS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Currency</label>
              <select
                value={form.currency}
                onChange={(e) => updateForm({ currency: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30 transition-colors"
              >
                <option value="">Select currency...</option>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Group / Cluster</label>
              <input
                type="text"
                value={form.cluster}
                onChange={(e) => updateForm({ cluster: e.target.value })}
                placeholder="e.g. Supplements, Skincare (optional grouping)"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30 transition-colors"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Used to group clients in the switcher dropdown
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => updateForm({ notes: e.target.value })}
                placeholder="Any additional context about this client..."
                rows={3}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30 transition-colors resize-none"
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <h3 className="font-medium">Review Client Details</h3>

            <div className="space-y-3 rounded-lg bg-muted/50 p-4">
              <DetailRow label="Name" value={form.clientName} />
              <DetailRow label="Slug" value={slug} mono />
              {form.website && <DetailRow label="Website" value={form.website} />}
              {form.category && <DetailRow label="Category" value={form.category} />}
              {form.primaryMarket && <DetailRow label="Market" value={form.primaryMarket} />}
              {form.currency && <DetailRow label="Currency" value={form.currency} />}
              {form.cluster && <DetailRow label="Cluster" value={form.cluster} />}
            </div>

            <div className="space-y-2 rounded-lg border border-border/50 p-4">
              <p className="text-sm font-medium">Auto-provisioning will create:</p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  Database record with all client metadata
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  8 brand intelligence template sections
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  R2 storage namespace (uploads, ads, videos, scraped)
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  Activity log entry
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="mt-4 text-sm text-red-500">{error}</p>
        )}

        {/* Navigation buttons */}
        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              step === 0
                ? "text-muted-foreground/50 cursor-not-allowed"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>

          {step < 2 ? (
            <button
              onClick={() => {
                if (step === 0 && !form.clientName.trim()) {
                  setError("Client name is required");
                  return;
                }
                setStep(step + 1);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              Next
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={handleCreate}
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-primary,#b2ff00)] px-5 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Provisioning...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Create Client
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-medium", mono && "font-mono text-xs")}>{value}</span>
    </div>
  );
}
