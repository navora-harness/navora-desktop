import { defineComponent, h, nextTick, onBeforeUnmount, Transition, type PropType } from 'vue'
import { animateDialogSurface, animateMenuSurface, dialogAnchor } from '@postpile/ui'

function surfaceTransition(name: string, menu: boolean) {
  return defineComponent({
    name,
    inheritAttrs: false,
    props: {
      target: [Object, Array] as PropType<HTMLElement | number[]>,
      disabled: Boolean,
    },
    setup(props, { slots, attrs }) {
      const cancellations = new Map<Element, () => void>()
      const anchors = new WeakMap<Element, HTMLElement>()
      const cancel = (el: Element) => {
        cancellations.get(el)?.()
        cancellations.delete(el)
        el.removeAttribute('data-pp-menu-pending')
      }
      onBeforeUnmount(() => {
        for (const el of cancellations.keys()) cancel(el)
      })
      function motion(el: Element, done: () => void, opening: boolean) {
        cancel(el)
        if (props.disabled) { done(); return }
        const anchor = opening
          ? props.target instanceof HTMLElement ? props.target : dialogAnchor()
          : anchors.get(el) || null
        if (anchor) anchors.set(el, anchor)
        let cancelled = false
        let frame = 0
        let cancelAnimation = () => {}
        const finish = () => {
          // A completed enter still owns its source-button placeholder. Retain
          // its cleanup until leave/unmount, including rapidly interrupted menus.
          el.removeAttribute('data-pp-menu-pending')
          done()
        }
        const animate = () => {
          if (cancelled) return
          cancelAnimation = menu
            ? animateMenuSurface(el as HTMLElement, anchor, opening, finish)
            : animateDialogSurface(el as HTMLElement, anchor, opening, finish)
          el.removeAttribute('data-pp-menu-pending')
        }
        cancellations.set(el, () => {
          cancelled = true
          cancelAnimationFrame(frame)
          cancelAnimation()
        })
        if (opening) {
          el.setAttribute('data-pp-menu-pending', '')
          void nextTick().then(() => { if (!cancelled) frame = requestAnimationFrame(animate) })
        } else animate()
      }
      return () => h(Transition, {
        ...attrs,
        css: false,
        onBeforeEnter: (el: Element) => { if (!props.disabled) el.setAttribute('data-pp-menu-pending', '') },
        onEnter: (el: Element, done: () => void) => motion(el, done, true),
        onLeave: (el: Element, done: () => void) => motion(el, done, false),
        onEnterCancelled: cancel,
        onLeaveCancelled: cancel,
        onAfterLeave: cancel,
      }, slots)
    },
  })
}

export const ButtonMenuTransition = surfaceTransition('NavoraButtonMenuTransition', true)
export const DialogTransition = surfaceTransition('NavoraDialogTransition', false)
