import {createApp,h,ref} from 'vue'
import QuestionnairePanel from '../../src/components/QuestionnairePanel.vue'
import {OPEN_QUESTIONNAIRE_EVENT,type OpenQuestionnaireRequest} from '../../src/utils/questionnaire-events'
import {appearancePalette} from '../../shared/appearance'
import '../../src/styles/control-system.css'
import '../../src/styles/appearance-themes.css'
import '../../src/styles/appearance-hover.css'
const records=await window.navora!.questionnaires.list(),id=ref(records.find(r=>r.status==='pending')?.id||records[0].id)
window.addEventListener(OPEN_QUESTIONNAIRE_EVENT,event=>{id.value=(event as CustomEvent<OpenQuestionnaireRequest>).detail.id})
function theme(mode='light'){const palette=appearancePalette('mist',mode,false),root=document.documentElement;root.dataset.navoraTheme=palette.id;root.dataset.navoraColorScheme=palette.dark?'dark':'light';root.style.colorScheme=palette.dark?'dark':'light';for(const [key,value] of Object.entries(palette))if(typeof value==='string')root.style.setProperty('--appearance-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),value)}
theme()
;(window as any).extensionProbe={theme,currentId:()=>id.value}
const style=document.createElement('style');style.textContent='*{box-sizing:border-box}body{margin:0;font-family:Segoe UI,Microsoft YaHei,sans-serif}#app,.extension-shell{height:100vh;display:flex;min-height:0;width:100%}';document.head.append(style)
createApp({setup(){return()=>h('main',{class:'navora-app extension-shell'},[h(QuestionnairePanel,{questionnaireId:id.value,chatId:'extension-chat',ownerTitle:'扩展问卷验证'})])}}).mount('#app')
