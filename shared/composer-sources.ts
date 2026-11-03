import type {ComposerContextSource,ComposerContextBlock} from './composer-document'
export type ComposerImportFile={name:string;mime:string;base64:string}
export type ComposerImportedFile={path:string;name:string;mime:string;size:number;sourceVersion:string;source:ComposerContextSource;thumbnail?:{mime:string;base64:string}}
export type ComposerExcerptInput={
  kind:'file'|'page'|'annotation';path?:string;pageId?:string;annotationId?:string
  range?:ComposerContextBlock['range'];selection?:boolean;capture?:boolean
  rect?:{x:number;y:number;width:number;height:number}
}
export type ComposerExcerpt={
  kind:ComposerExcerptInput['kind'];label:string;text:string;source:ComposerContextSource;sourceVersion:string
  range?:ComposerContextBlock['range'];truncated:boolean;referenceOnly?:boolean;reason?:string
  thumbnail?:{mime:string;base64:string};file?:ComposerImportedFile
}
export type ComposerSourcesApi={
  importContextFiles:(chatId:string,inputs:ComposerImportFile[])=>Promise<ComposerImportedFile[]>
  contextExcerpt:(chatId:string,input:ComposerExcerptInput)=>Promise<ComposerExcerpt>
}
