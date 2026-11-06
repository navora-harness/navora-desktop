import {onMounted,onUnmounted,ref} from 'vue'
import {resolveSubchatGlyphStyle,subchatGlyphUrl,type SubchatGlyphStyle} from '@shared/subchat-glyph'

const style=ref<SubchatGlyphStyle>('mixed'),cache=new Map<string,string>()
let users=0,generation=0,revision=0,unsubscribe:(()=>void)|undefined

/** All identity placements share one renderer subscription and the same deterministic generator. */
export function useSubchatGlyph(){
  onMounted(()=>{
    if(++users!==1)return
    const api=window.navora?.config,ticket=++generation
    if(!api)return
    unsubscribe=api.onChanged?.(config=>{revision++;style.value=resolveSubchatGlyphStyle(config.app.subchat_glyph_style)})
    const initialRevision=revision
    void api.get().then(config=>{if(users&&ticket===generation&&revision===initialRevision)style.value=resolveSubchatGlyphStyle(config.app.subchat_glyph_style)}).catch(()=>{})
  })
  onUnmounted(()=>{if(--users===0){generation++;unsubscribe?.();unsubscribe=undefined}})
  function glyphUrl(id:string){
    const key=`${style.value}:${id}`,existing=cache.get(key)
    if(existing)return existing
    const url=subchatGlyphUrl(id,style.value)
    cache.set(key,url)
    if(cache.size>1024)cache.delete(cache.keys().next().value!)
    return url
  }
  return{glyphUrl,style}
}
