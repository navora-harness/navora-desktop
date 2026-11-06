import type {NativePanelContent} from './native-ui'
import type {AnnotationBox} from './browser-annotation-position'
import {ANNOTATION_COMMENT_LIMIT,ANNOTATION_DRAFT_LIMIT} from './browser-annotation-limits'

export const ANNOTATION_EDITOR_ID='annotation-comment'
export const ANNOTATION_EDITOR_FONT={family:'Segoe UI',size:13}
export type AnnotationTextMeasure=(text:string)=>number
/** Use measured font advances, not character count or a hidden HTML editor.
 * Native shaping can differ slightly; a reserved gutter keeps wrapping conservative. */
export function annotationWrappedLines(text:string,width:number,measure:AnnotationTextMeasure,limit=9):number {
  if(width<=0)return limit
  let lines=1,line=''
  const wordSegmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'word'}):undefined
  const graphemes=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):undefined
  const paragraphs=text.replace(/\r\n?/gu,'\n').split('\n')
  for(let paragraphIndex=0;paragraphIndex<paragraphs.length;paragraphIndex++){
    if(paragraphIndex){if(++lines>=limit)return limit;line=''}
    const paragraph=paragraphs[paragraphIndex]!
    const words=wordSegmenter?Array.from(wordSegmenter.segment(paragraph),part=>part.segment):Array.from(paragraph)
    for(const word of words){
      if(measure(line+word)<=width){line+=word;continue}
      if(line){if(++lines>=limit)return limit;line=''}
      if(measure(word)<=width){line=word;continue}
      for(const point of graphemes?Array.from(graphemes.segment(word),part=>part.segment):Array.from(word)){
        if(line&&measure(line+point)>width){if(++lines>=limit)return limit;line=''}
        line+=point
      }
    }
  }
  return lines
}
export function annotationCommentProblem(text:string):string {
  if(text.length>ANNOTATION_DRAFT_LIMIT)return '内容过长，请缩短后继续；当前输入尚未完整保留。'
  return text.length>ANNOTATION_COMMENT_LIMIT?`${text.length} / ${ANNOTATION_COMMENT_LIMIT}，请缩短后确认`:''
}
export function annotationPanelLayout(options:{text:string;bounds:AnnotationBox;measure:AnnotationTextMeasure;lineHeight?:number;status?:string}) {
  const width=Math.max(160,Math.min(420,options.bounds.width-16)),contentWidth=Math.max(136,width-24)
  const lineHeight=Math.max(18,Math.min(28,options.lineHeight||20))
  const statusHeight=options.status?26:0
  const available=Math.max(32,options.bounds.height-16-24-32-8-statusHeight)
  const lines=annotationWrappedLines(options.text,Math.max(24,contentWidth-4-12),options.measure)
  const editorHeight=Math.max(32,Math.min(available,8*lineHeight+12,Math.max(2,lines)*lineHeight+12))
  return {width,contentWidth,editorHeight,height:editorHeight+24+32+8+statusHeight,lines,lineHeight}
}
export function browserAnnotationPanel(options:{text:string;layout:ReturnType<typeof annotationPanelLayout>;includeValue?:boolean;saved?:boolean;busy?:boolean;pending?:boolean;error?:string;stale?:boolean;overflow?:boolean}) {
  const problem=annotationCommentProblem(options.text),status=options.error||problem||(options.stale?'页面已变化，意见仍关联原位置。':'')
  const compact=options.layout.contentWidth<250
  const children:NativePanelContent[]=[{
    id:ANNOTATION_EDITOR_ID,type:'textarea',height:options.layout.editorHeight,width:options.layout.contentWidth,
    placeholder:'添加评论…',accessibleName:'添加评论',...(status?{accessibleDescription:status}:{}),invalid:!!options.error||!!problem||!!options.overflow,submitOnEnter:true,maxLength:0,scrollbarPlacement:'gutter',disabled:!!options.busy,
    style:{borderless:true,paddingTop:6,paddingBottom:6,paddingLeft:2,paddingRight:2},
    ...(options.includeValue?{value:options.text}:{}),
  }]
  if(status)children.push({id:'annotation-status',type:'text',text:status.slice(0,4096),singleLine:true,muted:!options.error&&!problem,fontSize:12,tooltip:status.slice(0,4096)})
  children.push({id:'annotation-actions',type:'row',gap:8,height:32,children:[
    ...(!compact&&options.error?[{id:'annotation-recover',type:'button' as const,text:'查看草稿',variant:'plain' as const,disabled:!!options.busy||!!options.overflow}]:!compact&&!options.saved?[{id:'annotation-discard',type:'button' as const,text:'放弃',variant:'plain' as const,disabled:!!options.busy}]:[]),
    {id:'annotation-spacer',type:'text',text:'',flex:1},
    {id:'annotation-keep',type:'button',text:'收起',variant:'plain',disabled:!!options.busy||!!options.overflow},
    compact&&options.error?{id:'annotation-recover',type:'button',text:'查看草稿',variant:'plain',disabled:!!options.busy||!!options.overflow}:{id:'annotation-save',type:'button',text:options.busy?'保存中…':'确认',variant:'default',disabled:!!options.busy||!!options.overflow||!!options.error||!!problem||!options.text.trim()},
  ]})
  return {id:'annotation-editor-root',type:'column' as const,width:options.layout.width,gap:8,children}
}
