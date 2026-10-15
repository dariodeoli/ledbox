import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("el menú lateral del panel y del superadmin tienen «Cerrar sesión»", () => {
  const shell = readFileSync("components/admin/AdminShell.tsx", "utf8");
  const foot = shell.slice(shell.indexOf('className="admin-sidebar-foot"'), shell.indexOf("</aside>", shell.indexOf('className="admin-sidebar-foot"')));
  assert.match(foot, /className="admin-nav-link admin-sidebar-logout"[\s\S]*onClick=\{\(\) => void logout\(\)\}/);
  assert.match(foot, /"Salir de la demo" : "Cerrar sesión"/);
  const platform = readFileSync("components/platform/PlatformShell.tsx", "utf8");
  assert.match(platform, /<PlatformLogout \/>/);
  const button = readFileSync("components/platform/PlatformLogout.tsx", "utf8");
  assert.match(button, /fetch\("\/api\/auth\/logout", \{ method: "POST" \}\)/);
  assert.match(button, /window\.location\.assign\("\/login"\)/);
});
