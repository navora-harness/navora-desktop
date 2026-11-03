<template>
  <div class="plugin-library">
    <header class="library-title-row">
      <h3>插件<span>{{ records.length }}</span></h3>
      <span v-if="enabledCount" class="library-enabled-count">{{ enabledCount }} 个已启用</span>
      <button v-if="batchMode" type="button" class="library-text-button" :disabled="busy" @click="emit('batch', false)">取消批量操作</button>
      <button v-else-if="removableCount" type="button" class="library-icon-button" aria-label="批量操作" title="批量操作" :disabled="busy" @click="emit('batch', true)"><AppIcon icon="list-check" /></button>
    </header>
    <div v-if="records.length" class="library-filters">
      <div class="library-search"><AppIcon icon="magnifying-glass" /><input v-model="query" type="search" aria-label="搜索插件" placeholder="搜索名称、用途或工具…" /><button v-if="query" type="button" aria-label="清空插件搜索" @click="query = ''"><AppIcon icon="xmark" /></button></div>
      <select v-model="source" aria-label="插件来源"><option value="all">全部来源</option><option v-for="option in sourceOptions" :key="option.id" :value="option.id">{{ option.label }}</option></select>
    </div>
    <div v-if="records.length" class="library-status-filters" role="group" aria-label="插件状态筛选"><button v-for="option in statuses" :key="option.id" type="button" :class="{ active: status === option.id }" :aria-pressed="status === option.id" @click="status = option.id">{{ option.label }}<span>{{ count(option.id) }}</span></button></div>
    <div v-if="error" class="library-load-error" role="alert"><AppIcon icon="circle-exclamation" /><span>{{ error }}</span><button type="button" :disabled="busy || loading" @click="emit('retry')">重试</button></div>
    <div v-if="loading && !records.length" class="library-empty" role="status"><AppIcon icon="circle-notch" :spin="!reducedMotion" /><span>正在读取插件…</span></div>
    <div v-else-if="!records.length && !error" class="library-empty settings-empty"><AppIcon icon="puzzle-piece" /><strong>暂无插件</strong><span>从模板创建，或导入现有插件</span><button type="button" class="library-text-button" @click="emit('create')">创建插件</button></div>
    <div v-else-if="records.length && !filtered.length" class="library-empty"><AppIcon icon="magnifying-glass" /><strong>没有匹配的插件</strong><button type="button" class="library-text-button" @click="reset">清空筛选</button></div>
    <div v-else class="library-rows" :aria-busy="loading || busy">
      <article v-for="plugin in filtered" :key="plugin.id" class="plugin-library-row" :class="{ selected: batchMode && selected.has(plugin.id), attention: pluginLibraryStatus(plugin, conflicts) === 'attention' }" :data-plugin-id="plugin.id">
        <div class="plugin-summary">
          <input v-if="batchMode" type="checkbox" class="plugin-batch-checkbox" :checked="selected.has(plugin.id)" :disabled="busy || protectedPlugin(plugin)" :aria-label="`选择 ${plugin.name}`" @change="emit('select', plugin.id)" />
          <span v-else class="plugin-identity-icon"><AppIcon icon="puzzle-piece" /></span>
          <div class="plugin-summary-copy">
            <div class="plugin-summary-title"><strong :title="plugin.name">{{ plugin.name }}</strong><span v-if="plugin.version" class="plugin-version">v{{ plugin.version }}</span><span v-if="plugin.targetLabel" class="plugin-version">{{ plugin.targetLabel }}</span><span class="plugin-origin" :title="plugin.sourceDetail || plugin.path">{{ pluginLibrarySource(plugin).label }}</span></div>
            <p class="plugin-description" :title="plugin.description">{{ plugin.description || plugin.id }}</p>
          </div>
          <span class="plugin-state" :class="{ enabled: pluginLibraryStatus(plugin, conflicts) === 'enabled', failed: plugin.error, conflict: conflicts.has(plugin.id) && !plugin.error }"><AppIcon v-if="plugin.error || conflicts.has(plugin.id)" icon="circle-exclamation" />{{ plugin.error ? '加载失败' : conflicts.has(plugin.id) ? '套件冲突' : plugin.enabled ? '已启用' : '已停用' }}</span>
          <button type="button" class="plugin-tool-count" :aria-expanded="expanded.has(plugin.id)" :aria-controls="`plugin-detail-${plugin.id}`" :title="`查看 ${plugin.tools.length} 个工具与插件详情`" @click="toggleExpanded(plugin.id)">{{ plugin.tools.length }}<span> 个工具</span></button>
          <input v-if="!batchMode" type="checkbox" class="surface-toggle plugin-enable" role="switch" :checked="plugin.enabled" :aria-checked="plugin.enabled" :aria-label="`${plugin.enabled ? '停用' : '启用'} ${plugin.name}`" :disabled="busy || (!!plugin.error && !plugin.enabled)" :title="plugin.error && !plugin.enabled ? '修复入口后可启用' : undefined" @change="emit('toggle', plugin.id, ($event.target as HTMLInputElement).checked)" />
          <v-menu v-if="!batchMode" location="bottom end">
            <template #activator="{ props: menuProps }"><button v-bind="menuProps" type="button" class="library-icon-button plugin-actions" :aria-label="`${plugin.name}的更多操作`" title="更多操作" :disabled="busy"><AppIcon icon="ellipsis" /></button></template>
            <div class="library-action-menu" role="menu">
              <button type="button" role="menuitem" :disabled="!plugin.hasReadme || busy" @click="emit('docs', plugin)"><AppIcon icon="book" />查看说明</button>
              <button type="button" role="menuitem" :disabled="busy" @click="emit('export', plugin.id)"><AppIcon icon="file-export" />导出插件</button>
              <button type="button" role="menuitem" :disabled="busy" @click="copy(plugin.path)"><AppIcon icon="copy" />复制路径</button>
              <button type="button" role="menuitem" class="danger" :disabled="protectedPlugin(plugin) || busy" @click="emit('remove', plugin)"><AppIcon icon="trash" />{{ protectedPlugin(plugin) ? '随附不可卸载' : plugin.kind === 'linked' ? '取消外链' : '卸载' }}</button>
            </div>
          </v-menu>
          <button type="button" class="library-icon-button plugin-disclosure" :aria-expanded="expanded.has(plugin.id)" :aria-controls="`plugin-detail-${plugin.id}`" :aria-label="`${expanded.has(plugin.id) ? '收起' : '展开'} ${plugin.name}详情`" @click="toggleExpanded(plugin.id)"><AppIcon icon="chevron-down" /></button>
        </div>
        <DisclosureTransition>
          <div v-if="expanded.has(plugin.id)" :id="`plugin-detail-${plugin.id}`" class="plugin-library-details">
            <div v-if="plugin.error" class="plugin-error-detail"><strong>入口加载失败</strong><pre>{{ plugin.error }}</pre></div>
            <p v-if="conflicts.has(plugin.id)" class="plugin-conflict-detail">套件 {{ plugin.suite }} 已安装多个包，请保留需要使用的版本。</p>
            <dl><dt>标识</dt><dd>{{ plugin.id }}</dd><dt>位置</dt><dd class="plugin-location">{{ plugin.path }}</dd><template v-if="plugin.suite"><dt>套件</dt><dd>{{ plugin.suite }}</dd></template></dl>
            <div v-if="plugin.tools.length" class="plugin-tool-list" aria-label="插件工具"><code v-for="tool in plugin.tools" :key="tool">{{ tool }}</code></div>
            <div v-else class="plugin-no-tools">{{ plugin.error ? '修复入口后重新加载插件' : plugin.enabled ? '未注册工具' : '启用后注册工具' }}</div>
            <button v-if="plugin.hasReadme" type="button" class="library-text-button" :disabled="busy" @click="emit('docs', plugin)">查看说明<AppIcon icon="arrow-up-right-from-square" /></button>
          </div>
        </DisclosureTransition>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { PluginRecord } from '@shared/plugins'
import { filterPluginLibrary, pluginLibrarySource, pluginLibraryStatus, type PluginLibraryStatus, type PluginLibrarySource } from '@shared/plugin-library'
import DisclosureTransition from '@/components/motion/DisclosureTransition'
const props = defineProps<{ records:PluginRecord[]; busy:boolean; loading:boolean; error:string; batchMode:boolean; selected:Set<string>; conflicts:Set<string> }>()
const emit = defineEmits<{ batch:[enabled:boolean]; select:[id:string]; toggle:[id:string,enabled:boolean]; docs:[plugin:PluginRecord]; export:[id:string]; remove:[plugin:PluginRecord]; create:[]; retry:[]; visible:[ids:string[]]; notify:[text:string,color?:string] }>()
const query = ref(''), status = ref<PluginLibraryStatus>('all'), source = ref<PluginLibrarySource>('all'), expanded = ref(new Set<string>())
const statuses: Array<{id:PluginLibraryStatus;label:string}> = [{id:'all',label:'全部'},{id:'enabled',label:'已启用'},{id:'disabled',label:'已停用'},{id:'attention',label:'需处理'}]
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const protectedPlugin = (plugin:PluginRecord) => plugin.bundled || plugin.kind === 'bundled'
const removableCount = computed(() => props.records.filter(plugin => !protectedPlugin(plugin)).length)
const enabledCount = computed(() => props.records.filter(plugin => pluginLibraryStatus(plugin,props.conflicts) === 'enabled').length)
const sourceOptions = computed(() => [...new Map(props.records.map(plugin => { const item = pluginLibrarySource(plugin); return [item.id,item] })).values()])
const filtered = computed(() => filterPluginLibrary(props.records,query.value,status.value,source.value,props.conflicts))
watch(filtered, records => emit('visible',records.map(plugin=>plugin.id)), {immediate:true})
watch(() => props.records, records => { const alive = new Set(records.map(plugin=>plugin.id)); expanded.value = new Set([...expanded.value].filter(id=>alive.has(id))) })
function count(id:PluginLibraryStatus) { return id === 'all' ? props.records.length : props.records.filter(plugin => pluginLibraryStatus(plugin,props.conflicts) === id).length }
function toggleExpanded(id:string) { const next=new Set(expanded.value); if(next.has(id))next.delete(id);else next.add(id);expanded.value=next }
function reset() { query.value='';status.value='all';source.value='all' }
async function copy(value:string) { try { await navigator.clipboard.writeText(value);emit('notify','已复制路径','success') } catch { emit('notify','复制失败','error') } }
</script>

<style scoped>
.plugin-library { min-width:0; }
.library-title-row { display:flex; align-items:center; gap:10px; margin:18px 0 12px; }
h3 { display:flex; align-items:center; gap:8px; font-size:14px; font-weight:600; color:#3a485d; }
h3 > span { background:#edf0f5; padding:1px 6px; border-radius:6px; font-size:10px; color:#7a8595; }
.library-enabled-count { color:#7c8a9c; font-size:11px; }
.library-title-row > button { margin-left:auto; }
button,select,input { font-family:inherit; }
button { cursor:pointer; }
button:disabled { opacity:.4; cursor:default; }
.library-icon-button { display:inline-grid; place-items:center; flex-shrink:0; width:30px; height:30px; padding:6px; border:1px solid transparent; border-radius:7px; color:#65758b; background:transparent; transition:background-color 140ms ease,border-color 140ms ease; }
.library-icon-button svg { width:13px; height:13px; }
.library-icon-button:hover:not(:disabled) { background:#e9edf3; border-color:#dbe2ed; }
.library-text-button { display:inline-flex; align-items:center; gap:6px; font-size:11px; color:#3c6595; padding:5px 7px; border:1px solid transparent; border-radius:6px; }
.library-text-button:hover { background:#edf2f8; border-color:#dce6f1; }
.library-filters { display:flex; align-items:center; gap:8px; }
.library-search { display:flex; align-items:center; gap:8px; min-width:0; flex:1; background:#fff; border:1px solid #e0e5ed; border-radius:8px; padding:5px 10px; height:36px; }
.library-search > svg { width:13px; color:#8692a2; }
.library-search input { width:100%; min-width:0; font-size:12px; color:#435169; outline:0; }
.library-search input::-webkit-search-cancel-button { display:none; }
.library-search button { display:grid; place-items:center; width:20px; height:20px; color:#7b8797; border-radius:4px; }
.library-search button svg { width:10px; }
.library-search:focus-within { border-color:#7294bc; box-shadow:0 0 0 2px #7294bc12; }
.library-filters select { border:1px solid #e0e5ed; border-radius:8px; background:#fff; padding:7px 10px; color:#68798f; font-size:11px; max-width:130px; min-width:0; height:36px; }
.library-status-filters { display:flex; gap:4px; margin:10px 0 12px; overflow:auto; scrollbar-width:none; }
.library-status-filters button { display:flex; align-items:center; gap:6px; padding:5px 8px; white-space:nowrap; color:#7d899a; border:1px solid transparent; border-radius:6px; font-size:11px; }
.library-status-filters button.active { color:#375a86; background:#e8eef6; border-color:#dae3ef; }
.library-status-filters button span { font-size:9px; opacity:.7; }
.library-rows { display:flex; flex-direction:column; gap:7px; }
.plugin-library-row { border:1px solid #e3e8ef; border-radius:9px; background:#fff; min-width:0; overflow:hidden; }
.plugin-library-row.selected { border-color:#91aecd; background:#f6f9fd; }
.plugin-library-row.attention { border-color:#eadce0; }
.plugin-summary { display:flex; align-items:center; gap:10px; padding:11px 12px; min-height:66px; }
.plugin-identity-icon { width:32px; height:32px; display:grid; place-items:center; flex-shrink:0; border:1px solid #e5eaf1; border-radius:8px; background:#f4f7fb; color:#6b82a1; }
.plugin-identity-icon svg { width:15px; height:15px; }
.plugin-summary-copy { flex:1; min-width:0; }
.plugin-summary-title { display:flex; align-items:center; gap:7px; min-width:0; }
.plugin-summary-title strong { font-size:12px; font-weight:600; color:#3c4c62; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.plugin-version { color:#8b96a5; font-size:10px; white-space:nowrap; }
.plugin-origin { color:#7c899c; border:1px solid #e8ecf2; border-radius:4px; font-size:9px; padding:1px 4px; white-space:nowrap; }
.plugin-description { margin:4px 0 0; color:#8791a0; font-size:11px; line-height:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.plugin-state { display:inline-flex; align-items:center; gap:4px; color:#8c96a5; font-size:10px; flex-shrink:0; white-space:nowrap; }
.plugin-state.enabled { color:#548174; }
.plugin-state.failed { color:#b25b66; }
.plugin-state.conflict { color:#a4824a; }
.plugin-state svg { width:11px; height:11px; }
.plugin-tool-count { flex-shrink:0; color:#6b7c93; font-size:10px; padding:4px 6px; border:1px solid #e9edf3; border-radius:6px; white-space:nowrap; }
.plugin-tool-count:hover { border-color:#c9d6e5; background:#f5f8fc; }
.plugin-enable { margin:0 1px; }
.plugin-batch-checkbox { width:16px; height:16px; flex-shrink:0; accent-color:#4d78a9; cursor:pointer; }
.plugin-disclosure[aria-expanded="true"] svg { transform:rotate(180deg); }
.plugin-disclosure svg { transition:transform 170ms ease; }
.plugin-library-details { padding:0 16px 13px 54px; font-size:11px; color:#7b8798; }
.plugin-library-details dl { display:grid; grid-template-columns:36px minmax(0,1fr); gap:5px 10px; padding-top:10px; border-top:1px solid #eef1f5; }
.plugin-library-details dt { color:#9ba4af; }
.plugin-library-details dd { min-width:0; margin:0; overflow-wrap:anywhere; }
.plugin-location { font-size:10px; }
.plugin-tool-list { display:flex; gap:5px; flex-wrap:wrap; max-height:140px; overflow:auto; margin:12px 0 5px; }
.plugin-tool-list code { font:10px/1.6 Consolas,monospace; padding:2px 6px; border:1px solid #e5eaf1; border-radius:5px; background:#f6f8fb; color:#63809b; overflow-wrap:anywhere; }
.plugin-no-tools { padding-top:10px; color:#9ba4af; }
.plugin-error-detail { background:#fcf4f5; color:#a34d5a; padding:10px; border:1px solid #efdce0; border-radius:7px; margin-bottom:10px; }
.plugin-error-detail strong { font-size:11px; font-weight:500; }
.plugin-error-detail pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:130px; overflow:auto; margin-top:5px; font:10px/1.65 Consolas,monospace; }
.plugin-conflict-detail { color:#a27b40; margin-bottom:10px; line-height:1.7; }
.library-load-error { display:flex; align-items:center; gap:8px; padding:10px; margin:10px 0; border:1px solid #efdfe2; background:#fcf5f6; color:#ad6270; font-size:11px; border-radius:8px; }
.library-load-error svg { width:13px; }
.library-load-error button { margin-left:auto; color:#8e5262; }
.library-empty { min-height:170px; padding:28px 10px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; font-size:12px; color:#8c97a6; text-align:center; }
.library-empty > svg { width:26px; height:26px; color:#a0aec1; }
.library-empty strong { color:#718098; font-size:13px; font-weight:500; }
.library-action-menu { padding:5px; min-width:160px; display:flex; flex-direction:column; border:1px solid #e3e8f0; border-radius:9px; background:#fff; box-shadow:0 8px 24px #20344918; }
.library-action-menu button { display:flex; gap:9px; align-items:center; padding:8px 10px; border:1px solid transparent; border-radius:6px; font-size:12px; color:#60718a; }
.library-action-menu button svg { width:13px; height:13px; }
.library-action-menu button:hover:not(:disabled) { background:#edf2f8; }
.library-action-menu .danger { color:#b15a68; }
button:focus-visible,select:focus-visible,input:focus-visible { outline:2px solid #6c91bb; outline-offset:2px; }
@media(max-width:850px) { .plugin-summary { gap:7px; } .plugin-origin { display:none; } .plugin-tool-count span { display:none; } .plugin-identity-icon { width:28px; height:28px; } }
@media(max-width:550px) {
  .plugin-summary { display:grid; grid-template-columns:28px minmax(0,1fr) auto auto; gap:7px; padding:10px; }
  .plugin-summary-copy { grid-column:2; }
  .plugin-summary .plugin-state { grid-column:2; grid-row:2; }
  .plugin-tool-count { grid-column:3; grid-row:2; padding:2px 6px; }
  .plugin-enable { grid-column:3; grid-row:1; }
  .plugin-actions { grid-column:4; grid-row:1; }
  .plugin-disclosure { grid-column:4; grid-row:2; height:22px; }
  .plugin-version { font-size:9px; }
  .plugin-description { max-width:100%; }
  .plugin-library-details { padding:0 12px 12px; }
  .plugin-origin { display:none; }
  .library-enabled-count { display:none; }
}
@media(prefers-reduced-motion:reduce) { .library-icon-button,.plugin-disclosure svg { transition:none; } .library-empty .is-spinning { animation:none; } }
</style>
