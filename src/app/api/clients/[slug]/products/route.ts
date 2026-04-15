import { schema } from "@/lib/db";
import { createCollectionHandlers } from "@/lib/client-sub-resource";

export const dynamic = "force-dynamic";

const handlers = createCollectionHandlers({
  table: schema.clientProducts as any,
  resourceName: "products",
});

export const GET = handlers.GET;
export const POST = handlers.POST;
