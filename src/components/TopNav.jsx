import { useState } from 'react'
import { Feather, Menu, X } from 'lucide-react'

const LINKS = [
  { l: 'Home', t: 'home' },
  { l: 'Workspaces', t: 'work' },
  { l: 'Word map', t: 'map' },
  { l: 'Reviewer', t: 'review' },
  { l: 'Poem on image', t: 'overlay' },
]

// One navbar for the whole site. tone="video" = white (over the hero video);
// tone="app" = theme-aware (adapts to dark/light), fuchsia on the active page.
export default function TopNav({ tone = 'app', active, onNavigate }) {
  const [open, setOpen] = useState(false)
  const onVideo = tone === 'video'
  const brand = onVideo ? 'text-white' : 'text-body'
  const linkCls = (isActive) =>
    'font-grotesk text-sm font-medium transition-colors ' +
    (isActive
      ? 'text-fuchsia'
      : onVideo
        ? 'text-white/80 hover:text-white'
        : 'text-muted hover:text-body')

  const go = (t) => {
    setOpen(false)
    onNavigate(t)
  }

  return (
    <nav className="relative z-20 px-6 py-6">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
        <button onClick={() => go('home')} className="flex shrink-0 items-center gap-2">
          <Feather size={24} className="text-fuchsia" />
          <span className={'font-grotesk text-lg font-semibold ' + brand}>Petrichor</span>
        </button>

        {/* Desktop / tablet: inline links. Hidden on phones, where they'd overflow. */}
        <div className="hidden items-center gap-5 sm:flex sm:gap-8">
          {LINKS.map((n) => (
            <button key={n.t} onClick={() => go(n.t)} className={linkCls(active === n.t)}>
              {n.l}
            </button>
          ))}
        </div>

        {/* Phones: a hamburger that toggles the dropdown below. */}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          className={'shrink-0 sm:hidden ' + (onVideo ? 'text-white' : 'text-body')}
        >
          {open ? <X size={26} /> : <Menu size={26} />}
        </button>
      </div>

      {/* Mobile dropdown. Solid themed surface so links stay legible over the
          hero video or a light app page. */}
      {open && (
        <div
          className={
            'absolute inset-x-4 top-full mt-1 flex flex-col overflow-hidden rounded-2xl border shadow-xl sm:hidden ' +
            (onVideo
              ? 'border-white/15 bg-black/90 backdrop-blur'
              : 'border-line bg-paper')
          }
        >
          {LINKS.map((n) => {
            const isActive = active === n.t
            return (
              <button
                key={n.t}
                onClick={() => go(n.t)}
                className={
                  'px-5 py-3.5 text-left font-grotesk text-base font-medium transition-colors ' +
                  (isActive
                    ? 'text-fuchsia'
                    : onVideo
                      ? 'text-white/85 hover:bg-white/10'
                      : 'text-body hover:bg-body/5')
                }
              >
                {n.l}
              </button>
            )
          })}
        </div>
      )}
    </nav>
  )
}
