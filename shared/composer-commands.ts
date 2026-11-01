export type ComposerToken = {start:number;end:number;kind:'all'|'file'|'session'|'window';query:string}
/** Only the token immediately before the caret is actionable; URLs and code stay plain text. */
export function composerToken(text:string,caret:number):ComposerToken|null {
  const before=text.slice(0,caret)
  const match=/(?:^|\s)([/@])([^\s/@]*)(?:[ \t]+([^\n]*))?$/.exec(before)
  if(!match)return null
  const names:Record<string,ComposerToken['kind']>={文件:'file',file:'file',会话:'session',session:'session',浏览器:'window',browser:'window',窗口:'window'}
  const name=match[2]!.toLowerCase(),kind=names[name]
  if(match[3]!==undefined&&!kind)return null
  return {start:match.index+match[0].indexOf(match[1]!),end:caret,kind:kind||'all',query:kind?(match[3]||''):match[2]!}
}
export function reasoningLabel(level:string):string {
  return ({off:'关闭',low:'轻度',medium:'标准',high:'深入',xhigh:'最高'} as Record<string,string>)[level]||level
}
