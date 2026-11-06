export type AppQuitRequest={source:'tray';error?:string}
export type AppQuitState={runningAgents:number}
export type AppQuitResult={ok:boolean;reason?:'running_agents_changed'|'local_only';runningAgents?:number}
