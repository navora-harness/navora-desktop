export type WorkspacePreview = {
  ok: boolean
  path?: string
  kind?: 'text' | 'markdown' | 'image' | 'unsupported'
  mime?: string
  content?: string
  base64?: string
  size?: number
  truncated?: boolean
  reason?: 'file_type'|'image_too_large'|'binary'|'encoding'
  error?: string
}
export const previewTextLimit=262_144
export const previewImageLimit=12_582_912
export const previewImageMimes:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.bmp':'image/bmp','.svg':'image/svg+xml'}
export const previewBinaryExtensions=new Set(['.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.odt','.ods','.odp','.zip','.rar','.7z','.gz','.tar','.exe','.dll','.wasm','.woff','.woff2','.ttf','.otf','.mp3','.mp4','.m4a','.wav','.ogg','.flac','.webm','.mov','.avi','.sqlite','.db'])
