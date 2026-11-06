/** Hidden retained popovers must not consume keyboard shortcuts. */
export function hasVisibleUi(selector:string){return [...document.querySelectorAll<HTMLElement>(selector)].some(element=>element.checkVisibility()&&getComputedStyle(element).visibility!=='hidden')}
