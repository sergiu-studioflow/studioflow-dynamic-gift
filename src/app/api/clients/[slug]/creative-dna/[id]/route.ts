import { schema } from "@/lib/db";
import { createItemHandlers } from "@/lib/client-sub-resource";

export const dynamic = "force-dynamic";

const handlers = createItemHandlers({
  table: schema.clientCreativeDna as any,
  resourceName: "creative-dna",
});

export const GET = handlers.GET;
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
