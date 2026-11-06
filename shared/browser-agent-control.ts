import type {BrowserAutomationState} from './browser-automation'

export type BrowserAgentAction = 'takeControl' | 'resume' | 'pause' | 'retryAutomation' | 'reload'

/** Ownership, current work and native release confirmation are independent. */
export function browserAgentControl(state?: BrowserAutomationState, pending: boolean | BrowserAgentAction = false) {
  const known = !!state
  const blocked=state?.pageBlocker?.state==='confirmed'&&state.pageBlocker.requiresUser
  const overdue = !!state?.controlWait?.overdue
  const fault = !!state && (overdue || !state.nativeConfirmed || state.error === 'release_unconfirmed' || state.error === 'cleanup_unconfirmed')
  const busy = !!pending || state?.activity === 'handoff' || !!state?.nativePending && (state.owner !== 'ai' || fault)
  const spinning = (!!busy || !!state?.nativePending) && !overdue
  const phase = state?.controlWait?.stage
  const stageLabel = phase ? ({queued:'等待前序控制请求',operation:'等待当前页面操作', 'submitted-input':'等待已提交输入',cleanup:'等待按键与指针清理',navigation:'等待在途页面导航',native:'等待原生输入保护确认'} as const)[phase] : '等待在途输入与清理确认'
  const pendingTitle = pending==='resume'?(blocked?'正在重新检查页面':'正在允许 AI 操作'):pending==='reload'?'正在重新加载页面':pending==='retryAutomation'?'正在重试控制确认':pending==='pause'?'正在暂停页面操作':state?.activity==='handoff' || pending==='takeControl'?'正在交还控制权':'正在确认输入保护'
  const reload = state?.error === 'cleanup_unconfirmed' && state.nativeConfirmed && !state.inputProtected
  const working = !!state?.activeOperations && (state.activity === 'acting' || state.activity === 'waiting')
  const leased = !!state?.leaseRunId
  const baseTitle = !known ? '正在读取控制状态' : overdue ? '控制切换尚未确认' : busy ? pendingTitle : fault
    ? state?.error === 'cleanup_unconfirmed' ? '输入清理尚未确认' : '控制状态尚未确认'
    : state?.nativePending ? '正在确认输入保护' : state?.activity === 'error' ? '本次页面操作未完成' : state?.owner === 'user' ? '由你操作'
    : state?.owner === 'paused' ? 'AI 操作已暂停' : working
    ? state.activity === 'waiting' ? '等待网页响应' : 'AI 正在操作' : leased ? 'AI 等待中' : 'AI 待命'
  const baseHint = !known ? '状态确认后可以切换，仍可查看此面板。' : overdue ? `${stageLabel}已超过 ${Math.floor((state?.controlWait?.elapsedMs||0)/1000)} 秒，当前控制状态保持不变。仍在等待实际确认，不会重放旧操作。` : busy ? `${stageLabel}；不会重放旧操作。`
    : fault ? reload ? '输入保护已解除。可主动重新加载页面以恢复；未保存内容可能丢失。' : '重试只解除控制，不会重放输入。'
    : state?.activity === 'error' ? state.error === 'renderer_gone' ? '页面已退出，请重新加载后再允许 AI 操作。' : state.error === 'automation_rendering_unavailable' ? '页面的后台渲染尚未确认，当前操作未启动。请检查页面后重试。' : '请重新观察页面，不自动重放输入。'
    : state?.nativePending ? '正在确认输入保护；仍可接管当前页面。'
    : state?.owner === 'user' ? '可直接操作网页；允许 AI 后只接受新操作。' : state?.owner === 'paused' ? '允许 AI 后先重新观察页面，不重启已结束的任务。'
    : leased && state.isolateInput && state.keepRendering && state.inputProtected ? '后台隔离已生效，等待期间保持；你可随时接管。'
    : leased ? '正在持有页面，请以输入保护的实际状态为准。'
    : state?.needsObservation ? '开始操作时自动隔离输入，并先重新观察页面。' : '开始操作时自动隔离输入，空闲时不占用网页。'
  const title=blocked&&!busy&&!fault?'网页需要本人处理':baseTitle
  const hint=blocked&&!busy&&!fault?'请接管网页完成登录或验证；完成后选择“我已完成，重新检查”。不会自动重放已经结束的任务。':baseHint
  const switchAction: BrowserAgentAction | undefined = !known || busy || fault ? undefined : state?.owner === 'ai' ? 'takeControl' : 'resume'
  const recoveryAction: BrowserAgentAction | undefined = !fault || busy ? undefined : reload ? 'reload' : 'retryAutomation'
  const primaryLabel = busy ? '正在确认…' : fault ? reload ? '重新加载页面' : '重试解除控制' : !known ? '正在读取状态…' : blocked ? state.owner==='ai'?'我来处理':'我已完成，重新检查' : state.owner === 'ai' ? '我来操作' : '允许 AI 操作'
  const protectionText = state?.nativePending ? '正在确认' : !known || !state.nativeConfirmed ? '尚未确认' : state.inputProtected ? '已生效' : leased ? '未生效' : '已解除'
  const cursorText = state?.cursorAvailable === false ? '当前不可用' : state?.cursorImageAvailable === false ? '图像不可用' : !known || !state.nativeConfirmed ? '尚未确认' : state.cursorEnabled ? '已启用，显示待核验' : leased && state.cursorRequested && !state.cursorPositionValid ? '等待首次有效指针输入' : '已隐藏'
  const showNativeStatus = known && (leased || !!state.inputProtected || !!state.cursorEnabled || !!state.nativePending || fault)
  const status = !known || busy || state.nativePending ? 'pending' : fault || state.activity === 'error' ? 'fault' : state.owner === 'user' ? 'manual' : state.owner === 'paused' ? 'paused' : leased || working ? 'active' : 'idle'
  return {known,blocked,busy,spinning,overdue,fault,reload,working,title,hint,switchAction,recoveryAction,primaryLabel,protectionText,cursorText,showNativeStatus,status}
}
