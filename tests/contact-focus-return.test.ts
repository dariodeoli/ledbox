import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import {mountOverlay} from '../lib/overlay-lifecycle';
import {overlayDocument} from './helpers/overlay-dom';
test('contact handoff restores stable store trigger when cart opener was unmounted, without reopening cart',async()=>{
 const source=ts.createSourceFile('contact.tsx',readFileSync('components/catalog-public/ContactPanel.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ContactPanel')!;
 let options:any;
 const draw=runInNewContext(ts.transpileModule(fn.getText(source).replace(/^export /,'')+';ContactPanel;',{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,{React,useState:(v:any)=>[v,()=>{}],useRef:()=>({current:null}),useModalBehavior:(_ref:any,_close:any,opts:any)=>options=opts,TextField:'text',EmailField:'email',PhoneField:'phone',XIcon:'icon'});
 const tree=draw({slug:'fixture',storeName:'Fixture',getCart(){},onClose(){},onSaved(){}});
 const f=overlayDocument(),cart=f.panel();const oldOpener=cart.last;oldOpener.focus();const contact=f.panel();
 const stable=f.el('BUTTON'),hidden=f.el('BUTTON'),offscreen=f.el('BUTTON');offscreen.getBoundingClientRect=()=>({top:-408,bottom:-380,left:0,right:20});hidden.visible=false;f.doc.body.append(stable,hidden,offscreen);
 const scope={querySelectorAll:()=>[offscreen,hidden,stable]};
 const all=(n:any):any[]=>Array.isArray(n)?n.flatMap(all):n?.props?[n,...all(n.props.children)]:[];
 all(tree).find(n=>n.props['data-testid']==='save-cart-dialog').props.ref({closest:()=>scope});
 const release=mountOverlay(contact.root as any,{opener:oldOpener as any,fallbackFocus:options.fallbackFocus});cart.root.remove();release();await Promise.resolve();
 assert.equal(f.doc.activeElement,stable);assert.equal(f.doc.body.style.overflow,'auto');assert.equal(cart.root.isConnected,false);
 const other=f.el('BUTTON');f.doc.body.append(other);other.focus();const normal=mountOverlay(contact.root as any,{fallbackFocus:options.fallbackFocus});normal();assert.equal(f.doc.activeElement,other,'live original opener retains priority');
 assert.match(readFileSync('components/overlays/useModalBehavior.ts','utf8'),/fallbackFocus: options.fallbackFocus/);
 for(const path of ['StoreHeaderControls','OrderBar'])assert.match(readFileSync(`components/catalog-public/${path}.tsx`,'utf8'),/data-store-cart-trigger/);
});

test('BODY opener resolves fallback after DOM commit; a new scope or deliberate user focus cancels stale return',async()=>{
 const f=overlayDocument(),p=f.panel(),stable=f.el('BUTTON');f.doc.body.append(stable);
 let afterCommit=false;
 const release=mountOverlay(p.root as any,{opener:f.doc.body,fallbackFocus:()=>afterCommit?stable as any:null});release();p.root.remove();afterCommit=true;f.doc.body.focus();await Promise.resolve();assert.equal(f.doc.activeElement,stable);
 const a=f.panel();const old=mountOverlay(a.root as any,{opener:f.doc.body,fallbackFocus:()=>stable as any});old();a.root.remove();const b=f.panel(),next=mountOverlay(b.root as any);await Promise.resolve();assert.equal(f.doc.activeElement,b.first);next();
 const c=f.panel(),other=f.el('BUTTON');f.doc.body.append(other);const last=mountOverlay(c.root as any,{opener:f.doc.body,fallbackFocus:()=>stable as any});last();c.root.remove();other.focus();await Promise.resolve();assert.equal(f.doc.activeElement,other);
});
