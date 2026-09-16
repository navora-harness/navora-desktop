import { AGENT_TOOLS, PLUGIN_DEV_TOOL_NAMES, buildSystemPrompt } from '../../shared/agent-tools'
import type { AppConfig } from '../../shared/config'
import { resolveForkDecision, resolvePluginDevMode, resolveSubchat } from '../../shared/config'
import { buildPluginDevPromptAppendix } from '../../shared/plugin-dev-mode'
import type {
  AgentAskContextEvidence,
  AgentAskOption,
  AgentAskRequest,
  AgentAskResponse,
  AgentEvent,
  AgentPhase,
  BrowserContextRef,
  ChatChangedEvent,
  ChatMessage,
  SkillReviewRequest,
  SkillReviewResponse,
  SubChatSpawnStatus,
} from '../../shared/types'
import {
  collectReadPageSources,
  stripTrailingSourcesSection,
  type AnswerSource,
} from '../../shared/answer-sources'
import { extractHttpUrls } from '../../shared/url-text'
import {
  logAgentError,
  logAgentStopped,
  logContinueRounds,
  logRoundLimit,
  logToolArgsRetry,
  logUserChoice,
  logWindowClosed,
  logBrowserDownloadIntercepted,
  makeRunLog,
  type RunLogEntry,
} from '../../shared/run-logs'
import type { ChatMessageParam, ToolCall } from '../../shared/openai-types'
import { resolveProvider, resolveModelName } from '../../shared/model-providers'
import {
  buildArtifactFollowups,
  buildStoreFollowups,
  collectStoreRecommendations,
  collectWorkspaceArtifacts,
  mergeFollowups,
  parseFollowupSuggestions,
  type FollowupSuggestion,
} from '../../shared/followups'
import type { ChatStore } from './chat-store'
import type { BrowserRegistry } from './browser-registry'
import type { BrowserNetworkManager } from './browser-network'
import type { PermissionGate } from './permission-gate'
import type { SecretsStore } from './secrets'
import type { PluginStore } from './plugin-store'
import type { MarketplaceClient } from './marketplace-client'
import type { SkillStore } from './skill-store'
import type { WorkspaceFiles } from './workspace-files'
import type { FileDownloadService } from './file-download'
import type { WorkspaceShell } from './workspace-shell'
import { executeAgentTool } from './browser-tools'
import { OpenAICompatibleClient, resolveLlmTimeoutMs } from './llm/openai-compatible'

export type { AgentEvent }

export type AskUserFn = (req: Omit<AgentAskRequest, 'id' | 'timeoutMs'> & {
  timeoutMs?: number
}) => Promise<AgentAskResponse>

/**
 * Parse optional per-ask timeout from tool args.
 * Settings `ask_timeout_ms === 0` (不限时) always wins.
 * `undefined` → Settings default. `0` → wait forever. Positive values clamped to 5s–10min.
 */
function resolveAgentAskTimeoutMs(
  args: Record<string, unknown>,
  settingsMs: number,
): number {
  if (!(settingsMs > 0)) return 0
  const raw =
    args.timeoutMs ??
    args.timeout_ms ??
    args.waitMs ??
    args.wait_ms ??
    (args.timeoutSec != null || args.timeout_sec != null
      ? Number(args.timeoutSec ?? args.timeout_sec) * 1000
      : undefined)
  if (raw === undefined || raw === null || raw === '') return settingsMs
  const n = Number(raw)
  if (!Number.isFinite(n)) return settingsMs
  if (n <= 0) return 0
  return Math.min(600_000, Math.max(5_000, Math.floor(n)))
}

/** Upstream / local servers sometimes 500 when the model emits broken tool-call JSON. */
function isRecoverableToolArgsLlmError(message: string): boolean {
  const msg = String(message || '')
  if (/Failed to parse tool call arguments as JSON/i.test(msg)) return true
  if (/parse tool call arguments/i.test(msg)) return true
  if (/invalid_tool_arguments/i.test(msg)) return true
  if (/llm_http_5\d\d/i.test(msg) && /tool call argument/i.test(msg)) return true
  if (/json\.exception\.parse_error/i.test(msg) && /tool/i.test(msg)) return true
  if (/missing closing quote/i.test(msg) && (/BEGIN .+ KEY/i.test(msg) || /tool/i.test(msg))) {
    return true
  }
  return false
}

function summarizeToolArgsLlmError(message: string): string {
  let msg = String(message || '').trim()
  msg = msg.replace(/^llm_http_\d+:/i, '').trim()
  try {
    const j = JSON.parse(msg)
    const nested = j?.error?.message || j?.message
    if (typeof nested === 'string' && nested.trim()) msg = nested.trim()
  } catch {
    /* keep raw */
  }
  if (msg.length > 280) msg = `${msg.slice(0, 279)}…`
  return msg
}

function parseToolCallArguments(raw: string | undefined): {
  ok: true
  args: Record<string, unknown>
} | {
  ok: false
  error: string
  detail: string
} {
  if (raw == null || !String(raw).trim()) return { ok: true, args: {} }
  try {
    const v = JSON.parse(String(raw))
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      return {
        ok: false,
        error: 'invalid_tool_arguments',
        detail: 'function.arguments must be a JSON object',
      }
    }
    return { ok: true, args: v as Record<string, unknown> }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      error: 'invalid_tool_arguments_json',
      detail:
        `${detail}. Use a single-line JSON object; escape newlines in PEM/keys as \\n, ` +
        `or call crypto_generate_key first and reuse returned fields.`,
    }
  }
}

type RunOpts = {
  chatId: string
  userText: string
  refs?: BrowserContextRef[]
}

export type AskSkillReviewFn = (
  req: Omit<SkillReviewRequest, 'id' | 'timeoutMs' | 'wait' | 'canDefer' | 'proposalId'> & {
    timeoutMs?: number
    wait?: boolean
    canDefer?: boolean
    proposalId?: string
  },
) => Promise<SkillReviewResponse>

type DownloadProgressUi = {
  chatId: string
  toolName: string
  toolCallId: string
  args: Record<string, unknown>
  startMsgId?: string
  sizeLabel: string
  partLabel: string
  progressMeta: {
    dest: string
    bytesTotal: number
    bytesPart: number
    contentLength?: number
    partIndex: number
    partsTotal: number
    percent?: number
    indeterminate: boolean
  }
}

const downloadProgressEmitAt = new Map<string, number>()
const downloadProgressPending = new Map<string, DownloadProgressUi>()
const downloadProgressTimers = new Map<string, ReturnType<typeof setTimeout>>()

export class AgentRuntime {
  private runs = new Map<string, AbortController>()
  private getConfig: () => AppConfig
  private updateConfig: (patch: Record<string, unknown>) => AppConfig | Promise<AppConfig>
  private chats: ChatStore
  private registry: BrowserRegistry
  private network: BrowserNetworkManager
  private files: WorkspaceFiles
  private downloads: FileDownloadService
  private shell: WorkspaceShell
  private gate: PermissionGate
  private secrets: SecretsStore
  private skills: SkillStore
  private plugins: PluginStore
  private store: MarketplaceClient
  private emit: (ev: AgentEvent) => void
  private onChatChanged?: (ev: ChatChangedEvent) => void
  private askUser: AskUserFn
  private askSkillReview: AskSkillReviewFn
  private pendingEvents = new Map<string, string[]>()
  /** chatId -> fingerprint -> remembered answer for similar fork asks */
  private forkMemory = new Map<string, Map<string, string>>()
  /** Active hierarchical fork answers for the current agent run */
  private forkChains = new Map<
    string,
    Array<{ forkGroup: string; step?: number; question: string; answer: string }>
  >()
  /** Waiters for async sub-chat completion (parent await / status). */
  private subchatWaiters = new Map<
    string,
    Array<(info: { status: SubChatSpawnStatus; summary: string }) => void>
  >()
  /** Serialize spawn checks per parent so parallel tool calls cannot oversubscribe. */
  private subchatSpawnTails = new Map<string, Promise<unknown>>()

  constructor(deps: {
    getConfig: () => AppConfig
    updateConfig: (patch: Record<string, unknown>) => AppConfig | Promise<AppConfig>
    chats: ChatStore
    registry: BrowserRegistry
    network: BrowserNetworkManager
    files: WorkspaceFiles
    downloads: FileDownloadService
    shell: WorkspaceShell
    gate: PermissionGate
    secrets: SecretsStore
    skills: SkillStore
    plugins: PluginStore
    store: MarketplaceClient
    emit: (ev: AgentEvent) => void
    onChatChanged?: (ev: ChatChangedEvent) => void
    askUser: AskUserFn
    askSkillReview: AskSkillReviewFn
  }) {
    this.getConfig = deps.getConfig
    this.updateConfig = deps.updateConfig
    this.chats = deps.chats
    this.registry = deps.registry
    this.network = deps.network
    this.files = deps.files
    this.downloads = deps.downloads
    this.shell = deps.shell
    this.gate = deps.gate
    this.secrets = deps.secrets
    this.skills = deps.skills
    this.plugins = deps.plugins
    this.store = deps.store
    this.emit = deps.emit
    this.onChatChanged = deps.onChatChanged
    this.askUser = deps.askUser
    this.askSkillReview = deps.askSkillReview
  }

  private parentIdOf(chatId: string): string | undefined {
    const c = this.chats.get(chatId)
    return c?.kind === 'sub' ? c.parentChatId : undefined
  }

  private notifyChatChanged(chatId: string): void {
    this.onChatChanged?.({ type: 'upsert', chatId })
  }

  isRunning(chatId: string): boolean {
    const ctrl = this.runs.get(chatId)
    return Boolean(ctrl && !ctrl.signal.aborted)
  }

  runningChatIds(): string[] {
    return [...this.runs.keys()]
  }

  /** Root (non-sub) chats currently running — used for max_parallel_agent_chats. */
  runningRootChatIds(): string[] {
    return this.runningChatIds().filter((id) => this.chats.get(id)?.kind !== 'sub')
  }

  private setPhase(chatId: string, phase: AgentPhase, detail?: string, toolName?: string) {
    this.emit({
      type: 'phase',
      chatId,
      phase,
      detail,
      toolName,
      parentChatId: this.parentIdOf(chatId),
    })
  }

  private emitReasoning(
    chatId: string,
    content: string,
    status: 'live' | 'done' | 'clear',
    round?: number,
  ) {
    this.emit({
      type: 'reasoning',
      chatId,
      content,
      status,
      round,
      parentChatId: this.parentIdOf(chatId),
    })
  }

  private emitDownloadProgressUi(info: DownloadProgressUi): void {
    downloadProgressEmitAt.set(info.chatId, Date.now())
    this.setPhase(
      info.chatId,
      'calling_tool',
      `下载中 ${info.progressMeta.dest} · ${info.sizeLabel}${info.partLabel}`,
      info.toolName,
    )
    if (!info.startMsgId) return
    const updated = this.chats.updateMessage(
      info.chatId,
      info.startMsgId,
      {
        content: `下载中… ${info.sizeLabel}${info.partLabel}`,
        meta: {
          toolName: info.toolName,
          toolCallId: info.toolCallId,
          args: info.args,
          status: 'running',
          downloadProgress: info.progressMeta,
        },
      },
      { persist: false },
    )
    if (!updated) return
    this.emit({
      type: 'message_update',
      chatId: info.chatId,
      message: {
        ...updated,
        meta: {
          ...updated.meta,
          downloadProgress: { ...info.progressMeta },
        },
      },
    })
  }

  pushUserOpLog(chatId: string, entry: string | RunLogEntry): void {
    const log = typeof entry === 'string' ? makeRunLog(entry) : entry
    if (this.runs.has(chatId)) {
      const list = this.pendingEvents.get(chatId) || []
      list.push(log.content)
      this.pendingEvents.set(chatId, list)
      this.setPhase(chatId, 'observing', log.summary)
    }
    const msg = this.chats.appendMessage(chatId, {
      role: 'log',
      content: log.content,
      meta: {
        kind: 'user_op',
        summary: log.summary,
        ...(log.detail ? { detail: log.detail } : {}),
      },
    })
    if (msg) this.emit({ type: 'message', chatId, message: msg })
  }

  /**
   * Browser download was blocked: notify chat/Agent, then ask 确认/拒绝 only.
   * Timeout / deny / 拒绝 → reject.
   */
  async promptDownloadConfirm(info: {
    chatId: string
    url: string
    filename: string
    relPath: string
    totalBytes?: number
  }): Promise<'confirm' | 'reject'> {
    this.pushUserOpLog(
      info.chatId,
      logBrowserDownloadIntercepted(info.filename, info.url, info.relPath),
    )

    const fork = resolveForkDecision(this.getConfig())
    const sizeLabel =
      typeof info.totalBytes === 'number' && info.totalBytes > 0
        ? formatDownloadBytes(info.totalBytes)
        : undefined
    // Agent 运行中才套用询问超时；用户自己点下载链接时不限时等待。
    const timeoutMs = this.isRunning(info.chatId) ? fork.ask_timeout_ms : 0
    this.setPhase(info.chatId, 'awaiting_user', `确认下载：${info.filename}`)

    const res = await this.askUser({
      chatId: info.chatId,
      kind: 'download_confirm',
      question: '检测到浏览器触发的被动下载（已拦截系统另存为）。是否保存到当前对话工作区？',
      options: ['确认', '拒绝'],
      optionItems: [
        { label: '确认', hint: '保存到 downloads/', recommended: true },
        { label: '拒绝', hint: '取消本次下载' },
      ],
      allowCustom: false,
      timeoutMs,
      meta: {
        forkTitle: '被动文件下载',
        downloadFilename: info.filename,
        downloadRelPath: info.relPath,
        downloadUrl: info.url,
        ...(sizeLabel ? { downloadSizeLabel: sizeLabel } : {}),
      },
      evidence: { url: info.url, title: info.filename },
    })

    if (res.source === 'option' && res.answer.trim() === '确认') return 'confirm'
    // timeout / deny / aborted / 拒绝 → reject
    return 'reject'
  }

  notifyWindowClosed(chatId: string, windowId: string): void {
    this.pushUserOpLog(chatId, logWindowClosed(windowId))
  }

  stop(chatId: string): boolean {
    // Stopping a parent also stops its running children.
    for (const child of this.chats.listChildren(chatId)) {
      if (this.runs.has(child.id)) this.stop(child.id)
    }
    const ctrl = this.runs.get(chatId)
    if (!ctrl) return false
    ctrl.abort()
    // Immediate UI feedback; run() finally still cleans up when awaited ops race-abort.
    this.setPhase(chatId, 'idle', '正在停止…')
    this.emit({
      type: 'status',
      chatId,
      running: false,
      parentChatId: this.parentIdOf(chatId),
    })
    return true
  }

  /** Drop per-chat fork memory when a Chat is deleted. */
  clearChatState(chatId: string): void {
    this.forkMemory.delete(chatId)
    this.forkChains.delete(chatId)
    this.pendingEvents.delete(chatId)
    this.subchatWaiters.delete(chatId)
  }

  /**
   * Resume after a process restart: user answered (or denied) a persisted 询问/决策.
   * Deny only clears persistence / finishes the tool card. A choice starts a new run from history.
   */
  async continueAfterPersistedAsk(
    chatId: string,
    req: AgentAskRequest,
    res: AgentAskResponse,
  ): Promise<void> {
    this.chats.setPendingAsk(chatId, null)
    if (this.runs.has(chatId)) return

    const denied = res.source === 'deny' || !String(res.answer || '').trim()
    const chat = this.chats.get(chatId)
    const toolMsg = [...(chat?.messages || [])].reverse().find(
      (m) =>
        m.role === 'tool' &&
        m.meta?.status === 'running' &&
        m.meta?.toolName === 'agent_ask_user',
    )
    const result = denied
      ? { ok: false, error: 'user_denied' }
      : {
          ok: true,
          answer: String(res.answer || '').trim(),
          source: res.source === 'custom' ? 'custom' : 'option',
        }
    if (toolMsg) {
      const updated = this.chats.updateMessage(chatId, toolMsg.id, {
        content: truncateJson(result, 4000),
        meta: {
          ...toolMsg.meta,
          status: denied ? 'error' : 'done',
          result,
        },
      })
      if (updated) this.emit({ type: 'message_update', chatId, message: updated })
    }

    if (denied) return

    const answer = String(res.answer || '').trim()
    const entry = logUserChoice(answer)
    const log = this.chats.appendMessage(chatId, {
      role: 'log',
      content: `${entry.content}\n请按该选择继续任务，不要重复同一询问/决策。`,
      meta: {
        kind: 'user_choice',
        source: res.source,
        summary: entry.summary,
        ...(entry.detail ? { detail: entry.detail } : {}),
        ...(req.meta?.step != null ? { step: req.meta.step } : {}),
        ...(req.meta?.forkGroup ? { forkGroup: req.meta.forkGroup } : {}),
      },
    })
    if (log) this.emit({ type: 'message', chatId, message: log })
    this.chats.flushChat(chatId)
    await this.run({ chatId, userText: '' })
  }

  stopAll(): void {
    for (const id of [...this.runs.keys()]) this.stop(id)
    for (const t of downloadProgressTimers.values()) clearTimeout(t)
    downloadProgressTimers.clear()
    downloadProgressPending.clear()
    downloadProgressEmitAt.clear()
  }

  /** Fail before the run loop starts (missing provider / API key, etc.). */
  private emitRunFailure(chatId: string, msg: string): void {
    const entry = logAgentError(msg)
    const m = this.chats.appendMessage(chatId, {
      role: 'log',
      content: entry.content,
      meta: {
        kind: 'agent_error',
        summary: entry.summary,
        ...(entry.detail ? { detail: entry.detail } : {}),
      },
    })
    if (m) this.emit({ type: 'message', chatId, message: m })
    this.emit({ type: 'error', chatId, error: msg, parentChatId: this.parentIdOf(chatId) })
    this.emit({ type: 'status', chatId, running: false, parentChatId: this.parentIdOf(chatId) })
    this.emit({ type: 'done', chatId, followups: [], parentChatId: this.parentIdOf(chatId) })
    if (this.chats.get(chatId)?.kind === 'sub') {
      this.finalizeSubchat(chatId, 'failed')
    }
  }

  async run(opts: RunOpts): Promise<void> {
    const { chatId } = opts
    if (this.runs.has(chatId)) {
      throw new Error('agent_already_running')
    }

    const cfg = this.getConfig()
    const fork = resolveForkDecision(cfg)
    const chat = this.chats.get(chatId)
    // Sub-chats use Settings → subchat.max_parallel (per parent). Root chats use
    // max_parallel_agent_chats and only count other root runs — otherwise parent+3
    // children would fill a default of 4 and the 4th child (or another root) fails.
    if (chat?.kind !== 'sub') {
      const runningRoots = [...this.runs.keys()].filter((id) => {
        const c = this.chats.get(id)
        return c?.kind !== 'sub'
      }).length
      if (runningRoots >= (cfg.browser.max_parallel_agent_chats || 4)) {
        throw new Error('max_parallel_agent_chats')
      }
    }

    const provider = resolveProvider(
      cfg.ai.providers,
      cfg.ai.default_provider,
      chat?.providerId,
    )
    if (!provider || provider.type !== 'openai_compatible') {
      this.emitRunFailure(chatId, 'provider_not_configured:请先在设置中配置模型服务商')
      return
    }
    const modelName = resolveModelName(provider, chat?.model)
    const apiKey = this.secrets.get(provider.api_key_ref || '') || ''

    const ctrl = new AbortController()
    this.runs.set(chatId, ctrl)
    this.forkChains.set(chatId, [])
    const runStartedAt = Date.now()
    this.emit({
      type: 'status',
      chatId,
      running: true,
      parentChatId: this.parentIdOf(chatId),
    })
    this.setPhase(chatId, 'thinking', '正在理解任务…')

    let followups: FollowupSuggestion[] = []
    const wantAiTitle = cfg.app.ai_generate_chat_title === true
    let stoppedByUser = false
    let completedReply = false
    let hitRoundLimit = false
    let toolArgsRecoveries = 0
    const maxToolArgsRecoveries = 3
    const client = new OpenAICompatibleClient({
      baseUrl: provider.base_url,
      apiKey,
      model: modelName,
      timeoutMs: resolveLlmTimeoutMs(provider.base_url, provider.timeout_ms),
    })

    try {
      const messages = this.buildMessages(chatId, opts.userText, opts.refs)
      let rounds = 0
      let budget = clampInt(cfg.ai.max_tool_rounds, 4, 80, 24)
      const continueBy = clampInt(cfg.ai.continue_tool_rounds, 4, 40, 12)
      let toolCallsThisRun = 0
      const sourceBag = new Map<string, AnswerSource>()
      const runReasoningParts: string[] = []

      // Instant provisional title from first ask; AI polish runs after the agent finishes
      // (avoids racing the main LLM call — many providers reject concurrent requests).
      this.maybeSetProvisionalTitle(chatId, opts.userText)

      while (true) {
        if (ctrl.signal.aborted) throw new Error('aborted')

        if (rounds >= budget) {
          this.setPhase(chatId, 'awaiting_user', '推理轮数已用尽，等待你的选择…')
          const askRes = await this.askUser({
            chatId,
            kind: 'continue_rounds',
            question: `已达 ${rounds} 轮推理上限。是否再继续 ${continueBy} 轮？`,
            options: [`再继续 ${continueBy} 轮`, '停止'],
            allowCustom: false,
            timeoutMs: fork.ask_timeout_ms,
            meta: { roundsUsed: rounds, continueBy },
          })
          if (ctrl.signal.aborted) throw new Error('aborted')
          const wantContinue =
            askRes.source === 'option' && askRes.answer.startsWith('再继续')
          if (wantContinue) {
            budget += continueBy
            const entry = logContinueRounds(continueBy, budget)
            const log = this.chats.appendMessage(chatId, {
              role: 'log',
              content: entry.content,
              meta: {
                kind: 'continue_rounds',
                summary: entry.summary,
                ...(entry.detail ? { detail: entry.detail } : {}),
              },
            })
            if (log) this.emit({ type: 'message', chatId, message: log })
            continue
          }
          hitRoundLimit = true
          break
        }

        rounds += 1

        const pending = this.pendingEvents.get(chatId) || []
        if (pending.length) {
          this.pendingEvents.set(chatId, [])
          messages.push({
            role: 'user',
            content: `[用户操作日志]\n${pending.join('\n')}`,
          })
        }

        // Keep prior-round CoT on screen while this call runs (avoid per-round flash).
        this.setPhase(
          chatId,
          'thinking',
          rounds === 1 ? '正在思考…' : `继续推理（第 ${rounds}/${budget} 轮）…`,
        )
        let reply: Awaited<ReturnType<OpenAICompatibleClient['chat']>>
        try {
          reply = await client.chat(messages, this.toolsForConfig(cfg, chatId), ctrl.signal)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (ctrl.signal.aborted) throw e
          if (
            isRecoverableToolArgsLlmError(msg) &&
            toolArgsRecoveries < maxToolArgsRecoveries
          ) {
            toolArgsRecoveries += 1
            const tip = summarizeToolArgsLlmError(msg)
            const entry = logToolArgsRetry(toolArgsRecoveries, maxToolArgsRecoveries, tip)
            const log = this.chats.appendMessage(chatId, {
              role: 'log',
              content: entry.content,
              meta: {
                kind: 'tool_args_retry',
                summary: entry.summary,
                ...(entry.detail ? { detail: entry.detail } : {}),
              },
            })
            if (log) this.emit({ type: 'message', chatId, message: log })
            messages.push({
              role: 'system',
              content:
                '上一轮工具调用失败：参数不是合法 JSON（常因多行 PEM/私钥未转义，或夹杂了非 JSON 文本）。' +
                '不要中止任务。请重新发起 function call：参数必须是单行合法 JSON 对象；' +
                '多行密钥请先用 crypto_generate_key 取得，再把返回字段填入下一步，或把换行写成 \\n。' +
                (tip ? ` 服务端提示：${tip}` : ''),
            })
            // Do not count this failed provider round against the tool budget.
            rounds -= 1
            continue
          }
          throw e
        }

        const reasoningText = normalizeLlmText(reply.reasoningContent).trim()
        if (reasoningText) {
          runReasoningParts.push(reasoningText)
          this.emitReasoning(
            chatId,
            formatRunReasoning(runReasoningParts),
            'live',
            rounds,
          )
        }

        if (reply.tool_calls?.length) {
          const assistantMsg: ChatMessageParam = {
            role: 'assistant',
            content: reply.content,
            tool_calls: reply.tool_calls,
          }
          messages.push(assistantMsg)

          if (reply.content?.trim()) {
            this.clearPartialMarkers(chatId)
            const m = this.chats.appendMessage(chatId, {
              role: 'assistant',
              content: reply.content,
              meta: { partial: true },
            })
            if (m) this.emit({ type: 'message', chatId, message: m })
          }

          // Parallelize async subchat spawns in the same round; other tools stay serial.
          const resultByCallId = new Map<string, unknown>()
          const spawnCalls = reply.tool_calls.filter(
            (c) => c.function.name === 'agent_spawn_subchat',
          )
          const otherCalls = reply.tool_calls.filter(
            (c) => c.function.name !== 'agent_spawn_subchat',
          )

          const runOne = async (call: ToolCall) => {
            if (ctrl.signal.aborted) throw new Error('aborted')
            const parsed = parseToolCallArguments(call.function.arguments)
            const args = parsed.ok ? parsed.args : {}
            const result = await this.runTool(chatId, call, ctrl.signal)
            toolCallsThisRun += 1
            collectReadPageSources(result, sourceBag, {
              toolName: call.function.name,
              args,
            })
            resultByCallId.set(call.id, result)
          }

          if (spawnCalls.length > 1) {
            await Promise.all(spawnCalls.map((c) => runOne(c)))
          } else if (spawnCalls.length === 1) {
            await runOne(spawnCalls[0])
          }

          for (const call of otherCalls) {
            await runOne(call)
          }

          const modelMax = Math.min(
            32000,
            Math.max(8000, Math.floor((cfg.browser.page_get_max_chars || 80000) / 2)),
          )
          for (const call of reply.tool_calls) {
            const result = resultByCallId.get(call.id)
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: truncateJsonForModel(result, modelMax),
            })
          }
          const nudge = efficiencyNudge(toolCallsThisRun)
          if (nudge) {
            messages.push({ role: 'system', content: nudge })
          }
          continue
        }

        const isSub = this.chats.get(chatId)?.kind === 'sub'
        this.setPhase(chatId, 'thinking', isSub ? '输出结果…' : '整理回复…')
        let text = (reply.content || '').trim() || '（无文本回复）'
        // UI shows read-pages panel; strip any model-written trailing 来源 block to avoid duplication.
        if (!isSub && cfg.app.show_read_pages !== false) {
          text = stripTrailingSourcesSection(text)
        }
        const finalSources = [...sourceBag.values()]
        messages.push({ role: 'assistant', content: text })
        this.clearPartialMarkers(chatId)
        const durationMs = Math.max(0, Date.now() - runStartedAt)
        const m = this.chats.appendMessage(chatId, {
          role: 'assistant',
          content: text,
          meta: {
            durationMs,
            ...(finalSources.length ? { sources: finalSources } : {}),
          },
        })
        if (m) this.emit({ type: 'message', chatId, message: m })
        // Live CoT stays until run finally ends (cleared in finally).
        completedReply = true
        break
      }

      if (hitRoundLimit) {
        const entry = logRoundLimit(rounds)
        const m = this.chats.appendMessage(chatId, {
          role: 'log',
          content: entry.content,
          meta: {
            kind: 'round_limit',
            summary: entry.summary,
            ...(entry.detail ? { detail: entry.detail } : {}),
          },
        })
        if (m) this.emit({ type: 'message', chatId, message: m })
      }

      if (completedReply && !ctrl.signal.aborted && this.chats.get(chatId)?.kind !== 'sub') {
        if (cfg.app.show_followup_suggestions === true) {
          followups = await this.suggestFollowups(client, chatId, messages, ctrl.signal)
        } else {
          followups = buildStoreFollowups(
            collectStoreRecommendations(this.chats.get(chatId)?.messages || []),
          )
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const isUserAbort =
        msg === 'aborted' ||
        (/^(This|The) operation was aborted\.?$/i.test(msg) && ctrl.signal.aborted)
      if (isUserAbort) {
        stoppedByUser = true
        const entry = logAgentStopped()
        const m = this.chats.appendMessage(chatId, {
          role: 'log',
          content: entry.content,
          meta: {
            kind: 'agent_stop',
            summary: entry.summary,
            ...(entry.detail ? { detail: entry.detail } : {}),
          },
        })
        if (m) this.emit({ type: 'message', chatId, message: m })
      } else {
        const entry = logAgentError(msg)
        const m = this.chats.appendMessage(chatId, {
          role: 'log',
          content: entry.content,
          meta: {
            kind: 'agent_error',
            summary: entry.summary,
            ...(entry.detail ? { detail: entry.detail } : {}),
          },
        })
        if (m) this.emit({ type: 'message', chatId, message: m })
        this.emit({
          type: 'error',
          chatId,
          error: msg,
          parentChatId: this.parentIdOf(chatId),
        })
      }
    } finally {
      this.clearLoadingMarkers(chatId, stoppedByUser || ctrl.signal.aborted ? 'aborted' : 'done')
      this.runs.delete(chatId)
      this.pendingEvents.delete(chatId)
      this.forkChains.delete(chatId)
      this.emitReasoning(chatId, '', 'clear')
      this.setPhase(chatId, 'idle')
      // End running UI first — title polish must not leave "Agent 运行中…" on screen.
      this.emit({
        type: 'status',
        chatId,
        running: false,
        parentChatId: this.parentIdOf(chatId),
      })
      this.emit({
        type: 'done',
        chatId,
        followups,
        parentChatId: this.parentIdOf(chatId),
      })

      const finished = this.chats.get(chatId)
      if (finished?.kind === 'sub' && finished.parentChatId) {
        const status: SubChatSpawnStatus = stoppedByUser
          ? 'cancelled'
          : completedReply
            ? 'done'
            : 'failed'
        this.finalizeSubchat(chatId, status)
      }

      // Title polish is once per chat (first user turn). tryLock happens inside
      // maybeGenerateTitle so a retry that starts after runs.delete cannot fetch again.
      const titleChat = this.chats.get(chatId)
      if (wantAiTitle && titleChat && titleChat.kind !== 'sub' && !titleChat.titleGenerated) {
        const userTurns = titleChat.messages.filter((m) => m.role === 'user').length
        if (userTurns <= 1) {
          try {
            await this.maybeGenerateTitle(client, chatId, opts.userText)
          } catch (e) {
            console.warn('[title] generate failed', e instanceof Error ? e.message : e)
          }
        } else {
          this.chats.tryLockTitle(chatId)
        }
      }
      // Ensure debounced writes land after the run (crash/quit window shrinks).
      this.chats.flushChat(chatId)
    }
  }

  /** Drop interim shimmer markers from previous assistant snippets. */
  private clearPartialMarkers(chatId: string): void {
    const chat = this.chats.get(chatId)
    if (!chat) return
    for (const m of chat.messages) {
      if (!m.meta?.partial) continue
      const updated = this.chats.updateMessage(chatId, m.id, {
        meta: { ...m.meta, partial: false },
      })
      if (updated) this.emit({ type: 'message_update', chatId, message: updated })
    }
  }

  /** Clear shimmer / stuck tool spinners when a run ends. */
  private clearLoadingMarkers(chatId: string, end: 'aborted' | 'done' = 'done'): void {
    this.clearPartialMarkers(chatId)
    const chat = this.chats.get(chatId)
    if (!chat) return
    for (const m of chat.messages) {
      if (m.role !== 'tool' || m.meta?.status !== 'running') continue
      const aborted = end === 'aborted'
      const updated = this.chats.updateMessage(chatId, m.id, {
        content:
          m.content === '执行中…' || !String(m.content || '').trim()
            ? aborted
              ? '用户终止'
              : '已结束'
            : m.content,
        meta: { ...m.meta, status: aborted ? 'aborted' : 'done' },
      })
      if (updated) this.emit({ type: 'message_update', chatId, message: updated })
    }
  }

  /** Instant title from a short slice of the first user message (not marked as AI). */
  private maybeSetProvisionalTitle(chatId: string, userText: string): void {
    const slice = this.chats.setProvisionalTitleFromFirstUser(chatId, userText)
    if (!slice) return
    this.emit({ type: 'title', chatId, title: slice, fromAi: false })
  }

  /**
   * AI title polish from the first user ask.
   * Runs after the main agent loop so it does not compete for the model slot.
   * Locks immediately so retries / follow-up runs never start a second fetch.
   */
  private async maybeGenerateTitle(
    client: OpenAICompatibleClient,
    chatId: string,
    userText: string,
  ): Promise<void> {
    try {
      const chat = this.chats.get(chatId)
      if (!chat || chat.kind === 'sub' || chat.titleGenerated) return

      const firstUser = chat.messages.find((m) => m.role === 'user')
      const prompt = (firstUser?.content || userText || '').trim()
      if (!prompt) {
        this.chats.tryLockTitle(chatId)
        return
      }

      if (!this.chats.tryLockTitle(chatId)) return

      let title: string | null = null
      try {
        title = await this.suggestChatTitleFromUser(client, prompt)
      } catch (e) {
        console.warn('[title] llm failed', e instanceof Error ? e.message : e)
      }
      if (!title) {
        title = polishLocalTitle(prompt)
        if (title) console.warn('[title] fallback to local polish:', title)
      }
      if (!title || !this.chats.get(chatId)) return
      this.chats.setTitle(chatId, title, { fromAi: true })
      this.emit({ type: 'title', chatId, title, fromAi: true })
    } catch (e) {
      console.warn('[title] generate failed', e instanceof Error ? e.message : e)
    }
  }

  private async suggestChatTitleFromUser(
    client: OpenAICompatibleClient,
    userText: string,
  ): Promise<string | null> {
    const messages = [
      {
        role: 'system' as const,
        content: [
          '你是会话侧栏标题生成器。把用户主任务压成一句简明标题，只输出标题正文一行。',
          '规则：',
          '1. 默认简体中文；任务全英文时可用英文，须完整单词。',
          '2. 中文≤36字，英文≤72字符；可稍长以便读懂，勿写成整段。',
          '3. 结构：动词/动作 + 对象；只抓主任务，忽略检查结果、路径、告知结果等收尾。',
          '4. 专有名词照抄；不要 URL、哈希、路径、父任务上下文。',
          '5. 禁止：标点结尾、思考/解释、「帮我/用户需要」开头、「Chat/对话/助手」。',
        ].join('\n'),
      },
      {
        role: 'user' as const,
        content: `任务：\n${userText.slice(0, 480)}\n\n标题：`,
      },
    ]

    console.log('[title] prompt', {
      system: messages[0].content,
      user: messages[1].content,
    })

    // mimo / reasoning models: small max_tokens leaves content empty (all spent on reasoning).
    // Prefer a generous budget; fall back to no limit.
    const attempts: Array<{ maxTokens?: number; timeoutMs: number }> = [
      { maxTokens: 1024, timeoutMs: 45000 },
      { timeoutMs: 60000 },
    ]

    for (const attempt of attempts) {
      try {
        const reply = await client.chat(messages, [], undefined, {
          temperature: 0.2,
          timeoutMs: attempt.timeoutMs,
          ...(attempt.maxTokens != null ? { maxTokens: attempt.maxTokens } : {}),
        })
        const fromContent = cleanChatTitle(normalizeLlmText(reply.content))
        if (fromContent && isUsableChatTitle(fromContent, userText)) return fromContent
        const fromReason = cleanChatTitle(extractTitleFromReasoning(reply.reasoningContent, userText))
        if (fromReason && isUsableChatTitle(fromReason, userText)) return fromReason
        // Last resort: accept cleaned title even if weak, only when nothing better.
        if (fromContent && !isMetaTitleLeak(fromContent)) return fromContent
        if (fromReason && !isMetaTitleLeak(fromReason)) return fromReason
        console.warn(
          '[title] empty content',
          'finish=',
          reply.finish_reason,
          'reasoningLen=',
          (reply.reasoningContent || '').length,
        )
      } catch (e) {
        console.warn('[title] attempt failed', attempt, e instanceof Error ? e.message : e)
      }
    }
    return null
  }

  /**
   * Build follow-up chips: deterministic actions from workspace artifacts first,
   * then LLM text prompts bound to those artifacts when relevant.
   */
  private async suggestFollowups(
    client: OpenAICompatibleClient,
    chatId: string,
    prior: ChatMessageParam[],
    signal: AbortSignal,
  ): Promise<FollowupSuggestion[]> {
    const chat = this.chats.get(chatId)
    const artifacts = collectWorkspaceArtifacts(chat?.messages || [])
    const storeRecs = collectStoreRecommendations(chat?.messages || [])
    const seeded = [
      ...buildStoreFollowups(storeRecs),
      ...buildArtifactFollowups(artifacts),
    ]

    try {
      const snippet = prior
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => {
          const text = typeof m.content === 'string' ? m.content.trim() : ''
          return { role: m.role, text }
        })
        .filter((m) => {
          if (!m.text) return false
          // Skip injected op logs and empty tool-round assistant stubs.
          if (m.text.startsWith('[用户操作日志]')) return false
          return true
        })
        .slice(-4)
        .map((m) => `${m.role}: ${m.text.slice(0, 600)}`)
        .join('\n\n')
      const maxAsk = Math.max(0, 6 - seeded.length)
      if (maxAsk <= 0) return seeded.slice(0, 4)

      const userParts = [`对话摘录：\n${snippet || '（无）'}`]
      if (artifacts.length > 0) {
        userParts.push(
          `相关工作区文件：\n${artifacts.map((a) => `- ${a.path}`).join('\n')}`,
        )
      }
      if (storeRecs.length > 0) {
        userParts.push(
          `商店可安装（界面已展示安装卡片，勿再重复推荐同一产品）：\n${storeRecs
            .map((r) => `- ${r.kind} ${r.productId} ${r.name}`)
            .join('\n')}`,
        )
      }
      userParts.push(`请输出 0～${maxAsk} 条相关追问的 JSON 数组。`)

      const followupMessages = [
        {
          role: 'system' as const,
          content: [
            '你是追问推荐器。根据对话给出用户下一步可能点的短追问。',
            '要求：与主题直接相关；每条不超过 36 字；不要重复已回答内容；没有合适追问就返回 []。',
            '默认输出 JSON 字符串数组，例如 ["…","…"]。',
            '若对话需要安装商店插件/技能且上文未列出该产品，可输出对象：{"label":"安装 xxx","action":{"type":"store_install","kind":"plugin","productId":"…","name":"…","description":"…"}}。',
            '不要 Markdown，不要其它字段。',
          ].join('\n'),
        },
        {
          role: 'user' as const,
          content: userParts.join('\n\n'),
        },
      ]
      console.log('[followups] prompt', {
        system: followupMessages[0].content,
        user: followupMessages[1].content,
      })
      const reply = await client.chat(followupMessages, [], signal)
      const fromLlm = parseFollowupSuggestions(reply.content || '', artifacts)
      return mergeFollowups(seeded, fromLlm, 6)
    } catch {
      return seeded.slice(0, 4)
    }
  }

  private buildMessages(
    chatId: string,
    userText: string,
    refs?: BrowserContextRef[],
  ): ChatMessageParam[] {
    const fork = resolveForkDecision(this.getConfig())
    const subchat = resolveSubchat(this.getConfig())
    const chat = this.chats.get(chatId)
    const skillAppendix = this.skills.buildPromptAppendix()
    const scopeChatId = this.chats.resolvePluginScopeChatId(chatId)
    const pluginAppendix = this.plugins.buildPromptAppendix(scopeChatId)
    const pluginDevAppendix = buildPluginDevPromptAppendix(this.getConfig())
    const appendix = [skillAppendix, pluginAppendix, pluginDevAppendix].filter(Boolean).join('\n')
    const systemPrompt = buildSystemPrompt(fork.enabled, {
      subchatEnabled: subchat.enabled,
      maxSubchats: subchat.max_parallel,
    })
    const out: ChatMessageParam[] = [
      {
        role: 'system',
        content: appendix ? `${systemPrompt}\n${appendix}` : systemPrompt,
      },
    ]

    if (chat?.kind === 'sub') {
      out.push({
        role: 'system',
        content:
          '你当前运行在「子对话」中：只专注完成父 Agent 交给你的 goal。' +
          '任务说明与【父任务上下文】/【系统补全自父对话】里的 URL、sitekey 等标识必须原样使用，禁止改成 example.com 或其它占位域名。' +
          '完成后直接给出任务结果即可，不要润色、排版或整理成完整回复。' +
          '不要尝试创建更多子对话。资源仍须极简（默认 1 Session + 1 窗口）。',
      })
    }

    const tree = this.registry.getTree(chatId)
    const sessionCount = tree.length
    const windowCount = tree.reduce((n, s) => n + (s.windows?.length || 0), 0)
    out.push({
      role: 'system',
      content:
        `当前 Chat 浏览器资源：Session ${sessionCount} 个，窗口 ${windowCount} 个。\n` +
        `${JSON.stringify(tree, null, 0)}\n` +
        (sessionCount > 0
          ? '已有资源：禁止再 browser_open；用已有 windowId navigate/get。'
          : '尚无资源：需要浏览时最多 browser_open 一次，并尽量带最终目标 URL。') +
        ' 查版本/新闻等：优先官网；百度最多搜一次并立刻作答。',
    })

    if (chat) {
      for (const m of chat.messages.slice(-30)) {
        if (m.role === 'user') out.push({ role: 'user', content: m.content })
        else if (m.role === 'assistant') out.push({ role: 'assistant', content: m.content })
        else if (m.role === 'log') out.push({ role: 'user', content: `[日志] ${m.content}` })
      }
    }

    void userText
    void refs

    if (refs?.length) {
      out.push({
        role: 'system',
        content: `用户绑定对象：${JSON.stringify(refs)}`,
      })
    }

    return out
  }

  private async runTool(
    chatId: string,
    call: ToolCall,
    signal: AbortSignal,
  ): Promise<unknown> {
    const parsed = parseToolCallArguments(call.function.arguments)
    const args: Record<string, unknown> = parsed.ok ? parsed.args : {}

    this.setPhase(chatId, 'calling_tool', `正在调用 ${call.function.name}`, call.function.name)

    const scopeChatId = this.chats.resolvePluginScopeChatId(chatId)
    const pluginOwner = this.plugins.ownerOfToolForChat(scopeChatId, call.function.name)
    const startMsg = this.chats.appendMessage(chatId, {
      role: 'tool',
      content: '执行中…',
      meta: {
        toolName: call.function.name,
        toolCallId: call.id,
        args,
        status: 'running',
        ...(pluginOwner
          ? { pluginId: pluginOwner.id, pluginName: pluginOwner.name, fromPlugin: true }
          : {}),
      },
    })
    if (startMsg) this.emit({ type: 'message', chatId, message: startMsg })

    let result: unknown
    if (!parsed.ok) {
      result = {
        ok: false,
        error: parsed.error,
        detail: parsed.detail,
        hint:
          'Do not stop. Retry the same tool with valid single-line JSON arguments; ' +
          'prefer crypto_generate_key then pass returned key fields instead of inventing PEM.',
      }
      if (startMsg) {
        const updated = this.chats.updateMessage(chatId, startMsg.id, {
          content: truncateJson(result, 4000),
          meta: {
            toolName: call.function.name,
            toolCallId: call.id,
            args,
            status: 'error',
            result,
          },
        })
        if (updated) this.emit({ type: 'message_update', chatId, message: updated })
      }
      return result
    }

    const quietNav =
      call.function.name.startsWith('browser_') ||
      Boolean(this.plugins.ownerOfToolForChat(scopeChatId, call.function.name))
    if (quietNav) this.registry.beginQuietNavigateLogs(chatId)
    try {
      if (call.function.name === 'agent_ask_user') {
        result = await this.runAskUserTool(chatId, args, signal)
      } else if (call.function.name === 'agent_spawn_subchat') {
        result = await this.spawnSubchat(chatId, args, call.id, signal)
      } else if (call.function.name === 'agent_await_subchats') {
        result = await this.awaitSubchats(chatId, args, signal)
      } else if (call.function.name === 'agent_subchat_status') {
        result = this.subchatStatus(chatId, args)
      } else {
        result = await executeAgentTool(call.function.name, args, {
          chatId,
          pluginScopeChatId: scopeChatId,
          signal,
          registry: this.registry,
          network: this.network,
          files: this.files,
          downloads: this.downloads,
          shell: this.shell,
          chats: this.chats,
          gate: this.gate,
          getConfig: this.getConfig,
          updateConfig: this.updateConfig,
          secrets: this.secrets,
          skills: this.skills,
          plugins: this.plugins,
          store: this.store,
          askSkillReview: this.askSkillReview,
          onDownloadProgress: (info) => {
            const pct =
              typeof info.contentLength === 'number' && info.contentLength > 0
                ? Math.min(100, Math.round((info.bytesPart / info.contentLength) * 100))
                : undefined
            const sizeLabel =
              pct != null
                ? `${formatDownloadBytes(info.bytesPart)} / ${formatDownloadBytes(info.contentLength!)}（${pct}%）`
                : formatDownloadBytes(info.bytesTotal)
            const partLabel =
              info.partsTotal > 1 ? ` · 分片 ${info.partIndex + 1}/${info.partsTotal}` : ''
            const progressMeta = {
              dest: info.dest,
              bytesTotal: info.bytesTotal,
              bytesPart: info.bytesPart,
              contentLength: info.contentLength,
              partIndex: info.partIndex,
              partsTotal: info.partsTotal,
              percent: pct,
              indeterminate: pct == null || (pct === 0 && info.bytesPart <= 0),
            }
            // Throttle UI/IPC: downloads can fire progress dozens of times per second.
            const now = Date.now()
            const force =
              pct === 100 ||
              (typeof info.contentLength === 'number' &&
                info.contentLength > 0 &&
                info.bytesPart >= info.contentLength)
            const lastAt = downloadProgressEmitAt.get(chatId) || 0
            if (!force && now - lastAt < 120) {
              downloadProgressPending.set(chatId, {
                chatId,
                toolName: call.function.name,
                toolCallId: call.id,
                args,
                startMsgId: startMsg?.id,
                sizeLabel,
                partLabel,
                progressMeta,
              })
              if (!downloadProgressTimers.has(chatId)) {
                const t = setTimeout(() => {
                  downloadProgressTimers.delete(chatId)
                  const pending = downloadProgressPending.get(chatId)
                  if (pending) {
                    downloadProgressPending.delete(chatId)
                    this.emitDownloadProgressUi(pending)
                  }
                }, 120)
                t.unref?.()
                downloadProgressTimers.set(chatId, t)
              }
              return
            }
            downloadProgressEmitAt.set(chatId, now)
            downloadProgressPending.delete(chatId)
            const pendingTimer = downloadProgressTimers.get(chatId)
            if (pendingTimer) {
              clearTimeout(pendingTimer)
              downloadProgressTimers.delete(chatId)
            }
            this.emitDownloadProgressUi({
              chatId,
              toolName: call.function.name,
              toolCallId: call.id,
              args,
              startMsgId: startMsg?.id,
              sizeLabel,
              partLabel,
              progressMeta,
            })
          },
        })
      }
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      if (quietNav) this.registry.endQuietNavigateLogs(chatId)
    }

    const ok =
      !(result && typeof result === 'object' && 'ok' in result && (result as { ok: boolean }).ok === false)
    if (startMsg) {
      const spawnMeta =
        call.function.name === 'agent_spawn_subchat' &&
        result &&
        typeof result === 'object' &&
        (result as { subChatId?: string }).subChatId
          ? {
              subChatId: (result as { subChatId: string }).subChatId,
              spawnStatus: (result as { status?: string }).status || 'running',
              spawnGoal: String(args.goal || ''),
            }
          : {}
      const updated = this.chats.updateMessage(chatId, startMsg.id, {
        content: truncateJson(result, 4000),
        meta: {
          toolName: call.function.name,
          toolCallId: call.id,
          args,
          status: ok ? 'done' : 'error',
          result,
          downloadProgress: undefined,
          ...spawnMeta,
        },
      })
      if (updated) {
        // Drop progress field so UI bar disappears after finish.
        if (updated.meta && 'downloadProgress' in updated.meta) {
          delete updated.meta.downloadProgress
        }
        this.emit({ type: 'message_update', chatId, message: updated })
      }
    }
    return result
  }

  private summarizeSubchat(subChatId: string): string {
    const chat = this.chats.get(subChatId)
    if (!chat) return ''
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const m = chat.messages[i]
      if (m.role === 'assistant' && m.content?.trim() && !m.meta?.partial) {
        const t = m.content.trim().replace(/\s+/g, ' ')
        return t.length > 1200 ? `${t.slice(0, 1200)}…` : t
      }
    }
    const errLog = [...chat.messages].reverse().find((m) => m.role === 'log' && m.meta?.kind === 'agent_error')
    if (errLog?.content) return errLog.content.slice(0, 500)
    return ''
  }

  private snapshotSubchat(subChatId: string) {
    const chat = this.chats.get(subChatId)
    if (!chat) {
      return { ok: false as const, subChatId, error: 'subchat_not_found' }
    }
    const status = (chat.spawnStatus ||
      (this.isRunning(subChatId) ? 'running' : 'done')) as SubChatSpawnStatus
    return {
      ok: true as const,
      subChatId,
      title: chat.title,
      goal: chat.spawnPurpose || chat.title,
      status,
      summary: status === 'running' ? '' : this.summarizeSubchat(subChatId),
    }
  }

  private finalizeSubchat(subChatId: string, status: SubChatSpawnStatus): void {
    const chat = this.chats.get(subChatId)
    if (!chat || chat.kind !== 'sub') return
    // Idempotent: ignore further transitions once terminal.
    if (chat.spawnStatus && chat.spawnStatus !== 'running') return
    if (status === 'running') return
    this.chats.setSpawnStatus(subChatId, status)
    const summary = this.summarizeSubchat(subChatId)
    const parentChatId = chat.parentChatId
    const parentToolCallId = chat.parentToolCallId

    if (parentChatId && parentToolCallId) {
      const parent = this.chats.get(parentChatId)
      const msg = parent?.messages.find(
        (m) => m.role === 'tool' && m.meta?.toolCallId === parentToolCallId,
      )
      if (msg) {
        const prevResult =
          msg.meta?.result && typeof msg.meta.result === 'object'
            ? (msg.meta.result as Record<string, unknown>)
            : {}
        const nextResult = {
          ...prevResult,
          ok: status === 'done',
          subChatId,
          status,
          summary,
        }
        const updated = this.chats.updateMessage(parentChatId, msg.id, {
          content: truncateJson(nextResult, 4000),
          meta: {
            ...msg.meta,
            spawnStatus: status,
            result: nextResult,
          },
        })
        if (updated) this.emit({ type: 'message_update', chatId: parentChatId, message: updated })
      }

      const line =
        status === 'done'
          ? `[子对话完成] ${subChatId}「${chat.title}」\n${summary || '（无文本结论）'}`
          : `[子对话结束:${status}] ${subChatId}「${chat.title}」\n${summary || ''}`.trim()
      const pending = this.pendingEvents.get(parentChatId) || []
      pending.push(line)
      this.pendingEvents.set(parentChatId, pending)
    }

    this.emit({
      type: 'subchat',
      chatId: subChatId,
      parentChatId: parentChatId || '',
      status,
      summary,
    })
    this.notifyChatChanged(subChatId)
    if (parentChatId) this.notifyChatChanged(parentChatId)

    const waiters = this.subchatWaiters.get(subChatId) || []
    this.subchatWaiters.delete(subChatId)
    for (const w of waiters) {
      try {
        w({ status, summary })
      } catch {
        /* ignore */
      }
    }

    // Sub-chats own isolated browser resources — drop them when the child finishes
    // so parent chats are not left with leftover Sessions/windows.
    void this.registry.clearChat(subChatId).catch((e) => {
      console.warn('[subchat] clear browser resources failed', subChatId, e)
    })
  }

  private waitForSubchat(
    subChatId: string,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<{ status: SubChatSpawnStatus; summary: string }> {
    const snap = this.snapshotSubchat(subChatId)
    if (!snap.ok) {
      return Promise.resolve({ status: 'failed', summary: snap.error })
    }
    if (snap.status !== 'running') {
      return Promise.resolve({ status: snap.status, summary: snap.summary })
    }

    return new Promise((resolve) => {
      let settled = false
      const finish = (info: { status: SubChatSpawnStatus; summary: string }) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        if (timer) clearTimeout(timer)
        const list = this.subchatWaiters.get(subChatId) || []
        this.subchatWaiters.set(
          subChatId,
          list.filter((fn) => fn !== onDone),
        )
        resolve(info)
      }
      const onDone = (info: { status: SubChatSpawnStatus; summary: string }) => finish(info)
      const onAbort = () => finish({ status: 'cancelled', summary: 'aborted' })
      const list = this.subchatWaiters.get(subChatId) || []
      list.push(onDone)
      this.subchatWaiters.set(subChatId, list)
      signal.addEventListener('abort', onAbort, { once: true })
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              finish({
                status: 'running',
                summary: 'await_timeout',
              })
            }, timeoutMs)
          : null
      // Re-check in case it finished between snapshot and waiter registration.
      const again = this.snapshotSubchat(subChatId)
      if (again.ok && again.status !== 'running') {
        finish({ status: again.status, summary: again.summary })
      }
    })
  }

  private async spawnSubchat(
    parentChatId: string,
    args: Record<string, unknown>,
    parentToolCallId: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (signal.aborted) return { ok: false, error: 'aborted' }

    const prev = this.subchatSpawnTails.get(parentChatId) || Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const tail = prev.then(() => gate)
    this.subchatSpawnTails.set(parentChatId, tail)
    try {
      await prev
      return await this.spawnSubchatLocked(parentChatId, args, parentToolCallId, signal)
    } finally {
      release()
      if (this.subchatSpawnTails.get(parentChatId) === tail) {
        this.subchatSpawnTails.delete(parentChatId)
      }
    }
  }

  private countActiveSubchats(parentChatId: string): number {
    return this.chats.listChildren(parentChatId).filter((c) => {
      if (this.isRunning(c.id)) return true
      return c.spawnStatus === 'running'
    }).length
  }

  private async spawnSubchatLocked(
    parentChatId: string,
    args: Record<string, unknown>,
    parentToolCallId: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (signal.aborted) return { ok: false, error: 'aborted' }
    const parent = this.chats.get(parentChatId)
    if (!parent) return { ok: false, error: 'parent_not_found' }
    if (parent.kind === 'sub' || parent.parentChatId) {
      return {
        ok: false,
        error: 'subchat_depth_exceeded',
        hint: 'Sub-chats cannot spawn further children. Complete the goal in this chat.',
      }
    }

    const cfg = this.getConfig()
    const subCfg = resolveSubchat(cfg)
    if (!subCfg.enabled) {
      return {
        ok: false,
        error: 'subchat_disabled',
        hint: 'User disabled sub-chats in Settings. Complete the work in this chat serially.',
      }
    }

    const goal = String(args.goal || '').trim()
    if (!goal) return { ok: false, error: 'goal_required' }
    let context = String(args.context || '').trim()
    // Child does not inherit parent history; backfill URLs/sitekeys the parent forgot to pass.
    context = enrichSubchatContextFromParent(parent, goal, context)
    const inheritWorkspace = args.inheritWorkspace === true

    const active = this.countActiveSubchats(parentChatId)
    if (active >= subCfg.max_parallel) {
      return {
        ok: false,
        error: 'max_subchats',
        hint: `This parent already has ${active} running sub-chat(s) (limit ${subCfg.max_parallel}). Call agent_await_subchats first, or raise Settings → 子对话 → 最大并行数.`,
        running: active,
        maxParallel: subCfg.max_parallel,
      }
    }

    let title = goal.replace(/\s+/g, ' ')
    // Keep a longer stored title; sidebar chips truncate with CSS ellipsis.
    if (title.length > 80) title = title.slice(0, 80)

    const sub = this.chats.create(title, {
      permissions: parent.permissions,
      providerId: parent.providerId,
      model: parent.model,
      kind: 'sub',
      parentChatId,
      parentToolCallId,
      spawnPurpose: goal,
      spawnStatus: 'running',
      titleGenerated: true,
    })

    if (inheritWorkspace) {
      const root = parent.workspaceRoot || this.chats.getWorkspaceRoot(parentChatId)
      if (root) this.chats.setWorkspaceRoot(sub.id, root)
    }

    const userText = context
      ? `${goal}\n\n【父任务上下文】\n${context.slice(0, 4000)}`
      : goal
    const userMsg = this.chats.appendMessage(sub.id, {
      role: 'user',
      content: userText,
    })
    if (userMsg) this.emit({ type: 'message', chatId: sub.id, message: userMsg })
    this.notifyChatChanged(sub.id)

    // Fire-and-forget: sync preamble of run() registers the AbortController before first await.
    void this.run({ chatId: sub.id, userText }).catch((e) => {
      console.error('[subchat.run]', sub.id, e)
      this.finalizeSubchat(sub.id, 'failed')
    })

    return {
      ok: true,
      subChatId: sub.id,
      status: 'running',
      goal,
      title,
      hint: 'Sub-chat started asynchronously. Spawn more in parallel if needed, then agent_await_subchats.',
    }
  }

  private async awaitSubchats(
    parentChatId: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const rawIds = Array.isArray(args.subChatIds) ? args.subChatIds : null
    let ids = (rawIds || this.chats.listChildren(parentChatId).map((c) => c.id))
      .map((x) => String(x || '').trim())
      .filter(Boolean)

    if (rawIds) {
      for (const id of ids) {
        const c = this.chats.get(id)
        if (!c || c.parentChatId !== parentChatId) {
          return { ok: false, error: 'subchat_not_owned', subChatId: id }
        }
      }
    } else {
      ids = ids.filter((id) => {
        const c = this.chats.get(id)
        return c && (c.spawnStatus === 'running' || this.isRunning(id))
      })
      if (!ids.length) {
        const all = this.chats.listChildren(parentChatId).map((c) => this.snapshotSubchat(c.id))
        return { ok: true, waited: false, results: all }
      }
    }

    if (!ids.length) return { ok: true, waited: false, results: [] }

    const rawTimeout = args.timeoutMs ?? args.timeout_ms
    let timeoutMs = 300_000
    if (rawTimeout !== undefined && rawTimeout !== null && rawTimeout !== '') {
      const n = Number(rawTimeout)
      if (Number.isFinite(n)) {
        timeoutMs = n <= 0 ? 0 : Math.min(600_000, Math.max(5_000, Math.floor(n)))
      }
    }

    this.setPhase(parentChatId, 'observing', `等待 ${ids.length} 个子对话…`)
    const settled = await Promise.all(ids.map((id) => this.waitForSubchat(id, signal, timeoutMs)))
    const results = ids.map((id, i) => {
      const snap = this.snapshotSubchat(id)
      if (!snap.ok) return snap
      const w = settled[i]
      // Prefer waiter outcome when still "running" due to timeout.
      if (w.status === 'running' && snap.status === 'running') {
        return { ...snap, status: 'running' as const, summary: w.summary || 'await_timeout' }
      }
      return snap
    })
    const allDone = results.every((r) => r.ok && r.status !== 'running')
    return {
      ok: true,
      waited: true,
      allDone,
      results,
    }
  }

  private subchatStatus(parentChatId: string, args: Record<string, unknown>): unknown {
    const rawIds = Array.isArray(args.subChatIds) ? args.subChatIds : null
    const ids = (rawIds || this.chats.listChildren(parentChatId).map((c) => c.id))
      .map((x) => String(x || '').trim())
      .filter(Boolean)
    if (rawIds) {
      for (const id of ids) {
        const c = this.chats.get(id)
        if (!c || c.parentChatId !== parentChatId) {
          return { ok: false, error: 'subchat_not_owned', subChatId: id }
        }
      }
    }
    return {
      ok: true,
      results: ids.map((id) => this.snapshotSubchat(id)),
    }
  }

  private async runAskUserTool(
    chatId: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const fork = resolveForkDecision(this.getConfig())
    if (!fork.enabled) {
      return {
        ok: false,
        error: 'fork_decision_disabled',
        hint: 'User disabled path-fork asks; proceed with the safest assumption and state it briefly.',
      }
    }

    const question = String(args.question || '').trim()
    if (!question) return { ok: false, error: 'question_required' }

    const optionItems = this.parseAskOptions(args, fork)
    const options = optionItems.map((o) => o.label)
    if (options.length < 2) {
      return { ok: false, error: 'options_need_at_least_2' }
    }

    const allowCustom = fork.allow_custom && args.allowCustom !== false
    const step = Number(args.step)
    const totalSteps = Number(args.totalSteps)
    const forkGroup = String(args.forkGroup || args.fork_group || '').trim() || 'default'
    const forkTitle = String(args.forkTitle || args.fork_title || '').trim()
    const stepNum = Number.isFinite(step) && step >= 1 ? Math.floor(step) : undefined
    const fingerprint = this.forkFingerprint(question, options, forkGroup, stepNum)
    const progressMeta = {
      ...(Number.isFinite(step) && step >= 1 ? { step: Math.floor(step) } : {}),
      ...(Number.isFinite(totalSteps) && totalSteps >= 1
        ? { totalSteps: Math.floor(totalSteps) }
        : {}),
      forkGroup,
      ...(forkTitle ? { forkTitle } : {}),
    }
    const askMeta = {
      ...progressMeta,
      priorAnswers: this.chainAnswersForGroup(chatId, forkGroup),
    }

    if (fork.remember_in_chat) {
      const remembered = this.forkMemory.get(chatId)?.get(fingerprint)
      if (remembered) {
        this.recordForkChainAnswer(chatId, {
          forkGroup,
          step: progressMeta.step,
          question,
          answer: remembered,
        })
        const entry = logUserChoice(remembered)
        const log = this.chats.appendMessage(chatId, {
          role: 'log',
          content: entry.content,
          meta: {
            kind: 'user_choice',
            source: 'option',
            summary: `${entry.summary}（沿用本会话选择）`,
            ...(entry.detail ? { detail: entry.detail } : {}),
            ...progressMeta,
          },
        })
        if (log) this.emit({ type: 'message', chatId, message: log })
        return {
          ok: true,
          answer: remembered,
          source: 'option',
          remembered: true,
          ...progressMeta,
          chainAnswers: this.chainAnswersForGroup(chatId, forkGroup),
          next:
            progressMeta.totalSteps &&
            progressMeta.step &&
            progressMeta.step < progressMeta.totalSteps
              ? 'Call agent_ask_user again for the next hierarchical step. Reuse the same forkGroup and forkTitle; set step = previous step + 1; do not re-ask answered questions.'
              : undefined,
        }
      }
    }

    this.setPhase(
      chatId,
      'awaiting_user',
      progressMeta.step && progressMeta.totalSteps
        ? `询问/决策 ${progressMeta.step}/${progressMeta.totalSteps}：${question.slice(0, 60)}`
        : question.slice(0, 80),
    )

    const evidence = fork.context_evidence ? this.collectAskEvidence(chatId) : undefined
    const timeoutMs = resolveAgentAskTimeoutMs(args, fork.ask_timeout_ms)
    const res = await this.askUser({
      chatId,
      kind: 'user_choice',
      question,
      options,
      optionItems: fork.option_hints || fork.recommended ? optionItems : undefined,
      allowCustom,
      evidence,
      meta: askMeta,
      timeoutMs,
    })

    if (signal.aborted || res.source === 'aborted') {
      return { ok: false, error: 'aborted' }
    }
    if (res.source === 'timeout') {
      return {
        ok: false,
        error: 'timeout',
        hint: 'User did not answer in time. State a brief safe default and continue, or stop if the choice is critical.',
      }
    }
    if (res.source === 'deny' || !res.answer.trim()) {
      return { ok: false, error: 'user_denied' }
    }

    const answer = res.answer.trim()
    this.recordForkChainAnswer(chatId, {
      forkGroup,
      step: progressMeta.step,
      question,
      answer,
    })
    if (fork.remember_in_chat && (res.source === 'option' || res.source === 'custom')) {
      let map = this.forkMemory.get(chatId)
      if (!map) {
        map = new Map()
        this.forkMemory.set(chatId, map)
      }
      map.set(fingerprint, answer)
    }

    const entry = logUserChoice(answer)
    const log = this.chats.appendMessage(chatId, {
      role: 'log',
      content: entry.content,
      meta: {
        kind: 'user_choice',
        source: res.source,
        summary: entry.summary,
        ...(entry.detail ? { detail: entry.detail } : {}),
        ...progressMeta,
      },
    })
    if (log) this.emit({ type: 'message', chatId, message: log })

    const chainAnswers = this.chainAnswersForGroup(chatId, forkGroup)
    return {
      ok: true,
      answer,
      source: res.source === 'custom' ? 'custom' : 'option',
      ...progressMeta,
      chainAnswers,
      next:
        progressMeta.totalSteps &&
        progressMeta.step &&
        progressMeta.step < progressMeta.totalSteps
          ? 'Call agent_ask_user again for the next hierarchical step based on this answer. Reuse the same forkGroup and forkTitle; set step = previous step + 1; do not re-ask answered questions.'
          : undefined,
    }
  }

  private recordForkChainAnswer(
    chatId: string,
    entry: { forkGroup: string; step?: number; question: string; answer: string },
  ): void {
    let chain = this.forkChains.get(chatId)
    if (!chain) {
      chain = []
      this.forkChains.set(chatId, chain)
    }
    chain.push(entry)
  }

  private chainAnswersForGroup(chatId: string, forkGroup: string) {
    return (this.forkChains.get(chatId) || [])
      .filter((e) => e.forkGroup === forkGroup)
      .map((e) => ({
        step: e.step,
        question: e.question,
        answer: e.answer,
      }))
  }

  private toolsForConfig(cfg: AppConfig, chatId?: string) {
    const fork = resolveForkDecision(cfg)
    const subchat = resolveSubchat(cfg)
    let tools = fork.enabled
      ? AGENT_TOOLS
      : AGENT_TOOLS.filter((t) => t.function.name !== 'agent_ask_user')
    if (!subchat.enabled) {
      const blocked = new Set([
        'agent_spawn_subchat',
        'agent_await_subchats',
        'agent_subchat_status',
      ])
      tools = tools.filter((t) => !blocked.has(t.function.name))
    }
    if (!resolvePluginDevMode(cfg)) {
      tools = tools.filter((t) => !PLUGIN_DEV_TOOL_NAMES.has(t.function.name))
    }
    const chat = chatId ? this.chats.get(chatId) : null
    if (chat?.kind === 'sub') {
      const blocked = new Set([
        'agent_spawn_subchat',
        'agent_await_subchats',
        'agent_subchat_status',
      ])
      tools = tools.filter((t) => !blocked.has(t.function.name))
    }
    const pluginTools = this.plugins.enabledToolsForChat(
      chatId ? this.chats.resolvePluginScopeChatId(chatId) : '',
    )
    if (pluginTools.length) tools = [...tools, ...pluginTools]
    return tools
  }

  private parseAskOptions(
    args: Record<string, unknown>,
    fork: ReturnType<typeof resolveForkDecision>,
  ): AgentAskOption[] {
    const raw = Array.isArray(args.options) ? args.options : []
    const recommendedLabel = String(args.recommended || '').trim()
    const items: AgentAskOption[] = []
    const seen = new Set<string>()

    for (const entry of raw) {
      let label = ''
      let hint = ''
      let recommended = false
      if (typeof entry === 'string') {
        label = entry.trim()
      } else if (entry && typeof entry === 'object') {
        const o = entry as Record<string, unknown>
        label = String(o.label || o.text || o.title || '').trim()
        hint = String(o.hint || o.desc || o.description || '').trim()
        recommended = o.recommended === true
      }
      if (!label || seen.has(label)) continue
      seen.add(label)
      if (recommendedLabel && label === recommendedLabel) recommended = true
      items.push({
        label,
        ...(fork.option_hints && hint ? { hint } : {}),
        ...(fork.recommended && recommended ? { recommended: true } : {}),
      })
      if (items.length >= 6) break
    }

    if (fork.recommended) {
      const marked = items.filter((o) => o.recommended)
      if (marked.length > 1) {
        let keepFirst = true
        for (const o of items) {
          if (!o.recommended) continue
          if (keepFirst) {
            keepFirst = false
            continue
          }
          delete o.recommended
        }
      }
    } else {
      for (const o of items) delete o.recommended
    }

    return items
  }

  private forkFingerprint(
    question: string,
    options: string[],
    forkGroup: string,
    step?: number,
  ): string {
    const q = question.trim().toLowerCase().replace(/\s+/g, ' ')
    const opts = [...options].map((o) => o.trim().toLowerCase()).sort()
    return `${forkGroup}#${step ?? 0}::${q}::${opts.join('|')}`
  }

  private collectAskEvidence(chatId: string): AgentAskContextEvidence | undefined {
    const tree = this.registry.getTree(chatId)
    let best: { url: string; title: string; windowId: string } | null = null
    for (const s of tree) {
      for (const w of s.windows) {
        const url = String(w.url || '').trim()
        if (!url || url === 'about:blank') continue
        const title = String(w.title || '').trim()
        const candidate = { url, title, windowId: w.windowId }
        if (!best || w.visible) best = candidate
        if (w.visible) return {
          url: best.url,
          title: best.title || undefined,
          windowId: best.windowId,
          snippet: best.title && best.title !== best.url ? best.title : undefined,
        }
      }
    }
    if (!best) return undefined
    return {
      url: best.url,
      title: best.title || undefined,
      windowId: best.windowId,
      snippet: best.title && best.title !== best.url ? best.title : undefined,
    }
  }
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

/** Soft stop hints so simple lookups don't wander for 15+ tool calls. */
function efficiencyNudge(toolCalls: number): string | null {
  if (toolCalls === 4) {
    return (
      `效率提醒：本任务已调用工具 ${toolCalls} 次。若首页或当前页已能回答用户，请立刻用中文给出最终答复并停止工具。` +
      `查版本类：不要再 back/点下一篇公告。file_download 已成功则不要再 file_list。`
    )
  }
  if (toolCalls === 6) {
    return (
      `效率警告：已调用工具 ${toolCalls} 次。请基于已收集信息立即作答，禁止继续 navigate/click/find/back/file_list。` +
      `信息不全也先给出目前结论，并可说明尚不确定的部分。`
    )
  }
  if (toolCalls >= 8 && toolCalls % 2 === 0) {
    return `强制停止浏览：工具已 ${toolCalls} 次。下一轮必须只输出对用户的中文最终回答，不得再调用任何工具。`
  }
  return null
}

function formatDownloadBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B'
  if (n < 1024) return `${Math.floor(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function truncateJson(v: unknown, max: number): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

/** Prefer truncating large string fields so ok/error/partial stay visible to the model. */
function truncateJsonForModel(v: unknown, max: number): string {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const obj = { ...(v as Record<string, unknown>) }
    for (const key of ['value', 'body', 'content', 'html', 'text'] as const) {
      if (typeof obj[key] === 'string' && (obj[key] as string).length > max / 2) {
        const s = obj[key] as string
        obj[key] = `${s.slice(0, Math.floor(max / 2))}\n…[truncated ${s.length - Math.floor(max / 2)} chars]`
        obj.truncated = true
      }
    }
    const s = JSON.stringify(obj)
    if (s.length <= max) return s
    return `${s.slice(0, max)}…[truncated]`
  }
  return truncateJson(v, max)
}

function normalizeLlmText(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    return raw
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text || '')
        }
        return ''
      })
      .join('')
  }
  if (raw == null) return ''
  return String(raw)
}

/** Cloudflare-style Turnstile sitekeys often appear beside page URLs. */
const SPAWN_SITEKEY_RE = /0x4[A-Za-z0-9_-]{20,}/g

function extractSpawnSitekeys(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(SPAWN_SITEKEY_RE)) {
    const k = m[0]
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

/**
 * Pull URLs / sitekeys from recent parent messages so the child briefing is self-contained
 * even when the parent model omits them from `context`.
 */
function enrichSubchatContextFromParent(
  parent: { messages?: ChatMessage[] },
  goal: string,
  context: string,
): string {
  const recent = (parent.messages || []).slice(-24)
  const corpus = recent
    .filter(
      (m) =>
        m.role === 'user' ||
        m.role === 'assistant' ||
        m.role === 'log' ||
        m.role === 'tool',
    )
    .map((m) => {
      const body = String(m.content || '')
      if (m.role !== 'tool' || !m.meta) return body
      const bits = [body]
      if (m.meta.result != null) {
        try {
          bits.push(typeof m.meta.result === 'string' ? m.meta.result : JSON.stringify(m.meta.result))
        } catch {
          /* ignore */
        }
      }
      if (m.meta.args != null) {
        try {
          bits.push(typeof m.meta.args === 'string' ? m.meta.args : JSON.stringify(m.meta.args))
        } catch {
          /* ignore */
        }
      }
      return bits.join('\n')
    })
    .join('\n')
  if (!corpus.trim()) return context

  const already = `${goal}\n${context}`
  const missingUrls = extractHttpUrls(corpus)
    .filter((u) => !already.includes(u))
    .slice(0, 8)
  const missingKeys = extractSpawnSitekeys(corpus)
    .filter((k) => !already.includes(k))
    .slice(0, 4)
  if (!missingUrls.length && !missingKeys.length) return context

  const bits: string[] = []
  if (missingUrls.length) bits.push(`相关链接：${missingUrls.join('\n')}`)
  if (missingKeys.length) bits.push(`sitekey：${missingKeys.join(' ')}`)
  const auto = bits.join('\n')
  return context ? `${context}\n\n【系统补全自父对话】\n${auto}` : `【系统补全自父对话】\n${auto}`
}

/** Join per-round CoT for the live thinking panel (whole current run). */
function formatRunReasoning(parts: string[]): string {
  const list = parts.map((p) => p.trim()).filter(Boolean)
  if (!list.length) return ''
  if (list.length === 1) return list[0]
  return list.map((t, i) => `【第 ${i + 1} 轮】\n${t}`).join('\n\n')
}

/** Pull a short title candidate from reasoning_content when content is empty. */
function extractTitleFromReasoning(raw: unknown, userText = ''): string {
  const text = normalizeLlmText(raw).trim()
  if (!text) return ''
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const candidates: string[] = []
  for (const rawLine of lines) {
    let line = rawLine
    line = line.replace(/^[-*•\d.、]+\s*/, '')
    line = line.replace(/^(标题|title)\s*[:：]\s*/i, '')
    line = line.replace(/^["'`「『]+|["'`」』]+$/g, '').trim()
    if (line.length < 2 || line.length > 80 || /[。！？；：:]$/.test(line)) continue
    if (isMetaTitleLeak(line)) continue
    candidates.push(line)
  }
  if (!candidates.length) return ''

  // Prefer early non-peripheral candidates (reasoning often ends with verify/size checks).
  const primary = candidates.find((c) => isUsableChatTitle(c, userText))
  return primary || candidates.find((c) => !isMetaTitleLeak(c)) || ''
}

/** Reasoning / prompt-leak fragments that must never become sidebar titles. */
function isMetaTitleLeak(title: string): boolean {
  const t = (title || '').trim()
  if (!t) return true
  if (/[：:]\s*$/.test(t)) return true
  // Meta / chain-of-thought crumbs seen in real chats.
  if (
    /^(现在[,，]?\s*)?(构思标题|构思一下|思考标题|思考过程|尝试几个选项|另一个想法|可能的标题|关键元素)/u.test(
      t,
    )
  ) {
    return true
  }
  if (/^(用户需要|用户想要|我需要|首先[，,]|然后[，,]|最后[，,]|接下来[，,])/u.test(t)) return true
  // Quoted draft leftovers: 「官网下载QQ安装包」–
  if (/^[「『"'`].+[」』"'`]\s*[–—\-·•]*$/u.test(t)) return true
  return false
}

/** Title is short, on-topic, and not a side verification / meta leak. */
function isUsableChatTitle(title: string, userText: string): boolean {
  if (!title || isMetaTitleLeak(title)) return false
  if (isPeripheralTitle(title, userText)) return false
  // Reject near-raw task restatements that still include URL host leftovers.
  if (/https?:\/\//i.test(title) || /\b0x[a-zA-Z0-9_-]{8,}\b/.test(title)) return false
  return true
}

/** True when title looks like a side verification step rather than the main ask. */
function isPeripheralTitle(title: string, userText: string): boolean {
  const t = (title || '').trim()
  if (!t) return true
  const peripheral =
    /^(检查|查看|确认|统计|核对).{0,6}(字数|大小|体积|字节|文件大小|是否成功|结果)$/u.test(t) ||
    /^(字数|大小|体积|字节)$/u.test(t) ||
    /检查字数|统计大小|查看大小|确认大小/u.test(t)
  if (!peripheral) return false
  // Only treat as peripheral when the user ask clearly has a stronger primary action.
  const ask = (userText || '').trim()
  return /下载|安装|打开|搜索|访问|获取|抓取|导出|上传|登录|注册|购买|预约|生成|查找|查询/u.test(ask)
}

/** Deterministic short title if the LLM path fails (still marks titleGenerated). */
function polishLocalTitle(userText: string): string | null {
  let t = (userText || '').trim().replace(/\s+/g, ' ')
  if (!t) return null
  t = t.split(/\r?\n/)[0]?.trim() || t
  // Drop parent-task wrappers and trailing verification clauses.
  t = t.replace(/【父任务上下文】[\s\S]*$/u, '').trim()
  t = t.replace(/[，,、；;].{0,20}(检查|查看|确认|统计).{0,8}(大小|字数|体积|是否成功|结果).*$/u, '')
  t = t.replace(/https?:\/\/\S+/gi, '')
  t = t.replace(/\bSitekey\s*(为|=|:)?\s*0x[a-zA-Z0-9_-]+/gi, '')
  t = t.replace(/^(请|麻烦|帮我|帮忙)?(看一下|看看|查一下|查询|检查|帮查)?/u, '')
  t = t.replace(/[。！？.!?：:]+$/u, '').trim()
  t = t.replace(/\s+/g, ' ').trim()
  if (!t) t = (userText || '').trim().replace(/\s+/g, ' ')
  if (t.length > 80) t = t.slice(0, 80)
  if (!t || /^新\s*Chat$/i.test(t) || isMetaTitleLeak(t)) return null
  if (isPeripheralTitle(t, userText)) {
    // Keep a truncated primary slice of the original ask instead.
    let primary = (userText || '').trim().replace(/\s+/g, ' ')
    primary = primary.split(/\r?\n/)[0]?.trim() || primary
    primary = primary.replace(/【父任务上下文】[\s\S]*$/u, '').trim()
    primary = primary.replace(/[，,、；;].{0,20}(检查|查看|确认|统计).{0,8}(大小|字数|体积|是否成功|结果).*$/u, '')
    primary = primary.replace(/https?:\/\/\S+/gi, '')
    primary = primary.replace(/^(请|麻烦|帮我|帮忙)/u, '').trim()
    if (primary.length > 80) primary = primary.slice(0, 80)
    if (primary && isUsableChatTitle(primary, userText)) return primary
  }
  return t
}

function cleanChatTitle(raw: string): string | null {
  let t = raw.trim()
  if (!t) return null
  t = t.split(/\r?\n/)[0]?.trim() || ''
  t = t.replace(/^["'`「『【《]+|["'`」』】》]+$/g, '').trim()
  t = t.replace(/^(标题|title)\s*[:：]\s*/i, '').trim()
  t = t.replace(/\s*[–—\-·•]+\s*$/u, '').trim()
  t = t.replace(/[：:]\s*$/u, '').trim()
  t = t.replace(/\s+/g, ' ')
  if (!t || /^新\s*Chat$/i.test(t) || isMetaTitleLeak(t)) return null
  // Soft length clamp; sidebar shows CSS ellipsis (setTitle also caps at 80).
  if (t.length > 80) t = t.slice(0, 80)
  return t
}

