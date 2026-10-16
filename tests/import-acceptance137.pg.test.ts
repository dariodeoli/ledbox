import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';

// Run ONLY against a disposable local PG with migration78/client already applied by the integrator.
// TEST_DATABASE_URL=postgresql://... node --import tsx --test --test-concurrency=1 tests/import-acceptance137.pg.test.ts
// Optional matching local server: IMPORT_ACCEPTANCE_BASE_URL=http://127.0.0.1:3177 (same DB).
test('137 applied catalog acceptance: states, unknown counts, tariffs, combos and rental lifecycle', {skip:!process.env.TEST_DATABASE_URL},async t=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1'].includes(url.hostname),'disposable local DB only');process.env.DATABASE_URL=url.toString();
 const {db}=await import('../lib/server/db');
 const {normalizeCatalog}=await import('../lib/import-catalog');
 const {applyCatalog,previewCatalog}=await import('../lib/server/import-catalog');
 const {portalAuditContext}=await import('../lib/server/audit');
 const {commitInventoryAssignment,reserveBudgetInventory}=await import('../lib/server/inventory-availability');
 const {comboCapacitiesForRange}=await import('../lib/server/inventory-combos');
 const {dispatchAssignment,returnAssignment}=await import('../lib/server/inventory-operations');
 const org=randomUUID();await db.organization.create({data:{id:org,name:'137 acceptance fixture',slug:`acceptance137-${org}`}});
 const ctx=portalAuditContext(org,'137 import acceptance');
 const raw=(codigo:string,extra:Record<string,unknown>={})=>({codigo,nombre:`Fixture ${codigo}`,tipo:'unidad',cantidad:10,precio:10000,...extra});
 const input=(productos:Record<string,unknown>[])=>{const p=normalizeCatalog({moneda:'PYG',productos});assert.ok(p.ok);return{products:p.value.doc.productos,parseProblems:p.value.problems,photos:null,photoProblems:[]}};
 const apply=async(products:Record<string,unknown>[])=>{const out=await applyCatalog(ctx,{...input(products),lote:randomUUID()});assert.deepEqual(out.fallidos,[]);return out};
 const item=(sku:string)=>db.inventoryItem.findFirstOrThrow({where:{organizationId:org,sku}});
 const count=async(sku:string)=>{const p=await item(sku);const rows=await db.inventoryUnit.groupBy({by:['status'],where:{organizationId:org,inventoryId:p.id},_count:{_all:true}});return{item:p,counts:Object.fromEntries(rows.map(r=>[r.status,r._count._all]))}};
 const client=await db.client.create({data:{id:randomUUID(),organizationId:org,name:'Acceptance client'}});
 const startsAt=new Date('2039-07-10T12:00:00Z'),endsAt=new Date('2039-07-11T12:00:00Z');
 const event=()=>db.event.create({data:{id:randomUUID(),organizationId:org,clientId:client.id,name:'Acceptance event',startsAt,endsAt,setupAt:startsAt,strikeAt:endsAt}});
 try{
  await t.test('10 units /7 maintenance: applied DB7+3, reimport no duplicate units/incidents',async()=>{
   const doc=[raw('STATE',{en_mantenimiento:7})];const plan=await previewCatalog(org,input(doc));assert.equal(plan.summary.estadosMantenimiento,7);assert.equal(await db.inventoryItem.count({where:{organizationId:org}}),0);
   const result=await apply(doc);let actual=await count('STATE');assert.equal(actual.item.quantity,10);assert.deepEqual(actual.counts,{AVAILABLE:3,MAINTENANCE:7});assert.equal(result.summary.estadosMantenimiento,7);
   const units=await db.inventoryUnit.findMany({where:{inventoryId:actual.item.id},select:{id:true},orderBy:{id:'asc'}});const incidents=await db.inventoryIncident.count({where:{inventoryId:actual.item.id}});
   await apply(doc);actual=await count('STATE');assert.deepEqual(actual.counts,{AVAILABLE:3,MAINTENANCE:7});assert.deepEqual(await db.inventoryUnit.findMany({where:{inventoryId:actual.item.id},select:{id:true},orderBy:{id:'asc'}}),units);assert.equal(await db.inventoryIncident.count({where:{inventoryId:actual.item.id}}),incidents);
  });
  await t.test('assigned8 remain intact when requested damage5 can apply only2; summary reflects DB change',async()=>{
   await apply([raw('ASSIGNED')]);const p=await item('ASSIGNED'),e=await event();const reserved=await commitInventoryAssignment({organizationId:org,eventId:e.id,inventoryId:p.id,quantity:8,startsAt,endsAt});assert.ok(reserved.ok);
   const doc=[raw('ASSIGNED',{danadas:5})];const plan=await previewCatalog(org,input(doc));assert.ok(plan.problems.some(p=>p.tipo==='estado-incompleto'));const applied=await apply(doc);const actual=await count('ASSIGNED');assert.equal(actual.counts.DAMAGED,2);assert.equal(actual.counts.AVAILABLE,8);assert.equal(applied.summary.estadosDanadas,2);assert.equal(applied.estadosAplicados[0].solicitados.DAMAGED,5);assert.equal(applied.estadosAplicados[0].aplicados.DAMAGED,2);assert.equal(applied.estadosAplicados[0].noAplicados,3);assert.ok(applied.problems.some(p=>p.tipo==='estado-incompleto'&&/3/.test(p.mensaje)));assert.equal((await db.eventInventory.findUniqueOrThrow({where:{id:reserved.assignment.id}})).quantity,8);
  });
  await t.test('reservation entering after preview cannot inflate applied summary: deterministic real-DB window',async()=>{
   await apply([raw('RACE')]);const p=await item('RACE'),e=await event();
   const original=db.$transaction.bind(db),target=db as unknown as {$transaction:(...args:any[])=>any};let inject=true;
   target.$transaction=async(...args:any[])=>{
    if(inject){inject=false;const reservation=await commitInventoryAssignment({organizationId:org,eventId:e.id,inventoryId:p.id,quantity:8,startsAt,endsAt});assert.ok(reservation.ok);}
    return(original as (...args:any[])=>any)(...args);
   };
   try{const result=await apply([raw('RACE',{en_mantenimiento:7})]);const actual=await count('RACE');assert.equal(actual.counts.MAINTENANCE,2);assert.equal(actual.counts.AVAILABLE,8);assert.equal(result.summary.estadosMantenimiento,2);assert.equal(result.estadosAplicados[0].solicitados.MAINTENANCE,7);assert.equal(result.estadosAplicados[0].noAplicados,5);assert.ok(result.avisos.some(row=>/5/.test(row.mensaje)));}
   finally{target.$transaction=original;}
  });
  await t.test('new null/omitted creates pending0; explicit0 confirmed0; existing null preserves counted units, prices and tariffs',async()=>{
   await apply([raw('UNKNOWN',{cantidad:null,precio:null}),raw('ABSENT',{cantidad:undefined,precio:null}),raw('ZERO',{cantidad:0,precio:null})]);
   for(const sku of ['UNKNOWN','ABSENT','ZERO']){const p=await item(sku);assert.equal(p.quantity,0);assert.equal(await db.inventoryUnit.count({where:{inventoryId:p.id}}),0);assert.equal((p as unknown as {stockCountStatus:string}).stockCountStatus,sku==='ZERO'?'CONFIRMED':'PENDING_COUNT');assert.equal(p.listPrice,0);}
   await apply([raw('UNKNOWN',{cantidad:null,precio:21000})]);const stillUnknown=await item('UNKNOWN');assert.equal(stillUnknown.quantity,0);assert.equal((stillUnknown as unknown as {stockCountStatus:string}).stockCountStatus,'PENDING_COUNT');assert.equal(await db.inventoryUnit.count({where:{inventoryId:stillUnknown.id}}),0);
   await apply([raw('KEEP',{cantidad:4,precio:12000,precios_dias:[{desde_dias:3,modo:'total',precio:25000}]})]);const before=await item('KEEP'),units=await db.inventoryUnit.findMany({where:{inventoryId:before.id},orderBy:{id:'asc'}}),tiers=await db.inventoryPriceTier.findMany({where:{inventoryId:before.id},orderBy:{id:'asc'}});assert.equal(tiers.length,1);
   await apply([raw('KEEP',{cantidad:null,precio:null})]);const after=await item('KEEP');assert.equal(after.quantity,4);assert.equal(after.listPrice,12000);assert.equal((after as unknown as {stockCountStatus:string}).stockCountStatus,'CONFIRMED');assert.deepEqual(await db.inventoryUnit.findMany({where:{inventoryId:before.id},orderBy:{id:'asc'}}),units);assert.deepEqual(await db.inventoryPriceTier.findMany({where:{inventoryId:before.id},orderBy:{id:'asc'}}),tiers);
  });
  await t.test('import unit+combo then quote fixture→real reserve→dispatch→return; null combo price never autosums',async()=>{
   await apply([raw('LEAF',{cantidad:4,precio:15000}),raw('KIT',{tipo:'juego',cantidad:null,precio:null,componentes:[{codigo:'LEAF',cantidad:2}]})]);const leaf=await item('LEAF'),kit=await item('KIT');assert.equal(kit.listPrice,0,'no commercial price was provided; must remain Consultar');assert.equal(await db.inventoryUnit.count({where:{inventoryId:kit.id}}),0);
   const capacity=(await comboCapacitiesForRange({organizationId:org,comboIds:[kit.id],startsAt,endsAt})).get(kit.id);assert.equal(capacity?.capacity,2);
   const e=await event();const quote=await db.budget.create({data:{id:randomUUID(),organizationId:org,clientId:client.id,eventId:e.id,title:'Explicit fixture quote (not generated commercial price)',status:'SENT',subtotal:30000,total:30000,items:{create:{id:randomUUID(),name:kit.name,inventoryId:kit.id,quantity:1,days:1,unitPrice:30000,subtotal:30000}}}});
   const reservation=await reserveBudgetInventory({organizationId:org,budgetId:quote.id,context:ctx});assert.equal(reservation.failed,false);assert.equal(reservation.conflicts,0);
   const assignment=await db.eventInventory.findFirstOrThrow({where:{eventId:e.id,inventoryId:leaf.id,releasedAt:null}});assert.equal(assignment.quantity,2);
   const sent=await dispatchAssignment({organizationId:org,assignmentId:assignment.id,at:startsAt,condition:'QA good'});assert.ok(sent.ok);
   const returned=await returnAssignment({organizationId:org,assignmentId:assignment.id,quantity:2,damaged:0,missing:0,at:endsAt,condition:'QA good'});assert.ok(returned.ok);assert.equal((await db.eventInventory.findUniqueOrThrow({where:{id:assignment.id}})).checkedIn,true);
   assert.equal((await comboCapacitiesForRange({organizationId:org,comboIds:[kit.id],startsAt:new Date('2039-08-10'),endsAt:new Date('2039-08-11')})).get(kit.id)?.capacity,2);
  });
  await t.test('portable company export+restore roundtrip: NOT_AVAILABLE, no fabricated PASS',{todo:'NOT_AVAILABLE: #246 no tenant portable export/restore endpoint exists'},()=>{});
 }finally{await db.organization.deleteMany({where:{id:org}});await db.$disconnect()}
});
