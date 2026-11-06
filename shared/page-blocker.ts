/** Host observations are deliberately separate from successful DOM/script reads. */
export type PageBlockerState = 'unknown' | 'not_observed' | 'suspected' | 'confirmed'
export type PageBlockerKind = 'human_verification' | 'login_required' | 'permission_prompt' | 'site_dialog' | 'other_overlay' | 'unknown'
export type PageBlockerEvidence = {
  kind: 'visible_verification_text' | 'visible_challenge_control' | 'suspected_frame' | 'blocking_container' | 'foreground_hit_test'
  processId?: number; routingId?: number; documentId?: number
}
export type PageBlockerSummaryV1 = {
  version: 1; chatId: string; windowId: string; webContentsId: number
  documentEpoch: number; controlEpoch: number; observedAt: number; observationId: string
  layoutRevision: string
  state: PageBlockerState; kind: PageBlockerKind
  coverage: 'complete_for_scope' | 'partial' | 'unavailable'
  scope: 'visible_viewport'; reasonCodes: string[]; omittedFrames: number; truncated: boolean
  evidence: PageBlockerEvidence[]
  requiresUser: boolean; blocksInteraction: 'yes' | 'no' | 'unknown'
  followup: 'none' | 'one_read_only_probe' | 'user_handoff'; probeUsed: boolean
  /** A prior confirmed observation is retained when the page is rechecked. */
  previouslyBlockedAt?: number; clearedAt?: number
}

export type PageBlockerProbe = {
  verificationText: boolean; challengeControl: boolean; suspectedFrame: boolean
  blockingContainer: boolean; foreground: boolean; visible: boolean
  kind: PageBlockerKind; partial: boolean
  processId?: number; routingId?: number; documentId?: number
}

export function classifyPageBlocker(probes: PageBlockerProbe[], available: boolean, partial: boolean): Pick<PageBlockerSummaryV1, 'state' | 'kind' | 'requiresUser' | 'blocksInteraction' | 'evidence'> {
  const visible = probes.filter(probe => probe.visible)
  const confirmed = visible.filter(probe => probe.foreground && probe.blockingContainer &&
    ((probe.kind === 'human_verification' && (probe.verificationText || probe.challengeControl)) ||
      (probe.kind !== 'unknown' && probe.challengeControl))).sort((a,b)=>{
        const rank=(kind:PageBlockerKind)=>kind==='human_verification'?0:kind==='login_required'?1:kind==='permission_prompt'?2:3
        return rank(a.kind)-rank(b.kind)
      })[0]
  const suspect = visible.find(probe => probe.verificationText || probe.challengeControl || probe.suspectedFrame)
  const selected = confirmed || suspect
  const evidence: PageBlockerEvidence[] = []
  if (selected) {
    const frame = { processId: selected.processId, routingId: selected.routingId, documentId: selected.documentId }
    if (selected.verificationText) evidence.push({ kind: 'visible_verification_text', ...frame })
    if (selected.challengeControl) evidence.push({ kind: 'visible_challenge_control', ...frame })
    if (selected.suspectedFrame) evidence.push({ kind: 'suspected_frame', ...frame })
    if (selected.blockingContainer) evidence.push({ kind: 'blocking_container', ...frame })
    if (selected.foreground) evidence.push({ kind: 'foreground_hit_test', ...frame })
  }
  return {
    state: confirmed ? 'confirmed' : suspect ? 'suspected' : !available || partial ? 'unknown' : 'not_observed',
    kind: selected?.kind || 'unknown', requiresUser: !!confirmed && ['human_verification','login_required','permission_prompt'].includes(confirmed.kind),
    blocksInteraction: confirmed ? 'yes' : suspect || !available || partial ? 'unknown' : 'no', evidence: evidence.slice(0, 4),
  }
}

/** Preserve host metadata verbatim while discarding untrusted/unsupported keys. */
export function compactPageBlocker(value: unknown): PageBlockerSummaryV1 | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const v = value as PageBlockerSummaryV1
  if (v.version !== 1 || !['unknown','not_observed','suspected','confirmed'].includes(v.state)) return undefined
  const text = (input: unknown, size = 96) => typeof input === 'string' ? input.slice(0, size) : ''
  const number = (input: unknown) => typeof input === 'number' && Number.isFinite(input) ? input : 0
  return {
    version: 1, chatId: text(v.chatId), windowId: text(v.windowId), webContentsId: number(v.webContentsId),
    documentEpoch: number(v.documentEpoch), controlEpoch: number(v.controlEpoch), observedAt: number(v.observedAt), observationId: text(v.observationId), layoutRevision: text(v.layoutRevision),
    state: v.state, kind: ['human_verification','login_required','permission_prompt','site_dialog','other_overlay','unknown'].includes(v.kind) ? v.kind : 'unknown',
    coverage: ['complete_for_scope','partial','unavailable'].includes(v.coverage) ? v.coverage : 'unavailable', scope: 'visible_viewport',
    reasonCodes: Array.isArray(v.reasonCodes) ? v.reasonCodes.filter(code => typeof code === 'string' && /^[A-Z_]+$/.test(code)).slice(0, 8) : ['INVALID_OBSERVATION'],
    omittedFrames: number(v.omittedFrames), truncated: v.truncated === true,
    evidence: Array.isArray(v.evidence) ? v.evidence.filter(item => item && ['visible_verification_text','visible_challenge_control','suspected_frame','blocking_container','foreground_hit_test'].includes(item.kind)).slice(0,4).map(item => ({kind:item.kind,...(typeof item.processId==='number'?{processId:item.processId}:{}),...(typeof item.routingId==='number'?{routingId:item.routingId}:{}),...(typeof item.documentId==='number'?{documentId:item.documentId}:{})})) : [],
    requiresUser: v.state === 'confirmed' && v.requiresUser === true,
    blocksInteraction: ['yes','no','unknown'].includes(v.blocksInteraction) ? v.blocksInteraction : 'unknown',
    followup: ['none','one_read_only_probe','user_handoff'].includes(v.followup) ? v.followup : 'none', probeUsed: v.probeUsed === true,
    ...(typeof v.previouslyBlockedAt==='number'?{previouslyBlockedAt:v.previouslyBlockedAt}:{}),...(typeof v.clearedAt==='number'?{clearedAt:v.clearedAt}:{}),
  }
}
