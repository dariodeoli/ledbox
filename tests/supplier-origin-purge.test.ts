import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import { formatBlockers } from '../lib/trash-shared';
function actual(path: string, name: string, globals: any) { const src = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true); const fn = src.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!; return runInNewContext(ts.transpileModule(fn.getText(src).replace(/^export /, '') + ';' + name + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, globals); }
class TrashError extends Error {
    constructor(message: string, readonly status: number, readonly blockers?: any[]) { super(message); }
}
test('supplier purge counts inventory defaults and physical owners within tenant, including retained deleted inventory', async () => {
    let queried: any;
    const tx = { $queryRawUnsafe: async (_sql: string, _id: string, org: string) => org === 'own' ? [{ id: 'supplier' }] : [], supplier: { findFirst: async (args: any) => { queried = args; return { _count: { jobs: 0, expenses: 0, purchaseInvoices: 0, inventoryDefaultSources: 2, inventoryOwnedUnits: 3 } }; } } };
    const pick = actual('lib/server/trash.ts', 'pick', {});
    const fn = actual('lib/server/trash.ts', 'blockersFor', { isTrashModel: () => true, TABLES: { Supplier: '"Supplier"' }, LABELS: { Supplier: 'El proveedor' }, anyState: { deletedAt: undefined }, TrashError, pick });
    const blockers = await fn('Supplier', 'supplier', 'own', tx);
    assert.equal(JSON.stringify(blockers), JSON.stringify([{ kind: 'inventoryDefaultSources', count: 2 }, { kind: 'inventoryOwnedUnits', count: 3 }]));
    assert.equal(queried.where.organizationId, 'own');
    assert.equal(queried.select._count.select.inventoryDefaultSources.where.organizationId, 'own');
    assert.equal(queried.select._count.select.inventoryOwnedUnits.where.organizationId, 'own');
    assert.equal('deletedAt' in queried.select._count.select.inventoryDefaultSources.where, false, 'deleted referenced items must still block physical purge');
    const labels = formatBlockers(blockers);
    assert.ok(labels.some(s => s.includes('productos de inventario')));
    assert.ok(labels.some(s => s.includes('unidades físicas')));
    await assert.rejects(fn('Supplier', 'supplier', 'foreign', tx), (e: any) => e.status === 404);
});
test('real purge refuses owner references before delete and maps concurrent Supplier FK conflict to409 without clearing references', async () => {
    let deleted = 0;
    const owner = { ownerSupplierId: 'supplier' };
    const fn = actual('lib/server/trash-crm.ts', 'purgeCrm', { readPurgeReason: () => 'QA', dbWithDeleted: { $transaction: async (cb: any) => cb({ supplier: { delete: async () => { deleted++; } } }) }, purgeBlockers: async () => [{ kind: 'inventoryOwnedUnits', count: 1 }], loadTrashed: async () => ({ label: 'Owner' }), namesMatch: () => true, blockedError: (b: any) => new TrashError('blocked', 409, b), TrashError, DELEGATE: { Supplier: 'supplier' } });
    await assert.rejects(fn('Supplier', 'supplier', { confirmName: 'Owner', reason: 'QA' }, {}), (e: any) => e.status === 409 && e.blockers[0].kind === 'inventoryOwnedUnits');
    assert.equal(deleted, 0);
    assert.equal(owner.ownerSupplierId, 'supplier');
    const race = actual('lib/server/trash-crm.ts', 'purgeCrm', { readPurgeReason: () => 'QA', dbWithDeleted: { $transaction: async () => { throw { code: 'P2003' }; } }, TrashError });
    await assert.rejects(race('Supplier', 'supplier', {}, {}), (e: any) => e.status === 409 && /inventario/.test(e.message));
    await assert.rejects(race('Client', 'client', {}, {}), (e: any) => e.code === 'P2003' && e.status === undefined);
    assert.equal(owner.ownerSupplierId, 'supplier');
});
