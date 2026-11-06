/** Navora shared types — P1 skeleton */
import type {ComposerDocument,ComposerDraftRecovery} from './composer-document'

export const DEFAULT_EDGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0'

export type PermissionMode = 'deny' | 'ask' | 'ask_chat' | 'allow_notify' | 'allow'

export type PermissionCapability =
  | 'session.create'
  | 'session.persist'
  | 'session.close'
  | 'session.clear'
  | 'session.set_proxy'
  | 'session.set_ua'
  | 'session.cookies_read'
  | 'session.cookies_write'
  | 'session.fetch'
  | 'window.create'
  | 'window.close'
  | 'window.set_visible'
  | 'navigate'
  | 'wait'
  | 'click'
  | 'type'
  | 'get_page'
  | 'evaluate'
  | 'screenshot'
  | 'desktop.screenshot'
  | 'network.request'
  | 'network.observe'
  | 'network.modify'
  | 'network.block'
  | 'file.read'
  | 'file.write'
  /** Agent-initiated workspace download via file_download / file_download_compose. */
  | 'file.download'
  /** Browser-intercepted download (click / navigation save), confirmed into workspace. */
  | 'file.download.passive'
  | 'shell.open'
  | 'shell.exec'
  | 'settings.read'
  | 'settings.write'
  /** Create / update Agent skills (always requires interactive consent). */
  | 'skills.write'
  /** Page requests device/browser geolocation (navigator.geolocation). */
  | 'browser.geolocation'
  /** Local pure computation (no browser/network/fs side effects), e.g. crypto tools. */
  | 'compute.local'

export type PermissionPreset = 'conservative' | 'balanced' | 'open' | 'custom'

export type ChatMessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'log'

export type BrowserContextKind = 'session' | 'window' | 'annotation'

/** Dragged / mentioned browser object for Agent context (reference chips). */
export type BrowserContextRef = {
  annotationId?: string
  annotationRevision?: number
  kind: BrowserContextKind
  sessionId: string
  windowId?: string
  label: string
  url?: string
  sessionIndex?: number
}

export type ChatMessage = {
  id: string
  role: ChatMessageRole
  content: string
  createdAt: number
  meta?: {
    /** Host-assigned identity for a started run; absent on legacy or idle UI messages. */
    runId?: string
    /** Append order within a run; updates keep their original sequence. */
    runSequence?: number
    /** Monotonic transcript revision for a direct child conversation. */
    subchatVersion?: number
    /** Initial user message; inserted corrections remain part of the same run. */
    turnId?: string
    /** Distinguishes execution narration from a completed answer after streaming ends. */
    phase?: 'progress' | 'final'
    /** Explicit resource presentation; absence preserves legacy delivery associations. */
    fileOutputs?: Array<{path:string;purpose:import('./workspace-resources').ResourcePurpose}>
    resourcePurpose?: import('./workspace-resources').ResourcePurpose
    refs?: BrowserContextRef[]
    document?: ComposerDocument
    taskConstraints?: import('./task-declarations').RuntimeTaskConstraints
    clientMessageId?: string
    [key: string]: unknown
  }
}

/** Per-chat permission override; new chats inherit from app settings. */
export type ChatPermissions = {
  preset: PermissionPreset
  modes: Record<PermissionCapability, PermissionMode>
}

/** Main sidebar chat vs Agent-spawned sub-conversation. */
export type ChatKind = 'main' | 'sub'

export type SubChatSpawnStatus = 'running' | 'done' | 'failed' | 'cancelled'
export type SubChatRunStatus = SubChatSpawnStatus | 'interrupted'
export type SubChatRun = {id:string;attempt:number;status:SubChatRunStatus;startedAt?:number;finishedAt?:number;reason?:string;summary?:string}
/** Lightweight direct-child index. Transcripts are fetched separately through chats.get. */
export type SubchatIndexItem = {id:string;parentChatId:string;title:string;purpose:string;status:SubChatRunStatus;run?:SubChatRun;createdAt:number;updatedAt:number;revision:number;messageVersion:number;summary:string;messageCount:number;unread?:boolean;pendingCount:number;resourceCount?:number;resourcesTruncated?:boolean}
export type SubchatsPending = {asks:AgentAskRequest[];permissions:PermissionRequest[]}

export type ChatSession = {
  queuedMessages?: QueuedMessage[]
  queuePaused?: boolean
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
  /** Absolute path override for this chat's file workspace (optional). */
  workspaceRoot?: string
  /**
   * Plugin-dev mode: session-scoped 外链 plugins (absolute dist paths).
   * Applies to this chat and its sub-chats only; not written to global plugins/index.json.
   * Only stored on main chats (`kind !== 'sub'`); sub-chats inherit via parentChatId.
   */
  devPluginLinks?: Array<{ id: string; path: string }>
  /** True after auto-title is locked (AI polish, fallback, skip, or user rename). */
  titleGenerated?: boolean
  /** User titles are never replaced by automatic topic/title generation. */
  titleSource?: 'auto' | 'user'
  /** Pinned chats stay at the top of the sidebar list. */
  pinned?: boolean
  /** When the chat was last pinned (sort key among pinned). */
  pinnedAt?: number
  /** Chat-scoped permission preset/modes (falls back to settings when absent). */
  permissions?: ChatPermissions
  /** Preferred AI provider id from `ai.providers`; falls back to `ai.default_provider`. */
  providerId?: string
  /** Preferred model id within the provider; falls back to provider.model. */
  model?: string
  /** Selected UI reasoning tier; resolved through provider.model_settings. */
  reasoningLevel?: string
  executionMode?: 'auto' | 'chat' | 'agent'
  /** Unsent composer draft (Telegram-style; synced across local + remote clients). */
  draft?: string
  /** Last draft write time (ms); legacy clients use it alongside revisioned document saves. */
  draftUpdatedAt?: number
  draftDocument?: ComposerDocument
  /** Preserve an unreadable/newer structured draft verbatim until a compatible app restores it. */
  draftUnsupportedDocument?: unknown
  draftUnsupportedRecoveries?: unknown[]
  /** Monotonic, including clears, so an older remote draft cannot reappear. */
  draftRevision?: number
  draftClearedFromRevision?: number
  draftRecoveries?: ComposerDraftRecovery[]
  draftConflict?: {recoveryId:string;expectedRevision:number;actualRevision:number}
  acceptedClientMessageIds?: Array<{id:string;acceptedAt:number;fingerprint?:string}>
  /** Default `main`. Sub-chats are spawned by Agent and hidden from the primary sidebar. */
  kind?: ChatKind
  /** Parent chat id when `kind === 'sub'`. */
  parentChatId?: string
  /** Parent tool_call id that spawned this sub-chat (for progress UI on the parent card). */
  parentToolCallId?: string
  /** Agent-declared goal for this sub-chat. */
  spawnPurpose?: string
  /** Lifecycle of an Agent-spawned sub-chat. */
  spawnStatus?: SubChatSpawnStatus
  /** Current attempt, including follow-up messages; independent of the original delegation result. */
  subchatRun?: SubChatRun
  /** Immutable first delegation receipt; follow-up runs must not rewrite the parent's original result. */
  spawnResult?: {runId:string;status:Exclude<SubChatSpawnStatus,'running'>;finishedAt?:number;summary:string}
  subchatRevision?: number
  subchatMessageVersion?: number
  /**
   * Unlimited (timeoutMs === 0) 询问/决策 parked across restarts.
   * Timed asks are not stored. Cleared on answer, deny, stop, or delete.
   */
  pendingAsk?: AgentAskRequest
}

export type QueuedMessage = {modelIdentity?:import('./model-selection').ModelSelectionIdentity;id:string;content:string;refs?:BrowserContextRef[];document?:ComposerDocument;taskConstraints?:import('./task-declarations').RuntimeTaskConstraints;clientMessageId?:string;revision?:number;createdAt:number;error?:string}

export type BrowserTreeWindow = {
  /** Actual page/task origin, independent from a shared storage session. */
  chatId?: string
  manualMuted?:boolean
  muteReason?:'manual'|'agent'
  desiredUrl?:string
  pinned?:boolean
  muted?:boolean
  audible?:boolean
  order?:number
  hostActive?:boolean
  tabRevision?:number
  persistent?:boolean
  viewport?: {width:number;height:number}|null
  zoomFactor?:number
  canGoBack?:boolean
  canGoForward?:boolean
  crashed?:boolean
  loadError?:import('./browser-workspace').BrowserLoadError
  annotationSelecting?:boolean
  tabKey?: string
  pageId?: string
  hostWindowId?: string
  presentation?: 'embedded' | 'detached'
  selected?:boolean
  manualControl?: boolean
  automation?: import('./browser-automation').BrowserAutomationState
  windowId: string
  sessionId: string
  title: string
  faviconUrl?: string
  url: string
  visible: boolean
  loading: boolean
  /** Current outer bounds when available. */
  width?: number
  height?: number
  x?: number
  y?: number
}

export type BrowserTreeSession = {
  scope?: BrowserSessionScope
  /** False only for the always-present, not-yet-created default storage entry. */
  initialized?: boolean
  sessionId: string
  chatId: string
  sessionIndex: number
  /** Stable profile-wide display number; independent of the storage partition index. */
  displayIndex?: number
  partition: string
  persist: boolean
  name?: string
  isDefault?: boolean
  windows: BrowserTreeWindow[]
}
export type BrowserSessionScope = 'default' | 'temporary' | 'persistent'
export type BrowserSessionCreateOptions = { scope?: BrowserSessionScope; persist?: boolean; ua?: string }
export type BrowserSessionManageOptions = { chatId?: string; confirmedSharedImpact?: boolean }
export type BrowserSessionUpdate = { name?: string; isDefault?: boolean }
export type BrowserSessionManageAction = 'close-pages' | 'clear-data' | 'delete'
export type BrowserSessionManageResult = { action: BrowserSessionManageAction; closedPages: number; remainingPages: number; deleted: boolean }

export type AppInfo = {
  name: string
  version: string
  electron: string
  chrome: string
  dataRoot: string
  /** True for portable / dev data next to the app; false for NSIS → %APPDATA%/Navora */
  portable?: boolean
}

export type PermissionDecision =
  | 'allow'
  | 'deny'
  | 'allow_once'
  | 'allow_chat'
  | 'always_allow'
  | 'always_deny'

export type PermissionRequest = {
  id: string
  chatId: string
  capability: PermissionCapability
  detail: string
  timeoutMs: number
}

export type AgentAskKind = 'continue_rounds' | 'user_choice' | 'download_confirm'

export type AgentAskOption = {
  label: string
  /** Short consequence / explanation under the label */
  hint?: string
  /** Model-marked preferred choice */
  recommended?: boolean
}

export type AgentAskContextEvidence = {
  url?: string
  title?: string
  snippet?: string
  windowId?: string
}

export type AgentAskCancelPayload = {
  id: string
  reason?: 'timeout' | 'aborted' | 'resolved' | 'deny'
}

export type AgentAskRequest = {
  id: string
  chatId: string
  kind: AgentAskKind
  question: string
  options: string[]
  /** Rich options when hints / recommended are enabled */
  optionItems?: AgentAskOption[]
  allowCustom: boolean
  timeoutMs: number
  /** When the ask originates from a sub-chat, parent id for sidebar bubbling. */
  parentChatId?: string
  /** Sub-chat title shown in ask UI when bubbling to parent. */
  subChatTitle?: string
  /** For continue_rounds / multi-step forks */
  meta?: {
    taskConstraints?:import('./task-declarations').RuntimeTaskConstraints
    roundsUsed?: number
    continueBy?: number
    roundBudget?: import('./agent-progress-policy').AgentRoundBudget
    /** 1-based step index in a continuous / hierarchical fork chain */
    step?: number
    /** Total planned steps when known */
    totalSteps?: number
    /** Shared id for a cascade group (e.g. stress-test setup) */
    forkGroup?: string
    /** Short label for the chain, shown in UI */
    forkTitle?: string
    /** Prior answers in this forkGroup (for cascade UI) */
    priorAnswers?: Array<{ step?: number; question: string; answer: string }>
    /** Browser download confirm details (UI truncates long paths/URLs) */
    downloadFilename?: string
    downloadRelPath?: string
    downloadUrl?: string
    downloadSizeLabel?: string
  }
  /** Optional live page evidence for the decision */
  evidence?: AgentAskContextEvidence
}

export type AgentAskResponse = {
  id: string
  /** Selected option text, custom input, or empty when skipped/denied */
  answer: string
  source: 'option' | 'custom' | 'deny' | 'timeout' | 'aborted'
}

export type AgentPhase =
  | 'idle'
  | 'thinking'
  | 'calling_tool'
  | 'awaiting_permission'
  | 'awaiting_user'
  | 'awaiting_skill_review'
  | 'observing'

export type AgentEvent =
  | { type: 'status'; chatId: string; running: boolean; parentChatId?: string }
  | {
      type: 'phase'
      chatId: string
      phase: AgentPhase
      detail?: string
      toolName?: string
      parentChatId?: string
    }
  /** Model chain-of-thought (e.g. reasoning_content). Live during a round; clear when the run ends. */
  | {
      type: 'reasoning'
      chatId: string
      content: string
      /** live = expanded progress; done = fold after round; clear = hide live panel */
      status: 'live' | 'done' | 'clear'
      round?: number
      parentChatId?: string
    }
  /** Transient current-round answer; only the final normalized message is persisted. */
  | { type: 'answer_preview'; chatId: string; content: string; parentChatId?: string }
  | { type: 'message'; chatId: string; message: ChatMessage }
  | { type: 'message_update'; chatId: string; message: ChatMessage }
  | { type: 'error'; chatId: string; error: string; parentChatId?: string }
  | { type: 'title'; chatId: string; title: string; fromAi?: boolean }
  | {
      type: 'done'
      chatId: string
      /** Legacy string[] or structured chips with optional executable actions. */
      followups?: Array<string | import('./followups').FollowupSuggestion>
      parentChatId?: string
    }
  | {
      type: 'subchat'
      chatId: string
      parentChatId: string
      status: SubChatSpawnStatus
      summary?: string
    }

/** Synced to local window + remote web clients when chat store mutates outside agent streams. */
export type ChatChangedEvent =
  | { type: 'upsert'; chatId: string }
  | { type: 'removed'; chatId: string }
  | { type: 'list' }

/** Agent skill create/update/delete/export — UI review dialog (not permission gate). */
export type SkillReviewAction = 'create' | 'update' | 'delete' | 'export'

export type SkillReviewDraft = {
  name: string
  description: string
  body: string
  /** Optional freeform skill version. */
  version?: string
  enabled?: boolean
  disableModelInvocation?: boolean
}

/** Pending skill change awaiting user confirm (可稍后在设置中打开). */
export type SkillProposal = {
  id: string
  createdAt: number
  updatedAt: number
  chatId?: string
  action: SkillReviewAction
  skillId?: string
  draft: SkillReviewDraft
  markdown?: string
  existing?: { id: string; name: string; description: string }
}

export type SkillReviewRequest = {
  id: string
  chatId: string
  action: SkillReviewAction
  skillId?: string
  draft?: SkillReviewDraft
  markdown?: string
  existing?: { id: string; name: string; description: string }
  /** 0 = no timeout (wait:false or deferred). */
  timeoutMs: number
  /** If false, agent continues immediately; dialog has no deadline. */
  wait: boolean
  /** Show「稍后处理」for create/update; delete/export are never deferrable. */
  canDefer: boolean
  proposalId: string
}

export type SkillReviewResponse = {
  id: string
  source: 'confirm' | 'cancel' | 'timeout' | 'aborted' | 'deferred'
  /** Edited draft when confirming create/update */
  draft?: SkillReviewDraft
  /** Absolute path when export confirmed and file written */
  exportPath?: string
  proposalId?: string
  /** Applied skill after confirm (create/update) */
  skill?: {
    id: string
    name: string
    description: string
    version?: string
    enabled: boolean
    disableModelInvocation: boolean
  }
}

/** Chromium will-download intercept (browser click / navigation download). */
export type BrowserDownloadState =
  | 'intercepted'
  | 'started'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type BrowserDownloadEntry = {
  id: string
  source?: 'browser' | 'tool'
  chatId: string
  sessionId: string
  windowId?: string
  state: BrowserDownloadState
  url: string
  filename: string
  savePath?: string
  relPath?: string
  receivedBytes?: number
  totalBytes?: number
  error?: string
  createdAt: number
  updatedAt: number
  /** UI: pause is available (in-progress + live DownloadItem). */
  canPause?: boolean
  /** UI: resume is available (paused + live item that canResume). */
  canResume?: boolean
  /** UI: cancel is available (not finished + live item, or still awaiting confirm). */
  canCancel?: boolean
}

export type BrowserDownloadsChanged = {
  downloads: BrowserDownloadEntry[]
  /** Monotonic for this application run; optional for older clients. */
  revision?: number
  /** Separates revisions after a server restart without remounting a remote UI. */
  instanceId?: string
}

export type BrowserDownloadsApi = {
  list: (chatId?: string) => Promise<BrowserDownloadEntry[]>
  icon?: (id: string, chatId?: string) => Promise<string | undefined>
  clear: (chatId?: string) => Promise<{ ok: true; removed: number }>
  remove: (id: string, chatId?: string) => Promise<{ ok: boolean; error?: string }>
  pause: (id: string, chatId?: string) => Promise<{ ok: boolean; error?: string }>
  resume: (id: string, chatId?: string) => Promise<{ ok: boolean; error?: string }>
  cancel: (id: string, chatId?: string) => Promise<{ ok: boolean; error?: string }>
  reveal: (id: string, chatId?: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  open: (id: string, chatId?: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  onChanged: (cb: (payload: BrowserDownloadsChanged) => void) => () => void
}

export type AppFullscreenState={fullscreen:boolean}
export type AppFullscreenToggleResult=AppFullscreenState&{ok:boolean}
