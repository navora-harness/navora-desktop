import {BrowserWindow,clipboard,dialog,ipcMain,type IpcMainInvokeEvent} from 'electron'
import fs from 'node:fs/promises'
import {existsSync} from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import type {WorkspaceFiles} from './workspace-files'
import type {WorkspaceShell} from './workspace-shell'
import {previewBinaryExtensions,previewImageMimes} from '../../shared/workspace-preview'
import type {WorkspaceFileAction,WorkspaceFileActionOptions,WorkspaceFileActionResult} from '../../shared/workspace-file-actions'

const maxCopyBytes=8*1024*1024
const powershell=process.platform==='win32'?path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'):''
const chooserSupported=()=>process.platform==='win32'&&existsSync(powershell)
const revision=(stat:{mtimeMs:number;size:number})=>`${stat.mtimeMs}:${stat.size}`
export function decodeWorkspaceFileText(bytes:Buffer,partial=false){
  const le=bytes[0]===0xff&&bytes[1]===0xfe,be=bytes[0]===0xfe&&bytes[1]===0xff
  if(!le&&!be&&bytes.includes(0))throw Error('file_content_binary')
  try{return new TextDecoder(le?'utf-16le':be?'utf-16be':'utf-8',{fatal:true}).decode(le||be?bytes.subarray(2):bytes,{stream:partial}).replace(/^\uFEFF/,'')}
  catch{throw Error('file_content_encoding')}
}
async function canCopyText(absolute:string,size:number){
  const extension=path.extname(absolute).toLowerCase()
  if(previewBinaryExtensions.has(extension)||extension in previewImageMimes)return {allowed:false,reason:'仅支持文本文件'}
  if(size>maxCopyBytes)return {allowed:false,reason:'文件超过 8 MB，请在应用中打开后复制'}
  const handle=await fs.open(absolute,'r')
  try{const bytes=Buffer.alloc(Math.min(size,4096)),read=await handle.read(bytes,0,bytes.length,0);decodeWorkspaceFileText(bytes.subarray(0,read.bytesRead),size>read.bytesRead);return {allowed:true}}
  catch{return {allowed:false,reason:'文件不是可正确解码的文本'}}
  finally{await handle.close()}
}

/** SHOpenWithDialog is the OS chooser, not a guessed list of installed programs. */
async function chooseApplication(owner:BrowserWindow,absolute:string):Promise<{canceled?:boolean}>{
  if(!chooserSupported())throw Error('open_with_unsupported')
  const native=owner.getNativeWindowHandle(),hwnd=native.length>=8?native.readBigUInt64LE().toString():String(native.readUInt32LE())
  const script=`Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NavoraOpenWith {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct Info { [MarshalAs(UnmanagedType.LPWStr)] public string File; [MarshalAs(UnmanagedType.LPWStr)] public string Class; public uint Flags; }
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=true)] public static extern int SHOpenWithDialog(IntPtr parent, ref Info info);
}
'@
$info = New-Object NavoraOpenWith+Info
$info.File = $env:NAVORA_OPEN_WITH_FILE
$info.Flags = 4
$result = [NavoraOpenWith]::SHOpenWithDialog([IntPtr]::new([Int64]::Parse($env:NAVORA_OPEN_WITH_PARENT)), [ref]$info)
[Console]::Out.Write($result)
`
  const result=await new Promise<number>((resolve,reject)=>{
    const child=spawn(powershell,['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,env:{...process.env,NAVORA_OPEN_WITH_FILE:absolute,NAVORA_OPEN_WITH_PARENT:hwnd},stdio:['ignore','pipe','pipe']})
    let stdout='',stderr=''
    child.stdout.on('data',data=>{stdout=(stdout+String(data)).slice(-1000)})
    child.stderr.on('data',data=>{stderr=(stderr+String(data)).slice(-1000)})
    child.once('error',()=>reject(Error('open_with_failed')))
    child.once('close',code=>{const value=Number(stdout.trim());if(code!==0||stderr.trim()||!Number.isInteger(value)||!stdout.trim())reject(Error('open_with_failed'));else resolve(value)})
  })
  if(result===-2147023673)return {canceled:true}
  if(result<0)throw Error('open_with_failed')
  return {}
}

export function registerWorkspaceFileActions(options:{files:WorkspaceFiles;shell:WorkspaceShell;trusted:(event:IpcMainInvokeEvent,chatId:string,relative:string)=>BrowserWindow|undefined}){
  ipcMain.handle('navora:workspace.fileAction',async(event,chatId:unknown,relative:unknown,action:WorkspaceFileAction,input:WorkspaceFileActionOptions={}):Promise<WorkspaceFileActionResult>=>{
    try{
      if(typeof chatId!=='string'||typeof relative!=='string'||!['inspect','system','openWith','reveal','saveAs','copyPath','copyRelativePath','copyContent'].includes(action)||!input||typeof input!=='object'||input.revision!==undefined&&typeof input.revision!=='string')throw Error('invalid_file_action')
      const owner=options.trusted(event,chatId,relative)
      if(!owner||owner.isDestroyed()||event.senderFrame!==event.sender.mainFrame)throw Error('local_file_ui_only')
      const absolute=await options.files.resolveExisting(chatId,relative),stat=await fs.stat(absolute)
      if(!stat.isFile()&&!stat.isDirectory())throw Error('unsupported_file_type')
      if(input.revision&&input.revision!==revision(stat))throw Error('file_changed_refresh')
      const valid=async()=>{
        if(owner.isDestroyed()||options.trusted(event,chatId,relative)!==owner)throw Error('file_source_unavailable')
        const current=await options.files.resolveExisting(chatId,relative),now=await fs.stat(current)
        if(current!==absolute||revision(now)!==revision(stat))throw Error('file_changed_refresh')
      }
      if(action==='inspect'){
        const text=stat.isFile()?await canCopyText(absolute,stat.size):{allowed:false,reason:'文件夹没有可复制的正文'}
        return {ok:true,capabilities:{revision:revision(stat),directory:stat.isDirectory(),openWith:stat.isFile()&&chooserSupported(),copyContent:text.allowed,copyContentReason:text.reason}}
      }
      await valid()
      if(action==='system')await options.shell.open(chatId,relative)
      else if(action==='reveal')await options.shell.reveal(chatId,relative)
      else if(action==='openWith'){
        if(!stat.isFile())throw Error('not_a_file')
        const result=await chooseApplication(owner,absolute);return {ok:!result.canceled,...result}
      }else if(action==='saveAs'){
        if(!stat.isFile())throw Error('not_a_file')
        const selected=await dialog.showSaveDialog(owner,{title:'另存为',defaultPath:path.basename(absolute)})
        if(selected.canceled||!selected.filePath)return {ok:false,canceled:true}
        await valid()
        if(path.resolve(absolute)!==path.resolve(selected.filePath))await fs.copyFile(absolute,selected.filePath)
      }else if(action==='copyPath')clipboard.writeText(absolute)
      else if(action==='copyRelativePath')clipboard.writeText(options.files.toRel(chatId,absolute))
      else if(action==='copyContent'){
        if(!stat.isFile())throw Error('not_a_file')
        if(previewBinaryExtensions.has(path.extname(absolute).toLowerCase())||path.extname(absolute).toLowerCase() in previewImageMimes)throw Error('file_content_binary')
        if(stat.size>maxCopyBytes)throw Error('file_content_too_large')
        const handle=await fs.open(absolute,'r')
        try{
          const before=await handle.stat();if(revision(before)!==revision(stat)||before.size>maxCopyBytes)throw Error('file_changed_refresh')
          const bytes=await handle.readFile();if(bytes.length>maxCopyBytes)throw Error('file_content_too_large')
          const content=decodeWorkspaceFileText(bytes),after=await handle.stat();if(revision(after)!==revision(before))throw Error('file_changed_refresh')
          await valid();clipboard.writeText(content)
        }finally{await handle.close()}
      }
      return {ok:true}
    }catch(error){return {ok:false,error:error instanceof Error?error.message:'file_action_failed'}}
  })
}
