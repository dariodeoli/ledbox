import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
// Integrator-only opt-in: disposable local PG with migration79 already applied.
test('supplier ownership references block purge409 without clearing history; tenant isolation and org cascade remain valid', { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    process.env.DATABASE_URL = url.toString();
    const { db, dbWithDeleted } = await import('../lib/server/db');
    const { purgeCrm } = await import('../lib/server/trash-crm');
    const { blockersFor } = await import('../lib/server/trash');
    const { portalAuditContext } = await import('../lib/server/audit');
    const org = randomUUID(), foreign = randomUUID();
    await db.organization.createMany({ data: [{ id: org, name: 'Ownership purge fixture', slug: `purge-owner-${org}` }, { id: foreign, name: 'Foreign fixture', slug: `purge-owner-${foreign}` }] });
    const supplier = await db.supplier.create({ data: { id: randomUUID(), organizationId: org, name: 'Historical owner' } });
    const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: 'Consigned fixture', category: 'Fixture', quantity: 1, defaultStockOrigin: 'CONSIGNED', defaultSourceSupplierId: supplier.id } });
    const unit = await db.inventoryUnit.create({ data: { id: randomUUID(), organizationId: org, inventoryId: item.id, code: `OWN-${randomUUID()}`, stockOrigin: 'CONSIGNED', ownerSupplierId: supplier.id } });
    await dbWithDeleted.supplier.update({ where: { id: supplier.id }, data: { deletedAt: new Date(), active: false } });
    const input = { confirmName: supplier.name, reason: 'Fixture cleanup request' };
    try {
        const blockers = await dbWithDeleted.$transaction(tx => blockersFor('Supplier', supplier.id, org, tx));
        assert.equal(blockers.find(b => b.kind === 'inventoryDefaultSources')?.count, 1);
        assert.equal(blockers.find(b => b.kind === 'inventoryOwnedUnits')?.count, 1);
        await assert.rejects(purgeCrm('Supplier', supplier.id, input, portalAuditContext(org, 'Purge fixture')), (e: any) => e.status === 409 && e.blockers.some((b: any) => b.kind === 'inventoryOwnedUnits'));
        assert.equal((await dbWithDeleted.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).defaultSourceSupplierId, supplier.id);
        assert.equal((await db.inventoryUnit.findUniqueOrThrow({ where: { id: unit.id } })).ownerSupplierId, supplier.id);
        assert.ok(await dbWithDeleted.supplier.findUnique({ where: { id: supplier.id } }));
        await assert.rejects(purgeCrm('Supplier', supplier.id, input, portalAuditContext(foreign, 'Foreign request')), (e: any) => e.status === 404);
        // Whole-organization deletion is an allowed aggregate cascade; deferred NO ACTION must not orphan owners or prevent it.
        await db.organization.delete({ where: { id: org } });
        assert.equal(await db.inventoryUnit.count({ where: { organizationId: org } }), 0);
        assert.equal(await dbWithDeleted.supplier.count({ where: { organizationId: org } }), 0);
    }
    finally {
        await db.organization.deleteMany({ where: { id: { in: [org, foreign] } } });
        await db.$disconnect();
    }
});
