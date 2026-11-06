import {app,BrowserWindow,NativePanel,nativeImage} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const root=process.env.NAVORA_ICON_EVIDENCE_ROOT
if(!root||!path.isAbsolute(root))throw Error('An isolated evidence directory is required')
app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration()
void app.whenReady().then(async()=>{
const owner=new BrowserWindow({show:false,x:-30000,y:-30000,width:900,height:600,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}})
try{
  await owner.loadURL('data:text/html,<title>Isolated icon raster evidence</title>')
  await owner.webContents.executeJavaScript(fs.readFileSync(path.join(root,'icons.js'),'utf8'))
  const result=await owner.webContents.executeJavaScript(`(async()=>{
    const rows=[];
    for(const name of ['magnifying-glass','comments','globe','xmark','arrow-up','arrow-down'])for(const scale of [1,1.25,1.5,1.75,2,2.1875,2.625]){
      const asset=uiIcons.getUiIcon(name,16),size=Math.ceil(16*scale),paths=asset.paths.map(p=>'<path d="'+p.d+'" fill="#263b55"'+(p.fillRule?' fill-rule="'+p.fillRule+'"':'')+'/>').join('');
      async function render(intrinsic){
        const image=new Image();image.src='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="'+intrinsic+'" height="'+intrinsic+'" viewBox="0 0 '+asset.size+' '+asset.size+'">'+paths+'</svg>');await image.decode();
        const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const context=canvas.getContext('2d');context.drawImage(image,0,0,size,size);return {data:context.getImageData(0,0,size,size).data,png:canvas.toDataURL('image/png')};
      }
      const old=await render(16),direct=await render(size);let differences=0,oldSoft=0,directSoft=0;
      for(let index=3;index<old.data.length;index+=4){if(old.data[index]!==direct.data[index])differences++;if(old.data[index]>0&&old.data[index]<255)oldSoft++;if(direct.data[index]>0&&direct.data[index]<255)directSoft++}
      rows.push({name,scale,size,differences,oldSoft,directSoft,old:old.png,direct:direct.png});
    }
    return {devicePixelRatio,rows};
  })()`)
  for(const row of result.rows)for(const kind of ['old','direct'])fs.writeFileSync(path.join(root,`${row.name}-${row.scale}-${kind}.png`),Buffer.from(row[kind].split(',')[1],'base64'))
  fs.writeFileSync(path.join(root,'comparison.json'),JSON.stringify({...result,rows:result.rows.map(({old,direct,...row})=>row)},null,2))
  console.log(JSON.stringify({devicePixelRatio:result.devicePixelRatio,comparisons:result.rows.length,different:result.rows.filter(row=>row.differences).length}))
  const names=['magnifying-glass','comments','globe','xmark','arrow-up','arrow-down'],cases=['single-1x','single-1.75x','multi-reps','physical-28-scale1','single-2x','single-3.5x','single-20DIP-exact','single-16DIP-over']
  function image(name,kind){
    const pixels=kind==='single-1x'?16:kind==='single-2x'?32:kind==='single-3.5x'?42:kind==='single-20DIP-exact'||kind==='single-16DIP-over'?35:28,scale=kind==='single-1x'||kind==='physical-28-scale1'?1:kind==='single-2x'?2:kind==='single-3.5x'?2.625:kind==='single-16DIP-over'?2.1875:1.75
    const data=fs.readFileSync(path.join(root,`${name}-${pixels/16}-direct.png`))
    if(kind!=='multi-reps')return nativeImage.createFromBuffer(data,{scaleFactor:scale})
    const image=nativeImage.createEmpty();for(const factor of [1,1.25,1.5,1.75,2])image.addRepresentation({scaleFactor:factor,buffer:fs.readFileSync(path.join(root,`${name}-${factor}-direct.png`))});return image
  }
  const content={id:'root',type:'column',width:600,gap:8,children:cases.map((kind,index)=>({id:'row-'+index,type:'row',height:32,gap:16,children:[{id:'label-'+index,type:'text',text:kind,width:170},...names.map((name,i)=>({id:'icon-'+index+'-'+i,type:'iconButton',width:32,height:28,image:image(name,kind),accessibleName:name}))]}))}
  const native=new NativePanel({parent:owner,content,contentInset:12,radius:12,focusMode:'none',dismissOnOutsideClick:false,theme:{mode:'light',background:'#ffffff',text:'#263b55',fontFamily:'Segoe UI',fontSize:13}})
  owner.setPosition(-30000,-30000);owner.showInactive();native.show({anchorBounds:{x:10,y:10,width:1,height:1},placement:'bottom-start'})
  await new Promise(resolve=>setTimeout(resolve,250))
  const state=native._getState();fs.writeFileSync(path.join(root,'native-state.json'),JSON.stringify(state,null,2))
  const {stdout}=await promisify(execFile)('python',[path.join(process.cwd(),'scripts/capture-native-panel.py'),'--pid',String(process.pid),'--hwnd',String(state.windowHandle),'--owner',String(state.parentWindowHandle),'--output',path.join(root,'native-comparison.png')],{windowsHide:true,timeout:15000});console.log(stdout)
  for(let phase=0;phase<4;phase++){
    native.update({content:{id:'phase-root',type:'column',width:440,style:{paddingLeft:phase,paddingTop:phase},children:[{id:'phase-row',type:'row',height:28,gap:4,children:names.map((name,index)=>({id:'phase-'+index,type:'iconButton',width:26,height:26,image:image(name,'single-1.75x'),accessibleName:name,style:{borderless:true}}))}]}})
    await new Promise(resolve=>setTimeout(resolve,100));const phaseState=native._getState();fs.writeFileSync(path.join(root,'phase-'+phase+'-state.json'),JSON.stringify(phaseState,null,2));await promisify(execFile)('python',[path.join(process.cwd(),'scripts/capture-native-panel.py'),'--pid',String(process.pid),'--hwnd',String(phaseState.windowHandle),'--owner',String(phaseState.parentWindowHandle),'--output',path.join(root,'phase-'+phase+'.png')],{windowsHide:true,timeout:15000})
  }
  native.destroy()
  app.exit(0)
}catch(error){console.error(error);app.exit(1)}finally{owner.destroy()}
}).catch(error=>{console.error(error);app.exit(1)})
