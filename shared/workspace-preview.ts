export type WorkspacePreview = {
  ok: boolean
  path?: string
  kind?: 'text' | 'markdown' | 'image' | 'unsupported'
  mime?: string
  content?: string
  base64?: string
  size?: number
  truncated?: boolean
  error?: string
}
