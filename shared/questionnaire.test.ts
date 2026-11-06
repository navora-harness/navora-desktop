import {test} from 'node:test'
import assert from 'node:assert/strict'
import {applicableQuestionnaireAnswers,visibleQuestionnaireQuestions,questionnaireAnswerChanges,formatQuestionnaireAnswers,validateQuestionnaireAnswers,validateQuestionnaireDefinition,type QuestionnaireDefinition} from './questionnaire'

export const definition:QuestionnaireDefinition={title:'项目需求',questions:[
  {id:'direction',type:'single',title:'选择方向',required:true,allowOther:true,options:[{id:'first',label:'方案一',recommended:true},{id:'second',label:'方案二'}]},
  {id:'features',type:'multi',title:'功能',required:true,options:[{id:'a',label:'功能甲'},{id:'b',label:'功能乙'}]},
  {id:'enabled',type:'toggle',title:'开启部署',required:true},
  {id:'count',type:'number',title:'数量',required:true,min:0,max:10},
  {id:'notes',type:'textarea',title:'要求',allowUnknown:true,allowDelegate:true,allowSkip:true,allowNote:true},
]}

test('questionnaires preserve false, zero and explicit unanswered semantics without applying recommendations',()=>{
  assert.deepEqual(validateQuestionnaireDefinition(definition),[])
  assert.equal(validateQuestionnaireAnswers(definition.questions,{},'',false).length,0)
  assert.equal(validateQuestionnaireAnswers(definition.questions,{}).length,4)
  const answers={direction:{state:'answered' as const,value:'first'},features:{state:'answered' as const,value:['a','b']},enabled:{state:'answered' as const,value:false},count:{state:'answered' as const,value:0},notes:{state:'unknown' as const,note:'稍后确认'}}
  assert.deepEqual(validateQuestionnaireAnswers(definition.questions,answers),[])
  assert.match(formatQuestionnaireAnswers(definition.questions,answers,'整体补充'),/开启部署：关闭\n数量：0\n要求：不确定（备注：稍后确认）\n补充说明：整体补充/)
  assert.match(formatQuestionnaireAnswers(definition.questions,{}),/选择方向：未回答/)
})

test('questionnaires reject duplicate ids, forged choices, unknown questions and disallowed answer states',()=>{
  assert.ok(validateQuestionnaireDefinition({...definition,questions:[definition.questions[0],definition.questions[0]]}).length)
  assert.ok(validateQuestionnaireDefinition({...definition,questions:[{...definition.questions[0],options:[{id:'a',label:'甲'},{id:'a',label:'乙'}]}]}).length)
  for(const answers of [{unknown:{state:'answered',value:'x'}},{direction:{state:'answered',value:'forged'}},{features:{state:'answered',value:['a','a']}},{enabled:{state:'unknown'}},{enabled:{state:'answered',value:'false'}},{count:{state:'answered',value:Infinity}},{direction:{state:'skip'}},{direction:{state:'unanswered',value:'first'}}])assert.ok(validateQuestionnaireAnswers(definition.questions,answers,'',false).length)
})

test('temporarily out-of-range numbers remain valid drafts and fail only submission validation',()=>{
  const answers={count:{state:'answered' as const,value:99}}
  assert.deepEqual(validateQuestionnaireAnswers(definition.questions,answers,'',false),[])
  assert.ok(validateQuestionnaireAnswers(definition.questions,answers).some(error=>error.questionId==='count'))
})

test('conditional descendants require visible answered ancestors and hidden required drafts are omitted from summaries',()=>{
  const questions:QuestionnaireDefinition['questions']=[
    {id:'platform',type:'single',title:'平台',required:true,options:[{id:'web',label:'网页'},{id:'desktop',label:'桌面'}]},
    {id:'detail',type:'text',title:'网页细节',required:true,showWhen:{questionId:'platform',equals:'web'}},
    {id:'extra',type:'text',title:'补充',required:true,showWhen:{questionId:'detail',equals:'yes'}},
  ]
  assert.deepEqual(validateQuestionnaireDefinition({title:'分支',questions}),[])
  const answers={platform:{state:'answered' as const,value:'desktop'},detail:{state:'answered' as const,value:'yes'}}
  assert.deepEqual(visibleQuestionnaireQuestions(questions,answers).map(q=>q.id),['platform'])
  assert.deepEqual(validateQuestionnaireAnswers(questions,answers),[])
  assert.deepEqual(Object.keys(applicableQuestionnaireAnswers(questions,answers)),['platform'])
  assert.equal(formatQuestionnaireAnswers(questions,answers),'平台：桌面')
  answers.platform.value='web'
  assert.equal(validateQuestionnaireAnswers(questions,answers)[0].questionId,'extra')
  assert.ok(validateQuestionnaireDefinition({title:'循环',questions:[{...questions[0],showWhen:{questionId:'detail',equals:'yes'}},...questions.slice(1)]}).length)
  assert.doesNotThrow(()=>validateQuestionnaireDefinition({title:'无效',questions:[{...questions[0],options:'broken'},questions[1]]}))
})

test('multi choice branches, false and zero compare without truthy defaults',()=>{
  for(const [type,value,expected] of [['multi',['x'],'x'],['toggle',false,false],['number',0,0]] as const){
    const questions:QuestionnaireDefinition['questions']=[{id:'source',type,title:'前题'},{id:'branch',type:'text',title:'分支',showWhen:{questionId:'source',equals:expected}}]
    assert.equal(visibleQuestionnaireQuestions(questions,{source:{state:'answered',value:structuredClone(value) as string[]|boolean|number}}).length,2)
    assert.equal(visibleQuestionnaireQuestions(questions,{source:{state:'unanswered'}}).length,1)
  }
})

test('calendar dates validate real days and allow incomplete or reversed ranges only in drafts',()=>{
  const questions:QuestionnaireDefinition['questions']=[{id:'date',type:'date',title:'日期',required:true,minDate:'2026-01-01',maxDate:'2026-12-31'},{id:'range',type:'dateRange',title:'范围',required:true}]
  const answers={date:{state:'answered' as const,value:'2026-11-06'},range:{state:'answered' as const,dateRange:{start:'2026-11-06',end:''}}}
  assert.deepEqual(validateQuestionnaireAnswers(questions,answers,'',false),[])
  assert.ok(validateQuestionnaireAnswers(questions,answers).length)
  answers.range.dateRange.end='2026-11-05';assert.deepEqual(validateQuestionnaireAnswers(questions,answers,'',false),[]);assert.ok(validateQuestionnaireAnswers(questions,answers).length)
  answers.range.dateRange.end='2026-11-07';assert.deepEqual(validateQuestionnaireAnswers(questions,answers),[])
  assert.match(formatQuestionnaireAnswers(questions,answers),/2026-11-06 至 2026-11-07/)
  for(const date of ['2026-02-29','2026-13-01','0000-01-01','2026-01-00'])assert.ok(validateQuestionnaireAnswers(questions,{...answers,date:{state:'answered',value:date}},'',false).length)
  assert.ok(validateQuestionnaireDefinition({title:'无效',questions:[{...questions[0],minDate:'2026-12-31',maxDate:'2026-01-01'}]}).length)
  assert.equal(questionnaireAnswerChanges(questions,answers,{...answers,date:{state:'answered',value:'2026-11-08'}})[0].after,'2026-11-08')
})
