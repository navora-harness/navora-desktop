import { defineComponent, h, mergeProps, onBeforeUnmount, Transition } from 'vue'

/** Only the disclosed region changes height; menus and sibling controls keep
 * their own coordinates. Cancellation never leaves inline dimensions behind. */
export default defineComponent({
  name: 'DisclosureTransition',
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    const running = new Map<HTMLElement, Animation>()
    const interrupted = new WeakMap<HTMLElement, { height: number; opacity: number; paddingTop: string; paddingBottom: string }>()
    function cancel(el: HTMLElement) {
      running.get(el)?.cancel()
      running.delete(el)
    }
    function interrupt(el: HTMLElement) {
      const css = getComputedStyle(el)
      interrupted.set(el, { height: el.getBoundingClientRect().height, opacity: Number(css.opacity), paddingTop: css.paddingTop, paddingBottom: css.paddingBottom })
      cancel(el)
    }
    function motion(el: HTMLElement, done: () => void, opening: boolean) {
      const current = el.getBoundingClientRect().height
      const opacity = Number(getComputedStyle(el).opacity)
      const prior = interrupted.get(el)
      interrupted.delete(el)
      cancel(el)
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return }
      const height = el.getBoundingClientRect().height
      const css = getComputedStyle(el)
      const full = { height: `${height}px`, opacity: 1, paddingTop: css.paddingTop, paddingBottom: css.paddingBottom }
      const small = { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px' }
      const start = prior ? { ...prior, height: `${prior.height}px` } : { ...full, height: `${current}px`, opacity }
      const frames = opening
        ? [prior ? start : small, full]
        : [start, small]
      const animation = el.animate(frames.map(frame => ({ ...frame, overflow: 'clip', minHeight: '0' })), {
        duration: opening ? 200 : 150, easing: 'cubic-bezier(.22,.75,.2,1)',
      })
      running.set(el, animation)
      animation.finished.then(() => {
        if (running.get(el) !== animation) return
        running.delete(el)
        animation.cancel()
        done()
      }).catch(() => {})
    }
    onBeforeUnmount(() => { for (const el of running.keys()) cancel(el) })
    return () => h(Transition, mergeProps(attrs, {
      css: false,
      onEnter: (el: HTMLElement, done: () => void) => motion(el, done, true),
      onLeave: (el: HTMLElement, done: () => void) => motion(el, done, false),
      onEnterCancelled: interrupt,
      onLeaveCancelled: interrupt,
      onAfterLeave: (el: HTMLElement) => { cancel(el); interrupted.delete(el) },
    }), slots)
  },
})
