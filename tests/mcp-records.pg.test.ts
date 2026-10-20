import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("MCP client, lead and event previews are tenant scoped, audited, stale safe and idempotent", { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "MCP integration tests require a local disposable database");
  process.env.DATABASE_URL = url.toString();
  const [{ db }, { previewMcpClient, confirmMcpClient, previewMcpLead, confirmMcpLead, previewMcpEvent, confirmMcpEvent }] = await Promise.all([
    import("../lib/server/db"), import("../lib/server/mcp/mutations"),
  ]);
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const actorId = randomUUID();
  const context = (orgId: string, userId = actorId) => ({
    organizationId: orgId, role: "OWNER" as const, demo: false, sandbox: false,
    organization: { id: orgId, name: "MCP record fixture", slug: `mcp-${orgId}`, planId: null },
    user: { id: userId, name: "MCP record actor", email: "mcp@example.test", role: "OWNER" as const }, session: {} as never,
  });
  await db.organization.createMany({ data: [organizationId, otherOrganizationId].map((id) => ({ id, slug: `mcp-${id}`, name: "MCP record fixture" })) });
  try {
    const beforeClients = await db.client.count({ where: { organizationId } });
    const clientPreview = await previewMcpClient(context(organizationId), { name: "MCP customer", email: "customer@example.test", type: "FINAL" });
    assert.equal(await db.client.count({ where: { organizationId } }), beforeClients, "preview is read only");
    await assert.rejects(() => confirmMcpClient(context(otherOrganizationId), { previewId: clientPreview.previewId, idempotencyKey: randomUUID() }));
    await assert.rejects(() => confirmMcpClient(context(organizationId, randomUUID()), { previewId: clientPreview.previewId, idempotencyKey: randomUUID() }));
    const confirmation = { previewId: clientPreview.previewId, idempotencyKey: randomUUID() };
    const createdClient = await confirmMcpClient(context(organizationId), confirmation) as { id: string };
    assert.deepEqual(await confirmMcpClient(context(organizationId), confirmation), createdClient, "same key returns original result");
    assert.equal(await db.client.count({ where: { organizationId } }), beforeClients + 1);
    assert.equal(await db.auditLog.count({ where: { organizationId, entity: "Client", entityId: createdClient.id } }), 1);

    const consentAt = new Date().toISOString();
    const leadPreview = await previewMcpLead(context(organizationId), { name: "MCP lead", phone: "0981000000", email: "lead@example.test", consentAt, consentChannel: "web-form", consentVersion: "v1" });
    const leadResult = await confirmMcpLead(context(organizationId), { previewId: leadPreview.previewId, idempotencyKey: randomUUID() }) as { id: string };
    const lead = await db.lead.findFirstOrThrow({ where: { id: leadResult.id, organizationId }, select: { source: true, consentAt: true, consentChannel: true, consentVersion: true, internalNotes: true } });
    assert.equal(lead.source, "mcp");
    assert.equal(lead.consentChannel, "web-form");
    assert.equal(lead.consentVersion, "v1");
    assert.equal(lead.internalNotes, null);
    assert.equal(lead.consentAt.toISOString(), consentAt);
    assert.equal(await db.auditLog.count({ where: { organizationId, entity: "Lead", entityId: leadResult.id } }), 1);

    const eventPreview = await previewMcpEvent(context(organizationId), { clientId: createdClient.id, name: "MCP event", startsAt: "2026-11-01T14:00:00.000Z", endsAt: "2026-11-01T18:00:00.000Z" });
    const eventResult = await confirmMcpEvent(context(organizationId), { previewId: eventPreview.previewId, idempotencyKey: randomUUID() }) as { id: string };
    const event = await db.event.findFirstOrThrow({ where: { id: eventResult.id, organizationId }, select: { clientId: true, name: true, status: true, startsAt: true, endsAt: true } });
    assert.equal(event.clientId, createdClient.id);
    assert.equal(event.status, "DRAFT");
    assert.equal(event.startsAt?.toISOString(), "2026-11-01T14:00:00.000Z");
    const foreignClient = await db.client.create({ data: { id: randomUUID(), organizationId: otherOrganizationId, name: "Foreign" } });
    await assert.rejects(() => previewMcpEvent(context(organizationId), { clientId: foreignClient.id, name: "Cross tenant" }));
    assert.equal(await db.auditLog.count({ where: { organizationId, entity: "Event", entityId: eventResult.id } }), 1);

    const stale = await previewMcpClient(context(organizationId), { id: createdClient.id, name: "Changed after preview" });
    await db.client.update({ where: { id: createdClient.id }, data: { phone: "0982000000" } });
    await assert.rejects(() => confirmMcpClient(context(organizationId), { previewId: stale.previewId, idempotencyKey: randomUUID() }), /PREVIEW_STALE/);
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
  }
});
