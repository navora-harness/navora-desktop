import { compactPageSnapshot, searchPageIndex } from '../../shared/page-index'

/** Runs only in the configured isolated world; never adds attributes to the page. */
const INDEX_RUNTIME = String.raw`
  const key = '__navoraPageIndexV1';
  let state = globalThis[key];
  if (!state || state.document !== document) {
    state = { document, id: Math.random().toString(36).slice(2), sequence: 0,
      records: new WeakMap(), nodes: new Map(), dirty: true, revision: 0, snapshot: null };
    state.observer = new MutationObserver(() => { state.dirty = true; });
    globalThis[key] = state;
  }
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const roleOf = el => el.getAttribute('role') || ({a:'link',button:'button',input:
    ({checkbox:'checkbox',radio:'radio',submit:'button',button:'button',range:'slider'})[el.type] || 'textbox',
    textarea:'textbox',select:'combobox',summary:'button',iframe:'frame',h1:'heading',h2:'heading',h3:'heading',h4:'heading',h5:'heading',h6:'heading'})[el.localName] ||
    (el.isContentEditable ? 'textbox' : 'text');
  const nameOf = el => {
    const root = el.getRootNode();
    const labels = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
      .map(id => root.getElementById?.(id)?.textContent || '').join(' ');
    return clean(labels || el.getAttribute('aria-label') ||
      (el.labels ? Array.from(el.labels).map(label => label.textContent || '').join(' ') : '') ||
      el.getAttribute('placeholder') || el.getAttribute('alt') || el.getAttribute('title') ||
      (el.localName === 'input' ? (['submit','button'].includes(el.type) ? el.value : '') : el.innerText || el.textContent)).slice(0, 180);
  };
  const urlOf = el => {
    try { const raw = el.getAttribute('href') || (el.localName === 'iframe' ? el.getAttribute('src') : '');
      if (!raw) return undefined;
      const url = new URL(raw, document.baseURI); return /^https?:$/.test(url.protocol) ? url.href : undefined;
    } catch { return undefined; }
  };
  const signature = el => JSON.stringify([el.localName, roleOf(el), nameOf(el), urlOf(el), el.type || '', !!el.disabled]);
  const selectors = new WeakMap(), siblingPositions = new WeakMap();
  const selectorOf = el => {
    if (selectors.has(el)) return selectors.get(el);
    const root = el.getRootNode(), parent = el.parentNode;
    let segment;
    if (el.id && root.querySelectorAll('#' + CSS.escape(el.id)).length === 1) segment = '#' + CSS.escape(el.id);
    else {
      if (parent && !siblingPositions.has(parent)) {
        const counts = new Map(), positions = new WeakMap();
        for (const child of parent.children || []) {
          const n = (counts.get(child.localName) || 0) + 1;
          counts.set(child.localName,n); positions.set(child,n);
        }
        siblingPositions.set(parent,positions);
      }
      segment = CSS.escape(el.localName) + ':nth-of-type(' + (siblingPositions.get(parent)?.get(el) || 1) + ')';
      if (el.parentElement) segment = selectorOf(el.parentElement) + ' > ' + segment;
    }
    if (!el.parentElement && root.host || segment.startsWith('#') && root.host) segment = selectorOf(root.host) + ' >>> ' + segment;
    selectors.set(el,segment); return segment;
  };
`

/** Capture once, reuse until observed mutations, navigation, or a one-second freshness bound. */
export function pageIndexCaptureScript(refresh = false): string {
  return `(() => { ${INDEX_RUNTIME}
    if (!${refresh} && state.snapshot && !state.dirty && Date.now() - state.snapshot.capturedAt < 1000) {
      return { ...state.snapshot, reused: true };
    }
    const start = performance.now();
    state.observer.disconnect();
    state.observer.observe(document, {subtree:true,childList:true,characterData:true,attributes:true,
      attributeFilter:['class','style','hidden','aria-hidden','aria-label','aria-labelledby','aria-disabled','disabled','checked','href','src','type','placeholder','title']});
    const entries = [], stack = document.body ? [document.body] : [];
    const candidates = 'a[href],button,input:not([type="hidden"]),textarea,select,summary,[role],[contenteditable="true"],h1,h2,h3,h4,h5,h6,p,li,td,th,iframe';
    let scanned = 0;
    state.nodes = new Map();
    while (stack.length && scanned < 12000 && entries.length < 2500) {
      const el = stack.pop(); scanned++;
      if (['script','style','noscript','template'].includes(el.localName) || el.hidden || el.getAttribute('aria-hidden') === 'true') continue;
      if (el.checkVisibility && !el.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}) && getComputedStyle(el).display !== 'contents') continue;
      if (el.shadowRoot) {
        state.observer.observe(el.shadowRoot, {subtree:true,childList:true,characterData:true,attributes:true});
        stack.push(...Array.from(el.shadowRoot.children).reverse());
      }
      stack.push(...Array.from(el.children).reverse());
      if (!el.matches(candidates)) continue;
      const role = roleOf(el), name = nameOf(el);
      if (!name && role === 'text') continue;
      if (el.localName === 'input' && el.type === 'hidden') continue;
      const sig = signature(el);
      let record = state.records.get(el);
      if (!record || record.signature !== sig) {
        record = { ref: 'd' + state.id + 'e' + (++state.sequence), signature: sig };
        state.records.set(el, record);
      }
      state.nodes.set(record.ref, {el, signature:sig});
      entries.push({ref:record.ref,role,name,tag:el.localName,selector:selectorOf(el),url:urlOf(el),
        disabled:el.disabled || el.getAttribute('aria-disabled') === 'true' || undefined,
        checked:typeof el.checked === 'boolean' && ['checkbox','radio'].includes(el.type) ? el.checked : undefined});
    }
    state.dirty = false;
    const scope = document.querySelector('main,[role="main"],article') || document.body;
    const text = scope ? scope.innerText || '' : '';
    state.snapshot = {documentId:state.id,url:location.href,title:document.title,text:text.slice(0,24000),entries,
      capturedAt:Date.now(),revision:++state.revision,reused:false,scanned,truncated:stack.length > 0 || text.length > 24000,
      captureMs:Math.round((performance.now()-start)*100)/100,
      coverage:{mainFrame:true,openShadow:true,closedShadow:false,frameContents:false}};
    return state.snapshot;
  })()`
}

/** Rank and budget in the renderer so cached searches do not transfer the full index. */
export function pageIndexReadScript(options?: { refresh?: boolean; query?: string; limit?: number; maxChars?: number }): string {
  // Both pure functions are deliberately self-contained. Reuse their compiled definitions
  // so Node tests and the isolated renderer execute the same ranking and crop policy.
  return `(() => {
    ${searchPageIndex.toString()}
    ${compactPageSnapshot.toString()}
    const snapshot = ${pageIndexCaptureScript(options?.refresh === true)};
    return ${compactPageSnapshot.name}(snapshot, ${JSON.stringify(options || {})});
  })()`
}

/** Resolve the original node and recompute its selector after DOM reordering. */
export function pageIndexResolveScript(ref: string): string {
  return `(() => { ${INDEX_RUNTIME}
    const record = state.nodes.get(${JSON.stringify(ref)});
    if (!record || !record.el.isConnected || record.signature !== signature(record.el)) return null;
    return {selector:selectorOf(record.el),role:roleOf(record.el),disabled:!!record.el.disabled};
  })()`
}

export function pageIndexFocusScript(ref: string, append: boolean): string {
  return `(() => { ${INDEX_RUNTIME}
    const record = state.nodes.get(${JSON.stringify(ref)});
    if (!record || !record.el.isConnected || record.signature !== signature(record.el)) return false;
    const el = record.el;
    if (el.disabled || el.readOnly || !['textbox','combobox'].includes(roleOf(el))) return false;
    el.focus();
    if (!${append}) {
      if ('value' in el) el.value = '';
      else if (el.isContentEditable) el.textContent = '';
      el.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
    }
    return true;
  })()`
}
