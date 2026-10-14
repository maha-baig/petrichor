import { bookTitle } from '../library.js'

/**
 * A book's cover: her uploaded image, or — until there is one — a typeset
 * cover in the book's own colour, the way a proof copy looks.
 */
const TYPE = {
  sm: { imprint: 'text-[0.38rem]', title: 'text-sm', subtitle: 'text-[0.55rem]', author: 'text-[0.42rem]' },
  md: { imprint: 'text-[0.5rem]', title: 'text-lg sm:text-xl', subtitle: 'text-[0.7rem]', author: 'text-[0.55rem]' },
  lg: { imprint: 'text-[0.62rem]', title: 'text-3xl', subtitle: 'text-sm', author: 'text-[0.7rem]' },
}

export default function BookCover({ work, className = '', size = 'md' }) {
  const t = TYPE[size] || TYPE.md
  return (
    <div
      className={
        'relative aspect-[2/3] w-full overflow-hidden rounded-[3px] shadow-[0_1px_2px_rgba(0,0,0,0.25),0_12px_28px_-12px_rgba(0,0,0,0.55)] ' +
        className
      }
      style={{ background: work.cover_color || '#2a1f2d' }}
    >
      {work.coverUrl ? (
        <img src={work.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-between px-[10%] py-[14%] text-center text-[#f3ede4]">
          <span className={'font-grotesk font-bold uppercase tracking-[0.3em] opacity-60 ' + t.imprint}>
            Petrichor
          </span>
          <div>
            <div className={'break-words font-serif italic leading-[1.05] ' + t.title}>
              {bookTitle(work)}
            </div>
            {work.subtitle && (
              <div className={'mt-2 font-serif italic opacity-70 ' + t.subtitle}>{work.subtitle}</div>
            )}
          </div>
          <span className={'font-grotesk uppercase tracking-[0.2em] opacity-75 ' + t.author}>
            {work.author || ' '}
          </span>
        </div>
      )}
      {/* the spine's crease */}
      <div className="pointer-events-none absolute inset-y-0 left-[4%] w-px bg-white/10" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[4%] bg-black/15" />
    </div>
  )
}
