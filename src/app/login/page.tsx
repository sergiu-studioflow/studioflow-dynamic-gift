"use client";

import { useState } from "react";
import Image from "next/image";
import { authClient } from "@/lib/auth-client";
import { Loader2, ArrowRight, Mail } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL: "/dashboard",
    });

    if (error) {
      setError(error.message ?? "Failed to send magic link. Please try again.");
      setLoading(false);
    } else {
      setSent(true);
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="animate-fade-up w-full max-w-[380px] space-y-8 px-4">
        {/* Logo / Brand */}
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center">
            <Image
              src="/dynamic-gift-logo.png"
              alt="Dynamic Gift"
              width={200}
              height={70}
              priority
              className="h-auto w-[200px] dark:hidden"
            />
            <Image
              src="/dynamic-gift-logo-light.png"
              alt="Dynamic Gift"
              width={200}
              height={70}
              priority
              className="hidden h-auto w-[200px] dark:block"
            />
          </div>
          <h1 className="mt-6 text-xl font-semibold tracking-tight text-foreground">
            Welcome to your{" "}
            <span className="font-display font-extrabold text-primary">Creative Studio</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in with your Dynamic Gift work email.
          </p>
        </div>

        {sent ? (
          <div className="animate-fade-in rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center dark:border-emerald-800 dark:bg-emerald-950">
            <Mail className="mx-auto h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <p className="mt-3 text-sm font-medium text-emerald-800 dark:text-emerald-200">
              Check your email
            </p>
            <p className="mt-1 text-[13px] text-emerald-600 dark:text-emerald-400">
              We sent a magic link to <strong>{email}</strong>
            </p>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-[13px] font-medium text-foreground">
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className="mt-1.5 block w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm text-foreground shadow-xs placeholder:text-muted-foreground transition-all duration-150 focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10"
              />
            </div>

            {error && (
              <p className="text-[13px] text-destructive">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-xs transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Send magic link
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
