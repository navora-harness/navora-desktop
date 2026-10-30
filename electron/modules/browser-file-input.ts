import type { WebContents } from 'electron'

/** Native file input adapter. The matching Electron build must include renderer read grants. */
export async function setBrowserFileInput(
  contents: WebContents,
  selector: string,
  files: string[],
  signal?: AbortSignal,
): Promise<'setFileInputFiles'> {
  if (signal?.aborted) throw new Error('aborted')
  const native = contents as WebContents & {
    setFileInputFiles?: (selector: string, files: string[], options?: {pierce?: boolean}) => Promise<void>
  }
  if (typeof native.setFileInputFiles !== 'function') throw new Error('native_file_input_unavailable')
  await native.setFileInputFiles(selector, files, {pierce:true})
  if (signal?.aborted) throw new Error('aborted')
  return 'setFileInputFiles'
}
