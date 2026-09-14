import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { linkifyBareUrlsInMarkdown } from '../../shared/url-text'

marked.setOptions({
  gfm: true,
  breaks: true,
})

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof HTMLAnchorElement && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/** Render Markdown to sanitized HTML for chat bubbles. */
export function renderMarkdown(src: string): string {
  // Pre-linkify bare URLs so marked GFM does not swallow CJK punctuation / prose.
  const prepared = linkifyBareUrlsInMarkdown(src || '')
  const raw = marked.parse(prepared, { async: false }) as string
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel', 'src', 'alt', 'title', 'loading'],
    ADD_TAGS: ['img'],
    // Allow relative workspace paths and blob: URLs produced after hydration.
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|blob|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  })
}
