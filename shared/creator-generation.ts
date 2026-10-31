import { extractThinkBlocks } from './llm-reply-normalize'
import { CREATOR_FILES, type CreatorFiles } from './creators'

/** Extract a complete JSON object, ignoring local-model reasoning and prose fences. */
export function parseCreatorGeneration(raw: string): CreatorFiles {
  if (raw.length > 1_000_000) throw new Error('generation_invalid')
  const source = extractThinkBlocks(raw).text.trim()
  const names = new Set(Object.values(CREATOR_FILES).flat())
  let candidates = 0
  for (let start = source.indexOf('{'); start >= 0 && candidates++ < 32; start = source.indexOf('{', start + 1)) {
    let quoted = false, escaped = false, depth = 0
    for (let index = start; index < source.length; index++) {
      const char = source[index]
      if (quoted) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') quoted = false
      } else if (char === '"') quoted = true
      else if (char === '{') depth++
      else if (char === '}' && --depth === 0) {
        try {
          const parsed = JSON.parse(source.slice(start, index + 1))
          const mapping = parsed?.files || (Object.keys(parsed || {}).length && Object.keys(parsed).every(name => names.has(name)) ? parsed : null)
          if (!mapping || Array.isArray(mapping) || typeof mapping !== 'object') break
          const files = { ...mapping }
          // A manifest may be emitted as a JSON object rather than an escaped string.
          if (files['plugin.json'] && typeof files['plugin.json'] === 'object' && !Array.isArray(files['plugin.json'])) files['plugin.json'] = JSON.stringify(files['plugin.json'], null, 2)
          return files as CreatorFiles
        } catch { break }
      }
    }
  }
  throw new Error('generation_invalid')
}
