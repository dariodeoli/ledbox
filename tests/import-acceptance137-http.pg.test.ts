import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
const base=process.env.IMPORT_ACCEPTANCE_BASE_URL;
const enabled=Boolean(process.env.TEST_DATABASE_URL&&base&&/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base));
// Opt-in: matching local app server + disposable PG, no external network or real messages.
test('137 imported unit+combo → public quote approval HTTP → real reserve/dispatch/return', {skip:!enabled,timeout:60000},async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));process.env.DATABASE_URL=url.toString();
 const {db}=await import('../lib/server/db');const{applyCatalog}=await import('../lib/server/import-catalog');const{normalizeCatalog}=await import('../lib/import-catalog');const{portalAuditContext}=await import('../lib/server/audit');const{generatePublicToken}=await import('../lib/server/budget-portal');const{dispatchAssignment,returnAssignment}=await import('../lib/server/inventory-operations');
 const org=randomUUID();await db.organization.create({data:{id:org,name:'137 HTTP disposable fixture',slug:`http137-${org}`}});
 try{
  const normalized=normalizeCatalog({productos:[{codigo:'U1',nombre:'Fixture chair',tipo:'unidad',cantidad:4,precio:10000},{codigo:'J1',nombre:'Fixture combo',tipo:'juego',cantidad:null,precio:19000,componentes:[{codigo:'U1',cantidad:2}]}]});assert.ok(normalized.ok);
  const imported=await applyCatalog(portalAuditContext(org,'137 HTTP acceptance'),{products:normalized.value.doc.productos,parseProblems:normalized.value.problems,photos:null,photoProblems:[],lote:randomUUID()});assert.deepEqual(imported.fallidos,[]);
  const leaf=await db.inventoryItem.findFirstOrThrow({where:{organizationId:org,sku:'U1'}}),combo=await db.inventoryItem.findFirstOrThrow({where:{organizationId:org,sku:'J1'}});
  const client=await db.client.create({data:{id:randomUUID(),organizationId:org,name:'Fixture renter'}});await db.treasuryAccount.create({data:{id:randomUUID(),organizationId:org,name:'Fixture account'}});
  const startsAt=new Date('2040-08-10T12:00:00Z'),endsAt=new Date('2040-08-11T12:00:00Z');const event=await db.event.create({data:{id:randomUUID(),organizationId:org,clientId:client.id,name:'Fixture production',startsAt,endsAt,setupAt:startsAt,strikeAt:endsAt}});
  // Quote fixture is explicit; this test exercises the real public decision endpoint, not the creation form.
  const quote=await db.budget.create({data:{id:randomUUID(),organizationId:org,clientId:client.id,eventId:event.id,title:'Fixture quote',status:'SENT',publicToken:generatePublicToken(),subtotal:19000,total:19000,items:{create:{id:randomUUID(),name:combo.name,inventoryId:combo.id,quantity:1,days:1,unitPrice:19000,subtotal:19000}}}});
  assert.equal(await db.eventInventory.count({where:{eventId:event.id}}),0,'quote alone must not reserve');
  const response=await fetch(`${base}/api/portal/budget/${quote.publicToken}/approve`,{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':`acceptance137-${randomUUID()}`},body:JSON.stringify({name:'Fixture renter',consent:true,budgetId:quote.id})});assert.equal(response.status,200,await response.text());
  assert.equal((await db.budget.findUniqueOrThrow({where:{id:quote.id}})).status,'APPROVED');
  const assignment=await db.eventInventory.findFirstOrThrow({where:{eventId:event.id,inventoryId:leaf.id,releasedAt:null}});assert.equal(assignment.quantity,2);
  const sent=await dispatchAssignment({organizationId:org,assignmentId:assignment.id,at:startsAt,condition:'Fixture good'});assert.ok(sent.ok);
  const returned=await returnAssignment({organizationId:org,assignmentId:assignment.id,quantity:2,damaged:0,missing:0,at:endsAt,condition:'Fixture good'});assert.ok(returned.ok);
  assert.equal((await db.eventInventory.findUniqueOrThrow({where:{id:assignment.id}})).checkedIn,true);
 }finally{await db.organization.deleteMany({where:{id:org}});await db.$disconnect()}
});
