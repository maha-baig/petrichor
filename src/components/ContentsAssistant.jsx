import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { askContents, describeContents, planContents } from '../assist.js'
import { deletePiece, reorderPieces, updatePiece } from '../library.js'

const fmt = (n) => Number(n || 0).toLocaleString()

/**
 * "Tell Petrichor": the author says what to do with the contents in her own
 * words; the assistant proposes moves, renames and deletions; she sees exactly
 * what will happen, and nothing changes until she applies it.
 */
export default function ContentsAssistant({ workId, onChanged }) {
  const [instruction, setInstruction] = useState('')
  const [phase, setPhase] = useState('idle') // idle | thinking | review | applying
  const [proposal, setProposal] = useState(null) // { contents, plan, note }
  const [error, setError] = useState(null)

  async function ask(e) {
    e?.preventDefault()
    if (!instruction.trim()) return
    setPhase('thinking')
    setError(null)
    try {
      const contents = await describeContents(workId)
      const { actions = [], note = '' } = await askContents(instruction.trim(), contents)
      const plan = planContents(contents, actions)
      setProposal({ contents, plan, note })
      setPhase('review')
    } catch (err) {
      setError(err.message)
      setPhase('idle')
    }
  }

  async function apply() {
    const { plan } = proposal
    setPhase('applying')
    setError(null)
    try {
      for (const [id, title] of plan.renames) if (!plan.deletes.has(id)) await updatePiece(id, { title })
      for (const id of plan.deletes) await deletePiece(id)
      if (plan.changedOrder || plan.deletes.size) await reorderPieces(plan.order)
      setProposal(null)
      setInstruction('')
      setPhase('idle')
      onChanged?.()
    } catch (err) {
      setError(`Something didn’t apply: ${err.message}`)
      setPhase('review')
      onChanged?.()
    }
  }

  const byId = proposal ? new Map(proposal.contents.map((c) => [c.id, c])) : null
  const nothing =
    proposal && !proposal.plan.renames.size && !proposal.plan.deletes.size && !proposal.plan.changedOrder

  return (
    <div className="mt-4 rounded-sm border border-line bg-card/50 p-4">
      <form onSubmit={ask} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="flex flex-1 items-center gap-2 rounded-full border border-line bg-paper px-4 py-2 focus-within:border-fuchsia">
          <Sparkles size={15} className="shrink-0 text-fuchsia" />
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            disabled={phase !== 'idle'}
            placeholder="Tell Petrichor: move Chapter 5 after the Prologue, delete the duplicate…"
            aria-label="Tell Petrichor what to change in the contents"
            className="w-full bg-transparent text-sm text-body placeholder:text-muted/60 focus:outline-none disabled:opacity-60"
          />
        </label>
        <button
          type="submit"
          disabled={phase !== 'idle' || !instruction.trim()}
          className="shrink-0 rounded-full bg-fuchsia px-4 py-2 font-grotesk text-sm font-bold text-white disabled:opacity-50"
        >
          {phase === 'thinking' ? 'Thinking…' : 'Show me'}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-fuchsia">{error}</p>}

      {proposal && (phase === 'review' || phase === 'applying') && (
        <div className="mt-4">
          {proposal.note && <p className="font-serif italic text-body">{proposal.note}</p>}

          {!nothing && (
            <ul className="mt-3 flex flex-col gap-1 text-sm">
              {[...proposal.plan.renames]
                .filter(([id]) => !proposal.plan.deletes.has(id))
                .map(([id, title]) => (
                  <li key={'r' + id} className="text-body">
                    <span className="text-muted">Rename</span> {byId.get(id).label} <span className="text-muted">→</span>{' '}
                    <span className="font-serif italic">{title}</span>
                  </li>
                ))}
              {proposal.plan.moves.map((m, i) => (
                <li key={'m' + i} className="text-body">
                  <span className="text-muted">Move</span> {byId.get(m.id).label}{' '}
                  <span className="text-muted">{m.after ? `after ${byId.get(m.after).label}` : 'to the very start'}</span>
                </li>
              ))}
              {[...proposal.plan.deletes].map((id) => (
                <li key={'d' + id} className="text-fuchsia">
                  Delete {byId.get(id).label} ({fmt(byId.get(id).words)} words, and its history)
                </li>
              ))}
            </ul>
          )}

          {proposal.plan.problems.length > 0 && (
            <p className="mt-2 text-xs text-muted">Also: {proposal.plan.problems.join('; ')}.</p>
          )}

          {(proposal.plan.changedOrder || proposal.plan.deletes.size > 0) && (
            <details className="mt-3 text-xs text-muted" open>
              <summary className="cursor-pointer">The contents afterwards</summary>
              <ol className="mt-2 list-decimal pl-6">
                {proposal.plan.order.map((id) => (
                  <li key={id} className="py-0.5">
                    <span className="font-serif italic text-body">{proposal.plan.renames.get(id) || byId.get(id).label}</span>
                  </li>
                ))}
              </ol>
            </details>
          )}

          <div className="mt-4 flex gap-2">
            {!nothing && (
              <button
                onClick={apply}
                disabled={phase === 'applying'}
                className="rounded-full bg-fuchsia px-4 py-1.5 font-grotesk text-xs font-bold text-white disabled:opacity-60"
              >
                {phase === 'applying' ? 'Applying…' : proposal.plan.deletes.size ? 'Apply, including deletions' : 'Apply'}
              </button>
            )}
            <button
              onClick={() => {
                setProposal(null)
                setPhase('idle')
              }}
              disabled={phase === 'applying'}
              className="rounded-full px-3 py-1.5 text-xs text-muted hover:text-body"
            >
              {nothing ? 'OK' : 'Cancel'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
