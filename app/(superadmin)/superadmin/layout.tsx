import { requirePlatformAdmin } from "@/lib/platform/guard";

export const dynamic = "force-dynamic";

/** El layout no alcanza solo (no se re-ejecuta al navegar): cada page vuelve a llamar al guard. */
export default async function SuperadminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requirePlatformAdmin();
  return children;
}
