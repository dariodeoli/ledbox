import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
const base=process.env.IMPORT_ACCEPTANCE_BASE_URL;
const enabled=Boolean(process.env.TEST_DATABASE_URL&&base&&/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base));
test('137 real multipart preview→apply preserves maintenance totals and duration tiers', {skip:!enabled,timeout:60000},async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));process.env.DATABASE_URL=url.toString();
 const {db}=await import('../lib/server/db');const {createSession}=await import('../lib/server/auth');
 const org=randomUUID(),userId=randomUUID();await db.organization.create({data:{id:org,name:'137 multipart disposable fixture',slug:`multipart137-${org}`}});
 try{
  const user=await db.adminUser.create({data:{id:userId,name:'Multipart QA',email:`${userId}@example.invalid`,role:'OWNER',passwordHash:'not-a-login',autoLockEnabled:false}});
  await db.adminMembership.create({data:{id:randomUUID(),adminUserId:userId,organizationId:org,role:'OWNER'}});
  const cookie=`ledbox_session=${(await createSession(user,org)).jwt}`;
  const doc={productos:[{codigo:'UI-7',nombre:'Multipart chair',cantidad:10,precio:10000,en_mantenimiento:7,precios_dias:[{desde_dias:3,modo:'total',precio:25000}]}]};
  const previewForm=new FormData();previewForm.set('accion','preview');previewForm.set('modo','CREATE_ONLY');previewForm.set('fuente','json');previewForm.set('json',new File([JSON.stringify(doc)],'catalogo.json',{type:'application/json'}));
  const response=await fetch(`${base}/api/admin/import/productos`,{method:'POST',headers:{Cookie:cookie},body:previewForm});assert.equal(response.status,200,await response.clone().text());
  const preview=await response.json();assert.equal(preview.resumen.estadosMantenimiento,7);assert.equal(preview.catalogo.productos[0].en_mantenimiento,7);assert.equal(preview.catalogo.productos[0].precios_dias[0].desde_dias,3);
  const applyForm=new FormData();applyForm.set('accion','apply');applyForm.set('modo','CREATE_ONLY');applyForm.set('catalogo',JSON.stringify(preview.catalogo));applyForm.set('lote',randomUUID());
  const applied=await fetch(`${base}/api/admin/import/productos`,{method:'POST',headers:{Cookie:cookie},body:applyForm});assert.equal(applied.status,200,await applied.clone().text());
  const messages=(await applied.text()).trim().split('\n').map(line=>JSON.parse(line));assert.ok(messages.every(row=>!row.error));const result=messages.find(row=>row.resultado)?.resultado;assert.ok(result);assert.equal(result.summary.estadosMantenimiento,7);assert.deepEqual(result.fallidos,[]);
  const item=await db.inventoryItem.findFirstOrThrow({where:{organizationId:org,sku:'UI-7'}});assert.equal(item.quantity,10);assert.equal(await db.inventoryUnit.count({where:{inventoryId:item.id,status:'MAINTENANCE'}}),7);assert.equal(await db.inventoryUnit.count({where:{inventoryId:item.id,status:'AVAILABLE'}}),3);
  const tier=await db.inventoryPriceTier.findFirstOrThrow({where:{inventoryId:item.id}});assert.equal(tier.fromDays,3);assert.equal(tier.price,25000);
 }finally{await db.organization.deleteMany({where:{id:org}});await db.adminUser.deleteMany({where:{id:userId}});await db.$disconnect()}
});
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
