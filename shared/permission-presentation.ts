const sensitiveKey=/(["']?[\w.-]*(?:authorization|set-cookie|cookie|password|passwd|token|secret|api[_-]?key|access[_-]?key|credential|private[_-]?key)[\w.-]*["']?\s*[:=]\s*)("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^,\s}\]]+)/gi

/** Hide credential-like values before untrusted tool arguments are shown in an approval card. */
export function permissionDetailForDisplay(detail:string):string{
  return String(detail||'')
    .replace(sensitiveKey,(_match,prefix:string,value:string)=>`${prefix}${value.startsWith('"')?'"[已隐藏]"':value.startsWith("'")?"'[已隐藏]'":'[已隐藏]'}`)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi,'$1 [已隐藏]')
    .replace(/([?&](?:token|key|secret|password|auth)=)[^&#\s"'},]*/gi,'$1[已隐藏]')
    .slice(0,600)
}
