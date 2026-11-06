/** Versioned, host-rendered questionnaires. Recommended options are never answers. */
export type QuestionnaireAnswerState = 'unanswered' | 'answered' | 'unknown' | 'delegate' | 'skip'
export type QuestionnaireAttachment = { id: string; name: string; size: number; path: string; sha256: string }
export type QuestionnaireAnswer = { state: QuestionnaireAnswerState; value?: string | string[] | boolean | number; other?: string; note?: string; dateRange?: { start: string; end: string }; attachments?: QuestionnaireAttachment[] }
export type QuestionnaireAnswers = Record<string, QuestionnaireAnswer>
export type QuestionnaireQuestion = {
  id: string; type: 'single' | 'multi' | 'toggle' | 'text' | 'textarea' | 'number' | 'date' | 'dateRange' | 'attachment'; title: string
  description?: string; required?: boolean; options?: Array<{id: string; label: string; description?: string; recommended?: boolean}>
  allowOther?: boolean; allowUnknown?: boolean; allowDelegate?: boolean; allowSkip?: boolean; allowNote?: boolean
  placeholder?: string; min?: number; max?: number; unit?: string
  showWhen?: { questionId: string; equals: string | boolean | number }
  minDate?: string; maxDate?: string
  accept?: string[]; maxFiles?: number; maxFileBytes?: number
}
export type QuestionnaireDefinition = { title: string; description?: string; questions: QuestionnaireQuestion[] }
export type QuestionnaireDraft = { revision: number; answers: QuestionnaireAnswers; supplement: string; updatedAt: number }
export type QuestionnaireDraftInput = { baseRevision: number; answers: QuestionnaireAnswers; supplement: string }
export type QuestionnaireDraftRecovery = QuestionnaireDraftInput & { id: string; savedAt: number }
export type QuestionnaireSubmission = { submissionId: string; submittedAt: number; revision: number; answers: QuestionnaireAnswers; supplement: string }
export type QuestionnaireRecord = QuestionnaireDefinition & {
  id: string; chatId: string; runId: string; toolCallId: string; schemaRevision: number
  parentChatId?: string; chatTitle?: string; taskConstraints?: import('./task-declarations').RuntimeTaskConstraints
  status: 'pending' | 'submitted' | 'cancelled' | 'stale'; createdAt: number; updatedAt: number
  draft: QuestionnaireDraft; recoveries?: QuestionnaireDraftRecovery[]; submission?: QuestionnaireSubmission; cancelReason?: string
  continuation?: { state: 'pending' | 'claimed' | 'done'; runId?: string; error?: string }
  files?: QuestionnaireAttachment[]
  source?: { kind: 'amendment' | 'template'; id: string; title: string }
}
export type QuestionnaireTemplate = QuestionnaireDefinition & { id: string; updatedAt: number; builtin?: boolean }
export type QuestionnaireValidationError = { questionId: string; message: string }
export type QuestionnaireSaveResult = { ok: boolean; record: QuestionnaireRecord; conflict?: QuestionnaireDraftRecovery; error?: string }
export type QuestionnaireSubmitInput = { revision: number; submissionId: string; answers?: QuestionnaireAnswers; supplement?: string }
export type QuestionnaireSubmitResult = { ok: boolean; record: QuestionnaireRecord; errors?: QuestionnaireValidationError[]; conflict?: boolean; error?: string }
export type QuestionnairesApi = {
  list(chatId?: string): Promise<QuestionnaireRecord[]>
  get(id: string): Promise<QuestionnaireRecord | null>
  saveDraft(id: string, input: QuestionnaireDraftInput): Promise<QuestionnaireSaveResult>
  submit(id: string, input: QuestionnaireSubmitInput): Promise<QuestionnaireSubmitResult>
  cancel(id: string, reason?: string): Promise<{ ok: boolean; record: QuestionnaireRecord; error?: string }>
  attach(id: string, questionId: string, files: Array<{ name: string; data: string }>): Promise<QuestionnaireAttachment[]>
  openAttachment(id: string, attachmentId: string): Promise<void>
  revise(id: string): Promise<QuestionnaireRecord>
  listTemplates(): Promise<QuestionnaireTemplate[]>
  saveTemplate(id: string, title: string): Promise<QuestionnaireTemplate>
  deleteTemplate(id: string): Promise<void>
  useTemplate(id: string, chatId: string): Promise<QuestionnaireRecord>
  onChanged(callback: (record: QuestionnaireRecord) => void): () => void
}

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(value)
export const MAX_QUESTIONNAIRE_FILE_BYTES = 10 * 1024 * 1024
export function validQuestionnaireDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
/** Dependencies only point backwards, so hidden ancestors cannot activate descendants. */
export function visibleQuestionnaireQuestions(questions: QuestionnaireQuestion[], answers: QuestionnaireAnswers): QuestionnaireQuestion[] {
  const visible = new Set<string>()
  return questions.filter(q => {
    const rule = q.showWhen, answer = rule ? answers[rule.questionId] : undefined
    const show = !rule || visible.has(rule.questionId) && answer?.state === 'answered' && (Array.isArray(answer.value) ? answer.value.includes(String(rule.equals)) : answer.value === rule.equals)
    if (show) visible.add(q.id)
    return show
  })
}
export function applicableQuestionnaireAnswers(questions: QuestionnaireQuestion[], answers: QuestionnaireAnswers): QuestionnaireAnswers {
  return Object.fromEntries(visibleQuestionnaireQuestions(questions, answers).filter(q => own(answers, q.id)).map(q => [q.id, answers[q.id]]))
}
export function questionnaireAnswerChanges(questions: QuestionnaireQuestion[], before: QuestionnaireAnswers, after: QuestionnaireAnswers, beforeSupplement = '', afterSupplement = '') {
  const previous=applicableQuestionnaireAnswers(questions,before),current=applicableQuestionnaireAnswers(questions,after)
  const changes=questions.filter(q=>JSON.stringify(previous[q.id])!==JSON.stringify(current[q.id])).map(q=>{
    const display=(answers:QuestionnaireAnswers)=>own(answers,q.id)?formatQuestionnaireAnswers([{...q,showWhen:undefined}],answers).slice(q.title.length+1):'不适用或未回答'
    return{questionId:q.id,title:q.title,before:display(previous),after:display(current)}
  })
  if(beforeSupplement!==afterSupplement)changes.push({questionId:'',title:'补充说明',before:beforeSupplement||'未填写',after:afterSupplement||'未填写'})
  return changes
}

export function validateQuestionnaireDefinition(value: unknown): string[] {
  if (!plain(value)) return ['问卷定义必须是对象']
  const errors: string[] = []
  if (!text(value.title, 200) || !(value.title as string).trim()) errors.push('问卷标题不能为空且最多 200 字符')
  if (value.description !== undefined && !text(value.description, 4000)) errors.push('问卷说明最多 4000 字符')
  if (!Array.isArray(value.questions) || !value.questions.length || value.questions.length > 30) return [...errors, '问卷需要 1 至 30 个问题']
  const ids = new Set<string>()
  for (const [index, q] of value.questions.entries()) {
    const prefix = `问题 ${index + 1}`
    if (!plain(q)) { errors.push(`${prefix}格式无效`); continue }
    if (!identifier(q.id) || ids.has(q.id as string)) errors.push(`${prefix}需要唯一且稳定的 ID`)
    ids.add(String(q.id))
    if (!['single','multi','toggle','text','textarea','number','date','dateRange','attachment'].includes(String(q.type))) errors.push(`${prefix}题型无效`)
    if (!text(q.title, 500) || !(q.title as string).trim()) errors.push(`${prefix}标题不能为空且最多 500 字符`)
    for (const key of ['description','placeholder','unit']) if (q[key] !== undefined && !text(q[key], key === 'description' ? 4000 : 300)) errors.push(`${prefix}的 ${key} 无效`)
    for (const key of ['required','allowOther','allowUnknown','allowDelegate','allowSkip','allowNote']) if (q[key] !== undefined && typeof q[key] !== 'boolean') errors.push(`${prefix}的 ${key} 必须是布尔值`)
    for (const key of ['min','max']) if (q[key] !== undefined && (typeof q[key] !== 'number' || !Number.isFinite(q[key]))) errors.push(`${prefix}的 ${key} 无效`)
    if (typeof q.min === 'number' && typeof q.max === 'number' && q.min > q.max) errors.push(`${prefix}的最小值不能超过最大值`)
    if (q.showWhen !== undefined) {
      const rule = q.showWhen
      const source = plain(rule) ? value.questions.slice(0,index).find((item: unknown) => plain(item) && item.id === rule.questionId) : undefined
      if (!plain(rule) || !source || !['single','multi','toggle','text','number','date'].includes(source.type) || !['string','boolean','number'].includes(typeof rule.equals) || (typeof rule.equals === 'number' && !Number.isFinite(rule.equals))) errors.push(`${prefix}的显示条件必须引用前面的可比较题目`)
      else if ((['single','multi'].includes(source.type) && (!Array.isArray(source.options) || !source.options.some((o: unknown) => plain(o) && o.id === rule.equals))) || (source.type === 'toggle' && typeof rule.equals !== 'boolean') || (source.type === 'number' && typeof rule.equals !== 'number') || (['text','date'].includes(source.type) && typeof rule.equals !== 'string')) errors.push(`${prefix}的显示条件答案无效`)
    }
    for (const key of ['minDate','maxDate']) if (q[key] !== undefined && (!['date','dateRange'].includes(String(q.type)) || !validQuestionnaireDate(q[key]))) errors.push(`${prefix}的日期限制无效`)
    if (typeof q.minDate === 'string' && typeof q.maxDate === 'string' && q.minDate > q.maxDate) errors.push(`${prefix}的开始日期不能晚于结束日期`)
    if (q.accept !== undefined && (q.type !== 'attachment' || !Array.isArray(q.accept) || q.accept.length > 30 || q.accept.some(v => typeof v !== 'string' || !/^\.[a-zA-Z0-9]{1,12}$/.test(v)))) errors.push(`${prefix}的附件扩展名无效`)
    for (const [key,limit] of [['maxFiles',10],['maxFileBytes',MAX_QUESTIONNAIRE_FILE_BYTES]] as const) if (q[key] !== undefined && (q.type !== 'attachment' || !Number.isSafeInteger(q[key]) || Number(q[key]) < 1 || Number(q[key]) > limit)) errors.push(`${prefix}的附件限制无效`)
    if (q.type === 'single' || q.type === 'multi') {
      if (!Array.isArray(q.options) || !q.options.length || q.options.length > 50) { errors.push(`${prefix}需要 1 至 50 个选项`); continue }
      const options = new Set<string>()
      for (const option of q.options) {
        if (!plain(option) || !identifier(option.id) || options.has(option.id) || !text(option.label, 500) || !(option.label as string).trim()) { errors.push(`${prefix}的选项 ID 或文案无效`); continue }
        options.add(option.id)
        if (option.description !== undefined && !text(option.description, 2000)) errors.push(`${prefix}选项说明过长`)
        if (option.recommended !== undefined && typeof option.recommended !== 'boolean') errors.push(`${prefix}推荐标记无效`)
      }
    } else if (q.allowOther) errors.push(`${prefix}仅选择题支持其他答案`)
  }
  return errors
}

/** Drafts may be incomplete, but malformed/unknown answers must never enter storage. */
export function validateQuestionnaireAnswers(questions: QuestionnaireQuestion[], answers: unknown, supplement: unknown = '', complete = true): QuestionnaireValidationError[] {
  const errors: QuestionnaireValidationError[] = []
  const add = (questionId: string, message: string) => errors.push({questionId,message})
  if (!plain(answers)) return [{questionId:'',message:'答案格式无效'}]
  if (!text(supplement, 20000)) add('', '补充说明最多 20000 字符')
  const ids = new Set(questions.map(q => q.id))
  const visible = new Set(visibleQuestionnaireQuestions(questions, answers as QuestionnaireAnswers).map(q => q.id))
  for (const id of Object.keys(answers)) if (!ids.has(id)) add(id, '答案不属于这份问卷')
  for (const q of questions) {
    const requiredNow = complete && visible.has(q.id)
    const a = own(answers,q.id) ? answers[q.id] : undefined
    if (a === undefined) { if (requiredNow && q.required) add(q.id,'请回答这道必填题'); continue }
    if (!plain(a) || !['unanswered','answered','unknown','delegate','skip'].includes(String(a.state))) { add(q.id,'答案状态无效'); continue }
    if (a.note !== undefined && (!q.allowNote || !text(a.note, 10000))) add(q.id,'备注无效或过长')
    if (a.other !== undefined && (!q.allowOther || !text(a.other, 10000))) add(q.id,'其他答案无效或过长')
    if (a.dateRange !== undefined && q.type !== 'dateRange') add(q.id,'这道题不接受日期范围')
    if (a.attachments !== undefined && q.type !== 'attachment') add(q.id,'这道题不接受附件')
    if (a.state !== 'answered') {
      if (own(a,'value') && a.value !== undefined) add(q.id,'未作答状态不能包含答案值')
      if (a.dateRange !== undefined || a.attachments !== undefined) add(q.id,'未作答状态不能包含日期或附件')
      if (a.state === 'unknown' && !q.allowUnknown) add(q.id,'这道题不允许选择不确定')
      if (a.state === 'delegate' && !q.allowDelegate) add(q.id,'这道题不能交给 Agent 决定')
      if (a.state === 'skip' && !q.allowSkip) add(q.id,'这道题不允许跳过')
      if (requiredNow && q.required && a.state === 'unanswered') add(q.id,'请回答这道必填题')
      continue
    }
    const other = typeof a.other === 'string' && !!a.other.trim()
    const optionIds = new Set((q.options || []).map(o => o.id))
    if (q.type === 'single') {
      if (typeof a.value !== 'string' || (a.value !== '' && !optionIds.has(a.value))) add(q.id,'请选择有效选项')
      else if (!a.value && requiredNow && !other) add(q.id,'请选择选项或填写其他答案')
    } else if (q.type === 'multi') {
      if (!Array.isArray(a.value) || a.value.some(v => typeof v !== 'string' || !optionIds.has(v)) || new Set(a.value).size !== a.value.length) add(q.id,'多选答案包含无效或重复选项')
      else if (requiredNow) { const count = a.value.length + (other ? 1 : 0); if (count < (q.min ?? 1)) add(q.id,`至少选择 ${q.min ?? 1} 项`); if (q.max !== undefined && count > q.max) add(q.id,`最多选择 ${q.max} 项`) }
    } else if (q.type === 'toggle') { if (typeof a.value !== 'boolean') add(q.id,'请选择开启或关闭') }
    else if (q.type === 'number') {
      if (typeof a.value !== 'number' || !Number.isFinite(a.value)) add(q.id,'请输入有效数字')
      else if (requiredNow && ((q.min !== undefined && a.value < q.min) || (q.max !== undefined && a.value > q.max))) add(q.id,'数字超出允许范围')
    } else if (q.type === 'date' || q.type === 'dateRange') {
      const values = q.type === 'date' ? [a.value] : plain(a.dateRange) ? [a.dateRange.start,a.dateRange.end] : []
      if (values.length !== (q.type === 'date' ? 1 : 2) || values.some(v => typeof v !== 'string' || (v !== '' && !validQuestionnaireDate(v)))) add(q.id,'请输入有效日期')
      else if (requiredNow && (values.some(v => !v || (q.minDate && String(v) < q.minDate) || (q.maxDate && String(v) > q.maxDate)) || (q.type === 'dateRange' && String(values[0]) > String(values[1])))) add(q.id,'请填写允许范围内的日期，开始日期不能晚于结束日期')
      if (q.type === 'dateRange' && a.value !== undefined) add(q.id,'日期范围格式无效')
    } else if (q.type === 'attachment') {
      if (a.value !== undefined || !Array.isArray(a.attachments) || a.attachments.some(f => !plain(f) || !identifier(f.id) || !text(f.name,255) || !(f.name as string).trim() || /[\\/\u0000-\u001f]/.test(String(f.name)) || typeof f.path !== 'string' || f.path.length > 4096 || !Number.isSafeInteger(f.size) || Number(f.size) < 0 || Number(f.size) > (q.maxFileBytes ?? MAX_QUESTIONNAIRE_FILE_BYTES) || (q.accept?.length && !q.accept.some(ext => String(f.name).toLowerCase().endsWith(ext.toLowerCase())))) || new Set(a.attachments?.map(f => f.id)).size !== a.attachments?.length) add(q.id,'附件格式、大小或类型无效')
      else if (a.attachments.length > (q.maxFiles ?? 5) || (requiredNow && !a.attachments.length)) add(q.id,`请选择 1 至 ${q.maxFiles ?? 5} 个附件`)
    } else if (!text(a.value, q.type === 'text' ? 4000 : 20000) || (requiredNow && !(a.value as string).trim())) add(q.id,'请输入有效内容')
  }
  return errors
}

export function formatQuestionnaireAnswers(record: Pick<QuestionnaireRecord,'questions'|'draft'|'submission'>): string
export function formatQuestionnaireAnswers(questions: QuestionnaireQuestion[], answers: QuestionnaireAnswers, supplement?: string): string
export function formatQuestionnaireAnswers(record: Pick<QuestionnaireRecord,'questions'|'draft'|'submission'> | QuestionnaireQuestion[], answers?: QuestionnaireAnswers, supplement = ''): string {
  const questions = Array.isArray(record) ? record : record.questions
  if (!Array.isArray(record)) { const snapshot = record.submission || record.draft; answers = snapshot.answers; supplement = snapshot.supplement }
  const labels = {unanswered:'未回答',unknown:'不确定',delegate:'由 Agent 决定',skip:'跳过'}
  const lines = visibleQuestionnaireQuestions(questions,answers || {}).map(q => {
    const a = answers?.[q.id]
    let value = !a || a.state === 'unanswered' ? labels.unanswered : a.state !== 'answered' ? labels[a.state] : Array.isArray(a.value) ? a.value.map(id => q.options?.find(o => o.id === id)?.label || id).join('、') : typeof a.value === 'boolean' ? (a.value ? '开启' : '关闭') : q.options?.find(o => o.id === a.value)?.label || String(a.value ?? '')
    if (a?.state === 'answered' && a.dateRange) value = `${a.dateRange.start} 至 ${a.dateRange.end}`
    if (a?.state === 'answered' && a.attachments) value = a.attachments.map(f => `${f.name}（${f.size} 字节，${f.path}）`).join('；')
    if (a?.other) value += `${value ? '；' : ''}其他：${a.other}`
    if (a?.note) value += `（备注：${a.note}）`
    return `${q.title}：${value}`
  })
  if (supplement) lines.push(`补充说明：${supplement}`)
  return lines.join('\n')
}
