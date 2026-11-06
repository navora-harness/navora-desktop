<template>
  <v-app class="navora-app"><main>
    <div id="plugin-sidebar-target" />
    <PluginLibraryList v-if="pane==='library'" :records="records" :busy="busy" :loading="false" error="" :batch-mode="false" :selected="empty" :conflicts="empty" @docs="record=>events.push(['docs',record.id])" @export="id=>events.push(['export',id])" @remove="record=>events.push(['remove',record.id])" @notify="text=>events.push(['notify',text])" />
    <PluginWorkspace v-if="pane==='workspace'" :active="active" sidebar-target="#plugin-sidebar-target" />
    <StoreBrowseDialog v-if="pane==='browse'" v-model="dialogOpen" kind="plugin" />
    <StoreProductDetailDialog v-if="pane==='detail'" v-model="dialogOpen" :product="product" :busy="busy" @change="events.push(['change',product?.productId])" @uninstall="events.push(['uninstall',product?.productId])" />
  </main></v-app>
</template>
<script setup lang="ts">
import {nextTick,ref} from 'vue'
import type {PluginRecord} from '../../shared/plugins'
import type {StoreCatalogProduct} from '../../shared/store'
import type {NativeMenuResult,NativeUiApi} from '../../shared/native-ui'
import type {NavoraApi} from '../../electron/preload'
import PluginLibraryList from '../../src/components/plugins/PluginLibraryList.vue'
import PluginWorkspace from '../../src/components/plugins/PluginWorkspace.vue'
import StoreBrowseDialog from '../../src/components/store/StoreBrowseDialog.vue'
import StoreProductDetailDialog from '../../src/components/store/StoreProductDetailDialog.vue'
import {useStoreUi} from '../../src/composables/useStoreUi'
const record=(id:string,bundled=false):PluginRecord=>({id,dirName:id,name:id,description:'fixture',version:'1.0',enabled:true,bundled,path:`D:/fixtures/${id}`,kind:bundled?'bundled':'linked',source:'fixture',tools:[],hasReadme:!bundled})
const catalog=(id:string,suite=true):StoreCatalogProduct=>({kind:'plugin',productId:id,name:id,description:'fixture',displayMode:suite?'suite':'single',packages:(suite?[`${id}-a`,`${id}-b`]:[`${id}-a`]).map(packageId=>({id:packageId,name:id,description:'fixture',versions:[]})),installed:{packageId:`${id}-a`,version:'1.0'}})
const pane=ref('library'),records=ref([record('linked'),record('bundled',true)]),busy=ref(false),active=ref(true),empty=new Set<string>(),events:any[]=[],dialogOpen=ref(false),product=ref<StoreCatalogProduct|null>(catalog('suite'))
const requests:any[]=[],pending=new Map<string,(result:NativeMenuResult)=>void>(),calls:any[]=[]
let clipboard=''
const nativeUi={capabilities:async()=>({menus:true,panels:false,pageInfo:false,distributionVersion:'fixture'}),popupMenu:input=>{requests.push(structuredClone(input));return new Promise(resolve=>pending.set(input.requestId,resolve))},closeMenu:async id=>{const resolve=pending.get(id);pending.delete(id);resolve?.({supported:true,reason:'closed'})},updateMenu:async()=>false,onMenuControl:()=>()=>{},showPanel:async()=>({supported:false,id:'',session:''}),updatePanel:async()=>false,hidePanel:async()=>{},destroyPanel:async()=>{},showPageInfo:async()=>false,onPanelEvent:()=>()=>{}} as NativeUiApi
window.navora={app:{platform:'win32'},nativeUi,plugins:{list:async()=>records.value,onChanged:()=>()=>{},pickParse:async kind=>{calls.push(['import',kind]);return {canceled:true}},export:async id=>{calls.push(['export',id]);return {canceled:true}},remove:async id=>{calls.push(['remove',id]);return {ok:true}}},store:{status:async()=>({baseUrl:'https://fixture.invalid',reachable:true}),list:async()=>({ok:true,products:[catalog('suite'),catalog('single',false)]}),readDocs:async()=>({ok:true,markdown:'# fixture'})}} as unknown as NavoraApi
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{clipboard=text}}})
const store=useStoreUi()
;(window as any).pluginMenuFixture={get requests(){return requests},get pending(){return [...pending.keys()]},get events(){return events},get calls(){return calls},get clipboard(){return clipboard},get installer(){return store.installerReq.value},get installerOpen(){return store.installerOpen.value},get detailOpen(){return store.detailOpen.value},choose(id:string,requestId=[...pending.keys()].at(-1)){const resolve=pending.get(requestId!);pending.delete(requestId!);resolve?.({supported:true,selectedId:id})},async show(value:string){dialogOpen.value=false;pane.value=value;busy.value=false;active.value=true;await nextTick();dialogOpen.value=true},setBusy(value:boolean){busy.value=value},replaceRecord(){records.value=[{...records.value[0]!,path:'D:/changed/linked',version:'2.0'},records.value[1]!]},replaceProduct(){product.value=catalog('different')},close(){dialogOpen.value=false},deactivate(){active.value=false}}
</script>
<style>html,body,#app{margin:0;height:100%;font-family:'Segoe UI',sans-serif}main{padding:20px}#plugin-sidebar-target:not(:empty){width:280px;float:left;height:600px}.plugin-workspace{min-height:600px}</style>
