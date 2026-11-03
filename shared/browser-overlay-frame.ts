/** Bound capture/decode/paint as one operation before the native surface is hidden. */
export async function prepareBrowserOverlayFrame(options:{capture:()=>Promise<string|null>;decode:(frame:string)=>Promise<void>;paint:(frame:string)=>Promise<void>;current:()=>boolean;timeoutMs?:number}):Promise<boolean>{
  let expired=false,timer:ReturnType<typeof setTimeout>|undefined
  const alive=()=>!expired&&options.current()
  const capture=(async()=>{try{const frame=await options.capture();if(!frame||!alive())return false;await options.decode(frame);if(!alive())return false;await options.paint(frame);return alive()}catch{return false}})()
  try{return await Promise.race([capture,new Promise<false>(resolve=>{timer=setTimeout(()=>{expired=true;resolve(false)},options.timeoutMs??350)})])}
  finally{expired=true;clearTimeout(timer)}
}
