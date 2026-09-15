import { schema } from "@/lib/db";
import { createCollectionHandlers } from "@/lib/client-sub-resource";

export const dynamic = "force-dynamic";

const handlers = createCollectionHandlers({
  table: schema.clientProducts,
  resourceName: "products",
  // Blank image URLs are stored as null on create, as on edit.
  imageUrlFields: ["imageUrl", "videoImageUrl"],
});

export const GET = handlers.GET;
export const POST = handlers.POST;
