/** A renderer registers only its currently owned, searchable view. */
export type WindowFindScope='chat'|'workspace'
export type WindowFindKind='chat'|'browser'|'file'|'subchat'
export type WindowFindOptions={caseSensitive:boolean;includeTools:boolean}
export type WindowFindState={status:'idle'|'searching'|'ready'|'unsupported'|'blocked'|'error';total:number;ordinal:number;truncated?:boolean;notice?:string}
export type WindowFindTarget={key:string;scope:WindowFindScope;kind:WindowFindKind;label:string;sourcePageId?:string;supportsCaseSensitive?:boolean;supportsTools?:boolean}
export type WindowFindAdapter={
  /** Return null when this view is not the active target of its scope. */
  target:()=>WindowFindTarget|null
  state:()=>WindowFindState
  setQuery:(query:string,options:WindowFindOptions)=>void|Promise<void>
  step:(direction:1|-1)=>void|Promise<void>
  stop:()=>void|Promise<void>
}
