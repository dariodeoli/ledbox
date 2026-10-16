import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as ui from 'owncoding-ui';
import { PAYMENT_PROOF_MAX_BYTES, PAYMENT_PROOF_MIMES, paymentProofExtension } from '../lib/admin-types';
import { prepareProofFile } from '../app/(portal)/_components/portal-proof-image';
const parse=(path:string)=>ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function nodes(root:ts.Node,predicate:(n:ts.Node)=>boolean){const found:ts.Node[]=[];function visit(n:ts.Node){if(predicate(n))found.push(n);ts.forEachChild(n,visit);}visit(root);return found;}
function evaluate(text:string,globals:Record<string,any>){return runInNewContext(ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText,{React,File,FormData,...globals});}
function fn(file:ts.SourceFile,name:string){return nodes(file,n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)[0].getText(file).replace(/^export /,'');}
const all=(n:any):any[]=>Array.isArray(n)?n.flatMap(all):n?.props?[n,...all(n.props.children)]:[];
function fileHarness(){
 const selected:(File|null)[]=[];const states:any[]=[],refs:any[]=[],effects:(()=>void)[]=[];let si=0,ri=0;
 const render=evaluate(fn(parse('components/admin/AdminFields.tsx'),'FileField')+'\nFileField;',{useState:(initial:any)=>{const i=si++;if(!(i in states))states[i]=initial;return[states[i],(next:any)=>{states[i]=next;}];},useRef:(initial:any)=>{const i=ri++;return refs[i]??(refs[i]={current:initial});},useEffect:(effect:()=>void)=>effects.push(effect),useFieldIds:()=>({fieldId:'proof',hintId:'hint',errorId:'error'}),describedBy:(error:any,hint:any)=>error?'error':hint?'hint':undefined,FieldChrome:'field',AdminIcon:()=>null});
 const external={current:null as any};let file:File|null=null;
 const draw=(extra:Record<string,any>={})=>{si=ri=0;effects.length=0;const tree=render({label:'Comprobante',file,maxBytes:null,onSelect:(next:File|null)=>{selected.push(next);file=next;},name:'proof-file',required:true,inputRef:external,ariaDescribedBy:'privacy',...extra});const input=all(tree).find(n=>n.type==='input');return{tree,input,effects:[...effects]};};
 return{draw,selected,external,setFile:(next:File|null)=>{file=next;}};
}

test('FileField keeps native selection/name/required/ref, opening-cancel does not clear it, remove allows same file again',()=>{
 const h=fileHarness();const file=new File(['%PDF-1.4\n'],'proof.pdf',{type:'application/pdf'});
 const native={value:'',files:[] as File[],clicks:0,click(){this.clicks++;}};
 let view=h.draw();view.input.props.ref(native);for(const effect of view.effects)effect();assert.equal(h.external.current,native);
 assert.equal(view.input.props.name,'proof-file');assert.equal(view.input.props.required,true);assert.equal(view.input.props['aria-describedby'],'privacy');
 native.value='C:\\fakepath\\proof.pdf';native.files=[file];view.input.props.onChange({target:native});assert.equal(native.value,'C:\\fakepath\\proof.pdf');assert.equal(h.selected.at(-1),file);
 view=h.draw();view.input.props.ref(native);all(view.tree).find(n=>n.type==='button'&&n.props['aria-label']==='Elegir archivo: Comprobante').props.onClick();
 // Closing the native chooser without a change event leaves the existing choice untouched.
 assert.equal(native.clicks,1);assert.equal(native.value,'C:\\fakepath\\proof.pdf');assert.equal(h.selected.length,1);
 const form=new FormData();form.append(view.input.props.name,native.files[0]);assert.equal((form.get('proof-file') as File).name,'proof.pdf');
 all(view.tree).find(n=>n.type==='button'&&n.props['aria-label']==='Quitar proof.pdf').props.onClick();assert.equal(native.value,'');assert.equal(h.selected.at(-1),null);
 view=h.draw();view.input.props.ref(native);native.value='C:\\fakepath\\proof.pdf';view.input.props.onChange({target:native});assert.equal(h.selected.at(-1),file);assert.equal(h.selected.length,3);
 h.setFile(null);view=h.draw();view.input.props.ref(native);for(const effect of view.effects)effect();assert.equal(native.value,'');
 view.input.props.ref(null);assert.equal(h.external.current,null);
});

test('FileField legacy reset/size guards remain; named disabled control stays disabled and zero-size cannot replace a valid choice',()=>{
 const h=fileHarness(), native={value:'chosen',files:[new File(['ab'],'a.json')],click(){}};
 let view=h.draw({name:undefined,required:undefined,maxBytes:3});view.input.props.ref(native);view.input.props.onChange({target:native});assert.equal(native.value,'');assert.equal(h.selected.length,1);
 native.value='too-big';native.files=[new File(['four'],'b.json')];view.input.props.onChange({target:native});assert.equal(native.value,'');assert.equal(h.selected.length,1);
 native.value='zero';native.files=[new File([],'zero.pdf')];view.input.props.onChange({target:native});assert.equal(native.value,'');assert.equal(h.selected.length,1);
 view=h.draw({disabled:true});assert.equal(view.input.props.disabled,true);assert.ok(all(view.tree).filter(n=>n.type==='button').every(n=>n.props.disabled));
});

test('portal upload still validates actual MIME/output cap and sends real FormData; success clears state and native ref',async()=>{
 const portal=parse('app/(portal)/_components/PortalBudgetView.tsx');
 async function attempt(file:File){const sent:any[]=[],errors:string[]=[],selected:any[]=[];const input={value:'chosen'};let refreshed=0;
 const submit=evaluate(fn(portal,'submitProof')+'\nsubmitProof;',{proofName:'Ana Pérez',proofFile:file,proofExpectedId:'expected-fixture',token:'private/token',demo:false,proofInputRef:{current:input},setProofError:(s:string)=>errors.push(s),setProofBusy(){},setProofSent(){},setProofFile:(f:File|null)=>selected.push(f),paymentProofExtension,require:(id:string)=>{assert.equal(id,'./portal-proof-image');return{prepareProofFile};},fetch:async(url:string,options:any)=>{sent.push({url,body:options.body});return{ok:true,json:async()=>({})};},router:{refresh(){refreshed++;}}});
 await submit({preventDefault(){}});return{sent,errors,input,selected,refreshed};}
 const valid=await attempt(new File(['%PDF-1.4\nfixture'],'receipt.pdf',{type:'application/pdf'}));assert.equal(valid.sent.length,1);assert.equal(valid.sent[0].url,'/api/portal/budget/private%2Ftoken/proof');
 const form=valid.sent[0].body as FormData;assert.ok(form instanceof FormData);assert.equal(form.get('name'),'Ana Pérez');assert.equal(form.get('expectedPaymentId'),'expected-fixture');assert.equal((form.get('file') as File).type,'application/pdf');assert.equal((form.get('file') as File).name,'comprobante.pdf');assert.equal(valid.input.value,'');assert.deepEqual(valid.selected,[null]);assert.equal(valid.refreshed,1);
 const fake=await attempt(new File(['not pdf'],'renamed.pdf',{type:'application/pdf'}));assert.equal(fake.sent.length,0);assert.ok(fake.errors.some(s=>s.includes('renombrado')));
 const large=await attempt(new File(['%PDF-1.4\n',new Uint8Array(PAYMENT_PROOF_MAX_BYTES)],'large.pdf',{type:'application/pdf'}));assert.equal(large.sent.length,0);assert.ok(large.errors.some(s=>s.includes('2 MB')));
 const fileNode=nodes(portal,n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText(portal)==='FileField')[0];
 const spec=evaluate(fileNode.getText(portal)+';',{FileField:'file',proofInputRef:{current:null},proofFile:null,PAYMENT_PROOF_MIMES,setProofFile(){},setProofError(){},setProofSent(){}});
 assert.equal(spec.props.required,true);assert.equal(spec.props.name,'proof-file');assert.equal(spec.props.preserveNativeSelection,true);assert.equal(spec.props.maxBytes,null,'raw photos may compress below final cap');assert.ok(spec.props.accept.includes('application/pdf'));
});

test('shared consents keep a native unchecked checkbox, associated rich label/description and required/disabled contracts',()=>{
 const cases=[['app/(portal)/_components/PortalBudgetView.tsx',{itemsChanged:false,pendingRequests:[],actionTotal:123,clientLabel:'Empresa fixture',formatMoney:String},true,'portal-consent-hint portal-consent-purpose'],['app/(portal)/_components/PortalComparisonView.tsx',{busy:true},true,undefined],['app/(portal)/_components/SignaturePortalView.tsx',{},undefined,'firma-consent-purpose'],['components/catalog-public/CartDrawer.tsx',{},undefined,undefined]] as const;
 for(const[path,extra,required,description]of cases){const src=parse(path);const node=nodes(src,n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText(src)==='SharedCheckbox')[0];let checked=false;
 const checkbox=evaluate(node.getText(src)+';',{SharedCheckbox:ui.Checkbox,consent:false,askPrice:false,setConsent:(next:boolean)=>{checked=next;},setAskPrice:(next:boolean)=>{checked=next;},...extra});
 assert.equal(checkbox.props.checked,false,path);assert.equal(checkbox.props.required,required,path);assert.equal(checkbox.props['aria-describedby'],description,path);
 const html=renderToStaticMarkup(checkbox);assert.equal((html.match(/type="checkbox"/g)??[]).length,1,path);assert.doesNotMatch(html,/checked=""/,path);assert.match(html,/<label\b[^>]*for="[^"]+"/,path);assert.doesNotMatch(html,/onkeydown=/i,path);
 checkbox.props.onChange({target:{checked:true}});assert.equal(checked,true,path);checkbox.props.onChange({target:{checked:false}});assert.equal(checked,false,path);
 if(path.includes('Comparison'))assert.match(html,/disabled=""/);
 if(path.includes('CartDrawer'))assert.equal(checkbox.props['aria-controls'],'mejor-precio');
 }
});

test('canonical RadioControl retains native exclusive-choice attributes and rich labels, forcing radio type',()=>{
 const fields=parse('components/admin/AdminFields.tsx');const RadioControl=evaluate(fn(fields,'RadioControl')+'\nRadioControl;',{});
 let changed='';
 const element=RadioControl({type:'text',name:'alternative',value:'b',checked:false,required:true,disabled:true,'aria-describedby':'details-b',onChange:(event:any)=>{changed=event.target.value;}});
 assert.equal(element.type,'input');assert.equal(element.props.type,'radio');assert.equal(element.props.name,'alternative');assert.equal(element.props.required,true);assert.equal(element.props.disabled,true);assert.equal(element.props['aria-describedby'],'details-b');assert.equal(element.props.onKeyDown,undefined);
 element.props.onChange({target:{value:'b'}});assert.equal(changed,'b');
 const html=renderToStaticMarkup(React.createElement('fieldset',null,React.createElement('legend',null,'Elegí una alternativa'),React.createElement('label',null,RadioControl({name:'alternative',value:'a',checked:true,onChange(){}}),' Opción A'),React.createElement('label',null,RadioControl({name:'alternative',value:'b',checked:false,onChange(){}}),' Opción B')));
 assert.equal((html.match(/type="radio"/g)??[]).length,2);assert.equal((html.match(/name="alternative"/g)??[]).length,2);assert.equal((html.match(/checked=""/g)??[]).length,1);assert.equal((html.match(/<label>/g)??[]).length,2);
 const portal=parse('app/(portal)/_components/PortalBudgetView.tsx');const render=evaluate(fn(portal,'PortalDecisionOptions')+'\nPortalDecisionOptions;',{RadioControl,AdminIcon:()=>null});
 const choices=render({value:'authorize',options:[{value:'authorize',label:'Autorizar',title:'Autorizar',helper:'Revisé todo'},{value:'discount',label:'Pedir rebaja',title:'Rebaja',helper:'Necesito mejor precio'}],onChange:(next:string)=>{changed=next;}});
 const controls=all(choices).filter(n=>n.type===RadioControl);assert.equal(controls.length,2);assert.equal(controls[0].props.checked,true);assert.equal(controls[1].props.checked,false);assert.equal(controls[1].props['aria-describedby'],'portal-decision-discount-help');controls[1].props.onChange();assert.equal(changed,'discount');
});
