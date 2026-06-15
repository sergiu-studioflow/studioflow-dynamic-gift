"use client";

import { createAuthClient } from "better-auth/react";

// Email + password auth. `signIn.email`, `signOut`, and `changePassword` are
// built into the base client — no plugins needed (magic-link removed).
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
});
