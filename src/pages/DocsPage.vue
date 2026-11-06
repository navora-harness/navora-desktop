<template>
  <section class="docs-page" :class="{'is-mobile':mobile}" aria-label="使用文档" @keydown.alt.left.prevent.stop="emit('close')">
    <header class="docs-header"><div><AppIcon icon="book"/><h1>使用文档</h1><span v-if="version" class="docs-version">v{{version}}</span></div><button v-if="embedded" type="button" class="ui-button" @click="emit('close')"><AppIcon icon="arrow-left"/>返回原内容</button></header>
    <div class="docs-layout">
      <nav class="docs-navigation" aria-label="文档目录"><label class="docs-search"><AppIcon icon="magnifying-glass"/><input v-model="query" type="search" aria-label="搜索使用文档" placeholder="搜索标题与正文"/><button v-if="query" type="button" aria-label="清空文档搜索" @click="query=''">×</button></label><p v-if="query" class="docs-search-count" role="status">{{chapters.length}} 个匹配章节</p><div class="docs-chapters"><button v-for="item in chapters" :key="item.id" type="button" :aria-current="item.id===chapter.id?'page':undefined" @click="select(item.id)"><strong>{{item.title}}</strong><small>{{item.summary}}</small></button><p v-if="!chapters.length" class="docs-empty">没有找到匹配内容，试试“草稿”“问卷”或“打开方式”。</p></div></nav>
      <article ref="content" class="docs-content" tabindex="-1" @scroll.passive="remember"><div class="docs-reading"><div class="docs-chapter-heading"><div><h2>{{chapter.title}}</h2><p>{{chapter.summary}}</p></div><button type="button" class="ui-icon-button" title="复制章节链接" aria-label="复制章节链接" @click="copyLink"><AppIcon icon="link"/></button></div><nav class="docs-section-links" aria-label="本章内容"><button v-for="item in chapter.sections" :key="item.id" type="button" @click="jump(item.id)">{{item.title}}</button></nav><section v-for="item in chapter.sections" :id="`guide-${chapter.id}-${item.id}`" :key="item.id" class="docs-section"><h3>{{item.title}}</h3><p v-for="(paragraph,index) in item.paragraphs" :key="index">{{paragraph}}</p><ol v-if="item.steps"><li v-for="step in item.steps" :key="step">{{step}}</li></ol></section><footer class="docs-footer"><button type="button" class="ui-button" :disabled="index===0" @click="select(userGuide[index-1]!.id)"><AppIcon icon="chevron-left"/>上一章</button><button type="button" class="docs-top" @click="content?.scrollTo({top:0,behavior:'auto'})">回到顶部</button><button type="button" class="ui-button" :disabled="index===userGuide.length-1" @click="select(userGuide[index+1]!.id)">下一章<AppIcon icon="chevron-right"/></button></footer></div></article>
    </div><span class="docs-notice" role="status">{{notice}}</span>
  </section>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import {GUIDE_READING_STORAGE_KEY,readGuideReading,resolveGuideTarget,searchUserGuide,userGuide} from '@shared/user-guide'
const props=withDefaults(defineProps<{embedded?:boolean;mobile?:boolean;initialChapter?:string;initialSection?:string}>(),{embedded:false,mobile:false})
const emit=defineEmits<{close:[];navigate:[target:{chapter:string;section?:string}]}>()
const content=ref<HTMLElement>(),query=ref(''),current=ref('start'),version=ref(''),notice=ref(''),positions:Record<string,number>={}
function focusSearch(){content.value?.closest('.docs-page')?.querySelector<HTMLInputElement>('[aria-label="搜索使用文档"]')?.focus({preventScroll:true})}
defineExpose({focusSearch})
const chapters=computed(()=>searchUserGuide(query.value)),chapter=computed(()=>userGuide.find(item=>item.id===current.value)||userGuide[0]!),index=computed(()=>userGuide.indexOf(chapter.value))
let timer:ReturnType<typeof setTimeout>|undefined,noticeTimer:ReturnType<typeof setTimeout>|undefined,navigation=0,renderedChapter='',mounted=false,disposed=false,storageFailed=false
try{const saved=readGuideReading(localStorage.getItem(GUIDE_READING_STORAGE_KEY));current.value=saved.chapter;Object.assign(positions,saved.positions)}catch{/* Reading remains available when storage is disabled. */}
function persist(){
  try{localStorage.setItem(GUIDE_READING_STORAGE_KEY,JSON.stringify({version:1,chapter:current.value,positions}));if(storageFailed&&notice.value==='阅读位置暂未保存，请稍后重试。')notice.value='';storageFailed=false}
  catch{storageFailed=true;notice.value='阅读位置暂未保存，请稍后重试。'}
}
function remember(){
  // current can advance before Vue has replaced the previous chapter's DOM.
  if(content.value&&renderedChapter===current.value)positions[current.value]=content.value.scrollTop
  clearTimeout(timer);timer=setTimeout(persist,150)
}
async function select(id:string,section?:string,notify=true){
  const target=resolveGuideTarget(id,section),request=++navigation
  remember();current.value=target.chapter
  await nextTick()
  if(disposed||request!==navigation)return
  renderedChapter=target.chapter
  if(target.section)jump(target.section,false)
  else if(content.value)content.value.scrollTop=positions[target.chapter]||0
  persist();if(notify)emit('navigate',target)
}
function jump(id:string,notify=true){
  if(renderedChapter!==chapter.value.id||!chapter.value.sections.some(item=>item.id===id))return
  const target=content.value?.querySelector<HTMLElement>(`#guide-${chapter.value.id}-${id}`)
  if(target&&content.value){content.value.scrollTop+=target.getBoundingClientRect().top-content.value.getBoundingClientRect().top-20;remember();if(notify)emit('navigate',{chapter:chapter.value.id,section:id})}
}
async function copyLink(){
  try{const url=new URL(location.href);url.hash=`/?docs=${encodeURIComponent(chapter.value.id)}`;await navigator.clipboard.writeText(url.toString());if(disposed)return;notice.value='章节链接已复制'}catch{if(disposed)return;notice.value='暂时无法复制，请重试'}
  clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.value=storageFailed?'阅读位置暂未保存，请稍后重试。':'',2500)
}
watch(()=>[props.initialChapter,props.initialSection],()=>{if(mounted&&props.initialChapter)void select(props.initialChapter,props.initialSection,false)})
onMounted(()=>{
  mounted=true
  void window.navora?.app.info().then(info=>{if(!disposed)version.value=info.version}).catch(()=>{})
  void select(props.initialChapter||current.value,props.initialSection,false).then(()=>{if(!disposed&&props.embedded)focusSearch()})
})
onBeforeUnmount(()=>{remember();disposed=true;navigation++;clearTimeout(timer);clearTimeout(noticeTimer);persist()})
</script>
<style scoped>
.docs-page{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%;background:var(--navora-surface);color:var(--navora-ink)}.docs-header{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;padding:8px 18px;border-bottom:1px solid var(--navora-stroke)}.docs-header>div{display:flex;align-items:center;gap:9px}.docs-header svg{width:17px;height:17px;color:var(--navora-muted)}.docs-header h1{font-size:14px;font-weight:600;margin:0}.docs-version{font-size:10px;color:var(--navora-muted)}.docs-header .ui-button{display:flex;align-items:center;gap:6px;font-size:12px}.docs-layout{display:grid;grid-template-columns:238px minmax(0,1fr);flex:1;min-height:0;overflow:hidden}.docs-navigation{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--navora-stroke);padding:14px 10px;background:var(--navora-sidebar,var(--navora-background))}.docs-search{display:flex;align-items:center;gap:7px;min-height:34px;padding:0 9px;border:1px solid var(--navora-stroke);border-radius:7px;background:var(--navora-surface);color:var(--navora-muted)}.docs-search>svg{width:14px;height:14px;flex:none}.docs-search input{min-width:0;width:100%;border:0;outline:none;background:transparent;color:var(--navora-ink);font:inherit;font-size:12px}.docs-search>button{font-size:18px;color:inherit}.docs-search-count{font-size:11px;color:var(--navora-muted);padding:8px 5px 0;margin:0}.docs-chapters{overflow:auto;min-height:0;margin-top:10px;padding-right:3px}.docs-chapters>button{display:flex;flex-direction:column;gap:3px;width:100%;padding:9px 10px;border-radius:7px;text-align:left;color:inherit;background:transparent}.docs-chapters>button+button{margin-top:3px}.docs-chapters>button:hover{background:var(--control-hover)}.docs-chapters>button[aria-current=page]{background:var(--control-selected);color:var(--navora-accent)}.docs-chapters strong{font-size:12px;font-weight:550;line-height:18px}.docs-chapters small{font-size:10px;line-height:15px;color:var(--navora-muted)}.docs-empty{font-size:12px;line-height:1.8;color:var(--navora-muted);padding:12px 8px}.docs-content{overflow:auto;min-width:0;min-height:0;scrollbar-gutter:stable}.docs-reading{max-width:840px;margin:0 auto;padding:28px 34px 20px}.docs-chapter-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.docs-chapter-heading h2{font-size:24px;line-height:1.4;font-weight:600;margin:0 0 7px}.docs-chapter-heading p{font-size:13px;color:var(--navora-muted);line-height:1.8;margin:0}.docs-section-links{display:flex;flex-wrap:wrap;gap:6px 18px;margin:20px 0 24px;padding-bottom:16px;border-bottom:1px solid var(--navora-stroke)}.docs-section-links button{font-size:12px;color:var(--navora-accent);text-align:left}.docs-section{margin:0 0 26px;scroll-margin-top:20px}.docs-section h3{font-size:15px;line-height:1.6;margin:0 0 10px;font-weight:600}.docs-section p,.docs-section li{font-size:13px;line-height:1.95;overflow-wrap:anywhere}.docs-section p{margin:0 0 10px}.docs-section ol{padding-left:20px}.docs-section li+li{margin-top:5px}.docs-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid var(--navora-stroke);padding-top:18px}.docs-footer button{font-size:12px}.docs-footer .ui-button{display:flex;align-items:center;gap:4px}.docs-footer svg{width:12px}.docs-top{color:var(--navora-muted)}.docs-notice{position:absolute;bottom:18px;right:24px;font-size:12px;color:var(--navora-accent)}button:focus-visible{outline:2px solid var(--navora-accent);outline-offset:2px}
@media(max-width:900px){.docs-layout{grid-template-columns:200px minmax(0,1fr)}.docs-reading{padding:24px 22px}}@media(max-width:620px){.docs-layout{display:flex;flex-direction:column}.docs-navigation{flex:0 0 auto;border-right:0;border-bottom:1px solid var(--navora-stroke);padding:10px}.docs-chapters{display:flex;gap:5px;overflow:auto;max-height:78px}.docs-chapters>button{flex:0 0 150px;padding:6px 8px}.docs-chapters>button+button{margin-top:0}.docs-chapters small{display:none}.docs-reading{padding:20px 16px}.docs-chapter-heading h2{font-size:20px}.docs-header{padding:8px 12px}.docs-version{display:none}}
</style>
