const MOODS = [
  'melancholy',
  'longing',
  'tenderness',
  'wonder',
  'grief',
  'nostalgia',
  'quiet rage',
  'restless',
]

export default function MoodSelector({ mood, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 font-serif italic text-muted">in a register of</span>
      {MOODS.map((m) => {
        const active = m === mood
        return (
          <button
            key={m}
            onClick={() => onChange(m)}
            className={
              'rounded-full border px-3 py-1 text-sm transition-colors ' +
              (active
                ? 'border-fuchsia bg-fuchsia text-white'
                : 'border-line text-muted hover:border-fuchsia/50 hover:text-body')
            }
          >
            {m}
          </button>
        )
      })}
    </div>
  )
}
