import {uiIconAssets} from './ui-icon-assets'
export type {UiIconAsset,UiIconPath} from './ui-icon-assets'

// Retain the existing catalogue and aliases for consumers that inspect icon names.
export const uiIconPaths:Record<string,string[]>=Object.fromEntries(Object.entries(uiIconAssets).map(([name,icon])=>[name,icon.regular.paths.map(path=>path.d)]))
export function getUiIcon(name:string,size=20){const icon=uiIconAssets[resolveUiIcon(name)]!;return size<=16.5?icon.small:icon.regular}

export const uiIconAliases:Record<string,string>={dir:'folder',plugin:'puzzle-piece',queue:'list-ul'}
export function resolveUiIcon(name:string){const key=Object.hasOwn(uiIconAliases,name)?uiIconAliases[name]:name;return Object.hasOwn(uiIconAssets,key)?key:'circle-question'}
export const vuetifyIconAliases={
  collapse:'chevron-up',complete:'check',cancel:'xmark',close:'xmark',delete:'xmark',clear:'xmark',success:'circle-check',info:'circle-exclamation',warning:'triangle-exclamation',error:'circle-exclamation',prev:'chevron-left',next:'chevron-right',checkboxOn:'checkbox-checked',checkboxOff:'checkbox',checkboxIndeterminate:'checkbox-mixed',delimiter:'circle',sortAsc:'arrow-up',sortDesc:'arrow-down',expand:'chevron-down',menu:'bars',subgroup:'chevron-down',dropdown:'chevron-down',radioOn:'radio-checked',radioOff:'circle',edit:'pen-to-square',ratingEmpty:'star',ratingFull:'star',ratingHalf:'star',loading:'circle-notch',first:'angles-left',last:'angles-right',unfold:'chevron-down',file:'paperclip',plus:'plus',minus:'minus',calendar:'calendar',treeviewCollapse:'chevron-down',treeviewExpand:'chevron-right',tableGroupCollapse:'chevron-down',tableGroupExpand:'chevron-right',upload:'arrow-up',search:'magnifying-glass',arrowup:'arrow-up',arrowdown:'arrow-down',arrowleft:'arrow-left',arrowright:'arrow-right',backspace:'xmark',fullscreen:'window-maximize',fullscreenExit:'window-restore',pause:'pause-circle',play:'arrow-right',
}
