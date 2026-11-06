/** A confirmation never resolves affirmatively without the current request's explicit choice. */
export function createSettingsPermissionConfirmation(changed:(requestId:string)=>void){
  let serial=0,current:{id:string;promise:Promise<boolean>;resolve:(confirmed:boolean)=>void}|undefined
  function decide(id:string,confirmed:boolean){if(!current||current.id!==id)return false;const request=current;current=undefined;changed('');request.resolve(confirmed);return true}
  return {
    ask(){if(current)return current.promise;let resolve!:(confirmed:boolean)=>void;const promise=new Promise<boolean>(done=>{resolve=done}),id=`permission-confirm-${++serial}`;current={id,promise,resolve};changed(id);return promise},
    decide,cancel(){if(current)decide(current.id,false)},
  }
}
