import { useEffect, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { checkProgression, repStatusClass } from '../lib/progression'

export default function ActiveWorkout() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const [session, setSession] = useState(null)
  const [exercises, setExercises] = useState([])
  const [setLogs, setSetLogs] = useState({})
  const [loading, setLoading] = useState(true)
  const [finishing, setFinishing] = useState(false)
  const [progressions, setProgressions] = useState([])
  const [elapsed, setElapsed] = useState(0)
  const [history, setHistory] = useState({})
  const timerRef = useRef(null)
  const startRef = useRef(Date.now())

  useEffect(() => {
    loadWorkout()
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [])

  async function loadWorkout() {
    const { data: sess } = await supabase
      .from('workout_sessions').select('*, program_days(*)')
      .eq('id', sessionId).single()
    if (!sess) { navigate('/'); return }
    setSession(sess)

    // Persist so user can navigate away and resume
    localStorage.setItem('activeSessionId', sessionId)

    const { data: exs } = await supabase
      .from('program_exercises').select('*')
      .eq('program_day_id', sess.program_day_id).order('exercise_order')
    setExercises(exs || [])

    const logs = {}
    for (const ex of exs || []) {
      logs[ex.id] = Array.from({ length: ex.sets }, (_, i) => ({
        set_number: i + 1, actual_reps: null,
        weight: parseFloat(ex.current_weight), completed: false,
      }))
    }
    setSetLogs(logs)
    setLoading(false)

    if (exs?.length) loadHistory(sess, exs)
  }

  async function loadHistory(sess, exs) {
    const { data: prevSessions } = await supabase
      .from('workout_sessions').select('id, completed_at')
      .eq('program_day_id', sess.program_day_id)
      .not('completed_at', 'is', null)
      .neq('id', sessionId)
      .order('completed_at', { ascending: false })
      .limit(3)

    if (!prevSessions?.length) return

    const { data: logs } = await supabase
      .from('set_logs').select('*')
      .in('session_id', prevSessions.map((s) => s.id))
      .in('program_exercise_id', exs.map((e) => e.id))

    const h = {}
    for (const ex of exs) {
      h[ex.id] = prevSessions
        .map((s) => ({
          date: s.completed_at,
          sets: (logs || []).filter(
            (l) => l.session_id === s.id && l.program_exercise_id === ex.id
          ),
        }))
        .filter((s) => s.sets.length > 0)
    }
    setHistory(h)
  }

  function updateSet(exerciseId, setIdx, field, value) {
    setSetLogs((prev) => ({
      ...prev,
      [exerciseId]: prev[exerciseId].map((s, i) =>
        i === setIdx ? { ...s, [field]: value === '' ? null : Number(value) } : s
      ),
    }))
  }

  function addSet(exerciseId) {
    const ex = exercises.find((e) => e.id === exerciseId)
    setSetLogs((prev) => ({
      ...prev,
      [exerciseId]: [
        ...prev[exerciseId],
        {
          set_number: prev[exerciseId].length + 1,
          actual_reps: null,
          weight: parseFloat(ex?.current_weight || 0),
          completed: false,
        },
      ],
    }))
  }

  async function saveRepRange(exerciseId, min, max) {
    const minN = parseInt(min, 10)
    const maxN = parseInt(max, 10)
    if (!minN || !maxN || minN > maxN) return
    setExercises((prev) =>
      prev.map((e) => e.id === exerciseId ? { ...e, rep_min: minN, rep_max: maxN } : e)
    )
    await supabase.from('program_exercises')
      .update({ rep_min: minN, rep_max: maxN }).eq('id', exerciseId)
  }

  function toggleComplete(exerciseId, setIdx) {
    setSetLogs((prev) => {
      const sets = [...prev[exerciseId]]
      const set = sets[setIdx]
      if (set.actual_reps === null && !set.completed) {
        const ex = exercises.find((e) => e.id === exerciseId)
        sets[setIdx] = { ...set, actual_reps: ex?.rep_max ?? set.actual_reps, completed: true }
      } else {
        sets[setIdx] = { ...set, completed: !set.completed }
      }
      return { ...prev, [exerciseId]: sets }
    })
  }

  function formatTime(s) {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  function exerciseProgress(exerciseId) {
    const sets = setLogs[exerciseId] || []
    return { done: sets.filter((s) => s.completed).length, total: sets.length }
  }

  function totalProgress() {
    let done = 0, total = 0
    for (const ex of exercises) {
      const p = exerciseProgress(ex.id)
      done += p.done; total += p.total
    }
    return { done, total }
  }

  const isRestDay = !loading && exercises.length === 0

  async function finishWorkout() {
    if (!window.confirm('Finish this workout?')) return
    setFinishing(true)
    try {
      const allLogs = []
      for (const ex of exercises) {
        for (const s of setLogs[ex.id] || []) {
          if (s.completed) {
            allLogs.push({
              session_id: sessionId, program_exercise_id: ex.id,
              exercise_name: ex.name, set_number: s.set_number,
              target_reps: ex.rep_max, actual_reps: s.actual_reps,
              weight: s.weight, weight_unit: ex.weight_unit, completed: true,
            })
          }
        }
      }
      if (allLogs.length > 0) await supabase.from('set_logs').insert(allLogs)
      await supabase.from('workout_sessions')
        .update({ completed_at: new Date().toISOString() }).eq('id', sessionId)
      const progs = checkProgression(allLogs, exercises)
      for (const p of progs) {
        await supabase.from('program_exercises')
          .update({ current_weight: p.newWeight }).eq('id', p.exerciseId)
      }
      localStorage.removeItem('activeSessionId')
      if (progs.length > 0) setProgressions(progs)
      else navigate('/')
    } catch (err) {
      alert(err.message)
      setFinishing(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg)' }}>
      <div className="w-7 h-7 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--text)', borderTopColor: 'transparent' }} />
    </div>
  )

  if (progressions.length > 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: 'var(--bg)' }}>
        <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text)' }}>Nice work.</h1>
        <p className="text-sm mb-8" style={{ color: 'var(--text-2)' }}>Weights increased for next session:</p>
        <div className="w-full max-w-sm space-y-3 mb-10">
          {progressions.map((p) => (
            <div key={p.exerciseId} className="rounded-2xl px-5 py-4 text-left" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              <p className="font-semibold" style={{ color: 'var(--text)' }}>{p.exerciseName}</p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
                {p.oldWeight} <span style={{ color: 'var(--text-3)' }}>→</span>{' '}
                <span className="font-bold" style={{ color: 'var(--text)' }}>{p.newWeight} {p.unit}</span>
                <span className="ml-2" style={{ color: 'var(--text-3)' }}>(+{p.newWeight - p.oldWeight})</span>
              </p>
            </div>
          ))}
        </div>
        <button onClick={() => navigate('/')} className="font-bold px-10 py-4 rounded-2xl text-base"
          style={{ background: 'var(--text)', color: 'var(--bg)' }}>Done</button>
      </div>
    )
  }

  if (isRestDay) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
        <div className="sticky top-0 z-10 px-4 pt-12 pb-3" style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-2)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="text-center">
              <h1 className="font-bold" style={{ color: 'var(--text)' }}>{session?.day_name}</h1>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>{formatTime(elapsed)}</p>
            </div>
            <div className="w-8" />
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text)' }}>{session?.day_name}</h2>
          <p className="text-sm mb-10" style={{ color: 'var(--text-3)' }}>No exercises — log this day as complete.</p>
          <button onClick={finishWorkout} disabled={finishing}
            className="font-bold px-10 py-4 rounded-2xl text-base disabled:opacity-40"
            style={{ background: 'var(--text)', color: 'var(--bg)' }}>
            {finishing ? 'Saving...' : 'Mark Complete'}
          </button>
        </div>
      </div>
    )
  }

  const { done, total } = totalProgress()
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>

      {/* Header */}
      <div className="sticky top-0 z-10 px-4 pb-3" style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)', paddingTop: 'max(12px, env(safe-area-inset-top, 12px))' }}>
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-2)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="text-center">
            <h1 className="font-bold" style={{ color: 'var(--text)' }}>{session?.day_name}</h1>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>{formatTime(elapsed)}</p>
          </div>
          <button onClick={finishWorkout} disabled={finishing || done === 0}
            className="text-sm font-bold px-4 py-2 rounded-xl disabled:opacity-30"
            style={{ background: 'var(--text)', color: 'var(--bg)' }}>
            {finishing ? '...' : 'Finish'}
          </button>
        </div>
        <div className="h-0.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
          <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: 'var(--text)' }} />
        </div>
        <p className="text-right text-xs mt-1" style={{ color: 'var(--text-3)' }}>{done}/{total} sets</p>
      </div>

      {/* Exercises */}
      <div className="flex-1 px-4 py-4 pb-10 space-y-4 max-w-lg mx-auto w-full">
        {exercises.map((ex) => {
          const sets = setLogs[ex.id] || []
          const { done: exDone, total: exTotal } = exerciseProgress(ex.id)
          const allDone = exDone === exTotal && exTotal > 0
          const exHistory = history[ex.id] || []

          return (
            <ExerciseCard
              key={ex.id}
              ex={ex}
              sets={sets}
              allDone={allDone}
              exHistory={exHistory}
              fmtDate={fmtDate}
              onUpdateSet={(setIdx, field, value) => updateSet(ex.id, setIdx, field, value)}
              onToggleComplete={(setIdx) => toggleComplete(ex.id, setIdx)}
              onNavigate={() => navigate(`/exercise/${ex.id}`)}
              onAddSet={() => addSet(ex.id)}
              onSaveRepRange={(min, max) => saveRepRange(ex.id, min, max)}
            />
          )
        })}
      </div>

      {/* Bottom finish */}
      <div className="sticky bottom-0 px-4 py-4" style={{ background: 'var(--bg)', borderTop: '1px solid var(--border)', paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))' }}>
        <button onClick={finishWorkout} disabled={finishing || done === 0}
          className="w-full font-bold py-4 rounded-2xl text-base disabled:opacity-30"
          style={{ background: 'var(--text)', color: 'var(--bg)' }}>
          {finishing ? 'Saving...' : `Finish Workout (${done}/${total} sets)`}
        </button>
      </div>
    </div>
  )
}

// ── Swipeable exercise card ──────────────────────────────────────────────────

function ExerciseCard({ ex, sets, allDone, exHistory, fmtDate, onUpdateSet, onToggleComplete, onNavigate, onAddSet, onSaveRepRange }) {
  const scrollRef = useRef(null)
  const [onHistoryPanel, setOnHistoryPanel] = useState(false)
  const [editReps, setEditReps] = useState(false)
  const [editMin, setEditMin] = useState(ex.rep_min)
  const [editMax, setEditMax] = useState(ex.rep_max)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = el.scrollWidth / 2
  }, [])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    setOnHistoryPanel(el.scrollLeft < el.clientWidth * 0.6)
  }

  function openEditReps() {
    setEditMin(ex.rep_min)
    setEditMax(ex.rep_max)
    setEditReps(true)
  }

  function confirmEditReps() {
    onSaveRepRange(editMin, editMax)
    setEditReps(false)
  }

  const cardStyle = {
    borderRadius: '16px',
    overflow: 'hidden',
    border: `1px solid ${allDone ? 'var(--border-2)' : 'var(--border)'}`,
    background: 'var(--surface-2)',
    flex: '0 0 100%',
    minWidth: '100%',
    scrollSnapAlign: 'start',
  }

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          display: 'flex', overflowX: 'scroll',
          scrollSnapType: 'x mandatory', scrollbarWidth: 'none',
          msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch',
          borderRadius: '16px',
        }}
      >
        {/* ── Panel 1: History ── */}
        <div style={{ ...cardStyle, borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-3)', margin: '0 0 2px' }}>← back to live</p>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', margin: 0 }}>{ex.name}</h3>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-3)', margin: 0 }}>History</p>
          </div>
          <div style={{ padding: '12px 16px 14px' }}>
            {exHistory.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--text-3)', textAlign: 'center', padding: '20px 0' }}>No history yet</p>
            ) : (
              exHistory.map((session, si) => (
                <div key={si} style={{ marginBottom: si < exHistory.length - 1 ? '16px' : 0 }}>
                  <p style={{ fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '6px' }}>
                    {fmtDate(session.date)}
                  </p>
                  {session.sets.map((s, i) => {
                    const hitTarget = s.actual_reps >= s.target_reps
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 8px', borderRadius: '8px', marginBottom: '3px', background: 'var(--surface-2)' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-3)', width: '16px' }}>#{s.set_number}</span>
                        <span style={{ fontSize: '14px', color: 'var(--text)', fontWeight: 500 }}>{s.weight}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>{ex.weight_unit}</span>
                        <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>×</span>
                        <span style={{ fontSize: '14px', color: hitTarget ? 'var(--text)' : '#c8a84b', fontWeight: 500 }}>{s.actual_reps}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>reps</span>
                        {hitTarget && <span style={{ fontSize: '11px', color: 'var(--text-2)', marginLeft: 'auto' }}>✓</span>}
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Panel 2: Live ── */}
        <div style={{ ...cardStyle }}>
          <div style={{ padding: '12px 16px 8px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', margin: '0 0 4px' }}>{ex.name}</h3>
              {editReps ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>{sets.length} sets ·</span>
                  <input type="number" value={editMin}
                    onChange={(e) => setEditMin(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    style={{ width: 36, textAlign: 'center', fontSize: '12px', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-2)', borderRadius: '6px', padding: '2px 4px', outline: 'none' }}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>–</span>
                  <input type="number" value={editMax}
                    onChange={(e) => setEditMax(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    style={{ width: 36, textAlign: 'center', fontSize: '12px', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-2)', borderRadius: '6px', padding: '2px 4px', outline: 'none' }}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>reps</span>
                  <button onClick={confirmEditReps} style={{ background: 'none', border: 'none', color: 'var(--text-2)', fontSize: '15px', cursor: 'pointer', padding: '0 3px' }}>✓</button>
                  <button onClick={() => setEditReps(false)} style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: '13px', cursor: 'pointer', padding: '0 3px' }}>✕</button>
                </div>
              ) : (
                <p onClick={openEditReps} style={{ fontSize: '11px', color: 'var(--text-3)', margin: 0, cursor: 'pointer' }}>
                  {sets.length} sets · {ex.rep_min}–{ex.rep_max} reps · {ex.current_weight} {ex.weight_unit}
                  <span style={{ marginLeft: 5, opacity: 0.5 }}>✎</span>
                </p>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              {allDone && <span style={{ fontSize: '13px', color: 'var(--text-2)' }}>✓</span>}
              {exHistory.length > 0 && !onHistoryPanel && (
                <span style={{ fontSize: '10px', color: 'var(--text-3)', letterSpacing: '0.06em' }}>← history</span>
              )}
              <button onClick={onNavigate} style={{ color: 'var(--text-3)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Set rows */}
          <div style={{ padding: '0 16px 14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr 1fr 36px', gap: '4px', marginBottom: '4px', padding: '0 2px' }}>
              {['SET', 'WEIGHT', 'REPS', ''].map((h, i) => (
                <span key={i} style={{ fontSize: '10px', color: 'var(--text-3)', textAlign: i === 0 ? 'left' : 'center', letterSpacing: '0.08em' }}>{h}</span>
              ))}
            </div>

            {sets.map((set, idx) => (
              <div key={idx} style={{
                display: 'grid', gridTemplateColumns: '20px 1fr 1fr 36px',
                gap: '4px', alignItems: 'center', marginBottom: '6px',
                background: set.completed ? 'rgba(240,236,228,0.06)' : 'var(--surface-3)',
                borderRadius: '10px', padding: '6px 6px',
              }}>
                <span style={{ fontSize: '13px', fontWeight: 500, color: set.completed ? 'var(--text)' : 'var(--text-3)', textAlign: 'center' }}>
                  {idx + 1}
                </span>
                <input
                  type="number"
                  value={set.weight ?? ''}
                  onChange={(e) => onUpdateSet(idx, 'weight', e.target.value)}
                  onFocus={(e) => e.target.select()}
                  style={{ width: '100%', textAlign: 'center', borderRadius: '8px', padding: '6px 4px', fontSize: '14px', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', outline: 'none' }}
                  placeholder={`${ex.current_weight}`}
                  step="2.5" min="0" inputMode="decimal"
                />
                <input
                  type="number"
                  value={set.actual_reps ?? ''}
                  onChange={(e) => onUpdateSet(idx, 'actual_reps', e.target.value)}
                  onFocus={(e) => e.target.select()}
                  className={set.actual_reps !== null ? repStatusClass(set.actual_reps, ex.rep_min, ex.rep_max) : ''}
                  style={{ width: '100%', textAlign: 'center', borderRadius: '8px', padding: '6px 4px', fontSize: '14px', background: 'var(--surface)', color: set.actual_reps === null ? 'var(--text-3)' : undefined, border: '1px solid var(--border)', outline: 'none' }}
                  placeholder={`${ex.rep_min}–${ex.rep_max}`}
                  min="0" max="100" inputMode="numeric"
                />
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <button
                    onClick={() => onToggleComplete(idx)}
                    style={{
                      width: 32, height: 32, borderRadius: '50%',
                      border: `2px solid ${set.completed ? 'var(--text)' : 'var(--border-2)'}`,
                      background: set.completed ? 'var(--text)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                    }}
                  >
                    <svg width="14" height="14" fill="none" stroke={set.completed ? 'var(--bg)' : 'transparent'} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}

            {/* Add set */}
            <button
              onClick={onAddSet}
              style={{
                width: '100%', marginTop: '4px',
                background: 'none', border: '1px dashed var(--border)',
                borderRadius: '10px', padding: '8px',
                fontSize: '11px', color: 'var(--text-3)',
                cursor: 'pointer', letterSpacing: '0.12em',
                fontFamily: "'Oxanium', sans-serif",
              }}
            >+ ADD SET</button>

            {allDone && sets.every((s) => s.actual_reps >= ex.rep_max) && (
              <p style={{ fontSize: '11px', textAlign: 'center', color: 'var(--text-2)', marginTop: '8px' }}>
                All sets at max — weight increases {ex.weight_increment}{ex.weight_unit} next session
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Scroll dots */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '5px', marginTop: '6px' }}>
        <div style={{ width: 5, height: 5, borderRadius: '50%', background: onHistoryPanel ? 'var(--text-2)' : 'var(--border-2)', transition: 'background 0.2s' }} />
        <div style={{ width: 5, height: 5, borderRadius: '50%', background: onHistoryPanel ? 'var(--border-2)' : 'var(--text-2)', transition: 'background 0.2s' }} />
      </div>
    </div>
  )
}
