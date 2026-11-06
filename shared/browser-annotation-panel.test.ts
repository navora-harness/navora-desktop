import assert from 'node:assert/strict'
import test from 'node:test'
import {ANNOTATION_EDITOR_ID,annotationCommentProblem,annotationPanelLayout,annotationWrappedLines,browserAnnotationPanel} from './browser-annotation-panel'
import {ANNOTATION_DRAFT_LIMIT} from './browser-annotation-limits'
import {nativePanelNodes} from './native-ui-validation'
const measure=(text:string)=>Array.from(text).reduce((width,point)=>width+(point==='W'?12:point==='i'?3:point.codePointAt(0)!>127?13:7),0)
const bounds={x:0,y:0,width:800,height:500}
const layout=(text:string,height=500)=>annotationPanelLayout({text,bounds:{...bounds,height},measure})
test('annotation wrapping uses measured glyph widths, explicit newlines and grapheme-safe soft wraps',()=>{
  assert.equal(annotationWrappedLines('WWW',12,measure),3)
  assert.equal(annotationWrappedLines('iii',12,measure),1)
  assert.equal(annotationWrappedLines('中\n文\r\n三',100,measure),3)
  assert.equal(annotationWrappedLines('a\n',100,measure),2)
  const measured:string[]=[]
  annotationWrappedLines('👩‍💻😀 e\u0301'.repeat(3),24,text=>{measured.push(text);return [...text].length*8})
  assert.ok(measured.every(text=>[...text].every(point=>point.length===2||!/[\uD800-\uDFFF]/u.test(point))))
})
test('measured multiline input grows, shrinks and caps while leaving footer space',()=>{
  const short=layout(''),wrapped=layout('中'.repeat(100)),long=layout('中'.repeat(1000)),low=layout('中'.repeat(1000),180)
  assert.ok(wrapped.editorHeight>short.editorHeight)
  assert.equal(long.editorHeight,8*long.lineHeight+12)
  assert.ok(low.height<=164)
  assert.equal(layout('a').editorHeight,short.editorHeight)
})
test('native editor uses stable multiline control, no hard truncation and value only for initialization',()=>{
  const text='原文\n😀',initial=browserAnnotationPanel({text,layout:layout(text),includeValue:true}),refresh=browserAnnotationPanel({text,layout:layout(text)})
  const first=nativePanelNodes(initial).get(ANNOTATION_EDITOR_ID)!,next=nativePanelNodes(refresh).get(ANNOTATION_EDITOR_ID)!
  assert.equal(initial.width,layout(text).width,'native root width includes the panel content inset')
  assert.equal(first.width,initial.width!-24,'Canvas and native textarea share the same inner width')
  assert.equal(first.type,'textarea');assert.equal(first.value,text);assert.equal(first.submitOnEnter,true);assert.equal(first.maxLength,0)
  assert.equal(Object.hasOwn(next,'value'),false)
  assert.equal(next.scrollbarPlacement,'gutter')
  assert.ok(nativePanelNodes(refresh).get('annotation-save'))
  assert.equal(Object.hasOwn(first,'children'),false)
})
test('over-limit draft remains complete and editable, confirms are blocked instead of truncating emoji',()=>{
  const text='a'.repeat(3999)+'😀',tree=browserAnnotationPanel({text,layout:layout(text),includeValue:true})
  const nodes=nativePanelNodes(tree)
  assert.equal(nodes.get(ANNOTATION_EDITOR_ID)?.value,text)
  assert.equal(nodes.get(ANNOTATION_EDITOR_ID)?.disabled,false)
  assert.equal(nodes.get(ANNOTATION_EDITOR_ID)?.invalid,true)
  assert.match(nodes.get(ANNOTATION_EDITOR_ID)?.accessibleDescription||'',/4000/)
  assert.equal(nodes.get(ANNOTATION_EDITOR_ID)?.contextMenu,undefined,'The native editor keeps its editing context menu')
  assert.equal(nodes.get('annotation-save')?.disabled,true)
  assert.match(annotationCommentProblem(text),/4000/)
  assert.equal(annotationCommentProblem('a'.repeat(ANNOTATION_DRAFT_LIMIT+1)).includes('未完整保留'),true)
  const pending=nativePanelNodes(browserAnnotationPanel({text:'有效批注',layout:layout('有效批注'),pending:true}))
  assert.equal(pending.get('annotation-save')?.disabled,false,'parent save drains the ordered draft chain')
  assert.equal(pending.has('annotation-status'),false,'routine draft writes do not add a jumping status row')
})
test('overflow prevents save/keep claims; busy blocks actions and compact errors retain a recovery control',()=>{
  const overflow=nativePanelNodes(browserAnnotationPanel({text:'old',layout:layout('old'),overflow:true,error:'当前输入尚未完整保留'}))
  for(const id of ['annotation-save','annotation-keep','annotation-recover'])assert.equal(overflow.get(id)?.disabled,true)
  const small=annotationPanelLayout({text:'draft',bounds:{...bounds,width:240},measure,status:'write failed'})
  const compact=nativePanelNodes(browserAnnotationPanel({text:'draft',layout:small,error:'写入失败'}))
  assert.ok(compact.get('annotation-recover'));assert.ok(compact.get('annotation-keep'))
})
