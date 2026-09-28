import type { IntegrationProvider } from "@prisma/client";
import { HttpError } from "@/lib/session";

export function parseProvider(p: string): IntegrationProvider {
  const v = p.toUpperCase();
  if (v !== "GOOGLE" && v !== "MICROSOFT" && v !== "SMTP") throw new HttpError(404, "Unknown provider");
  return v;
}
