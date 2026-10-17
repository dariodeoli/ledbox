import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const routePath = "app/api/admin/inventory/incidents/route.ts";

function getHarness(options: { unitStatus?: string; denied?: boolean } = {}) {
  let incidentReads = 0;
  let auditReads = 0;
  const row = {
    id: "unit-1", code: "EQ-01", status: options.unitStatus ?? "RETIRED", incidentCycle: 2,
    inventory: { id: "item-1", name: "Equipo QA", sku: "EQ" },
  };
  const incidentKind = row.status === "LOST" ? "MISSING" : "DAMAGE";
  const db = {
    inventoryUnit: { findFirst: async ({ where }: any) => {
      assert.equal(where.organizationId, "tenant-a", "la unidad siempre se busca dentro del tenant autenticado");
      return where.id === row.id ? row : null;
    } },
    inventoryIncident: { findMany: async ({ where }: any) => {
      incidentReads++;
      assert.equal(where.organizationId, "tenant-a");
      assert.equal(where.unitId, row.id);
      return [{ id: "incident-1", organizationId: "tenant-a", unitId: row.id, unitCycle: 2, kind: incidentKind, status: "WRITTEN_OFF" }];
    } },
    auditLog: { findMany: async ({ where }: any) => {
      auditReads++;
      assert.equal(where.organizationId, "tenant-a");
      assert.equal(where.entity, "InventoryIncident");
      assert.equal(where.entityId.in.length, 1);
      assert.equal(where.entityId.in[0], "incident-1");
      return [
        { id: "audit-create", entityId: "incident-1", action: "create", actorName: "QA", summary: incidentKind === "MISSING" ? "Faltante registrado" : "Daño registrado", detail: { fields: { kind: incidentKind } }, createdAt: new Date("2035-01-01T10:00:00Z") },
        { id: "audit-close", entityId: "incident-1", action: "status", actorName: "QA", summary: "Dado de baja", detail: { changes: { status: { from: "OPEN", to: "WRITTEN_OFF" } } }, createdAt: new Date("2035-01-01T11:00:00Z") },
      ];
    } },
    $transaction: async (operation: (tx: any) => Promise<unknown>, options: any) => {
      assert.equal(options.isolationLevel, "RepeatableRead", "el resumen se lee en una sola vista consistente");
      return operation(db);
    },
  };
  const source = ts.createSourceFile(routePath, readFileSync(routePath, "utf8"), ts.ScriptTarget.Latest, true);
  const getNode = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "GET");
  assert.ok(getNode);
  const get = runInNewContext(ts.transpileModule(`${getNode.getText(source).replace(/^export /, "")}\nGET;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    db,
    URL,
    Response,
    requireAdminContext: async () => options.denied
      ? { ok: false, response: Response.json({ error: "No autorizado" }, { status: 403 }) }
      : { ok: true, context: { organizationId: "tenant-a" } },
    jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  });
  return { get, reads: () => [incidentReads, auditReads] };
}

test("historial causal por unidad expone retiro/pérdida y auditoría bajo tenant autenticado", async () => {
  for (const status of ["RETIRED", "LOST"]) {
    const f = getHarness({ unitStatus: status });
    const expectedKind = status === "LOST" ? "MISSING" : "DAMAGE";
    const response = await f.get(new Request("http://localhost/api/admin/inventory/incidents?unitTrace=unit-1"));
    assert.equal(response.status, 200);
    const payload = await response.json() as { unit: { status: string; incidentCycle: number }; incidents: Array<{ kind: string; unitCycle: number; status: string }>; history: Array<{ action: string; detail: { fields?: { kind?: string }; changes?: { status?: { to?: string } } } | null }> };
    assert.deepEqual([payload.unit.status, payload.unit.incidentCycle], [status, 2]);
    assert.deepEqual(payload.incidents.map((incident) => [incident.kind, incident.unitCycle, incident.status]), [[expectedKind, 2, "WRITTEN_OFF"]]);
    assert.deepEqual(payload.history.map((event) => event.action), ["create", "status"]);
    assert.equal(payload.history[0].detail?.fields?.kind, expectedKind);
    assert.equal(payload.history[1].detail?.changes?.status?.to, "WRITTEN_OFF");
    assert.deepEqual(f.reads(), [1, 1]);
  }
});

test("historial causal no consulta incidentes si la unidad pertenece a otro tenant", async () => {
  const f = getHarness();
  const response = await f.get(new Request("http://localhost/api/admin/inventory/incidents?unitTrace=foreign-unit"));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "La unidad no existe en esta empresa." });
  assert.deepEqual(f.reads(), [0, 0]);
});

test("historial causal requiere autorización antes de consultar", async () => {
  const f = getHarness({ denied: true });
  const response = await f.get(new Request("http://localhost/api/admin/inventory/incidents?unitTrace=unit-1"));
  assert.equal(response.status, 403);
  assert.deepEqual(f.reads(), [0, 0]);
});
