import { schema } from "@/lib/db";
import { createItemHandlers } from "@/lib/client-sub-resource";

export const dynamic = "force-dynamic";

const handlers = createItemHandlers({
  table: schema.clientProducts as any,
  resourceName: "products",
  imageUrlFields: ["imageUrl", "videoImageUrl"],
});

export const GET = handlers.GET;
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
