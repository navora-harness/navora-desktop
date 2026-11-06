/**
 * Compress browser page payloads before they are sent back to the LLM.
 * Full news-site bodies often trip provider content filters ("high risk");
 * a headline-oriented digest keeps analysis useful while reducing rejections.
 */

import { compactPageBlocker } from './page-blocker'

const NAV_NOISE =
  /^(subscribe|log in|sign in|menu|skip to content|cookie|accept all|the economist pro|weekly edition|world in brief|search|close|back to top)$/i

const SECTION_CHIPS =
  /^(united states|finance & economics|business|china|asia|europe|britain|middle east & africa|artificial intelligence|games|opinion|culture|science & technology|international)$/i

export function isLlmContentRejected(text: string): boolean {
  const t = String(text || '').trim()
  if (!t) return false
  if (/request was rejected because it was considered high risk/i.test(t)) return true
  if (/content (?:was )?(?:filtered|blocked|flagged)|safety (?:system|policy)|sensitive content/i.test(t)) {
    return true
  }
  if (/因(?:内容)?安全策略|内容审核|高风险|违规内容|无法回答该问题/.test(t) && t.length < 120) {
    return true
  }
  return false
}

function uniqKeepOrder(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const k = item.toLowerCase()
    if (!item || seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

/** Pull likely headlines from raw page innerText. */
export function extractPageHeadlines(raw: string, limit = 30): string[] {
  const lines = String(raw || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const headlines: string[] = []
  for (const line of lines) {
    if (NAV_NOISE.test(line) || SECTION_CHIPS.test(line)) continue
    if (/^\d+\s*min read$/i.test(line)) continue
    if (/^https?:\/\//i.test(line)) continue
    if (line.length < 18 || line.length > 140) continue
    if (/^[\[{]/.test(line)) continue
    headlines.push(line)
    if (headlines.length >= limit * 2) break
  }
  return uniqKeepOrder(headlines).slice(0, limit)
}

function digestDomSummary(value: Record<string, unknown>, maxChars: number): string {
  const title = String(value.title || '').trim()
  const url = String(value.url || '').trim()
  const headings = Array.isArray(value.headings) ? value.headings : []
  const lines: string[] = []
  lines.push('【页面结构摘要】公开网页标题与栏目，供客观总结。')
  if (title) lines.push(`标题：${title}`)
  if (url) lines.push(`地址：${url}`)
  const heads: string[] = []
  for (const h of headings) {
    if (!h || typeof h !== 'object') continue
    const text = String((h as { text?: unknown }).text || '').trim()
    if (!text || text === 'undefined undefined') continue
    if (NAV_NOISE.test(text) || SECTION_CHIPS.test(text)) continue
    heads.push(text)
  }
  const uniq = uniqKeepOrder(heads).slice(0, 36)
  if (uniq.length) {
    lines.push('标题列表：')
    for (const h of uniq) lines.push(`- ${h}`)
  }
  return lines.join('\n').slice(0, maxChars)
}

/** Preserve actionable records; headline-only compression loses links and controls. */
function compactStructuredPage(value: Record<string, unknown>, maxChars: number): Record<string, unknown> {
  if (JSON.stringify(value).length <= maxChars) return value
  const groups = ['headings', 'inputs', 'links', 'entries', 'frames'] as const
  const output = { ...value, truncated: true } as Record<string, unknown>
  if (typeof output.text === 'string') output.text = output.text.slice(0, Math.floor(maxChars / 4))
  for (const key of groups) if (Array.isArray(value[key])) output[key] = []
  // Interleave groups so navigation links cannot crowd all input controls out.
  for (let index = 0; index < 80; index++) {
    for (const key of groups) {
      const source = value[key]
      const target = output[key]
      if (!Array.isArray(source) || !Array.isArray(target) || index >= source.length) continue
      target.push(source[index])
      if (JSON.stringify(output).length > maxChars) target.pop()
    }
  }
  return output
}

function nativeSnapshot(value: unknown): value is Record<string, unknown> & {elements: unknown[]; frames: unknown[]} {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Array.isArray((value as Record<string, unknown>).elements) && Array.isArray((value as Record<string, unknown>).frames) &&
    typeof (value as Record<string, unknown>).complete === 'boolean'
}

function compactNativeSnapshot(value: Record<string, unknown> & {elements:unknown[];frames:unknown[]}, maxChars: number): Record<string, unknown> {
  if (JSON.stringify(value).length <= maxChars) return value
  const reasons=Array.isArray(value.truncationReasons)?value.truncationReasons.filter(reason=>typeof reason==='string'):[]
  const coverage={complete:value.complete,truncated:value.truncated,truncationReasons:reasons,frameCount:value.frames.length,elementCount:value.elements.length}
  const frames:Record<string,unknown>[]=[],elements:Record<string,unknown>[]=[]
  const modelTruncation={reason:'MODEL_RESULT_BUDGET',omittedElements:value.elements.length,omittedFrames:value.frames.length,fieldsShortened:0}
  const output={complete:false,truncated:true,truncationReasons:[...new Set([...reasons,'MODEL_RESULT_BUDGET'])],sourceCoverage:coverage,modelTruncation,frames,elements}
  const frameKey=(item:Record<string,unknown>)=>`${item.processId}:${item.routingId}`
  const frameMap=new Map(value.frames.filter(item=>item&&typeof item==='object').map(item=>[frameKey(item as Record<string,unknown>),item as Record<string,unknown>]))
  const includedFrames=new Set<string>()
  function compactRecord(raw:Record<string,unknown>, keys:readonly string[], limit=240) {
    const result:Record<string,unknown>={}
    const omitted:string[]=[]
    for(const key of keys){
      const field=raw[key]
      if(field===undefined)continue
      if(typeof field==='string'&&field.length>limit&&key!=='ref'){
        // Input values and locators must never become plausible but false data.
        if(['value','url','href','selector','ref'].includes(key)){omitted.push(key);continue}
        result[key]=`${field.slice(0,limit)}…`;omitted.push(key)
      }else result[key]=field
    }
    if(omitted.length)result.modelFieldsTruncated=omitted
    return result
  }
  function elementRank(raw:Record<string,unknown>) {
    const editable=/^(?:input|textarea|select)$/iu.test(String(raw.tagName))||/textbox|searchbox|combobox/iu.test(String(raw.role))
    if(raw.visible!==false&&raw.focused===true)return 0
    if(raw.visible!==false&&editable)return 1
    if(raw.visible!==false&&(/button|link|checkbox|radio|menuitem/iu.test(String(raw.role))||/^(?:a|button)$/iu.test(String(raw.tagName))))return 2
    return raw.visible!==false?3:editable?4:5
  }
  const candidates=value.elements.filter(item=>item&&typeof item==='object').map(item=>item as Record<string,unknown>).sort((a,b)=>elementRank(a)-elementRank(b))
  let size=JSON.stringify(output).length
  for(const raw of candidates){
    const item=compactRecord(raw,['ref','target','backendNodeId','parentBackendNodeId','tagName','type','role','name','text','value','valueRedacted','labelText','description','placeholder','descriptionText','errorText','invalid','disabled','readOnly','checked','selected','expanded','focused','visible','bounds'])
    if(Array.isArray(raw.options)){
      item.options=raw.options.slice(0,6).filter(option=>option&&typeof option==='object').map(option=>compactRecord(option as Record<string,unknown>,['backendNodeId','label','text','value','selected','disabled'],120))
      if(raw.options.length>6)item.optionsTruncated=true
    }
    const target=raw.target&&typeof raw.target==='object'?raw.target as Record<string,unknown>:null
    const key=target?frameKey(target):'',rawFrame=frameMap.get(key)
    const frame=rawFrame&&!includedFrames.has(key)?compactRecord(rawFrame,['processId','routingId','documentId','url','status','reason'],512):null
    const cost=JSON.stringify(item).length+1+(frame?JSON.stringify(frame).length+1:0)
    if(size+cost>maxChars-64)continue
    elements.push(item);size+=cost
    if(frame){frames.push(frame);includedFrames.add(key)}
    if(item.modelFieldsTruncated||item.optionsTruncated)modelTruncation.fieldsShortened++
  }
  // Keep coverage for unselected/failed frames when space permits, rather than
  // silently suggesting that selected elements represent the entire page.
  for(const [key,raw] of frameMap){
    if(includedFrames.has(key))continue
    const frame=compactRecord(raw,['processId','routingId','documentId','url','status','reason'],512),cost=JSON.stringify(frame).length+1
    if(size+cost>maxChars-64)continue
    frames.push(frame);includedFrames.add(key);size+=cost
  }
  modelTruncation.omittedElements=value.elements.length-elements.length
  modelTruncation.omittedFrames=value.frames.length-frames.length
  return output
}

/**
 * Build a model-facing digest from page text (or return as-is if already short).
 */
export function digestPageTextForModel(
  raw: string,
  opts?: { maxChars?: number; safe?: boolean },
): string {
  const safe = opts?.safe === true
  const maxChars = Math.max(800, opts?.maxChars ?? (safe ? 4500 : 9000))
  const text = String(raw || '').replace(/\r/g, '').trim()
  if (!text) return ''
  if (text.length <= Math.min(2400, maxChars) && !safe) return text

  const headlines = extractPageHeadlines(text, safe ? 22 : 36)
  const cleanedLines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !NAV_NOISE.test(l))
  const excerptBudget = Math.max(600, maxChars - headlines.join('\n').length - 120)
  const excerpt = cleanedLines.join('\n').slice(0, excerptBudget)

  const parts = [
    safe
      ? '【页面安全摘要】以下仅为公开新闻标题与短摘录，请用中文客观概述主题与篇目，勿展开敏感细节。'
      : '【页面摘要】标题优先；正文为节选。',
  ]
  if (headlines.length) {
    parts.push(`标题列表：\n- ${headlines.join('\n- ')}`)
  }
  if (excerpt.trim()) {
    parts.push(`正文节选：\n${excerpt.trim()}`)
  }
  return parts.join('\n\n').slice(0, maxChars)
}

/**
 * Rewrite a browser_get / fetch style tool result for the model.
 * `safe` uses a tighter headline-only digest (retry after content rejection).
 */
export function prepareToolResultForModel(
  result: unknown,
  maxChars: number,
  safe = false,
): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result
  const obj = { ...(result as Record<string, unknown>) }
  const budget = Math.max(1200, Math.floor(maxChars * (safe ? 0.45 : 0.55)))

  if (typeof obj.value === 'string') {
    const s = obj.value
    if (s.length > (safe ? 1200 : 2800) || safe) {
      obj.value = digestPageTextForModel(s, { maxChars: budget, safe })
      obj.digested = true
      if (safe) obj.safe_digest = true
    }
  } else if (obj.value && typeof obj.value === 'object' && !Array.isArray(obj.value)) {
    const v = obj.value as Record<string, unknown>
    if(nativeSnapshot(v)) {
      obj.value=compactNativeSnapshot(v,budget)
      if(obj.value!==v){obj.digested=true;obj.truncated=true;obj.modelTruncated=true}
    } else if ('headings' in v || 'links' in v || 'inputs' in v || 'entries' in v) {
      obj.value = safe ? digestDomSummary(v, budget) : compactStructuredPage(v, budget)
      obj.digested = true
      if (safe) obj.safe_digest = true
    }
  }

  if (typeof obj.body === 'string' && (obj.body.length > 2800 || safe)) {
    obj.body = digestPageTextForModel(obj.body, { maxChars: budget, safe })
    obj.digested = true
  }

  return obj
}

/** Always return valid JSON, even when an unusually large result exceeds its budget. */
export function serializeToolResultForModel(result: unknown, maxChars: number, safe = false): string {
  const blocker=result&&typeof result==='object'&&!Array.isArray(result)?compactPageBlocker((result as Record<string,unknown>).pageBlocker):undefined
  if(blocker){
    const source={...(result as Record<string,unknown>)}
    delete source.pageBlocker
    const reserved=JSON.stringify({pageBlocker:blocker}).length+2
    if(reserved+300<=maxChars){
      const body=JSON.parse(serializeToolResultForModel(source,maxChars-reserved,safe))
      return JSON.stringify({...body,pageBlocker:blocker})
    }
    // Even the native empty-snapshot and generic shrink paths cannot erase a blocker.
    const minimal={version:1,state:blocker.state,kind:blocker.kind,windowId:blocker.windowId,webContentsId:blocker.webContentsId,documentEpoch:blocker.documentEpoch,controlEpoch:blocker.controlEpoch,observationId:blocker.observationId,coverage:blocker.coverage,reasonCodes:blocker.reasonCodes,requiresUser:blocker.requiresUser,blocksInteraction:blocker.blocksInteraction,probeUsed:blocker.probeUsed}
    const retained={ok:source.ok,error:source.error,truncated:true,pageBlocker:minimal,message:'Page blocker metadata retained; request a smaller page scope.'}
    if(JSON.stringify(retained).length<=maxChars)return JSON.stringify(retained)
    return JSON.stringify({ok:source.ok,truncated:true,pageBlocker:{version:1,state:'unknown',coverage:'unavailable',reasonCodes:['MODEL_RESULT_BUDGET'],observationId:blocker.observationId},error:'page_blocker_context_budget'})
  }
  const prepared = prepareToolResultForModel(result, maxChars, safe)
  let serialized = JSON.stringify(prepared) ?? 'null'
  if (serialized.length <= maxChars) return serialized
  if(prepared&&typeof prepared==='object'&&nativeSnapshot((prepared as Record<string,unknown>).value)){
    const original=result as Record<string,unknown>,snapshot=original.value
    if(nativeSnapshot(snapshot)){
      // Do not send native refs/targets through generic recursive shortening.
      // Oversized envelope fields (e.g. capabilities) are optional diagnostics.
      const envelope:Record<string,unknown>={ok:original.ok,native:original.native,partial:original.partial,envelopeTruncated:true,modelTruncated:true}
      for(const key of ['url','title','loading','waitTimedOut']){
        const value=original[key]
        if(typeof value==='string'&&value.length>512)continue
        if(value!==undefined)envelope[key]=value
      }
      let budget=Math.max(0,maxChars-JSON.stringify(envelope).length-20)
      for(let attempt=0;attempt<4;attempt++){
        const value=compactNativeSnapshot(snapshot,budget)
        serialized=JSON.stringify({...envelope,...(value!==snapshot?{truncated:true}:{}),value})
        if(serialized.length<=maxChars)return serialized
        budget=Math.max(0,budget-(serialized.length-maxChars)-64)
      }
      return JSON.stringify({ok:original.ok,truncated:true,modelTruncated:true,value:{complete:false,truncated:true,truncationReasons:['MODEL_RESULT_BUDGET'],elements:[],frames:[]},message:'Request agent_find or a smaller snapshot scope.'})
    }
  }
  const shrink = (value: unknown, limit: number, depth = 0): unknown => {
    if (typeof value === 'string') return value.length > limit ? `${value.slice(0, limit)}…` : value
    if (value === null || typeof value !== 'object') return value
    if (depth > 6) return '[omitted]'
    if (Array.isArray(value)) return value.slice(0, Math.max(1, Math.floor(limit / 100))).map((v) => shrink(v, limit, depth + 1))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      // Never turn an URL or locator into a plausible but incorrect target.
      ['url', 'href', 'selector', 'ref'].includes(key) && typeof item === 'string' && item.length > limit
        ? null : shrink(item, limit, depth + 1),
    ]))
  }
  for (let limit = Math.max(128, Math.floor(maxChars / 4)); limit >= 64; limit = Math.floor(limit / 2)) {
    const reduced = shrink(prepared, limit)
    const object = reduced && typeof reduced === 'object' && !Array.isArray(reduced)
      ? { ...reduced, truncated: true } : { value: reduced, truncated: true }
    serialized = JSON.stringify(object)
    if (serialized.length <= maxChars) return serialized
  }
  const meta = prepared && typeof prepared === 'object' ? prepared as Record<string, unknown> : {}
  return JSON.stringify({ ok: meta.ok, error: meta.error, partial: meta.partial,
    truncated: true, originalChars: (JSON.stringify(prepared) || '').length,
    message: 'Result exceeds context budget; request a smaller scope or search the page index.' })
}

/** Best-effort local summary when the model keeps rejecting the page. */
export function buildLocalPageSummaryFromToolJson(toolContents: string[]): string {
  const headlines: string[] = []
  let title = ''
  let url = ''
  for (const raw of toolContents) {
    let text = raw
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (typeof parsed.url === 'string' && parsed.url) url = parsed.url
      if (typeof parsed.title === 'string' && parsed.title) title = parsed.title
      if (typeof parsed.value === 'string') text = parsed.value
      else if (parsed.value && typeof parsed.value === 'object') {
        text = digestDomSummary(parsed.value as Record<string, unknown>, 6000)
      }
    } catch {
      /* plain text */
    }
    for (const h of extractPageHeadlines(text, 16)) headlines.push(h)
  }
  const uniq = uniqKeepOrder(headlines).slice(0, 12)
  if (!uniq.length && !title && !url) return ''
  const lines = ['页面已成功读取，但当前模型因内容安全策略拒绝深入分析。以下为本地提取的公开标题：', '']
  if (title) lines.push(`页面：${title}`)
  if (url) lines.push(`地址：${url}`)
  if (uniq.length) {
    lines.push('')
    for (const h of uniq) lines.push(`- ${h}`)
  }
  lines.push('', '可更换模型后重试，或指定只要标题列表 / 某一主题摘要。')
  return lines.join('\n')
}
