import {computed,onBeforeUnmount,ref,watch} from 'vue'

/** Query the live runtime across every chat; renderer badges are only caches. */
export function useAppQuitConfirmation(){
  const open=ref(false),runningAgents=ref<number|null>(null),checking=ref(false),error=ref('')
  let sequence=0,disposed=false
  const ready=computed(()=>open.value&&!checking.value&&!error.value&&runningAgents.value!==null)
  const message=computed(()=>error.value||(
    runningAgents.value===null?'正在确认运行状态…':
    runningAgents.value>0?`当前有 ${runningAgents.value} 个 Agent 正在运行，退出将停止这些任务。确定退出吗？`:
    '确定要退出程序吗？'
  ))
  async function refresh(){
    if(disposed||!open.value)return false
    const request=++sequence;checking.value=true;error.value=''
    try{
      const state=await window.navora!.app.quitState()
      if(disposed||!open.value||request!==sequence)return false
      if(!Number.isSafeInteger(state.runningAgents)||state.runningAgents<0)throw Error('invalid_quit_state')
      runningAgents.value=state.runningAgents
      return true
    }catch{
      if(!disposed&&open.value&&request===sequence)error.value='无法确认当前运行状态，请重试。'
      return false
    }finally{if(!disposed&&request===sequence)checking.value=false}
  }
  watch(open,value=>{
    if(value){runningAgents.value=null;void refresh()}
    else{sequence++;checking.value=false;runningAgents.value=null;error.value=''}
  },{flush:'sync'})
  onBeforeUnmount(()=>{disposed=true;sequence++})
  return {open,runningAgents,checking,error,ready,message,refresh}
}
