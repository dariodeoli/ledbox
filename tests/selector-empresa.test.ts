import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("el panel tiene el selector «Cambiar de empresa» y llama al PATCH de la sesión", () => {
  const shell = readFileSync("components/admin/AdminShell.tsx", "utf8");
  assert.match(shell, /aria-label="Cambiar de empresa"/);
  assert.match(shell, /`Cambiar a \$\{org.name\}`/);
  assert.match(shell, /session\.organizations\.length > 1/);
  assert.match(shell, /fetch\("\/api\/admin\/session", \{\s*method: "PATCH"/);
  const route = readFileSync("app/api/admin/session/route.ts", "utf8");
  assert.match(route, /setActiveOrganization\(result\.context, organizationId\)/);
});
