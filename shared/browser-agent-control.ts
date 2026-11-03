import type {BrowserAutomationState} from './browser-automation'

export type BrowserAgentAction = 'takeControl' | 'resume' | 'pause' | 'retryAutomation' | 'reload'

/** Ownership, current work and native release confirmation are independent. */
export function browserAgentControl(state?: BrowserAutomationState, pending = false) {
  const known = !!state
  const fault = !!state && (!state.nativeConfirmed || state.error === 'release_unconfirmed' || state.error === 'cleanup_unconfirmed')
  const busy = pending || state?.activity === 'handoff' || !!state?.nativePending && (state.owner !== 'ai' || fault)
  const reload = state?.error === 'cleanup_unconfirmed' && state.nativeConfirmed && !state.inputProtected
  const working = !!state?.activeOperations && (state.activity === 'acting' || state.activity === 'waiting')
  const title = !known ? '正在读取控制状态' : busy ? '正在交还控制权' : fault
    ? state?.error === 'cleanup_unconfirmed' ? '输入清理尚未确认' : '控制状态尚未确认'
    : state?.activity === 'error' ? '本次页面操作未完成' : state?.owner === 'user' ? '由你操作'
    : state?.owner === 'paused' ? '浏览器操作已暂停' : working
    ? state.activity === 'waiting' ? '等待网页响应' : 'AI 正在操作' : '已允许 AI 操作，当前空闲'
  const hint = !known ? '状态确认后可以切换，仍可查看此面板。' : busy ? '等待在途输入与清理确认；不会重放旧操作。'
    : fault ? reload ? '输入保护已解除。可主动重新加载页面以恢复；未保存内容可能丢失。' : '重试只解除控制，不会重放输入。'
    : state?.activity === 'error' ? state.error === 'renderer_gone' ? '页面已退出，请重新加载后再允许 AI 操作。' : '请重新观察页面，不自动重放输入。'
    : state?.nativePending ? '正在确认输入保护；仍可接管当前页面。'
    : state?.owner === 'user' ? 'AI 的页面操作已暂停。' : state?.owner === 'paused' ? '恢复后先重新观察页面。'
    : state?.needsObservation ? '下一次操作先重新观察；不会重新启动已结束的任务。' : '左键切换控制权，右键查看状态。'
  const switchAction: BrowserAgentAction | undefined = !known || busy || fault ? undefined : state?.owner === 'ai' ? 'takeControl' : 'resume'
  const recoveryAction: BrowserAgentAction | undefined = !fault || busy ? undefined : reload ? 'reload' : 'retryAutomation'
  return {known,busy,fault,reload,working,title,hint,switchAction,recoveryAction}
}
