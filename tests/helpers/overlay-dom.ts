export function overlayDocument() {
  const listeners = new Map<string, Set<(event: any) => void>>();
  class Element {
    ownerDocument: any; parentElement: Element | null = null; children: Element[] = [];
    style = { overflow: '', display: '', visibility: '' }; attrs = new Map<string, string>();
    inert = false; hidden = false; disabled = false; visible = true; tagName: string; open = false; focused = 0;
    constructor(tag = 'DIV') { this.tagName = tag; this.ownerDocument = doc; }
    get isConnected(): boolean { return this === doc.body || Boolean(this.parentElement?.isConnected); }
    get tabIndex() { return Number(this.attrs.get('tabindex') ?? (['BUTTON','INPUT','A','SELECT','TEXTAREA'].includes(this.tagName) ? '0' : '-1')); }
    set tabIndex(v: number) { this.attrs.set('tabindex', String(v)); }
    getAttribute(k: string) { return this.attrs.get(k) ?? null; }
    hasAttribute(k: string) { return this.attrs.has(k); }
    setAttribute(k: string, v: string) { this.attrs.set(k, v); }
    removeAttribute(k: string) { this.attrs.delete(k); }
    append(...nodes: Element[]) { for (const n of nodes) { if (n.parentElement) n.remove(); n.parentElement = this; this.children.push(n); } }
    remove() { if(this.parentElement) this.parentElement.children=this.parentElement.children.filter(n=>n!==this); this.parentElement=null; }
    closest<T>(selector: string): T | null { for(let n:Element|null=this;n;n=n.parentElement)if((n.tagName==='DIALOG'&&n.open)||(n.getAttribute('role')==='dialog'&&n.getAttribute('aria-modal')==='true'))return n as T;return null; }
    contains(n: any): boolean { return n === this || this.children.some(c => c.contains(n)); }
    matches(selector: string) { if(selector===':disabled')return this.disabled; if(selector==='script,style,link')return ['SCRIPT','STYLE','LINK'].includes(this.tagName); return false; }
    querySelectorAll<T>(_selector: string): T[] { return this.children.flatMap(n => [n,...n.querySelectorAll<Element>(_selector)]) as T[]; }
    getBoundingClientRect() { return {top:0,left:0,bottom:10,right:10}; }
    getClientRects() { return this.visible && !this.hidden ? [{}] : []; }
    focus() { this.focused++; doc.activeElement = this; for (const listener of listeners.get('focusin')??[]) listener({target:this}); }
    showModal() { this.open=true; }
    close() { this.open=false; }
  }
  const doc: any = { activeElement: null, defaultView: { innerWidth:390, innerHeight:844, HTMLElement: Element, getComputedStyle: (e: Element) => e.style }, addEventListener(name: string, fn: any) { if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(fn); }, removeEventListener(name: string, fn: any) { listeners.get(name)?.delete(fn); } };
  doc.body=new Element('BODY'); doc.documentElement=new Element('HTML');doc.body.style.overflow='auto';doc.documentElement.style.overflow='clip';
  const el=(tag='DIV')=>new Element(tag);
  const opener=el('BUTTON');doc.body.append(opener);doc.activeElement=opener;
  const panel=()=>{const root=el();const first=el('BUTTON'),last=el('BUTTON');root.append(first,last);doc.body.append(root);return{root,first,last}};
  const key=(key='Tab',shiftKey=false,defaultPrevented=false)=>{const event={key,shiftKey,defaultPrevented,preventDefault(){this.defaultPrevented=true},stopPropagation(){}};for(const fn of [...listeners.get('keydown')??[]])fn(event);return event.defaultPrevented};
  return{doc,el,opener,panel,key,listeners};
}
