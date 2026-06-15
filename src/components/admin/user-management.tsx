"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/utils";
import { Loader2, Plus, Trash2, KeyRound, ShieldCheck, Shield, Copy, Check } from "lucide-react";

type AdminUser = {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  role: "admin" | "member" | string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

function generatePassword(length = 16): string {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  let out = "";
  for (let i = 0; i < length; i++) out += charset[values[i] % charset.length];
  return out;
}

const inputClass =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3.5 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all duration-150";

export function UserManagement({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [cEmail, setCEmail] = useState("");
  const [cName, setCName] = useState("");
  const [cPassword, setCPassword] = useState("");
  const [cRole, setCRole] = useState<"admin" | "member">("member");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // reset-password dialog
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [rPassword, setRPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState(false);

  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to load users");
      const data = await res.json();
      setUsers(data.users ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setCEmail("");
    setCName("");
    setCPassword(generatePassword());
    setCRole("member");
    setCreateError(null);
    setCopied(false);
    setCreateOpen(true);
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cEmail, displayName: cName, password: cPassword, role: cRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to create user");
      setCreateOpen(false);
      await load();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  }

  function openReset(u: AdminUser) {
    setResetTarget(u);
    setRPassword(generatePassword());
    setResetError(null);
    setResetDone(false);
    setCopied(false);
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    setResetting(true);
    setResetError(null);
    try {
      const res = await fetch(`/api/admin/users/${resetTarget.id}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: rPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to reset password");
      setResetDone(true);
    } catch (e) {
      setResetError(e instanceof Error ? e.message : "Failed to reset password");
    } finally {
      setResetting(false);
    }
  }

  async function toggleRole(u: AdminUser) {
    setBusyId(u.id);
    setError(null);
    try {
      const nextRole = u.role === "admin" ? "member" : "admin";
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to change role");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to change role");
    } finally {
      setBusyId(null);
    }
  }

  async function removeUser(u: AdminUser) {
    if (!confirm(`Delete ${u.email}? This permanently removes their account and sign-in access.`)) return;
    setBusyId(u.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to delete user");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete user");
    } finally {
      setBusyId(null);
    }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-card">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Portal users</h2>
        <Button size="sm" className="ml-auto" onClick={openCreate}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add user
        </Button>
      </div>

      {error && <p className="px-5 pt-4 text-[13px] text-destructive">{error}</p>}

      <div className="p-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">User</th>
                  <th className="pb-2 pr-4 font-medium">Role</th>
                  <th className="pb-2 pr-4 font-medium">Last login</th>
                  <th className="pb-2 pr-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = u.userId === currentUserId;
                  const busy = busyId === u.id;
                  return (
                    <tr key={u.id} className="border-b border-border/60 last:border-0">
                      <td className="py-3 pr-4">
                        <div className="font-medium text-foreground">
                          {u.displayName}
                          {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                        </div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={
                            u.role === "admin"
                              ? "inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                              : "inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
                          }
                        >
                          {u.role === "admin" ? <ShieldCheck className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
                          {u.role}
                        </span>
                        {!u.isActive && (
                          <span className="ml-2 text-xs text-muted-foreground">inactive</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "—"}
                      </td>
                      <td className="py-3 pr-0">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => toggleRole(u)}
                            title={u.role === "admin" ? "Demote to member" : "Promote to admin"}
                          >
                            {u.role === "admin" ? "Make member" : "Make admin"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => openReset(u)}
                            title="Reset password"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy || isSelf}
                            onClick={() => removeUser(u)}
                            title={isSelf ? "You can't delete your own account" : "Delete user"}
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create user dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>
              Creates an account with a password. Share the password securely — they can change it in
              Settings.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCreate} className="space-y-4">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">Email</label>
              <Input type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} required className="mt-1.5" placeholder="name@dynamicgift.com.au" />
            </div>
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">Display name</label>
              <Input value={cName} onChange={(e) => setCName(e.target.value)} className="mt-1.5" placeholder="Optional" />
            </div>
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">Temporary password</label>
              <div className="mt-1.5 flex gap-2">
                <Input value={cPassword} onChange={(e) => setCPassword(e.target.value)} required minLength={8} className="font-mono" />
                <Button type="button" variant="outline" size="sm" onClick={() => copy(cPassword)} title="Copy">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setCPassword(generatePassword())}>
                  New
                </Button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">Role</label>
              <select
                value={cRole}
                onChange={(e) => setCRole(e.target.value as "admin" | "member")}
                className={`${inputClass} mt-1.5`}
              >
                <option value="member">Member</option>
                <option value="admin">Admin (can manage users)</option>
              </select>
            </div>
            {createError && <p className="text-[13px] text-destructive">{createError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create user"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              Set a new password for <strong>{resetTarget?.email}</strong>. Share it securely.
            </DialogDescription>
          </DialogHeader>
          {resetDone ? (
            <div className="space-y-4">
              <p className="flex items-center gap-1.5 text-[13px] text-emerald-600 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" /> Password updated.
              </p>
              <div className="flex gap-2">
                <Input value={rPassword} readOnly className="font-mono" />
                <Button type="button" variant="outline" size="sm" onClick={() => copy(rPassword)}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <DialogFooter>
                <Button type="button" onClick={() => setResetTarget(null)}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={submitReset} className="space-y-4">
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">New password</label>
                <div className="mt-1.5 flex gap-2">
                  <Input value={rPassword} onChange={(e) => setRPassword(e.target.value)} required minLength={8} className="font-mono" />
                  <Button type="button" variant="outline" size="sm" onClick={() => copy(rPassword)} title="Copy">
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setRPassword(generatePassword())}>
                    New
                  </Button>
                </div>
              </div>
              {resetError && <p className="text-[13px] text-destructive">{resetError}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setResetTarget(null)}>Cancel</Button>
                <Button type="submit" disabled={resetting}>
                  {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set password"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
