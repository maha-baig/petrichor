import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { gsap } from 'gsap'

import './Masonry.css'

// Measure the container so the layout follows the content column, not the viewport.
function useMeasure() {
  const ref = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])

  return [ref, size]
}

function preloadImages(urls) {
  return Promise.all(
    urls.map(
      (src) =>
        new Promise((resolve) => {
          const img = new Image()
          img.src = src
          img.onload = img.onerror = () => resolve()
        })
    )
  )
}

/**
 * Animated masonry board.
 *
 * items: [{ id, img, aspect?, height?, url? }]
 *   aspect — width / height of the source image; the tile keeps that ratio.
 *   height — fixed px height fallback when no aspect is known.
 */
export default function Masonry({
  items,
  ease = 'power3.out',
  duration = 0.6,
  stagger = 0.05,
  animateFrom = 'bottom',
  scaleOnHover = true,
  hoverScale = 0.97,
  blurToFocus = true,
  colorShiftOnHover = false,
  minColumnWidth = 190,
  maxColumns = 3,
  renderOverlay,
}) {
  const [containerRef, { width }] = useMeasure()
  const [imagesReady, setImagesReady] = useState(false)
  const nodes = useRef(new Map())
  const hasMounted = useRef(false)

  const reduced =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const columns = width ? Math.max(1, Math.min(maxColumns, Math.floor(width / minColumnWidth))) : 1

  useEffect(() => {
    let alive = true
    preloadImages(items.map((i) => i.img)).then(() => alive && setImagesReady(true))
    return () => {
      alive = false
    }
  }, [items])

  const grid = useMemo(() => {
    if (!width) return []

    const colHeights = new Array(columns).fill(0)
    const columnWidth = width / columns

    return items.map((child) => {
      const col = colHeights.indexOf(Math.min(...colHeights))
      const x = columnWidth * col
      const h = child.aspect ? columnWidth / child.aspect : (child.height ?? 300) / 2
      const y = colHeights[col]

      colHeights[col] += h

      return { ...child, x, y, w: columnWidth, h }
    })
  }, [columns, items, width])

  // Absolutely positioned children can't size the container — do it ourselves.
  const boardHeight = grid.length ? Math.max(...grid.map((i) => i.y + i.h)) : 0

  const initialPosition = (item) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { x: item.x, y: item.y }

    let direction = animateFrom
    if (animateFrom === 'random') {
      const dirs = ['top', 'bottom', 'left', 'right']
      direction = dirs[Math.floor(Math.random() * dirs.length)]
    }

    switch (direction) {
      case 'top':
        return { x: item.x, y: -200 }
      case 'bottom':
        return { x: item.x, y: item.y + 160 }
      case 'left':
        return { x: -200, y: item.y }
      case 'right':
        return { x: rect.width + 200, y: item.y }
      case 'center':
        return { x: rect.width / 2 - item.w / 2, y: boardHeight / 2 - item.h / 2 }
      default:
        return { x: item.x, y: item.y + 100 }
    }
  }

  useLayoutEffect(() => {
    if (!imagesReady) return

    grid.forEach((item, index) => {
      const el = nodes.current.get(item.id)
      if (!el) return

      const to = { x: item.x, y: item.y, width: item.w, height: item.h }

      if (reduced) {
        gsap.set(el, { ...to, opacity: 1, filter: 'none' })
        return
      }

      // New tiles fly in; tiles that merely moved (resize, a sibling removed) glide.
      if (!hasMounted.current || !el.dataset.placed) {
        el.dataset.placed = '1'
        const from = initialPosition(item)
        gsap.fromTo(
          el,
          {
            opacity: 0,
            x: from.x,
            y: from.y,
            width: item.w,
            height: item.h,
            ...(blurToFocus && { filter: 'blur(10px)' }),
          },
          {
            opacity: 1,
            ...to,
            ...(blurToFocus && { filter: 'blur(0px)' }),
            duration: 0.8,
            ease,
            delay: (hasMounted.current ? 0 : index) * stagger,
          }
        )
      } else {
        gsap.to(el, { ...to, duration, ease, overwrite: 'auto' })
      }
    })

    hasMounted.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, imagesReady, stagger, animateFrom, blurToFocus, duration, ease, reduced])

  function hover(el, entering) {
    if (reduced) return
    if (scaleOnHover) {
      gsap.to(el, { scale: entering ? hoverScale : 1, duration: 0.3, ease: 'power2.out' })
    }
    if (colorShiftOnHover) {
      const overlay = el.querySelector('.masonry-color-overlay')
      if (overlay) gsap.to(overlay, { opacity: entering ? 0.3 : 0, duration: 0.3 })
    }
  }

  return (
    <div ref={containerRef} className="masonry-list" style={{ height: boardHeight }}>
      {grid.map((item) => (
        <div
          key={item.id}
          ref={(el) => {
            if (el) nodes.current.set(item.id, el)
            else nodes.current.delete(item.id)
          }}
          className="masonry-item group"
          style={{ opacity: 0 }}
          onMouseEnter={(e) => hover(e.currentTarget, true)}
          onMouseLeave={(e) => hover(e.currentTarget, false)}
        >
          <div className="masonry-img" style={{ backgroundImage: `url("${item.img}")` }}>
            {colorShiftOnHover && (
              <div
                className="masonry-color-overlay"
                style={{
                  position: 'absolute',
                  inset: 0,
                  background:
                    'linear-gradient(45deg, rgba(255,0,150,0.5), rgba(0,150,255,0.5))',
                  opacity: 0,
                  pointerEvents: 'none',
                  borderRadius: 2,
                }}
              />
            )}
            {renderOverlay?.(item)}
          </div>
        </div>
      ))}
    </div>
  )
}
