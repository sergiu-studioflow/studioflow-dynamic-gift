"use client";

import { useState } from "react";
import { Loader2, LogOut, ShieldOff } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

/**
 * Shown instead of the portal when someone is signed in but has no active portal account —
 * deactivated in User management, or a login whose portal user row was removed. Every API
 * route refuses them anyway; this says so plainly instead of rendering a portal that fails
 * on every click.
 */
export function NoAccessScreen({ email, deactivated }: { email?: string | null; deactivated: boolean }) {
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-border bg-card p-8 text-center shadow-card">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <ShieldOff className="h-6 w-6 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-foreground">
            {deactivated ? "This account has been disabled" : "No access to this portal"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {email ? (
              <>
                You&apos;re signed in as <span className="font-medium text-foreground">{email}</span>, but{" "}
              </>
            ) : null}
            {deactivated
              ? "this account is no longer active. Ask a portal admin to reactivate it."
              : "this account hasn't been given access to the Creative Studio. Ask a portal admin to set up your access."}
          </p>
        </div>
        <Button onClick={signOut} disabled={signingOut} variant="outline" className="gap-2">
          {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          Sign out
        </Button>
      </div>
    </div>
  );
}
