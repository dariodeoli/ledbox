import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import ts from 'typescript';
import * as React from 'react';
import {mountOverlay} from '../lib/overlay-lifecycle';
import {overlayDocument} from './helpers/overlay-dom';
test('filters modal lifecycle mounts in portal child only after host resolves, with Escape/Tab/lock and opener return',()=>{
 const source=ts.createSourceFile('filters.tsx',readFileSync('components/catalog-public/StoreFilters.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const declaration=(name:string)=>source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)!.getText(source).replace(/^export /,'');
 const evaluate=(name:string,globals:any)=>runInNewContext(ts.transpileModule(declaration(name)+';'+name+';',{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText,{React,...globals});
 const f=overlayDocument(),p=f.panel();let registrations=0,closed=0,release=()=>{};
 const Content=Symbol('content'),Portal=Symbol('portal');
 const outer=evaluate('FiltersDrawer',{FiltersDrawerContent:Content,ThemePortal:Portal});
 const input={props:{filters:{},resultCount:3},onClose:()=>closed++,onClear(){}};
 const tree=outer(input);assert.equal(tree.type,Portal);assert.equal(tree.props.children.type,Content);assert.equal(registrations,0,'portal host pending does not run modal hook with null ref');
 let refs=0;
 const content=evaluate('FiltersDrawerContent',{useRef:()=>({current:refs++===0?p.root:p.first}),useModalBehavior:(ref:any,onClose:any)=>{registrations++;release=mountOverlay(ref.current,{onClose})},activeFilterCount:()=>0,FiltersPanel:'filters',XIcon:'icon'});
 // ThemePortal resolves host and mounts the component together with its DOM.
 content(tree.props.children.props);assert.equal(registrations,1);assert.equal(f.doc.body.style.overflow,'hidden');p.last.focus();f.key();assert.equal(f.doc.activeElement,p.first);f.key('Escape');assert.equal(closed,1);release();assert.equal(f.doc.body.style.overflow,'auto');assert.equal(f.doc.activeElement,f.opener);
});
