import { Feather } from 'lucide-react'

const LINKS = [
  { l: 'Home', t: 'home' },
  { l: 'Word map', t: 'map' },
  { l: 'Reviewer', t: 'review' },
  { l: 'Poem on image', t: 'overlay' },
]

// One navbar for the whole site. tone="video" = white (over the hero video);
// tone="app" = theme-aware (adapts to dark/light), fuchsia on the active page.
export default function TopNav({ tone = 'app', active, onNavigate }) {
  const onVideo = tone === 'video'
  const brand = onVideo ? 'text-white' : 'text-body'
  const linkCls = (isActive) =>
    'font-grotesk text-sm font-medium transition-colors ' +
    (isActive
      ? 'text-fuchsia'
      : onVideo
        ? 'text-white/80 hover:text-white'
        : 'text-muted hover:text-body')

  return (
    <nav className="relative z-20 px-6 py-6">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
        <button onClick={() => onNavigate('home')} className="flex shrink-0 items-center gap-2">
          <Feather size={24} className="text-fuchsia" />
          <span className={'font-grotesk text-lg font-semibold ' + brand}>Petrichor</span>
        </button>
        <div className="flex items-center gap-5 sm:gap-8">
          {LINKS.map((n) => (
            <button key={n.t} onClick={() => onNavigate(n.t)} className={linkCls(active === n.t)}>
              {n.l}
            </button>
          ))}
        </div>
      </div>
    </nav>
  )
}
