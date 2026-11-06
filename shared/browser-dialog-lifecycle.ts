/** Presentation remounts must not settle a newer logical dialog. */
export function createBrowserDialogLifecycle(){
  let open=false,cycle=0,presentation=0,entered=-1,closed=0
  return {
    setOpen(next:boolean){if(next&&!open){cycle++;presentation++}open=next;return presentation},
    changePresentation(){return ++presentation},
    current(){return presentation},
    afterEnter(token:number){if(!open||token!==presentation||entered===cycle)return false;entered=cycle;return true},
    afterLeave(token:number){if(open||token!==presentation||closed===cycle)return false;closed=cycle;return true},
  }
}
