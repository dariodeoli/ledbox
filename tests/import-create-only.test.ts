import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {normalizeCatalog,planCatalog,type ExistingItem} from '../lib/import-catalog';
import {categoryKey,categoryPathKey} from '../lib/inventory-categories';
import {collectionSlug} from '../lib/collections';
function plan(products:Record<string,unknown>[],mode:'CREATE_ONLY'|'UPSERT'='CREATE_ONLY',existing:ExistingItem={id:'existing',name:'Real',isCombo:false,inTrash:false,units:10,activeUnits:10,stockCountStatus:'CONFIRMED'}){const parsed=normalizeCatalog({productos:products});assert.ok(parsed.ok);return planCatalog({products:parsed.value.doc.productos,parseProblems:parsed.value.problems,existing:new Map([['EX',existing]]),photoNames:null,importMode:mode})}
const existingRow={codigo:'EX',nombre:'Alterado',tipo:'unidad',precio:90000,cantidad:99};
test('CREATE_ONLY preserves existing count/status, permits new combo using preserved component, and UPSERT keeps old behavior',()=>{
 const rows=[existingRow,{codigo:'NEW',nombre:'Nuevo combo',tipo:'juego',precio:null,componentes:[{codigo:'EX',cantidad:2}]}];const p=plan(rows);assert.equal(p.items[0].accion,'omitir');assert.equal(p.items[0].countBefore,10);assert.equal(p.items[0].countAfter,10);assert.equal(p.items[1].accion,'crear');assert.equal(p.problems.filter(x=>x.nivel==='error').length,0);assert.equal(plan(rows,'UPSERT').items[0].accion,'actualizar');
 const pending=plan([existingRow],'CREATE_ONLY',{id:'existing',name:'Real',isCombo:false,inTrash:false,units:0,activeUnits:0,stockCountStatus:'PENDING_COUNT'}).items[0];assert.equal(pending.stockCountStatus,'PENDING_COUNT');assert.equal(pending.countBefore,null);assert.equal(pending.countAfter,null);
});
test('omitted invalid NEW component still blocks combo; existing game stays invalid as nested component',()=>{
 const nested=plan([{codigo:'NEW',nombre:'Nuevo combo',tipo:'juego',componentes:[{codigo:'EX',cantidad:1}]}],'CREATE_ONLY',{id:'existing',name:'Real game',isCombo:true,inTrash:false,units:0});assert.ok(nested.problems.some(x=>x.tipo==='juego-anidado'));assert.equal(nested.items[0].accion,'omitir');
 const p=plan([{codigo:'BAD',nombre:'Malo',cantidad:1,precio:-1},{codigo:'KIT',nombre:'Kit',tipo:'juego',componentes:[{codigo:'BAD',cantidad:1}]}]);assert.equal(p.items.find(x=>x.product.codigo==='KIT')?.accion,'omitir');
});
function actual(path:string,name:string,globals:any){const s=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);const fn=s.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)!;return runInNewContext(ts.transpileModule(fn.getText(s).replace(/^export /,'')+';'+name+';',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,globals)}
test('canonical preserveExisting helpers recheck conflict under key lock without changing archived category/collection metadata',async()=>{
 const before={id:'cat',name:'Sillas',key:'sillas',parentId:null,archivedAt:new Date('2030-01-01'),sortOrder:3};let categoryWrites=0,collectionWrites=0,locks=0;
 const tx={$queryRaw:async()=>{locks++;return[]},inventoryCategory:{createMany:async()=>({count:0}),findFirstOrThrow:async({where}:any)=>{assert.equal(where.organizationId,'org');return before},updateMany:async()=>{categoryWrites++}},collection:{createMany:async()=>({count:0}),findFirstOrThrow:async({where}:any)=>{assert.equal(where.organizationId,'org');return{id:'collection'}},updateMany:async()=>{collectionWrites++}}};
 const find=actual('lib/server/inventory-categories.ts','findOrCreate',{randomUUID:()=> 'new',categoryKey,categoryPathKey});const result=await find(tx,'org','Sillas',null,true);assert.equal(result.created,false);assert.equal(result.archivedAt,before.archivedAt);assert.equal(categoryWrites,0);
 const upsert=actual('lib/server/collections.ts','upsertCollectionByName',{randomUUID:()=> 'new',collectionSlug});const collection=await upsert(tx,'org',{nombre:'Actual',descripcion:'Changed',orden:99},{preserveExisting:true});assert.equal(collection.created,false);assert.equal(collectionWrites,0);assert.equal(locks,2);
});
test('real API preview retains legacy UPSERT default, rejects invalid mode, exposes typed count transitions without writing',async()=>{
 const source=ts.createSourceFile('route.ts',readFileSync('app/api/admin/import/[modulo]/route.ts','utf8'),ts.ScriptTarget.Latest,true);const declaration=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='POST')!;let called=0;
 const parsed=normalizeCatalog({productos:[{codigo:'P',nombre:'Pending',cantidad:null},{codigo:'Z',nombre:'Zero',cantidad:0}]});assert.ok(parsed.ok);
 for(const [mode,wanted]of [[undefined,'UPSERT'],['CREATE_ONLY','CREATE_ONLY'],['NOPE',null]]){
  let passed:any;
  const post=runInNewContext(ts.transpileModule(declaration.getText(source).replace(/^export /,'')+';POST;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{Request,Response,Blob,FormData,guard:async()=>({ok:true,module:{id:'productos'},context:{organizationId:'org'}}),readBodyLimited:async(r:Request)=>({ok:true,bytes:new Uint8Array(await r.arrayBuffer())}),TOTAL_BODY_MAX:100000,textOf:(f:FormData,k:string)=>String(f.get(k)??''),rateLimit:async()=>({allowed:true}),CATALOG_LIMITS:{applyRate:10,previewRate:20},jsonError:(error:string,status:number)=>Response.json({error},{status}),readSource:async()=>({ok:true,products:parsed.value.doc.productos,categories:[],collections:[],problems:[],empresa:'Fixture'}),fileOf:()=>null,previewCatalog:async(_org:string,input:any)=>{called++;passed=input.importMode;return planCatalog({products:input.products,existing:new Map(),photoNames:null,importMode:input.importMode})}});
  const form=new FormData();form.set('accion','preview');if(mode)form.set('modo',mode);const result=await post(new Request('http://localhost/api/admin/import/productos',{method:'POST',body:form}),{params:Promise.resolve({modulo:'productos'})});
  if(!wanted){assert.equal(result.status,400);continue}assert.equal(result.status,200);assert.equal(passed,wanted);const body=await result.json();assert.equal(body.importMode,wanted);assert.equal(body.filas[0].stockCountStatus,'PENDING_COUNT');assert.equal(body.filas[0].countAfter,null);assert.equal(body.filas[1].stockCountStatus,'CONFIRMED');assert.equal(body.filas[1].countAfter,0);
 }assert.equal(called,2,'invalid mode never reaches preview/read pipeline');
});

test('actual preview row renders pending count separately from confirmed zero',()=>{
 const src=ts.createSourceFile('panel.tsx',readFileSync('components/admin/AdminImportPanel.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let target:ts.Node|undefined;
 const visit=(n:ts.Node)=>{if(ts.isJsxElement(n)&&n.getText(src).startsWith('<span')&&n.getText(src).includes('fila.countBefore'))target=n;ts.forEachChild(n,visit)};visit(src);assert.ok(target);
 for(const [status,before,after,expected]of [['PENDING_COUNT',null,null,'Stock: desconocido → pendiente de conteo'],['CONFIRMED',0,0,'Stock: 0 → 0']]){
 const row=runInNewContext(ts.transpileModule(target!.getText(src)+';',{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText,{React,modulo:{id:'productos'},fila:{detalle:'Unidad',stockCountStatus:status,countBefore:before,countAfter:after}});assert.ok(renderToStaticMarkup(row).includes(expected as string));
 }
});
