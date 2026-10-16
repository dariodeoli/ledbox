import * as photoResults from "../lib/import-photo-results";
import assert from 'node:assert/strict';import {test} from 'node:test';import{readFileSync}from'node:fs';import{runInNewContext}from'node:vm';import ts from'typescript';import{planUnitStates}from'../lib/import-catalog';
const src=ts.createSourceFile('import.ts',readFileSync('lib/server/import-catalog.ts','utf8'),ts.ScriptTarget.Latest,true);const fn=(name:string,g:any)=>runInNewContext(ts.transpileModule(src.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)!.getText(src).replace(/^export /,'')+';'+name+';',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,g);
async function harness(committed=8,rollbackFirst=false){
const units=Array.from({length:10},(_,i)=>({id:String(i),code:String(i),status:'AVAILABLE'}));let actual=0;let rolledBack=false;
const state=fn('applyUnitStates',{ADJUSTABLE_STATES:['MAINTENANCE','DAMAGED','LOST'],committedQuantities:async()=>new Map([['i',committed]]),planUnitStates,beginInventoryUnitIncidentCycle:async()=>1,randomUUID:()=>String(actual),INCIDENT_KIND_OF:{MAINTENANCE:'REPAIR'},IMPORT_NOTE:'Importación',auditChanges:()=>null,syncInventoryQuantity:async()=>{}});
const tx={inventoryUnit:{findMany:async()=>units,update:async({where,data}:any)=>{units.find(u=>u.id===where.id)!.status=data.status;actual++}},inventoryIncident:{create:async()=>{}}};
const planned={existingId:'i',accion:'actualizar',esCombo:false,product:{codigo:'A',nombre:'Silla',colecciones:null},foto:null,fotosExtra:null};const plan={items:[planned],categories:[],collections:[],summary:{omitidos:0,estadosMantenimiento:7},problems:[]};
const apply=fn('applyCatalog',{...photoResults,previewCatalog:async()=>plan,db:{$transaction:async(cb:any)=>{const snapshot=units.map(u=>u.status);const out=await cb(tx);if(rollbackFirst&&!rolledBack){rolledBack=true;units.forEach((u,i)=>u.status=snapshot[i]);actual=0;throw new Error('simulated block rollback')}return out}},BLOCK_SIZE:50,writeUnitItem:async()=>{const states=await state(tx,{organizationId:'o',user:{id:null}},'i','Silla',{MAINTENANCE:7});return{id:'i',created:false,photo:false,states}},recordAudit:async()=>{},ADJUSTABLE_STATES:['MAINTENANCE','DAMAGED','LOST'],console:{error(){}}});
const result=await apply({organizationId:'o',user:{id:null}},{lote:'l',photos:null});return{result,actual,plan,units};
}
test('apply counters use changes committed under current reservation lock rather than stale preview',async()=>{
 const {result,actual,plan}=await harness(8);
 assert.equal(plan.summary.estadosMantenimiento,7,'preview remains unchanged');
 assert.equal(actual,2);assert.equal(result.summary.estadosMantenimiento,2);
 assert.equal(result.estadosAplicados[0].solicitados.MAINTENANCE,7);
 assert.equal(result.estadosAplicados[0].aplicados.MAINTENANCE,2);
 assert.equal(result.estadosAplicados[0].noAplicados,5);
 assert.match(result.estadosAplicados[0].motivo,/asignadas/);
 assert.ok(result.avisos.some((p:any)=>/5/.test(p.mensaje)));
 assert.equal(result.tarjetas.find((c:any)=>c.etiqueta==='A mantenimiento').valor,2);
});
test('successful full application reports seven actual changes and no missing-state warning',async()=>{
 const{result,actual}=await harness(0);assert.equal(actual,7);assert.equal(result.summary.estadosMantenimiento,7);assert.equal(result.estadosAplicados[0].noAplicados,0);assert.equal(result.estadosAplicados[0].motivo,null);assert.equal(result.avisos.length,0);
});
test('rolled-back block retry counts only the committed outcome once',async()=>{
 const{result,actual}=await harness(0,true);assert.equal(actual,7);assert.equal(result.summary.estadosMantenimiento,7);assert.equal(result.estadosAplicados.length,1);assert.equal(result.actualizados,1);
});
