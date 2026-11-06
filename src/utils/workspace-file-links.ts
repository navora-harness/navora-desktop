import {workspaceLinkPath} from '@shared/file-tabs'
import {getUiIcon} from '@shared/ui-icons'
import {workspaceFileDisplayPath} from '@shared/workspace-file-path'

function icon(name:string){
  const asset=getUiIcon(name,16),svg=document.createElementNS('http://www.w3.org/2000/svg','svg')
  svg.setAttribute('viewBox',`0 0 ${asset.size} ${asset.size}`);svg.setAttribute('aria-hidden','true');svg.setAttribute('class','chat-file-link-icon')
  for(const value of asset.paths){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',value.d);path.setAttribute('fill',asset.strokeWidth?'none':'currentColor');if(asset.strokeWidth){path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width',String(asset.strokeWidth))}svg.append(path)}
  return svg
}
/** Only app-created icon nodes are added after Markdown's existing sanitization. No file reads. */
export function decorateWorkspaceLinks(sanitizedHtml:string,inlineMedia=false,workspaceRoot?:string){
  const template=document.createElement('template');template.innerHTML=sanitizedHtml
  if(!inlineMedia)for(const img of template.content.querySelectorAll<HTMLImageElement>('img')){
    const source=img.getAttribute('data-src')||img.getAttribute('src')||'',path=workspaceLinkPath(source)
    if(!path)continue
    const anchor=document.createElement('a');anchor.setAttribute('href',path);anchor.textContent=img.alt||path.split('/').at(-1)||path
    ;(img.closest('a')||img).replaceWith(anchor)
  }
  for(const anchor of template.content.querySelectorAll<HTMLAnchorElement>('a[href]')){
    const path=workspaceLinkPath(anchor.getAttribute('href')||'');if(!path)continue
    anchor.classList.add('chat-file-link');anchor.setAttribute('data-workspace-path',path);anchor.setAttribute('title',workspaceFileDisplayPath(workspaceRoot,path));anchor.removeAttribute('target');anchor.prepend(icon(/\.(?:png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(path)?'image':'file-lines'))
  }
  if(inlineMedia)for(const image of template.content.querySelectorAll<HTMLImageElement>('img')){
    const path=workspaceLinkPath(image.getAttribute('data-src')||image.getAttribute('src')||'')
    if(path)image.setAttribute('title',workspaceFileDisplayPath(workspaceRoot,path))
  }
  return template.innerHTML
}
