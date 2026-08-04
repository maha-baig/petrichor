import { motion } from 'framer-motion'

// The editorial easing — accelerates quickly, settles softly.
export const EASE = [0.22, 1, 0.36, 1]

// Page/section level: subtle depth (small y + scale), slower than its content.
// Used on the wrapper that swaps between hero ⇄ app and between tabs.
export const pageV = {
  hidden: { opacity: 0, y: 24, scale: 0.99 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    // the panel itself settles; its <Reveal> children stagger themselves
    transition: { duration: 0.55, ease: EASE },
  },
  exit: { opacity: 0, y: -28, scale: 0.985, transition: { duration: 0.4, ease: EASE } },
}

// Container that staggers its children into view (eyebrow → heading → … ).
export const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
  exit: { transition: { staggerChildren: 0.03, staggerDirection: -1 } },
}

// The per-element reveal: fade + travel up, physical rather than digital.
export const rise = {
  hidden: { opacity: 0, y: 34 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
  exit: { opacity: 0, y: -16, transition: { duration: 0.28, ease: EASE } },
}

// A revealed element: fade + travel up on mount.
//
// Deliberately CSS-driven, not JS-driven. Two reasons:
//  1. Inheriting a parent variant is fragile — a panel can mount inside a
//     wrapper that already finished its own "show", and the child then never
//     gets the trigger and sits at opacity 0 forever.
//  2. requestAnimationFrame stops while the page is hidden or occluded, which
//     freezes every JS animation mid-flight. A CSS animation is wall-clock
//     based and is simply already finished when you look again — content can
//     never get stranded invisible.
// It also stays on the compositor (opacity + transform only).
//
// `order` gives the editorial stagger: 0, 1, 2… ≈ 80ms apart.
export function Reveal({ children, className, as: Tag = 'div', order = 0, delay, style, ...rest }) {
  return (
    <Tag
      className={'reveal-rise' + (className ? ' ' + className : '')}
      style={{ animationDelay: `${delay ?? order * 0.08}s`, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  )
}
