/** App-owned vector presets. File names are used only to select a fixed asset. */
const groups = [
  ['pdf', 'PDF', '#B63C45', 'pdf'],
  ['document', 'DOC', '#3767AA', 'doc docx odt rtf pages'],
  ['sheet', 'XLS', '#2B805D', 'xls xlsx xlsm ods csv tsv numbers'],
  ['slides', 'PPT', '#BE642F', 'ppt pptx odp key'],
  ['archive', 'ZIP', '#946E32', 'zip rar 7z tar gz bz2 xz tgz zst'],
  ['image', 'IMG', '#9270B1', 'png jpg jpeg gif webp svg avif bmp ico tif tiff heic'],
  ['video', 'VID', '#9560A0', 'mp4 mov mkv webm avi m4v wmv flv'],
  ['audio', 'AUD', '#B45A82', 'mp3 wav flac aac m4a ogg opus aiff'],
  ['code', '</>', '#477C91', 'js jsx ts tsx vue html css scss json jsonl xml yaml yml toml py go rs java c cpp h sh ps1 sql ipynb'],
  ['text', 'TXT', '#697A8D', 'txt md markdown log ini conf'],
  ['app', 'APP', '#5E7599', 'exe msi msix appx dmg pkg deb rpm apk appimage'],
] as const

const presets = new Map<string, {key:string;dataUrl:string}>()
for (const [kind,label,color,extensions] of groups) {
  // A folded page and a colored label remain legible in the 32 px file tile.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M8 3h11l6 6v18a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" fill="white" stroke="${color}" stroke-width="1.3"/><path d="M19 3v6h6" fill="${color}" fill-opacity=".14" stroke="${color}" stroke-width="1.3" stroke-linejoin="round"/><rect x="2" y="14" width="27" height="12" rx="3" fill="${color}"/><text x="15.5" y="22.4" fill="white" font-family="Segoe UI,Arial,sans-serif" font-size="8" font-weight="700" text-anchor="middle">${label.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</text></svg>`
  const asset = {key:`download-type-${kind}`,dataUrl:`data:image/svg+xml;base64,${btoa(svg)}`}
  for (const extension of extensions.split(' ')) presets.set(extension,asset)
}

export function downloadFileExtension(filename:string) {
  const name=filename.split(/[/\\]/).at(-1)||''
  const extension=/\.([a-z0-9]{1,16})$/i.exec(name)?.[1]?.toLowerCase()
  return extension||''
}

export function downloadFilePreset(filename:string) {
  return presets.get(downloadFileExtension(filename))
}
