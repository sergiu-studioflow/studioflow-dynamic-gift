import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { provisionClient } from "@/lib/client-provisioning";
import type { BrandOption } from "@/lib/types";
import { slugify } from "@/lib/utils";
import { eq, asc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

export const dynamic = "force-dynamic";

// GET — list all active brands (sorted by sortOrder). Typed as BrandOption[] so this
// response and BrandSelect can't drift apart again.
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const rows = await db
    .select()
    .from(schema.brands)
    .where(eq(schema.brands.isActive, true))
    .orderBy(asc(schema.brands.sortOrder), asc(schema.brands.brandName));

  return NextResponse.json<BrandOption[]>(rows);
}

const createBrandSchema = z.object({
  name: z.string().min(1).max(200),
});

// POST — add a new brand (admin only). Provisioned exactly like Clients → Add Client:
// a bare row had no slug or storage prefix, so every brand-scoped system broke on it.
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createBrandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.format() }, { status: 400 });
  }

  const name = parsed.data.name.trim();
  const clientSlug = slugify(name);
  if (!clientSlug) {
    return NextResponse.json({ error: "Brand name must contain letters or numbers" }, { status: 400 });
  }

  const [existing] = await db
    .select({ id: schema.brands.id })
    .from(schema.brands)
    .where(eq(schema.brands.clientSlug, clientSlug))
    .limit(1);
  if (existing) {
    return NextResponse.json({ error: `A brand with the slug "${clientSlug}" already exists` }, { status: 409 });
  }

  try {
    const brand = await provisionClient({ clientName: name, clientSlug }, auth.portalUser.id);
    return NextResponse.json(brand, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("unique")) {
      return NextResponse.json({ error: "A brand with this name already exists" }, { status: 409 });
    }
    throw err;
  }
}
