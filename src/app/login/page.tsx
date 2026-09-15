import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Only a session that actually validates skips the form. Cookie presence alone is not
  // enough: a stale cookie sent here from the portal layout used to bounce straight back.
  let signedIn = false;
  try {
    signedIn = !!(await auth.api.getSession({ headers: await headers() }));
  } catch {
    // Can't verify right now (e.g. database unreachable) — show the form rather than an error page.
  }
  if (signedIn) redirect("/dashboard");

  return <LoginForm />;
}
