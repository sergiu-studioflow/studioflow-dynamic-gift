import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { ShieldCheck } from "lucide-react";
import { ComplianceDashboard } from "@/components/qc/compliance-dashboard";

export const dynamic = "force-dynamic";

async function getRole(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return "viewer";

  const [portalUser] = await db
    .select({ role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.userId, session.user.id))
    .limit(1);

  return portalUser?.role ?? "viewer";
}

export default async function QualityControlPage() {
  const role = await getRole();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="flex items-center gap-2 text-4xl font-bold tracking-tight text-foreground">
          <ShieldCheck className="h-8 w-8 text-primary" />
          Quality Control
        </h1>
        <p className="mt-2 max-w-3xl text-base text-muted-foreground">
          Every generated piece is checked against this client&apos;s standards before it reaches your review queue: does it
          immediately convey value, is the product imagery sharp and professional, does the copy have direction, is it
          on-brand, and does it match what has worked before. Anything that fails is held here — it stays out of downloads,
          Winners, the posting queue and auto-publishing until you approve it.
        </p>
      </div>

      <ComplianceDashboard role={role} />
    </div>
  );
}
