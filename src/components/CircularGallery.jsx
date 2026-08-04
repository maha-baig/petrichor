import { Camera, Mesh, Plane, Program, Renderer, Texture, Transform } from 'ogl'
import { useEffect, useRef } from 'react'

import './CircularGallery.css'

// A curved, scrollable ribbon of cards (from React Bits, WebGL via ogl).
//
// One addition to the original: `onItemClick`. A press that doesn't turn into a
// drag is treated as a click on whichever card sits nearest the pointer, so the
// gallery can stand in for a list of things you open rather than only look at.

function debounce(func, wait) {
  let timeout
  return function (...args) {
    clearTimeout(timeout)
    timeout = setTimeout(() => func.apply(this, args), wait)
  }
}

function lerp(p1, p2, t) {
  return p1 + (p2 - p1) * t
}

function autoBind(instance) {
  const proto = Object.getPrototypeOf(instance)
  Object.getOwnPropertyNames(proto).forEach((key) => {
    if (key !== 'constructor' && typeof instance[key] === 'function') {
      instance[key] = instance[key].bind(instance)
    }
  })
}

function getFontSize(font) {
  const match = font.match(/(\d+)px/)
  return match ? parseInt(match[1], 10) : 30
}

// Trim a line until it fits, and mark the cut.
function ellipsize(ctx, line, maxWidth) {
  if (ctx.measureText(line).width <= maxWidth) return line
  let cut = line
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1)
  }
  return `${cut.replace(/[\s,.;:—-]+$/, '')}…`
}

// The labels here are whole prompts, not the one-word captions the original
// gallery assumed, so the canvas is a fixed box the text is wrapped and cut
// into. Letting it grow with the text is what sent the titles sprawling across
// their neighbours.
function createTextTexture(gl, text, font = 'bold 30px monospace', color = 'black', maxLines = 2) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  const fontSize = getFontSize(font)
  const boxWidth = fontSize * 15
  const lineHeight = Math.round(fontSize * 1.3)
  context.font = font

  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean)
  const lines = []
  let cur = ''
  let overflow = false
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word
    if (!cur || context.measureText(test).width <= boxWidth) {
      cur = test
      continue
    }
    if (lines.length === maxLines - 1) {
      overflow = true
      break
    }
    lines.push(cur)
    cur = word
  }
  if (cur) lines.push(cur)
  if (!lines.length) lines.push('untitled')
  if (overflow) lines[lines.length - 1] += '…'

  canvas.width = Math.ceil(boxWidth + fontSize)
  canvas.height = lines.length * lineHeight + Math.ceil(fontSize * 0.6)
  context.font = font
  context.fillStyle = color
  context.textBaseline = 'middle'
  context.textAlign = 'center'
  context.clearRect(0, 0, canvas.width, canvas.height)
  const top = (canvas.height - lines.length * lineHeight) / 2
  lines.forEach((line, i) => {
    context.fillText(
      ellipsize(context, line, boxWidth),
      canvas.width / 2,
      top + lineHeight * (i + 0.5),
    )
  })

  const texture = new Texture(gl, { generateMipmaps: false })
  texture.image = canvas
  return { texture, width: canvas.width, height: canvas.height }
}

class Title {
  constructor({ gl, plane, renderer, text, textColor = '#545050', font = '30px sans-serif' }) {
    autoBind(this)
    this.gl = gl
    this.plane = plane
    this.renderer = renderer
    this.text = text
    this.textColor = textColor
    this.font = font
    this.createMesh()
  }
  createMesh() {
    const { texture, width, height } = createTextTexture(
      this.gl,
      this.text,
      this.font,
      this.textColor,
    )
    const geometry = new Plane(this.gl)
    const program = new Program(this.gl, {
      vertex: `
        attribute vec3 position;
        attribute vec2 uv;
        uniform mat4 modelViewMatrix;
        uniform mat4 projectionMatrix;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragment: `
        precision highp float;
        uniform sampler2D tMap;
        varying vec2 vUv;
        void main() {
          vec4 color = texture2D(tMap, vUv);
          if (color.a < 0.1) discard;
          gl_FragColor = color;
        }
      `,
      uniforms: { tMap: { value: texture } },
      transparent: true,
    })
    this.mesh = new Mesh(this.gl, { geometry, program })
    this.aspect = width / height
    this.mesh.setParent(this.plane)
    this.layout()
  }
  // The label hangs off the card, so it inherits the card's scale — which is
  // taller than it is wide. Dividing that back out keeps the type its own
  // shape, and pins the label to the card's width so it can't run into the
  // card beside it.
  layout() {
    const sx = this.plane.scale.x || 1
    const sy = this.plane.scale.y || 1
    const width = sx * 0.92
    const height = width / this.aspect
    this.mesh.scale.set(width / sx, height / sy, 1)
    this.mesh.position.y = -0.5 - height / (2 * sy) - 0.05
  }
}

class Media {
  constructor({
    geometry,
    gl,
    image,
    index,
    length,
    renderer,
    scene,
    screen,
    text,
    viewport,
    bend,
    textColor,
    borderRadius = 0,
    font,
  }) {
    this.extra = 0
    this.geometry = geometry
    this.gl = gl
    this.image = image
    this.index = index
    this.length = length
    this.renderer = renderer
    this.scene = scene
    this.screen = screen
    this.text = text
    this.viewport = viewport
    this.bend = bend
    this.textColor = textColor
    this.borderRadius = borderRadius
    this.font = font
    this.createShader()
    this.createMesh()
    this.createTitle()
    this.onResize()
  }
  createShader() {
    const texture = new Texture(this.gl, { generateMipmaps: true })
    this.program = new Program(this.gl, {
      depthTest: false,
      depthWrite: false,
      vertex: `
        precision highp float;
        attribute vec3 position;
        attribute vec2 uv;
        uniform mat4 modelViewMatrix;
        uniform mat4 projectionMatrix;
        uniform float uTime;
        uniform float uSpeed;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position;
          p.z = (sin(p.x * 4.0 + uTime) * 1.5 + cos(p.y * 2.0 + uTime) * 1.5) * (0.1 + uSpeed * 0.5);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragment: `
        precision highp float;
        uniform vec2 uImageSizes;
        uniform vec2 uPlaneSizes;
        uniform sampler2D tMap;
        uniform float uBorderRadius;
        varying vec2 vUv;

        float roundedBoxSDF(vec2 p, vec2 b, float r) {
          vec2 d = abs(p) - b;
          return length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0) - r;
        }

        void main() {
          vec2 ratio = vec2(
            min((uPlaneSizes.x / uPlaneSizes.y) / (uImageSizes.x / uImageSizes.y), 1.0),
            min((uPlaneSizes.y / uPlaneSizes.x) / (uImageSizes.y / uImageSizes.x), 1.0)
          );
          vec2 uv = vec2(
            vUv.x * ratio.x + (1.0 - ratio.x) * 0.5,
            vUv.y * ratio.y + (1.0 - ratio.y) * 0.5
          );
          vec4 color = texture2D(tMap, uv);

          float d = roundedBoxSDF(vUv - 0.5, vec2(0.5 - uBorderRadius), uBorderRadius);
          float edgeSmooth = 0.002;
          float alpha = 1.0 - smoothstep(-edgeSmooth, edgeSmooth, d);

          gl_FragColor = vec4(color.rgb, alpha);
        }
      `,
      uniforms: {
        tMap: { value: texture },
        uPlaneSizes: { value: [0, 0] },
        uImageSizes: { value: [0, 0] },
        uSpeed: { value: 0 },
        uTime: { value: 100 * Math.random() },
        uBorderRadius: { value: this.borderRadius },
      },
      transparent: true,
    })
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = this.image
    img.onload = () => {
      texture.image = img
      this.program.uniforms.uImageSizes.value = [img.naturalWidth, img.naturalHeight]
    }
  }
  createMesh() {
    this.plane = new Mesh(this.gl, { geometry: this.geometry, program: this.program })
    this.plane.setParent(this.scene)
  }
  createTitle() {
    this.title = new Title({
      gl: this.gl,
      plane: this.plane,
      renderer: this.renderer,
      text: this.text,
      textColor: this.textColor,
      font: this.font,
    })
  }
  update(scroll) {
    // The ribbon loops by moving a card a whole ribbon-length at a time. Wrap
    // on where the card has ended up rather than on which way the last drag
    // went: every card then sits within half a ribbon of the middle however it
    // got there — including across a resize part-way through a browse, which
    // used to leave a card-shaped hole that only more dragging would close.
    let x = this.x - scroll.current - this.extra
    if (Math.abs(x) > this.widthTotal / 2) {
      const shift = Math.round(x / this.widthTotal) * this.widthTotal
      this.extra += shift
      x -= shift
    }
    this.plane.position.x = x

    const H = this.viewport.width / 2

    if (this.bend === 0) {
      this.plane.position.y = 0
      this.plane.rotation.z = 0
    } else {
      // `bend` is a drop measured across a frame about six cards wide. Cards
      // keep their size whatever the screen, so on a phone that same drop would
      // stand the neighbours on their heads — scale it to the frame instead.
      const B_abs = Math.abs(this.bend) * (this.viewport.width / this.plane.scale.x / 6)
      const R = (H * H + B_abs * B_abs) / (2 * B_abs)
      const effectiveX = Math.min(Math.abs(x), H)

      // Hang the curve around the middle of the frame rather than from its top,
      // or the cards at the ends drop far enough to take their labels off the
      // bottom of the gallery.
      const arc = R - Math.sqrt(R * R - effectiveX * effectiveX) - B_abs / 2
      if (this.bend > 0) {
        this.plane.position.y = -arc
        this.plane.rotation.z = -Math.sign(x) * Math.asin(effectiveX / R)
      } else {
        this.plane.position.y = arc
        this.plane.rotation.z = Math.sign(x) * Math.asin(effectiveX / R)
      }
    }

    this.speed = scroll.current - scroll.last
    this.program.uniforms.uTime.value += 0.04
    this.program.uniforms.uSpeed.value = this.speed
  }
  onResize({ screen, viewport } = {}) {
    // Whatever wrapping happened at the old size was measured against the old
    // frame. Keeping it is how the ribbon ends up with a card-shaped hole in it
    // — the gallery is often built a moment before the page settles on its
    // final width.
    this.extra = 0
    if (screen) this.screen = screen
    if (viewport) {
      this.viewport = viewport
      if (this.plane.program.uniforms.uViewportSizes) {
        this.plane.program.uniforms.uViewportSizes.value = [
          this.viewport.width,
          this.viewport.height,
        ]
      }
    }
    this.scale = this.screen.height / 1500
    this.plane.scale.y = (this.viewport.height * (900 * this.scale)) / this.screen.height
    this.plane.scale.x = (this.viewport.width * (700 * this.scale)) / this.screen.width
    this.plane.program.uniforms.uPlaneSizes.value = [this.plane.scale.x, this.plane.scale.y]
    // The card just changed size; the label hanging under it has to follow.
    this.title?.layout()
    // Proportional, so the ribbon keeps its rhythm on a phone as on a desk.
    this.padding = this.plane.scale.x * 0.26
    this.width = this.plane.scale.x + this.padding
    this.widthTotal = this.width * this.length
    // Lay the ribbon out around the middle rather than starting at it, so the
    // frame is full on both sides before anyone has dragged anything. Still a
    // whole number of cards from zero, so the snap points don't move.
    this.x = this.width * (this.index - Math.floor(this.length / 2))
  }
}

class App {
  constructor(
    container,
    {
      items,
      bend,
      textColor = '#ffffff',
      borderRadius = 0,
      font = 'bold 30px Figtree',
      scrollSpeed = 2,
      scrollEase = 0.05,
      onItemClick,
    } = {},
  ) {
    document.documentElement.classList.remove('no-js')
    this.container = container
    this.scrollSpeed = scrollSpeed
    this.scroll = { ease: scrollEase, current: 0, target: 0, last: 0 }
    this.onItemClick = onItemClick
    this.itemCount = items?.length || 0
    this.onCheckDebounce = debounce(this.onCheck, 200)
    this.createRenderer()
    this.createCamera()
    this.createScene()
    this.onResize()
    this.createGeometry()
    this.createMedias(items, bend, textColor, borderRadius, font)
    this.update()
    this.addEventListeners()
  }
  createRenderer() {
    this.renderer = new Renderer({
      alpha: true,
      antialias: true,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
    })
    this.gl = this.renderer.gl
    this.gl.clearColor(0, 0, 0, 0)
    this.container.appendChild(this.gl.canvas)
  }
  createCamera() {
    this.camera = new Camera(this.gl)
    this.camera.fov = 45
    this.camera.position.z = 20
  }
  createScene() {
    this.scene = new Transform()
  }
  createGeometry() {
    this.planeGeometry = new Plane(this.gl, { heightSegments: 50, widthSegments: 100 })
  }
  createMedias(items, bend = 1, textColor, borderRadius, font) {
    const galleryItems = items && items.length ? items : []
    // The ribbon loops by drawing the set more than once. Two passes is plenty
    // for a full drawer, but one or two workspaces would leave it mostly empty
    // — so repeat until there are enough cards to fill the turn and to keep the
    // point a card wraps at safely off-screen. Kept even, so the card that
    // greets you is still the first workspace.
    const passes = galleryItems.length ? 2 * Math.max(1, Math.ceil(4 / galleryItems.length)) : 0
    this.mediasImages = Array.from({ length: passes }, () => galleryItems).flat()
    this.medias = this.mediasImages.map((data, index) => {
      return new Media({
        geometry: this.planeGeometry,
        gl: this.gl,
        image: data.image,
        index,
        length: this.mediasImages.length,
        renderer: this.renderer,
        scene: this.scene,
        screen: this.screen,
        text: data.text,
        viewport: this.viewport,
        bend,
        textColor,
        borderRadius,
        font,
      })
    })
  }
  onTouchDown(e) {
    this.isDown = true
    this.scroll.position = this.scroll.current
    this.start = e.touches ? e.touches[0].clientX : e.clientX
    this.startY = e.touches ? e.touches[0].clientY : e.clientY
    this.moved = 0
  }
  onTouchMove(e) {
    if (!this.isDown) return
    const x = e.touches ? e.touches[0].clientX : e.clientX
    this.moved = Math.abs(this.start - x)
    const distance = (this.start - x) * (this.scrollSpeed * 0.025)
    this.scroll.target = this.scroll.position + distance
  }
  onTouchUp(e) {
    const wasDown = this.isDown
    this.isDown = false
    this.onCheck()

    // A press that never became a drag is a click. Open whichever card sits
    // nearest the pointer, so the gallery behaves like a list of doors.
    if (!wasDown || !this.onItemClick || this.moved > 8) return
    const upX = e?.changedTouches ? e.changedTouches[0].clientX : e?.clientX
    const upY = e?.changedTouches ? e.changedTouches[0].clientY : e?.clientY
    if (upX == null) return
    const rect = this.container.getBoundingClientRect()
    if (upY < rect.top || upY > rect.bottom || upX < rect.left || upX > rect.right) return

    const localX = upX - rect.left
    let best = null
    let bestDist = Infinity
    this.medias.forEach((m) => {
      // world x → screen x
      const sx = (m.plane.position.x / this.viewport.width + 0.5) * rect.width
      const halfW = (m.plane.scale.x / this.viewport.width) * rect.width * 0.5
      const d = Math.abs(sx - localX)
      if (d < bestDist && d < halfW + 20) {
        bestDist = d
        best = m
      }
    })
    if (best && this.itemCount) this.onItemClick(best.index % this.itemCount)
  }
  onWheel(e) {
    const delta = e.deltaY || e.wheelDelta || e.detail
    this.scroll.target += (delta > 0 ? this.scrollSpeed : -this.scrollSpeed) * 0.2
    this.onCheckDebounce()
  }
  onKeyDown(e) {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault()
        this.scroll.target += this.scrollSpeed * 5
        this.onCheckDebounce()
        break
      case 'ArrowLeft':
        e.preventDefault()
        this.scroll.target -= this.scrollSpeed * 5
        this.onCheckDebounce()
        break
      case 'Home':
        e.preventDefault()
        this.scroll.target = 0
        this.onCheckDebounce()
        break
      case 'Enter':
      case ' ': {
        // Open whatever is centred — the keyboard equivalent of a click.
        if (!this.onItemClick || !this.medias?.length || !this.itemCount) break
        e.preventDefault()
        let best = null
        let bestDist = Infinity
        this.medias.forEach((m) => {
          const d = Math.abs(m.plane.position.x)
          if (d < bestDist) {
            bestDist = d
            best = m
          }
        })
        if (best) this.onItemClick(best.index % this.itemCount)
        break
      }
      default:
        break
    }
  }

  onCheck() {
    if (!this.medias || !this.medias[0]) return
    const width = this.medias[0].width
    const itemIndex = Math.round(Math.abs(this.scroll.target) / width)
    const item = width * itemIndex
    this.scroll.target = this.scroll.target < 0 ? -item : item
  }
  onResize() {
    this.screen = {
      width: this.container.clientWidth,
      height: this.container.clientHeight,
    }
    this.renderer.setSize(this.screen.width, this.screen.height)
    this.camera.perspective({ aspect: this.screen.width / this.screen.height })
    const fov = (this.camera.fov * Math.PI) / 180
    const height = 2 * Math.tan(fov / 2) * this.camera.position.z
    const width = height * this.camera.aspect
    this.viewport = { width, height }
    if (this.medias) {
      this.medias.forEach((media) => media.onResize({ screen: this.screen, viewport: this.viewport }))
    }
  }
  update() {
    this.scroll.current = lerp(this.scroll.current, this.scroll.target, this.scroll.ease)
    if (this.medias) {
      this.medias.forEach((media) => media.update(this.scroll))
    }
    this.renderer.render({ scene: this.scene, camera: this.camera })
    this.scroll.last = this.scroll.current
    this.raf = window.requestAnimationFrame(this.update.bind(this))
  }
  addEventListeners() {
    this.boundOnResize = this.onResize.bind(this)
    this.boundOnWheel = this.onWheel.bind(this)
    this.boundOnTouchDown = this.onTouchDown.bind(this)
    this.boundOnTouchMove = this.onTouchMove.bind(this)
    this.boundOnTouchUp = this.onTouchUp.bind(this)
    this.boundOnKeyDown = this.onKeyDown.bind(this)

    window.addEventListener('resize', this.boundOnResize)
    window.addEventListener('mousewheel', this.boundOnWheel)
    window.addEventListener('wheel', this.boundOnWheel)
    // Only start a drag from the gallery itself — otherwise every click on the
    // page scrubs it, and a press elsewhere would count as a card click.
    this.container.addEventListener('mousedown', this.boundOnTouchDown)
    window.addEventListener('mousemove', this.boundOnTouchMove)
    window.addEventListener('mouseup', this.boundOnTouchUp)
    this.container.addEventListener('touchstart', this.boundOnTouchDown)
    window.addEventListener('touchmove', this.boundOnTouchMove)
    window.addEventListener('touchend', this.boundOnTouchUp)

    this.container?.addEventListener('keydown', this.boundOnKeyDown)

    // The window isn't the only thing that changes shape — the gallery is built
    // as soon as the workspaces arrive, which can be a beat before the page has
    // settled on its final width.
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.boundOnResize)
      this.observer.observe(this.container)
    }
  }
  destroy() {
    this.observer?.disconnect()
    window.cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.boundOnResize)
    window.removeEventListener('mousewheel', this.boundOnWheel)
    window.removeEventListener('wheel', this.boundOnWheel)
    this.container?.removeEventListener('mousedown', this.boundOnTouchDown)
    window.removeEventListener('mousemove', this.boundOnTouchMove)
    window.removeEventListener('mouseup', this.boundOnTouchUp)
    this.container?.removeEventListener('touchstart', this.boundOnTouchDown)
    window.removeEventListener('touchmove', this.boundOnTouchMove)
    window.removeEventListener('touchend', this.boundOnTouchUp)
    if (this.renderer && this.renderer.gl && this.renderer.gl.canvas.parentNode) {
      this.renderer.gl.canvas.parentNode.removeChild(this.renderer.gl.canvas)
    }
    this.container?.removeEventListener('keydown', this.boundOnKeyDown)
  }
}

export default function CircularGallery({
  items,
  bend = 3,
  textColor = '#ffffff',
  borderRadius = 0.05,
  font = 'bold 30px Figtree',
  scrollSpeed = 2,
  scrollEase = 0.05,
  onItemClick,
}) {
  const containerRef = useRef(null)
  // Held in a ref so a new handler identity doesn't tear down the WebGL scene.
  const clickRef = useRef(onItemClick)
  clickRef.current = onItemClick

  useEffect(() => {
    if (!containerRef.current) return
    const app = new App(containerRef.current, {
      items,
      bend,
      textColor,
      borderRadius,
      font,
      scrollSpeed,
      scrollEase,
      onItemClick: (i) => clickRef.current?.(i),
    })
    return () => app.destroy()
  }, [items, bend, textColor, borderRadius, font, scrollSpeed, scrollEase])

  return (
    <div
      className="circular-gallery"
      ref={containerRef}
      tabIndex={0}
      role="region"
      aria-label="Workspaces. Use left and right arrow keys to browse, Enter to open."
    />
  )
}
