<template>
  <section class="plugin-document" aria-label="插件说明文档">
    <header class="document-heading"><h3>{{ label }}</h3><span v-if="sections.length">{{ sections.length }} 个章节</span></header>
    <div class="document-layout" :class="{'has-outline':sections.length>=3}">
      <nav v-if="sections.length>=3" class="document-outline" :class="{'is-expanded':outlineExpanded}" aria-label="说明目录">
        <span class="outline-label">本页内容</span>
        <button type="button" class="outline-toggle" :aria-expanded="outlineExpanded" :aria-controls="`${documentId}-outline`" @click="outlineExpanded=!outlineExpanded"><font-awesome-icon icon="list-ul" /><span>本页内容</span><font-awesome-icon icon="chevron-down" /></button>
        <ol :id="`${documentId}-outline`" class="document-outline-list"><li v-for="section in sections" :key="section.id" :class="{'is-nested':section.level===3}"><button type="button" :class="{active:activeSection===section.id}" :aria-current="activeSection===section.id?'location':undefined" :title="section.title" @click="jump(section.id)">{{ section.title }}</button></li></ol>
      </nav>
      <div ref="body" class="md-body document-prose" v-html="html" @click="onDocumentClick" />
    </div>
    <span class="document-announcement" role="status" aria-live="polite">{{ announcement }}</span>
  </section>
</template>

<script setup lang="ts">
import {onBeforeUnmount,onMounted,ref,useId,watch} from 'vue'

// The host renders and sanitizes Markdown before passing its HTML here.
const props=withDefaults(defineProps<{html:string;label?:string}>(),{label:'插件说明'})
const documentId=`plugin-document-${useId().replace(/[^\w-]/g,'')}`
const body=ref<HTMLElement|null>(null),sections=ref<Array<{id:string;title:string;level:number}>>([])
const activeSection=ref(''),outlineExpanded=ref(false),announcement=ref('')
const anchors=new Map<string,HTMLElement>(),copyTimers=new Set<ReturnType<typeof setTimeout>>()
let observer:IntersectionObserver|undefined,generation=0
const slug=(value:string)=>value.normalize('NFKC').trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}\p{M}_\s-]/gu,'').replace(/\s+/g,'-')
const callouts:Record<string,string>={NOTE:'说明',TIP:'提示',IMPORTANT:'重要',WARNING:'注意',CAUTION:'警告'}
function scrollParent(element:HTMLElement){let parent=element.parentElement;while(parent&&!/(auto|scroll)/.test(getComputedStyle(parent).overflowY))parent=parent.parentElement;return parent}

function prepareDocument(){
  const root=body.value
  if(!root)return
  ++generation;observer?.disconnect();anchors.clear();for(const timer of copyTimers)clearTimeout(timer);copyTimers.clear()
  announcement.value='';outlineExpanded.value=false
  const occurrences=new Map<string,number>()
  const headings=[...root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')]
  for(const [index,heading] of headings.entries()){
    const originalId=heading.id,title=heading.textContent?.trim()||`章节 ${index+1}`,base=slug(title)||`section-${index+1}`
    const count=occurrences.get(base)||0;occurrences.set(base,count+1)
    const anchor=count?`${base}-${count}`:base
    heading.id=`${documentId}-${anchor}`
    if(originalId)anchors.set(originalId,heading)
    anchors.set(anchor,heading);anchors.set(heading.id,heading)
  }
  sections.value=headings.filter(heading=>heading.tagName==='H2'||heading.tagName==='H3').slice(0,40).map(heading=>({id:heading.id,title:heading.textContent?.trim()||'未命名章节',level:Number(heading.tagName[1])}))
  activeSection.value=sections.value[0]?.id||''
  for(const pre of root.querySelectorAll<HTMLPreElement>('pre')){
    const code=pre.querySelector('code')
    if(!code||pre.closest('.document-code'))continue
    const frame=document.createElement('div'),bar=document.createElement('div'),language=document.createElement('span'),copy=document.createElement('button')
    frame.className='document-code';bar.className='document-code-bar'
    const languageId=[...code.classList].find(name=>name.startsWith('language-'))?.slice(9)||''
    language.textContent=({js:'JavaScript',javascript:'JavaScript',ts:'TypeScript',typescript:'TypeScript',json:'JSON',bash:'Bash',sh:'Shell',powershell:'PowerShell',python:'Python',py:'Python',html:'HTML',css:'CSS',yaml:'YAML',yml:'YAML',sql:'SQL',text:'文本'} as Record<string,string>)[languageId.toLowerCase()]||languageId||'代码'
    copy.type='button';copy.className='document-code-copy';copy.textContent='复制';copy.setAttribute('aria-label',`复制 ${language.textContent} 代码`)
    bar.append(language,copy);pre.before(frame);frame.append(bar,pre)
    pre.tabIndex=0;pre.setAttribute('aria-label',`${language.textContent} 代码内容`)
  }
  for(const quote of root.querySelectorAll<HTMLElement>('blockquote')){
    const first=quote.firstElementChild,node=first?.firstChild
    if(node?.nodeType!==Node.TEXT_NODE)continue
    const match=node.textContent?.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*/i)
    if(!match)continue
    const kind=match[1]!.toUpperCase(),title=document.createElement('div')
    node.textContent=node.textContent!.slice(match[0].length).replace(/^\n/,'')
    if(!node.textContent?.trim()&&node.nextSibling?.nodeName==='BR')node.nextSibling.remove()
    if(!first?.textContent?.trim()&&!first?.querySelector('img,code'))first?.remove()
    quote.dataset.callout=kind.toLowerCase();title.className='document-callout-title';title.textContent=callouts[kind]!
    quote.prepend(title)
  }
  const scrollRoot=scrollParent(root)
  const visible=new Set<string>()
  observer=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting)visible.add(entry.target.id);else visible.delete(entry.target.id)}const first=sections.value.find(section=>visible.has(section.id));if(first)activeSection.value=first.id},{root:scrollRoot,rootMargin:'0px 0px -60% 0px'})
  for(const section of sections.value){const heading=anchors.get(section.id);if(heading)observer.observe(heading)}
}
function jump(id:string){const heading=anchors.get(id);if(!heading)return;activeSection.value=heading.id;const root=scrollParent(heading);if(root)root.scrollTo({top:Math.max(0,root.scrollTop+heading.getBoundingClientRect().top-root.getBoundingClientRect().top-24),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});heading.tabIndex=-1;heading.focus({preventScroll:true})}
async function onDocumentClick(event:MouseEvent){
  const target=event.target instanceof Element?event.target:null
  const copy=target?.closest<HTMLButtonElement>('.document-code-copy')
  if(copy){
    const code=copy.closest('.document-code')?.querySelector('pre code'),current=generation
    if(!code)return
    try{await navigator.clipboard.writeText(code.textContent||'');if(current!==generation)return;copy.textContent='已复制';announcement.value='代码已复制'}catch{if(current!==generation)return;copy.textContent='复制失败';announcement.value='复制失败，请选择代码后手动复制'}
    const timer=setTimeout(()=>{copy.textContent='复制';copyTimers.delete(timer)},1800);copyTimers.add(timer);return
  }
  const link=target?.closest<HTMLAnchorElement>('a[href]'),href=link?.getAttribute('href')
  if(!href?.startsWith('#'))return
  event.preventDefault()
  let anchor=href.slice(1);try{anchor=decodeURIComponent(anchor)}catch{/* Keep malformed fragments inert. */}
  const heading=anchors.get(anchor)||anchors.get(slug(anchor))
  if(heading)jump(heading.id)
}
watch(()=>props.html,prepareDocument,{flush:'post'})
onMounted(prepareDocument)
onBeforeUnmount(()=>{++generation;observer?.disconnect();for(const timer of copyTimers)clearTimeout(timer)})
</script>

<style scoped>
.plugin-document{container:plugin-document / inline-size;min-width:0;color:#374357;--doc-stroke:#dce3ed;--doc-accent:#416b9a;--doc-mono:'Cascadia Code','SFMono-Regular',Consolas,'Liberation Mono',monospace}
.document-heading{display:flex;align-items:center;gap:12px;margin-bottom:24px;padding-bottom:14px;border-bottom:1px solid var(--doc-stroke)}
.document-heading h3{margin:0;color:#52647d;font-size:12px;font-weight:600;letter-spacing:.02em}.document-heading>span{margin-left:auto;color:#8a95a5;font-size:10px;font-variant-numeric:tabular-nums}
.document-layout{min-width:0}.document-prose{min-width:0;max-width:76ch;margin:0;font-size:14px;line-height:1.95;letter-spacing:.005em;overflow-wrap:anywhere;word-break:normal;user-select:text;-webkit-user-select:text}
.document-prose :deep(*){box-sizing:border-box}.document-prose :deep(> :first-child){margin-top:0}.document-prose :deep(> :last-child){margin-bottom:0}
.document-prose :deep(h1),.document-prose :deep(h2),.document-prose :deep(h3),.document-prose :deep(h4),.document-prose :deep(h5),.document-prose :deep(h6){font-weight:650;line-height:1.5;color:#243248;letter-spacing:-.015em;scroll-margin-block-start:24px;text-wrap:pretty}
.document-prose :deep(h1){font-size:27px;line-height:1.4;margin:0 0 22px;letter-spacing:-.025em}.document-prose :deep(h2){font-size:20px;margin:38px 0 16px;padding-bottom:10px;border-bottom:1px solid #e7ebf1}.document-prose :deep(h3){font-size:16px;margin:28px 0 12px}.document-prose :deep(h4){font-size:14px;margin:22px 0 10px}.document-prose :deep(h5),.document-prose :deep(h6){font-size:13px;margin:20px 0 10px}
.document-prose :deep(p){margin:0 0 17px}.document-prose :deep(strong){font-weight:650;color:#2e3d52}.document-prose :deep(em){color:#53647a}.document-prose :deep(del){color:#8993a1}
.document-prose :deep(ul),.document-prose :deep(ol){margin:14px 0 20px;padding-inline-start:1.65em;list-style-position:outside}.document-prose :deep(ul){list-style-type:disc}.document-prose :deep(ol){list-style-type:decimal}.document-prose :deep(ul ul){list-style-type:circle}.document-prose :deep(ul ul ul){list-style-type:square}.document-prose :deep(li){padding-inline-start:.25em;margin:7px 0}.document-prose :deep(li::marker){color:#7d8ca1;font-weight:600;font-variant-numeric:tabular-nums}.document-prose :deep(li > p){margin:7px 0}.document-prose :deep(li > ul),.document-prose :deep(li > ol){margin:6px 0 10px}
.document-prose :deep(li:has(> input[type=checkbox])){list-style:none;margin-inline-start:-1.6em;padding-inline-start:0}.document-prose :deep(input[type=checkbox]){width:14px;height:14px;vertical-align:-2px;margin-inline-end:8px;accent-color:#577b9c;opacity:1}
.document-prose :deep(a){color:#376796;text-decoration:underline;text-decoration-color:#9bb5cf;text-decoration-thickness:1px;text-underline-offset:3px;overflow-wrap:anywhere;transition:color 140ms ease,text-decoration-color 140ms ease}.document-prose :deep(a:hover){color:#224b77;text-decoration-color:currentColor}.document-prose :deep(a:focus-visible){outline:2px solid #7192b8;outline-offset:3px;border-radius:2px}
.document-prose :deep(:not(pre) > code){font-family:var(--doc-mono);font-size:.86em;color:#426180;background:#f0f4f8;border:1px solid #dde5ef;border-radius:5px;padding:.15em .4em;box-decoration-break:clone;-webkit-box-decoration-break:clone;white-space:break-spaces;overflow-wrap:anywhere}
.document-prose :deep(.document-code){margin:20px 0 24px;border:1px solid #d6dfeb;border-radius:11px;background:#f7f9fc;overflow:hidden;max-width:100%}.document-prose :deep(.document-code-bar){display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 12px 7px 16px;background:#edf2f7;border-bottom:1px solid #dce4ee;color:#78879a;font-family:inherit;font-size:10px;line-height:1.5;user-select:none;-webkit-user-select:none}
.document-prose :deep(.document-code-copy){min-width:48px;min-height:26px;padding:4px 8px;border:1px solid transparent;border-radius:5px;color:#667b95;font-family:inherit;font-size:10px;font-weight:500;cursor:pointer;transition:background-color 140ms ease,color 140ms ease}.document-prose :deep(.document-code-copy:hover){background:#dfe8f2;color:#335c87}.document-prose :deep(.document-code-copy:focus-visible){outline:2px solid #7192b8;outline-offset:0}
.document-prose :deep(pre){margin:20px 0;padding:17px 19px;border:1px solid #d6dfeb;border-radius:9px;max-width:100%;overflow:auto;background:#f7f9fc;color:#35485f;font-family:var(--doc-mono);font-size:12px;line-height:1.85;tab-size:2;white-space:pre;word-break:normal;overflow-wrap:normal;scrollbar-width:thin;scrollbar-color:#b9c6d7 transparent}.document-prose :deep(.document-code pre){border:0;border-radius:0;margin:0}.document-prose :deep(pre code){font:inherit;color:inherit;white-space:pre;word-break:normal;overflow-wrap:normal;padding:0;border:0;background:transparent;border-radius:0}.document-prose :deep(pre:focus-visible){outline:2px solid #7192b8;outline-offset:-3px}
.document-prose :deep(.md-table-scroll){width:100%;margin:20px 0 26px;border:1px solid #d5deea;border-radius:10px;overflow-x:auto;scrollbar-width:thin;scrollbar-color:#b9c6d7 transparent}.document-prose :deep(.md-table-scroll:focus-visible){outline:2px solid #7192b8;outline-offset:3px}.document-prose :deep(table){display:table;width:100%;min-width:420px;border-collapse:separate;border-spacing:0;margin:0;line-height:1.75;font-size:12px;font-variant-numeric:tabular-nums}.document-prose :deep(th),.document-prose :deep(td){padding:11px 14px;min-width:100px;border:0;border-bottom:1px solid #e0e6ef;text-align:start;vertical-align:top}.document-prose :deep(th){background:#edf2f7;color:#405571;font-size:11px;font-weight:650;white-space:nowrap}.document-prose :deep(tr:last-child td){border-bottom:0}.document-prose :deep(tbody tr:nth-child(even)){background:#f8fafc}.document-prose :deep(tbody tr:hover){background:#f0f5fa}.document-prose :deep(td code){font-size:11px}.document-prose :deep(td p:last-child){margin:0}
.document-prose :deep(blockquote){margin:22px 0;padding:14px 18px;border:1px solid #dce5ef;border-inline-start:3px solid #8ca6c3;border-radius:0 9px 9px 0;background:#f5f8fc;color:#5a6b80}.document-prose :deep(blockquote > :last-child){margin-bottom:0}.document-prose :deep(.document-callout-title){display:flex;align-items:center;gap:8px;color:#47698e;font-size:12px;font-weight:650;margin-bottom:6px}.document-prose :deep(.document-callout-title::before){content:'';width:6px;height:6px;background:currentColor;border-radius:50%;flex-shrink:0}.document-prose :deep(blockquote[data-callout=tip]){border-color:#d4e6dc;border-inline-start-color:#75a58b;background:#f3f9f5}.document-prose :deep([data-callout=tip] > .document-callout-title){color:#4e8064}.document-prose :deep(blockquote[data-callout=important]){border-color:#e1dcf1;border-inline-start-color:#a393c4;background:#f8f6fc}.document-prose :deep([data-callout=important] > .document-callout-title){color:#7a689e}.document-prose :deep(blockquote[data-callout=warning]),.document-prose :deep(blockquote[data-callout=caution]){border-color:#eadfcf;border-inline-start-color:#c5a275;background:#fcf8f1}.document-prose :deep([data-callout=warning] > .document-callout-title),.document-prose :deep([data-callout=caution] > .document-callout-title){color:#9a753e}
.document-prose :deep(hr){height:1px;border:0;background:#dce4ee;margin:30px 0}.document-prose :deep(img){display:inline-block;max-width:100%;height:auto;vertical-align:middle;border-radius:7px}.document-prose :deep(p:has(> img:only-child)){margin:22px 0}.document-prose :deep(kbd){font-family:var(--doc-mono);font-size:11px;line-height:1.6;padding:2px 6px;color:#5d6d83;border:1px solid #ced8e5;border-bottom-width:2px;border-radius:4px;background:#f8fafc}.document-prose :deep(details){margin:18px 0;padding:12px 16px;border:1px solid #d6e0ec;border-radius:8px;background:#fbfcfe}.document-prose :deep(summary){font-size:13px;color:#4d6580;font-weight:600;cursor:pointer}.document-prose :deep(details[open] > summary){margin-bottom:13px}.document-prose :deep(dt){font-weight:600;color:#3d5068;margin-top:12px}.document-prose :deep(dd){margin-inline-start:18px;margin-top:5px}.document-prose :deep(figure){margin:22px 0}.document-prose :deep(figcaption){font-size:11px;line-height:1.7;color:#8491a3;text-align:center;margin-top:8px}
.document-outline{min-width:0;margin-bottom:26px;padding:0 12px;background:#f7f9fc;border:1px solid #dce4ef;border-radius:8px;user-select:none;-webkit-user-select:none}.outline-label{display:none}.outline-toggle{display:flex;align-items:center;gap:8px;width:100%;height:38px;border-radius:6px;color:#667a93;font-size:11px;text-align:start;cursor:pointer}.outline-toggle svg{width:12px}.outline-toggle svg:last-child{margin-inline-start:auto;width:9px;transition:transform 160ms ease}.is-expanded .outline-toggle svg:last-child{transform:rotate(180deg)}.document-outline-list{display:none;list-style:none;margin:0;padding:0 0 10px;max-height:240px;overflow:auto;scrollbar-width:thin}.is-expanded .document-outline-list{display:block}.document-outline-list li{list-style:none;margin:0}.document-outline-list button{display:block;width:100%;padding:6px 8px;border-inline-start:2px solid transparent;border-radius:0 5px 5px 0;text-align:start;color:#8090a5;font-size:11px;line-height:1.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;transition:background-color 140ms ease,color 140ms ease}.document-outline-list button:hover{background:#e9eff7;color:#42668e}.document-outline-list button.active{border-inline-start-color:#7898bd;background:#e9eff7;color:#42668e}.document-outline-list .is-nested button{padding-inline-start:17px;font-size:10px}.document-outline :is(button):focus-visible{outline:2px solid #7192b8;outline-offset:-2px}
.document-announcement{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@container plugin-document (min-width:780px){.document-layout.has-outline{display:grid;grid-template-columns:minmax(0,1fr) 150px;column-gap:32px;align-items:start}.document-layout.has-outline .document-prose{grid-column:1;grid-row:1}.document-layout.has-outline .document-outline{grid-column:2;grid-row:1;position:sticky;top:20px;padding:0 0 0 13px;margin:0;border:0;border-inline-start:1px solid #dce4ee;border-radius:0;background:transparent}.outline-toggle{display:none}.outline-label{display:flex;padding:2px 8px 10px;font-size:10px;font-weight:600;color:#667a93}.document-outline-list{display:block;max-height:min(55vh,480px);padding-bottom:0}.document-outline-list button{font-size:10px}}
@container plugin-document (max-width:480px){.document-prose{font-size:13px;line-height:1.95}.document-prose :deep(h1){font-size:24px}.document-prose :deep(h2){font-size:18px;margin-top:30px}.document-prose :deep(h3){font-size:15px}.document-prose :deep(pre){font-size:11px;padding:14px}.document-prose :deep(th),.document-prose :deep(td){padding:9px 11px}.document-heading{margin-bottom:20px}.document-prose :deep(blockquote){padding:12px 14px}}
@media(prefers-reduced-motion:reduce){.plugin-document *,.document-prose :deep(*){transition:none!important;scroll-behavior:auto!important}}
@media(forced-colors:active){.document-prose :deep(.document-code),.document-prose :deep(.md-table-scroll),.document-prose :deep(blockquote),.document-outline{border-color:CanvasText}.document-outline-list button.active{border-color:Highlight;color:Highlight}.document-prose :deep(a){color:LinkText}}
</style>
