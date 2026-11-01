import type {PluginRecord} from './plugins'
import type {StoreCatalogProduct} from './store'
import {filterPluginLibrary} from './plugin-library'

export type PluginWorkspaceMode = 'search' | 'installed' | 'store'
export type PluginWorkspaceEntry = {key:string; name:string; description:string; local?:PluginRecord; product?:StoreCatalogProduct}

/** Resolve installation state from the current local inventory, including suite variants. */
export function currentPluginProducts(products:readonly StoreCatalogProduct[], records:readonly PluginRecord[]):StoreCatalogProduct[] {
  const installed=new Map(records.map(record=>[record.id,record]))
  return products.filter(product=>product.kind==='plugin').map(product=>{
    const local=product.packages.map(pkg=>installed.get(pkg.id)).find(Boolean)
    return {...product,installed:local?{packageId:local.id,version:local.version,name:local.name}:undefined}
  })
}

export function pluginWorkspaceEntries(records:readonly PluginRecord[], products:readonly StoreCatalogProduct[], mode:PluginWorkspaceMode, query:string):PluginWorkspaceEntry[] {
  const tokens=query.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const local=filterPluginLibrary(records,query,'all','all',new Set()).map(record=>({key:`local:${record.id}`,name:record.name,description:record.description,local:record}))
  if(mode==='installed')return local
  const matchedLocal=new Set(local.map(entry=>entry.local.id))
  const catalog=currentPluginProducts(products,records).filter(product=>{
    if(mode==='search' && product.packages.some(pkg=>matchedLocal.has(pkg.id)))return false
    const text=[product.productId,product.name,product.description,...product.packages.flatMap(pkg=>[pkg.id,pkg.name,pkg.description])].join(' ').normalize('NFKC').toLocaleLowerCase()
    return tokens.every(token=>text.includes(token))
  }).map(product=>({key:`store:${product.productId}`,name:product.name,description:product.description,product}))
  return mode==='store'?catalog:[...local,...catalog]
}
