export const OPEN_QUESTIONNAIRE_EVENT='navora:questionnaire.open'
export type OpenQuestionnaireRequest={id:string;chatId:string}
export function requestOpenQuestionnaire(id:string,chatId:string){
  window.dispatchEvent(new CustomEvent<OpenQuestionnaireRequest>(OPEN_QUESTIONNAIRE_EVENT,{detail:{id,chatId}}))
}
