import { defineComponent, h, mergeProps, onBeforeUnmount, Transition, type PropType } from 'vue'

function surfaceTransition(name: string, menu: boolean) {
  return defineComponent({
    name,
    inheritAttrs: false,
    props: {
      target: [Object, Array] as PropType<HTMLElement | number[]>,
      disabled: Boolean,
    },
    setup(props, { slots, attrs }) {
      const running = new Map<Element, Animation>()
      const cancel = (el: Element) => {
        running.get(el)?.cancel()
        running.delete(el)
      }
      onBeforeUnmount(() => {
        for (const el of running.keys()) cancel(el)
      })
      function motion(el: Element, done: () => void, opening: boolean) {
        cancel(el)
        if (props.disabled || matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return }
        // Composite only; resizing, blur, live shadows and source-button clones
        // force large repaints and make borderless activators disappear on return.
        const full = { opacity: 1, transform: 'translateY(0px) scale(1)' }
        const small = { opacity: 0, transform: `translateY(${menu ? '-5' : '10'}px) scale(${menu ? '.97' : '.985'})` }
        const animation = el.animate(opening ? [small, full] : [full, small], {
          duration: opening ? (menu ? 210 : 240) : 130,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        })
        running.set(el, animation)
        animation.finished.then(() => {
          if (running.get(el) !== animation) return
          running.delete(el)
          animation.cancel()
          done()
        }).catch(() => {})
      }
      return () => h(Transition, mergeProps(attrs, {
        css: false,
        onEnter: (el: Element, done: () => void) => motion(el, done, true),
        onLeave: (el: Element, done: () => void) => motion(el, done, false),
        onEnterCancelled: cancel,
        onLeaveCancelled: cancel,
        onAfterLeave: cancel,
      }), slots)
    },
  })
}

export const ButtonMenuTransition = surfaceTransition('NavoraButtonMenuTransition', true)
export const DialogTransition = surfaceTransition('NavoraDialogTransition', false)
