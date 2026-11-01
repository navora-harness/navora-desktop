import {storeErrorText} from './store'

const pluginErrorHints: Record<string, string> = {
  path_not_found: '路径不存在',
  plugin_json_missing: '缺少 plugin.json',
  invalid_manifest: 'plugin.json 无效',
  invalid_main_path: 'main 路径非法',
  invalid_main_ext: 'main 仅支持 .cjs / .js',
  plugin_not_found: '插件不存在',
  readme_not_found: '该插件未提供说明文件',
  plugin_exists: '插件已存在',
  plugin_bundled_cannot_remove: '随附插件不可卸载',
  plugin_bundled_cannot_overwrite: '不可覆盖随附插件',
  plugin_suite_conflict: '同套件已安装其它包，请先卸载或确认更换',
  plugin_suite_bundled_conflict: '同套件存在随附插件，无法导入替换',
  plugin_exclusivity_conflict: '同套件已安装其它包，请先卸载或确认更换',
  plugin_exclusivity_bundled_conflict: '同套件存在随附插件，无法导入替换',
  plugin_too_large: '压缩包超过 200MB 上限',
  zip_empty: '压缩包为空',
  zip_unsafe_path: '压缩包含不安全路径',
  invalid_suite_manifest: '套件清单 suite.json 无效',
  suite_packages_empty: '套件压缩包未包含任何变体',
  package_not_found: '套件中找不到所选变体',
  link_path_missing: '外链目录不存在',
  plugin_path_must_be_dir_or_zip: '请选择插件文件夹或 .zip 压缩包',
  plugin_permissions_undeclared: '插件未声明权限计划',
  plugin_permissions_empty: '插件权限计划为空',
  import_load_failed: '导入后加载失败',
  invalid_module_exports: '插件入口未导出 tools / execute',
  remote_unsupported: '远程端不支持文件选择，请在本机客户端操作',
  remote_forbidden: '远程端禁止此操作',
  id_required: '缺少插件 id',
  host_too_old: '当前桌面版本过低，无法安装该版本',
  invalid_catalog_path: '商店目录路径无效，已拒绝下载',
  size_mismatch: '下载体积与目录声明不符',
  download_timeout: '下载超时',
  checksum_mismatch: '校验和不匹配，已拒绝安装',
  product_kind_required: '插件与技能同名，请指定类型',
  product_not_found: '商店中找不到该产品',
}

export function pluginErrorText(code?: string): string {
  if (!code) return '操作失败'
  return pluginErrorHints[code] || storeErrorText(code)
}
