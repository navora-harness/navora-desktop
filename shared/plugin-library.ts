import type { PluginRecord } from './plugins'
export type PluginLibraryStatus = 'all' | 'enabled' | 'disabled' | 'attention'
export type PluginLibrarySource = 'all' | 'creator' | 'linked' | 'installed' | 'bundled' | 'session'
export function pluginLibrarySource(plugin: PluginRecord): { id: PluginLibrarySource; label: string } {
  if (plugin.bundled || plugin.kind === 'bundled') return { id:'bundled', label:'随附' }
  if (plugin.kind === 'linked' && /\/creators\/creator_[a-f0-9]{24}\/releases\/revision-\d+\/?$/.test(plugin.path.replaceAll('\\','/'))) return { id:'creator', label:'创建器' }
  if (plugin.kind === 'linked') return { id:'linked', label:'开发外链' }
  if (plugin.kind === 'session') return { id:'session', label:'会话' }
  return { id:'installed', label:'已安装' }
}
export function pluginLibraryStatus(plugin: PluginRecord, conflicts: ReadonlySet<string>): Exclude<PluginLibraryStatus,'all'> {
  return plugin.error || conflicts.has(plugin.id) ? 'attention' : plugin.enabled ? 'enabled' : 'disabled'
}
export function filterPluginLibrary(plugins: readonly PluginRecord[], query: string, status: PluginLibraryStatus, source: PluginLibrarySource, conflicts: ReadonlySet<string>) {
  const tokens = query.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return plugins.filter(plugin => {
    const origin = pluginLibrarySource(plugin)
    if (source !== 'all' && origin.id !== source) return false
    if (status !== 'all' && pluginLibraryStatus(plugin,conflicts) !== status) return false
    const searchable = [plugin.name,plugin.id,plugin.description,plugin.version,plugin.suite,origin.label,...(plugin.tools || [])].join(' ').normalize('NFKC').toLocaleLowerCase()
    return tokens.every(token => searchable.includes(token))
  })
}
