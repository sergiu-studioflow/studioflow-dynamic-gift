import { getAppConfig } from "@/lib/config";
import { requireAuth, isAuthError } from "@/lib/auth";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const config = await getAppConfig();
  return NextResponse.json(config);
}
