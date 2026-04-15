import { schema } from "@/lib/db";
import { createCollectionHandlers } from "@/lib/client-sub-resource";

export const dynamic = "force-dynamic";

const handlers = createCollectionHandlers({
  table: schema.clientBrandIntelligence as any,
  resourceName: "brand-intel",
  orderBy: "asc",
  orderColumn: (schema.clientBrandIntelligence as any).sortOrder,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
