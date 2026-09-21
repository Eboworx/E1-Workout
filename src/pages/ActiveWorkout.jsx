import { useEffect, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase } from '../lib/supabase'
import { checkProgression } from '../lib/progression'
import { AB_BANK } from '../lib/abBank'
import {
  reorderExercises, visibleWhileDragging, insertExerciseAfter, withOrder, persistOrder, groupOf, isGroupEnd,
} from '../lib/exerciseOrder'

const PROGRESS_KEY = (id) => `workout_progress_${id}`
const AB_KEY = (id) => `ab_warmup_${id}`
const REST_DUR_KEY = 'rest_duration_secs'
const REST_PRESETS = [60, 90, 120, 150, 180]

// Soft double-beep when rest is up
function restBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    ;[0, 0.22].forEach((delay) => {
      const t0 = ctx.currentTime + delay
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(0.25, t0 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5)
      osc.connect(g).connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + 0.55)
    })
  } catch { /* ignore */ }
  if (navigator.vibrate) navigator.vibrate([200, 100, 200])
}

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
  const [sessionHistory, setSessionHistory] = useState([])
  const [readyToIncrease, setReadyToIncrease] = useState({}) // exerciseId → true if last session hit all targets
  const [showHistory, setShowHistory] = useState(false)
  const [showAddEx, setShowAddEx] = useState(false)
  const [insertAfterIdx, setInsertAfterIdx] = useState(null)
  const [addExForm, setAddExForm] = useState({ name: '', sets: 3, rep_min: 8, rep_max: 12, weight: 0, unit: 'lbs', isSuperset: false })
  const [addingEx, setAddingEx] = useState(false)
  const [abIdx, setAbIdx] = useState(null)
  const [abDone, setAbDone] = useState(false)
  const [abPickerOpen, setAbPickerOpen] = useState(false)
  const [dragId, setDragId] = useState(null)
  const [expanded, setExpanded] = useState({}) // exerciseId → true/false (manual override of the auto-expand)
  const timerRef = useRef(null)
  const startRef = useRef(Date.now())

  // Rest timer
  const [restEndAt, setRestEndAt] = useState(null)
  const [restLeft, setRestLeft] = useState(0)
  const [restDur, setRestDur] = useState(() => {
    const v = parseInt(localStorage.getItem(REST_DUR_KEY), 10)
    return v > 0 ? v : 120
  })
  const restTickRef = useRef(null)

  function startRest() {
    setRestEndAt(Date.now() + restDur * 1000)
    setRestLeft(restDur)
  }

  function adjustRest(delta) {
    setRestDur((d) => {
      const next = Math.min(600, Math.max(15, d + delta))
      localStorage.setItem(REST_DUR_KEY, String(next))
      return next
    })
    if (restEndAt) setRestEndAt((e) => e + delta * 1000)
  }

  function cycleRestPreset() {
    setRestDur((d) => {
      const i = REST_PRESETS.indexOf(d)
      const next = REST_PRESETS[(i + 1) % REST_PRESETS.length] || REST_PRESETS[0]
      localStorage.setItem(REST_DUR_KEY, String(next))
      return next
    })
  }

  useEffect(() => {
    if (!restEndAt) { clearInterval(restTickRef.current); return }
    restTickRef.current = setInterval(() => {
      const left = Math.ceil((restEndAt - Date.now()) / 1000)
      if (left <= 0) {
        restBeep()
        setRestEndAt(null)
      } else {
        setRestLeft(left)
      }
    }, 300)
    return () => clearInterval(restTickRef.current)
  }, [restEndAt])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  )

  useEffect(() => {
    loadWorkout()
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [])

  useEffect(() => {
    if (!loading && Object.keys(setLogs).length > 0) {
      localStorage.setItem(PROGRESS_KEY(sessionId), JSON.stringify(setLogs))
    }
  }, [setLogs, loading])

  useEffect(() => {
    if (!loading && abIdx !== null) localStorage.setItem(AB_KEY(sessionId), JSON.stringify({ idx: abIdx, done: abDone }))
  }, [abIdx, abDone, loading])

  async function loadWorkout() {
    const { data: sess } = await supabase
      .from('workout_sessions').select('*, program_days(*)')
      .eq('id', sessionId).single()
    if (!sess) { navigate('/'); return }
    setSession(sess)
    localStorage.setItem('activeSessionId', sessionId)

    const { data: exs } = await supabase
      .from('program_exercises').select('*')
      .eq('program_day_id', sess.program_day_id).order('exercise_order').order('id')
    setExercises(exs || [])

    // Load all past sessions for this day (for history panel)
    const { data: allPast } = await supabase
      .from('workout_sessions')
      .select('id, completed_at')
      .eq('program_day_id', sess.program_day_id)
      .not('completed_at', 'is', null)
      .neq('id', sessionId)
      .order('completed_at', { ascending: true })
    setSessionHistory(allPast || [])

    // Ab warm-up: restore a mid-workout choice; otherwise the user picks
    const savedAb = localStorage.getItem(AB_KEY(sessionId))
    if (savedAb) {
      try {
        const a = JSON.parse(savedAb)
        setAbIdx(a.idx ?? null)
        setAbDone(!!a.done)
      } catch { /* stay unpicked */ }
    }

    // Load last session's per-set weights so pyramid sets carry over correctly.
    // Progression: if every set hit its target reps last session → add weight_increment.
    // Otherwise carry exact weights forward. No current_weight arithmetic needed.
    const lastWeightsByExercise = {}
    const readyMap = {}
    if (exs?.length && allPast?.length) {
      const lastSession = allPast[allPast.length - 1]
      const { data: lastLogs } = await supabase
        .from('set_logs')
        .select('program_exercise_id, set_number, weight, actual_reps, target_reps')
        .eq('session_id', lastSession.id)
        .in('program_exercise_id', exs.map((e) => e.id))
        .order('set_number')

      for (const ex of exs) {
        const logs = (lastLogs || [])
          .filter((l) => l.program_exercise_id === ex.id)
          .sort((a, b) => a.set_number - b.set_number)
        if (logs.length > 0) {
          const allHitTarget = logs.every(
            (l) => l.actual_reps !== null && l.actual_reps >= (l.target_reps ?? ex.rep_max)
          )
          readyMap[ex.id] = allHitTarget
          // Carry weights forward as-is; progression happens when user decides to bump
          lastWeightsByExercise[ex.id] = logs.map((l) => parseFloat(l.weight))
        }
      }
    }
    setReadyToIncrease(readyMap)

    const defaultLogs = {}
    for (const ex of exs || []) {
      const prevWeights = lastWeightsByExercise[ex.id]
      defaultLogs[ex.id] = Array.from({ length: ex.sets }, (_, i) => ({
        set_number: i + 1,
        actual_reps: null,
        weight: prevWeights ? (prevWeights[i] ?? parseFloat(ex.current_weight)) : parseFloat(ex.current_weight),
        completed: false,
      }))
    }

    const saved = localStorage.getItem(PROGRESS_KEY(sessionId))
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        const merged = { ...defaultLogs }
        for (const key of Object.keys(parsed)) {
          if (merged[key]) merged[key] = parsed[key]
        }
        setSetLogs(merged)
      } catch { setSetLogs(defaultLogs) }
    } else {
      setSetLogs(defaultLogs)
    }

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

  async function handleDragEnd(event) {
    const { active, over } = event
    setDragId(null)
    if (!over || active.id === over.id) return
    const prev = exercises
    // Dragging a parent carries its supersets; a superset dropped elsewhere attaches to what's above it
    const next = withOrder(reorderExercises(prev, active.id, over.id))
    if (next === prev) return
    setExercises(next)
    try {
      await persistOrder(next, prev)
    } catch (err) {
      alert(`Couldn't save order: ${err.message}`)
    }
  }

  function toggleExpanded(exerciseId, autoOpen) {
    setExpanded((prev) => ({ ...prev, [exerciseId]: !(prev[exerciseId] ?? autoOpen) }))
  }

  function openAddModal(afterIdx, isSuperset) {
    setInsertAfterIdx(afterIdx)
    setAddExForm({ name: '', sets: 3, rep_min: 8, rep_max: 12, weight: 0, unit: 'lbs', isSuperset })
    setShowAddEx(true)
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
        { set_number: prev[exerciseId].length + 1, actual_reps: null, weight: parseFloat(ex?.current_weight || 0), completed: false },
      ],
    }))
  }

  function removeSet(exerciseId, setIdx) {
    setSetLogs((prev) => {
      const current = prev[exerciseId]
      if (current.length <= 1) return prev
      const updated = current
        .filter((_, i) => i !== setIdx)
        .map((s, i) => ({ ...s, set_number: i + 1 }))
      return { ...prev, [exerciseId]: updated }
    })
  }

  function setExerciseSetCount(exerciseId, count) {
    const target = parseInt(count)
    if (isNaN(target) || target < 1 || target > 10) return
    const ex = exercises.find((e) => e.id === exerciseId)
    setSetLogs((prev) => {
      const current = prev[exerciseId] || []
      if (target === current.length) return prev
      if (target > current.length) {
        const extra = Array.from({ length: target - current.length }, (_, i) => ({
          set_number: current.length + i + 1,
          actual_reps: null,
          weight: parseFloat(ex?.current_weight || 0),
          completed: false,
        }))
        return { ...prev, [exerciseId]: [...current, ...extra] }
      }
      return { ...prev, [exerciseId]: current.slice(0, target) }
    })
  }

  async function saveExerciseName(exerciseId, name) {
    const n = (name || '').trim()
    if (!n) return
    setExercises((prev) => prev.map((e) => e.id === exerciseId ? { ...e, name: n } : e))
    await supabase.from('program_exercises').update({ name: n }).eq('id', exerciseId)
    // Keep past logged sets in sync so history/progress show the new name
    await supabase.from('set_logs').update({ exercise_name: n }).eq('program_exercise_id', exerciseId)
  }

  async function saveRepRange(exerciseId, min, max) {
    const minN = parseInt(min, 10)
    const maxN = parseInt(max, 10)
    if (!minN || !maxN || minN > maxN) return
    setExercises((prev) => prev.map((e) => e.id === exerciseId ? { ...e, rep_min: minN, rep_max: maxN } : e))
    await supabase.from('program_exercises').update({ rep_min: minN, rep_max: maxN }).eq('id', exerciseId)
  }

  function toggleComplete(exerciseId, setIdx) {
    const willComplete = !(setLogs[exerciseId]?.[setIdx]?.completed)
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
    if (willComplete) {
      startRest()
      // Finishing the last set hands the card back to auto-collapse (drops any manual "keep open")
      const others = (setLogs[exerciseId] || []).filter((_, i) => i !== setIdx)
      if (others.every((s) => s.completed)) {
        setExpanded((prev) => {
          if (!(exerciseId in prev)) return prev
          const next = { ...prev }
          delete next[exerciseId]
          return next
        })
      }
    }
  }

  async function addExercise() {
    if (!addExForm.name.trim()) return
    setAddingEx(true)
    try {
      const insertIdx = insertAfterIdx === null ? exercises.length : insertAfterIdx + 1
      const { data: ex, error } = await supabase.from('program_exercises').insert({
        program_day_id: session.program_day_id,
        name: addExForm.name.trim(),
        sets: addExForm.sets,
        rep_min: addExForm.rep_min,
        rep_max: addExForm.rep_max,
        current_weight: addExForm.weight,
        weight_unit: addExForm.unit,
        weight_increment: 2.5,
        exercise_order: insertIdx + 1,
        is_superset: addExForm.isSuperset,
      }).select().single()

      if (error) throw error

      if (ex) {
        // Insert at position (afterIdx + 1), or append if null / end — then re-stamp
        // every exercise's order so it stays put on reload.
        const prev = exercises
        const next = withOrder(insertExerciseAfter(prev, insertAfterIdx, ex))
        setExercises(next)
        persistOrder(next, prev).catch((e) => alert(`Couldn't save order: ${e.message}`))
        setExpanded((m) => ({ ...m, [ex.id]: true }))
        setSetLogs((prev) => ({
          ...prev,
          [ex.id]: Array.from({ length: ex.sets }, (_, i) => ({
            set_number: i + 1, actual_reps: null, weight: ex.current_weight, completed: false,
          })),
        }))
      }
      setShowAddEx(false)
      setInsertAfterIdx(null)
      setAddExForm({ name: '', sets: 3, rep_min: 8, rep_max: 12, weight: 0, unit: 'lbs', isSuperset: false })
    } catch (err) {
      alert(err.message)
    } finally {
      setAddingEx(false)
    }
  }

  async function abandonWorkout() {
    if (!window.confirm('Abandon this workout? It won\'t be saved.')) return
    await supabase.from('workout_sessions').delete().eq('id', sessionId)
    localStorage.removeItem('activeSessionId')
    localStorage.removeItem(PROGRESS_KEY(sessionId))
    localStorage.removeItem(AB_KEY(sessionId))
    navigate('/')
  }

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
      // Backdated sessions (retro-logged from the week strip) complete on their original day
      const startedAt = session?.started_at ? new Date(session.started_at) : new Date()
      const isBackdated = startedAt.toDateString() !== new Date().toDateString()
      await supabase.from('workout_sessions')
        .update({
          completed_at: isBackdated ? session.started_at : new Date().toISOString(),
          notes: abDone && abIdx !== null ? `Abs: ${AB_BANK[abIdx].name}` : null,
        }).eq('id', sessionId)
      // Check which exercises hit all reps — show indicator, but do NOT auto-bump current_weight
      const progs = checkProgression(allLogs, exercises)
      localStorage.removeItem('activeSessionId')
      localStorage.removeItem(PROGRESS_KEY(sessionId))
      localStorage.removeItem(AB_KEY(sessionId))
      if (progs.length > 0) setProgressions(progs)
      else navigate('/')
    } catch (err) {
      alert(err.message)
      setFinishing(false)
    }
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

  if (loading) return (
    <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg)' }}>
      <div className="w-7 h-7 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--text)', borderTopColor: 'transparent' }} />
    </div>
  )

  if (progressions.length > 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: 'var(--bg)' }}>
        <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text)' }}>Nice work.</h1>
        <p className="text-sm mb-8" style={{ color: 'var(--text-2)' }}>You hit all your reps — go up in weight next session:</p>
        <div className="w-full max-w-sm space-y-3 mb-10">
          {progressions.map((p) => (
            <div key={p.exerciseId} className="rounded-2xl px-5 py-4 text-left" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              <p className="font-semibold" style={{ color: 'var(--text)' }}>{p.exerciseName}</p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
                Ready to add <span className="font-bold" style={{ color: 'var(--text)' }}>+{p.increment} {p.unit}</span>
                <span style={{ color: 'var(--text-3)' }}> next session</span>
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

  // Roadmap: the "current" exercise is the first one with an unfinished set; its
  // whole group (parent + supersets) is open, everything else collapses to a row.
  const currentEx = exercises.find((e) => (setLogs[e.id] || []).some((s) => !s.completed))
  const currentGroupIds = new Set(currentEx ? groupOf(exercises, currentEx.id).map((e) => e.id) : [])
  const visibleList = visibleWhileDragging(exercises, dragId)
  const lastEx = exercises[exercises.length - 1]
  const lastGroupOpen = !!lastEx && groupOf(exercises, lastEx.id).some((g) => (expanded[g.id] ?? currentGroupIds.has(g.id)))
  const startedDate = session?.started_at ? new Date(session.started_at) : null
  const isBackdated = startedDate && startedDate.toDateString() !== new Date().toDateString()

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>

      {/* Header */}
      <div className="sticky top-0 z-10 px-4 pb-2" style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)', paddingTop: 'max(8px, env(safe-area-inset-top, 8px))' }}>
        <div className="flex items-center justify-between mb-1">
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-2)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="text-center">
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text)', margin: 0 }}>{session?.day_name}</h1>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: isBackdated ? '11px' : '19px', fontWeight: isBackdated ? 300 : 500, color: isBackdated ? 'var(--gold)' : 'var(--text)', fontVariantNumeric: 'tabular-nums', margin: '1px 0 0', letterSpacing: isBackdated ? '0.08em' : '0.04em' }}>
              {isBackdated ? `LOGGING FOR ${startedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}` : formatTime(elapsed)}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '11px', color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums', minWidth: 32, textAlign: 'right' }}>{done}/{total}</span>
            <button
              onClick={cycleRestPreset}
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '2px 8px', fontSize: '10px', color: 'var(--text-2)', fontFamily: 'var(--font-display)', letterSpacing: '0.06em', cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }}
            >rest {formatTime(restDur)}</button>
          </div>
        </div>
        <div style={{ height: 2, background: 'var(--surface-2)', borderRadius: 1, overflow: 'hidden', marginTop: 6 }}>
          <div className="transition-all duration-300" style={{ height: '100%', width: `${pct}%`, background: 'var(--text)', borderRadius: 1 }} />
        </div>
      </div>

      {/* Rest timer — sticks to top while counting down */}
      {restEndAt && (
        <div style={{
          position: 'fixed', zIndex: 40,
          top: 'calc(env(safe-area-inset-top, 0px) + 78px)',
          left: '50%', transform: 'translateX(-50%)',
          width: 192, height: 96,
          background: 'var(--text)', borderRadius: 18,
          boxShadow: '0 10px 32px rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 8px',
        }}>
          <button onClick={() => adjustRest(-15)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#141414', opacity: 0.55, fontSize: '13px', fontFamily: 'var(--font-display)', fontWeight: 600, padding: '8px 6px' }}
          >−15</button>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '9px', letterSpacing: '0.22em', textTransform: 'uppercase', color: '#141414', opacity: 0.5, margin: 0 }}>Rest</p>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '42px', fontWeight: 600, lineHeight: 1, color: '#141414', margin: 0, fontVariantNumeric: 'tabular-nums' }}>
              {formatTime(restLeft)}
            </p>
          </div>
          <button onClick={() => adjustRest(15)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#141414', opacity: 0.55, fontSize: '13px', fontFamily: 'var(--font-display)', fontWeight: 600, padding: '8px 6px' }}
          >+15</button>
          <button onClick={() => setRestEndAt(null)}
            style={{ position: 'absolute', top: -8, right: -8, width: 24, height: 24, borderRadius: '50%', background: 'var(--surface-3)', border: '1px solid var(--border-2)', color: 'var(--text-2)', fontSize: '12px', lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
          >✕</button>
        </div>
      )}

      {/* Exercises */}
      <div className="flex-1 px-4 pt-2 max-w-lg mx-auto w-full" style={{ paddingBottom: '108px' }}>

        {/* Session history panel */}
        {sessionHistory.length > 0 && (
          <div style={{ marginBottom: '12px' }}>
            <button
              onClick={() => setShowHistory((v) => !v)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px' }}
            >
              <span style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '10px', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                {sessionHistory.length} session{sessionHistory.length !== 1 ? 's' : ''} logged
              </span>
              <svg width="12" height="12" fill="none" stroke="var(--text-3)" strokeWidth="2" viewBox="0 0 24 24"
                style={{ transform: showHistory ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showHistory && (
              <div style={{ marginTop: '6px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
                {sessionHistory.map((s, i) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: i < sessionHistory.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '11px', color: 'var(--text-3)', letterSpacing: '0.06em' }}>
                      Session {i + 1}
                    </span>
                    <span style={{ fontSize: '12px', color: 'var(--text-2)' }}>
                      {new Date(s.completed_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Ab warm-up */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '9px 14px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-3)', margin: '0 0 3px' }}>Ab warm-up</p>
            {abIdx === null ? (
              <button onClick={() => setAbPickerOpen(true)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>Pick one</span>
                <svg width="12" height="12" fill="none" stroke="var(--text-2)" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            ) : (
              <>
                <button onClick={() => setAbPickerOpen(true)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', margin: '0 0 4px' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '15px', fontWeight: 600, color: abDone ? 'var(--text-2)' : 'var(--text)' }}>{AB_BANK[abIdx].name}</span>
                  <svg width="12" height="12" fill="none" stroke="var(--text-3)" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <p style={{ fontSize: '11px', color: 'var(--text-3)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {AB_BANK[abIdx].moves.map((m) => `${m.name} ${m.dose}`).join(' · ')}
                </p>
              </>
            )}
          </div>
          {abIdx !== null && (
            <button onClick={() => setAbDone((v) => !v)} className={`chk-btn${abDone ? ' on' : ''}`} aria-label="Ab warm-up done">
              <svg width="16" height="16" fill="none" stroke={abDone ? 'var(--bg)' : 'transparent'} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </button>
          )}
        </div>

        {/* Sortable exercise list */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => setDragId(e.active.id)}
          onDragCancel={() => setDragId(null)}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={visibleList.map((e) => e.id)} strategy={verticalListSortingStrategy}>
            {visibleList.map((ex, idx) => {
              const sets = setLogs[ex.id] || []
              const { done: exDone, total: exTotal } = exerciseProgress(ex.id)
              const allDone = exDone === exTotal && exTotal > 0
              const exHistory = history[ex.id] || []
              const autoOpen = currentGroupIds.has(ex.id)
              const isOpen = expanded[ex.id] ?? autoOpen
              const realIdx = exercises.findIndex((e) => e.id === ex.id)
              const groupEnd = isGroupEnd(exercises, realIdx)
              const groupOpen = groupOf(exercises, ex.id).some((g) => (expanded[g.id] ?? currentGroupIds.has(g.id)))

              return (
                <div key={ex.id}>
                  <SortableExerciseCard
                    id={ex.id}
                    ex={ex}
                    sets={sets}
                    allDone={allDone}
                    exHistory={exHistory}
                    fmtDate={fmtDate}
                    readyToIncrease={!!readyToIncrease[ex.id]}
                    isOpen={isOpen}
                    isCurrent={autoOpen}
                    isFirst={idx === 0}
                    carrying={ex.id === dragId ? exercises.length - visibleList.length : 0}
                    onToggleOpen={() => toggleExpanded(ex.id, autoOpen)}
                    onUpdateSet={(setIdx, field, value) => updateSet(ex.id, setIdx, field, value)}
                    onToggleComplete={(setIdx) => toggleComplete(ex.id, setIdx)}
                    onNavigate={() => navigate(`/exercise/${ex.id}`)}
                    onAddSet={() => addSet(ex.id)}
                    onRemoveSet={(setIdx) => removeSet(ex.id, setIdx)}
                    onSaveRepRange={(min, max) => saveRepRange(ex.id, min, max)}
                    onSaveName={(name) => saveExerciseName(ex.id, name)}
                    onSetCount={(count) => setExerciseSetCount(ex.id, count)}
                  />
                  {/* Insert row — only under the open group, after its last item */}
                  {groupEnd && groupOpen && !dragId && (
                    <BetweenAddRow onAdd={(isSuperset) => openAddModal(realIdx, isSuperset)} />
                  )}
                </div>
              )
            })}
          </SortableContext>
        </DndContext>

        {/* Always-available add at the end of the day (unless the last group is open and already shows one) */}
        {!lastGroupOpen && !dragId && (
          <BetweenAddRow onAdd={(isSuperset) => openAddModal(exercises.length - 1, isSuperset)} />
        )}
      </div>

      {/* Bottom finish bar */}
      <div className="sticky bottom-0 px-4 pt-3" style={{ background: 'var(--bg)', borderTop: '1px solid var(--border)', paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))' }}>
        <button onClick={finishWorkout} disabled={finishing || done === 0}
          className="w-full disabled:opacity-30"
          style={{ background: 'var(--text)', color: 'var(--bg)', border: 'none', borderRadius: '13px', padding: '13px', fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer' }}>
          {finishing ? 'Saving...' : `Finish Workout · ${done}/${total}`}
        </button>
        <button onClick={abandonWorkout} style={{ width: '100%', marginTop: '5px', background: 'none', border: 'none', color: 'var(--text-3)', fontSize: '11px', fontFamily: "'Oxanium', sans-serif", letterSpacing: '0.1em', cursor: 'pointer', padding: '3px 0 0' }}>
          Abandon workout
        </button>
      </div>

      {/* Ab warm-up picker */}
      {abPickerOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div onClick={() => setAbPickerOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} />
          <div style={{ position: 'relative', background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '24px 20px', paddingBottom: 'max(32px, env(safe-area-inset-bottom, 32px))', zIndex: 1, maxHeight: '75vh', overflowY: 'auto' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '11px', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-3)', margin: '0 0 16px' }}>Pick your ab warm-up</p>
            {AB_BANK.map((circuit, i) => (
              <button
                key={i}
                onClick={() => { setAbIdx(i); setAbDone(false); setAbPickerOpen(false) }}
                style={{
                  width: '100%', textAlign: 'left',
                  background: i === abIdx ? 'var(--surface-3)' : 'var(--surface-2)',
                  border: `1px solid ${i === abIdx ? 'var(--border-2)' : 'var(--border)'}`,
                  borderRadius: '12px', padding: '12px 14px', marginBottom: '8px', cursor: 'pointer',
                }}
              >
                <p style={{ fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 600, color: 'var(--text)', margin: '0 0 3px' }}>{circuit.name}</p>
                <p style={{ fontSize: '11px', color: 'var(--text-3)', margin: 0 }}>
                  {circuit.moves.map((m) => `${m.name} ${m.dose}`).join(' · ')}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Add exercise modal */}
      {showAddEx && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div onClick={() => setShowAddEx(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} />
          <div style={{ position: 'relative', background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '24px 20px', paddingBottom: 'max(32px, env(safe-area-inset-bottom, 32px))', zIndex: 1 }}>
            <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '11px', letterSpacing: '0.18em', textTransform: 'uppercase', color: addExForm.isSuperset ? '#c8a84b' : 'var(--text-3)', marginBottom: '16px' }}>
              {addExForm.isSuperset ? 'Add Superset' : 'Add Exercise'}
              {insertAfterIdx !== null && (
                <span style={{ color: 'var(--text-3)', fontWeight: 300 }}> · after {exercises[insertAfterIdx]?.name}</span>
              )}
            </p>

            <input
              type="text"
              placeholder="Exercise name"
              value={addExForm.name}
              onChange={(e) => setAddExForm((f) => ({ ...f, name: e.target.value }))}
              autoFocus
              style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px 14px', fontSize: '15px', color: 'var(--text)', outline: 'none', marginBottom: '12px', boxSizing: 'border-box', fontFamily: 'system-ui' }}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '12px' }}>
              {[['SETS', 'sets', 1, 10, 1], ['REP MIN', 'rep_min', 1, 99, 1], ['REP MAX', 'rep_max', 1, 99, 1]].map(([label, key, mn, mx, step]) => (
                <div key={key}>
                  <p style={{ fontSize: '10px', color: 'var(--text-3)', letterSpacing: '0.1em', marginBottom: '4px', fontFamily: "'Oxanium', sans-serif" }}>{label}</p>
                  <input type="number" value={addExForm[key]} min={mn} max={mx} step={step}
                    onChange={(e) => setAddExForm((f) => ({ ...f, [key]: +e.target.value }))}
                    onFocus={(e) => e.target.select()}
                    style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 8px', fontSize: '15px', color: 'var(--text)', outline: 'none', textAlign: 'center' }}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', marginBottom: '20px' }}>
              <div>
                <p style={{ fontSize: '10px', color: 'var(--text-3)', letterSpacing: '0.1em', marginBottom: '4px', fontFamily: "'Oxanium', sans-serif" }}>STARTING WEIGHT</p>
                <input type="number" value={addExForm.weight} min="0" step="2.5"
                  onChange={(e) => setAddExForm((f) => ({ ...f, weight: +e.target.value }))}
                  onFocus={(e) => e.target.select()}
                  style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 8px', fontSize: '15px', color: 'var(--text)', outline: 'none', textAlign: 'center' }}
                />
              </div>
              <div>
                <p style={{ fontSize: '10px', color: 'var(--text-3)', letterSpacing: '0.1em', marginBottom: '4px', fontFamily: "'Oxanium', sans-serif" }}>UNIT</p>
                <select value={addExForm.unit} onChange={(e) => setAddExForm((f) => ({ ...f, unit: e.target.value }))}
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 8px', fontSize: '15px', color: 'var(--text)', outline: 'none', height: '42px' }}>
                  <option value="lbs">lbs</option>
                  <option value="kg">kg</option>
                </select>
              </div>
            </div>

            <button
              onClick={addExercise}
              disabled={addingEx || !addExForm.name.trim()}
              style={{ width: '100%', background: addExForm.isSuperset ? '#3a3010' : 'var(--text)', color: addExForm.isSuperset ? '#c8a84b' : 'var(--bg)', border: addExForm.isSuperset ? '1px solid #c8a84b40' : 'none', borderRadius: '12px', padding: '15px', fontSize: '15px', fontFamily: "'Oxanium', sans-serif", letterSpacing: '0.06em', cursor: 'pointer', opacity: (!addExForm.name.trim() || addingEx) ? 0.4 : 1 }}
            >
              {addingEx ? '...' : addExForm.isSuperset ? 'Add Superset' : 'Add Exercise'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Between-exercise insert row ─────────────────────────────────────────────

function BetweenAddRow({ onAdd }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 2px' }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <button
        onClick={() => onAdd(false)}
        style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '20px', padding: '3px 10px', fontSize: '10px', color: 'var(--text-3)', cursor: 'pointer', fontFamily: "'Oxanium', sans-serif", letterSpacing: '0.08em', whiteSpace: 'nowrap' }}
      >+ ex</button>
      <button
        onClick={() => onAdd(true)}
        style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '20px', padding: '3px 10px', fontSize: '10px', color: 'var(--text-3)', cursor: 'pointer', fontFamily: "'Oxanium', sans-serif", letterSpacing: '0.08em', whiteSpace: 'nowrap' }}
      >+ ss</button>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  )
}

// ── Sortable wrapper ─────────────────────────────────────────────────────────

function SortableExerciseCard(props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.85 : 1,
  }
  return (
    <div ref={setNodeRef} style={style}>
      {props.isOpen
        ? <ExerciseCard {...props} dragListeners={listeners} dragAttributes={attributes} isDragging={isDragging} />
        : <CollapsedExerciseRow {...props} dragListeners={listeners} dragAttributes={attributes} />}
    </div>
  )
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function DragHandle({ listeners, attributes, style }) {
  return (
    <div
      {...listeners}
      {...attributes}
      style={{ touchAction: 'none', cursor: 'grab', padding: '2px 8px 2px 0', color: 'var(--text-3)', flexShrink: 0, ...style }}
    >
      <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
        <circle cx="3" cy="3" r="1.5" /><circle cx="9" cy="3" r="1.5" />
        <circle cx="3" cy="8" r="1.5" /><circle cx="9" cy="8" r="1.5" />
        <circle cx="3" cy="13" r="1.5" /><circle cx="9" cy="13" r="1.5" />
      </svg>
    </div>
  )
}

function SSBadge() {
  return (
    <span style={{ fontSize: '8px', fontFamily: "'Oxanium', sans-serif", letterSpacing: '0.12em', color: 'var(--gold)', border: '1px solid rgba(200,168,75,0.3)', borderRadius: '3px', padding: '0px 4px', flexShrink: 0 }}>SS</span>
  )
}

function SupersetConnector() {
  return <div style={{ position: 'absolute', left: -12, top: -14, width: 2, height: 'calc(50% + 14px)', background: 'rgba(200,168,75,0.35)', borderRadius: 1, pointerEvents: 'none' }} />
}

// ── Collapsed row (the "roadmap" view) ───────────────────────────────────────

function CollapsedExerciseRow({ ex, sets, allDone, isFirst, carrying, onToggleOpen, dragListeners, dragAttributes }) {
  const isSuperset = ex.is_superset && !isFirst
  const doneSets = sets.filter((s) => s.completed)
  const started = doneSets.length > 0

  let summary
  if (allDone) {
    // e.g. "135 lbs × 10 · 10 · 9"
    const weights = [...new Set(doneSets.map((s) => s.weight))]
    const w = weights.length === 1 ? `${weights[0]} ${ex.weight_unit}` : `${Math.min(...weights)}–${Math.max(...weights)} ${ex.weight_unit}`
    summary = `${w} × ${doneSets.map((s) => s.actual_reps ?? '–').join(' · ')}`
  } else if (started) {
    summary = `${doneSets.length}/${sets.length} done · ${ex.rep_min}–${ex.rep_max} reps · ${sets[doneSets.length]?.weight ?? ex.current_weight} ${ex.weight_unit}`
  } else {
    summary = `${sets.length} × ${ex.rep_min}–${ex.rep_max} · ${sets[0]?.weight ?? ex.current_weight} ${ex.weight_unit}`
  }

  return (
    <div style={{ position: 'relative', marginLeft: isSuperset ? '22px' : 0, marginBottom: '6px' }}>
      {isSuperset && <SupersetConnector />}
      <div
        onClick={onToggleOpen}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          background: 'var(--surface)',
          border: `1px solid ${isSuperset ? 'rgba(200,168,75,0.22)' : (allDone ? 'var(--border-2)' : 'var(--border)')}`,
          borderRadius: isSuperset ? '12px' : '14px',
          padding: isSuperset ? '7px 12px 7px 10px' : '9px 14px 9px 12px',
          cursor: 'pointer',
          opacity: allDone ? 0.72 : 1,
        }}
      >
        <DragHandle listeners={dragListeners} attributes={dragAttributes} style={{ padding: '2px 6px 2px 0' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: isSuperset ? '13px' : '14px', fontWeight: 600, color: isSuperset ? 'var(--gold-soft)' : (allDone ? 'var(--text-2)' : 'var(--text)'), margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ex.name}
            </p>
            {ex.is_superset && <SSBadge />}
            {carrying > 0 && <span style={{ fontSize: '9px', fontFamily: "'Oxanium', sans-serif", letterSpacing: '0.1em', color: 'var(--gold)', flexShrink: 0 }}>+{carrying} SS</span>}
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-3)', margin: '1px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{summary}</p>
        </div>
        {allDone ? (
          <span style={{ fontSize: '13px', color: 'var(--text-2)', flexShrink: 0 }}>✓</span>
        ) : (
          <svg width="12" height="12" fill="none" stroke="var(--text-3)" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>
    </div>
  )
}

// ── Swipeable exercise card (live panel first, swipe left for history) ───────

function ExerciseCard({ ex, sets, allDone, exHistory, fmtDate, readyToIncrease, isCurrent, isFirst, carrying, onToggleOpen, onUpdateSet, onToggleComplete, onNavigate, onAddSet, onRemoveSet, onSaveRepRange, onSaveName, onSetCount, dragListeners, dragAttributes }) {
  const scrollRef = useRef(null)
  const [onHistoryPanel, setOnHistoryPanel] = useState(false)
  const [editReps, setEditReps] = useState(false)
  const [editMin, setEditMin] = useState(ex.rep_min)
  const [editMax, setEditMax] = useState(ex.rep_max)
  const [editSets, setEditSets] = useState(sets.length)
  const [editName, setEditName] = useState(ex.name)

  const isSuperset = ex.is_superset && !isFirst
  const activeSetIdx = sets.findIndex((s) => !s.completed)

  // Live panel sits at scrollLeft 0, so a DOM move (reorder) or remount can never
  // land us on history by accident — the browser resets scroll to 0.
  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    setOnHistoryPanel(el.scrollLeft > el.clientWidth * 0.4)
  }

  function backToLive() {
    scrollRef.current?.scrollTo({ left: 0, behavior: 'smooth' })
  }

  function openEditReps() {
    setEditMin(ex.rep_min)
    setEditMax(ex.rep_max)
    setEditSets(sets.length)
    setEditName(ex.name)
    setEditReps(true)
  }

  function confirmEditReps() {
    onSaveRepRange(editMin, editMax)
    const targetSets = parseInt(editSets)
    if (!isNaN(targetSets) && targetSets !== sets.length) {
      onSetCount(targetSets)
    }
    if (editName.trim() && editName.trim() !== ex.name) onSaveName(editName)
    setEditReps(false)
  }

  const borderColor = isSuperset
    ? 'rgba(200,168,75,0.25)'
    : (isCurrent ? 'var(--border-2)' : (allDone ? 'var(--border-2)' : 'var(--border)'))

  const cardStyle = {
    borderRadius: isSuperset ? '12px' : '16px',
    overflow: 'hidden',
    border: `1px solid ${borderColor}`,
    background: 'var(--surface)',
    flex: '0 0 100%',
    minWidth: '100%',
    scrollSnapAlign: 'start',
  }

  const rowH = isSuperset ? 32 : 36

  return (
    <div style={{ position: 'relative', marginLeft: isSuperset ? '22px' : 0, marginTop: isSuperset ? '2px' : 0, marginBottom: '6px' }}>
      {isSuperset && <SupersetConnector />}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          display: 'flex', overflowX: 'scroll',
          scrollSnapType: 'x mandatory', scrollbarWidth: 'none',
          msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch',
          borderRadius: isSuperset ? '12px' : '16px',
        }}
      >
        {/* ── Panel 1: Live ── */}
        <div style={{ ...cardStyle }}>
          <div style={{ padding: isSuperset ? '7px 12px 3px' : '8px 14px 4px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <DragHandle listeners={dragListeners} attributes={dragAttributes} style={{ marginTop: '2px' }} />

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                <h3 onClick={onToggleOpen} style={{ fontFamily: 'var(--font-display)', fontSize: isSuperset ? '13px' : '15px', fontWeight: 600, color: isSuperset ? 'var(--gold-soft)' : 'var(--text)', margin: 0, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ex.name}</h3>
                {ex.is_superset && <SSBadge />}
                {carrying > 0 && <span style={{ fontSize: '9px', fontFamily: "'Oxanium', sans-serif", letterSpacing: '0.1em', color: 'var(--gold)', flexShrink: 0 }}>+{carrying} SS</span>}
                {readyToIncrease && (
                  <span style={{ fontSize: '9px', fontFamily: "'Oxanium', sans-serif", letterSpacing: '0.08em', textTransform: 'uppercase', background: 'rgba(200,168,75,0.15)', color: 'var(--gold)', border: '1px solid rgba(200,168,75,0.3)', borderRadius: '4px', padding: '1px 5px', flexShrink: 0 }}>
                    ⬆ add weight
                  </span>
                )}
              </div>
              {editReps ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                  <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                    placeholder="Exercise name"
                    style={{ width: '100%', fontSize: '13px', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-2)', borderRadius: '6px', padding: '4px 8px', outline: 'none', marginBottom: '4px', boxSizing: 'border-box' }} />
                  <input type="number" value={editSets} onChange={(e) => setEditSets(e.target.value)} onFocus={(e) => e.target.select()}
                    min="1" max="10"
                    style={{ width: 30, textAlign: 'center', fontSize: '12px', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-2)', borderRadius: '6px', padding: '2px 4px', outline: 'none' }} />
                  <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>sets ·</span>
                  <input type="number" value={editMin} onChange={(e) => setEditMin(e.target.value)} onFocus={(e) => e.target.select()}
                    style={{ width: 34, textAlign: 'center', fontSize: '12px', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-2)', borderRadius: '6px', padding: '2px 4px', outline: 'none' }} />
                  <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>–</span>
                  <input type="number" value={editMax} onChange={(e) => setEditMax(e.target.value)} onFocus={(e) => e.target.select()}
                    style={{ width: 34, textAlign: 'center', fontSize: '12px', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-2)', borderRadius: '6px', padding: '2px 4px', outline: 'none' }} />
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
                <span style={{ fontSize: '10px', color: 'var(--text-3)', letterSpacing: '0.06em' }}>hist →</span>
              )}
              <button onClick={onNavigate} style={{ color: 'var(--text-3)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </button>
              <button onClick={onToggleOpen} aria-label="Collapse" style={{ color: 'var(--text-3)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Set rows */}
          <div style={{ padding: isSuperset ? '0 12px 5px' : '0 14px 6px' }}>
            {sets.map((set, idx) => (
              <div key={idx} className={`set-grid${set.completed ? ' set-row-done' : ''}`} style={{ marginBottom: '4px' }}>
                <span className={`set-num${idx === activeSetIdx ? ' active' : ''}`}>
                  {idx + 1}
                </span>
                <input
                  type="number" value={set.weight ?? ''}
                  onChange={(e) => onUpdateSet(idx, 'weight', e.target.value)}
                  onFocus={(e) => e.target.select()}
                  className="set-input"
                  style={{ height: rowH, fontSize: isSuperset ? 14 : 16 }}
                  step="2.5" min="0" inputMode="decimal"
                />
                <input
                  type="number" value={set.actual_reps ?? ''}
                  onChange={(e) => onUpdateSet(idx, 'actual_reps', e.target.value)}
                  onFocus={(e) => e.target.select()}
                  className="set-input"
                  style={{
                    height: rowH, fontSize: isSuperset ? 14 : 16,
                    ...(!set.completed && set.actual_reps !== null && set.actual_reps < ex.rep_min ? { color: 'var(--gold)' } : {}),
                  }}
                  placeholder={`${ex.rep_min}–${ex.rep_max}`}
                  min="0" max="100" inputMode="numeric"
                />
                <button onClick={() => onToggleComplete(idx)} className={`chk-btn${set.completed ? ' on' : ''}`} style={{ width: rowH - 2, height: rowH - 2 }}>
                  <svg width="16" height="16" fill="none" stroke={set.completed ? 'var(--bg)' : 'transparent'} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                {sets.length > 1 ? (
                  <button
                    onClick={() => onRemoveSet(idx)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: '15px', padding: '0', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.6 }}
                  >×</button>
                ) : <div />}
              </div>
            ))}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px' }}>
              <button onClick={onAddSet} style={{ background: 'none', border: 'none', padding: '2px 8px', fontSize: '10px', color: 'var(--text-3)', cursor: 'pointer', letterSpacing: '0.14em', fontFamily: 'var(--font-display)' }}>
                + ADD SET
              </button>
            </div>

            {allDone && sets.every((s) => s.actual_reps >= ex.rep_max) && (
              <p style={{ fontSize: '11px', textAlign: 'center', color: 'var(--text-2)', margin: '2px 0 4px' }}>
                All sets at max — add {ex.weight_increment}{ex.weight_unit} next session
              </p>
            )}
          </div>
        </div>

        {/* ── Panel 2: History — scrolls inside, never taller than the live panel ── */}
        <div style={{ ...cardStyle, borderColor: 'var(--border)', position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
              <div>
                <p onClick={backToLive} style={{ fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-3)', margin: '0 0 2px', cursor: 'pointer' }}>← back to live</p>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: isSuperset ? '15px' : '17px', fontWeight: 600, color: 'var(--text)', margin: 0 }}>{ex.name}</h3>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-3)', margin: 0 }}>History</p>
            </div>
            <div style={{ padding: '10px 14px 12px' }}>
              {exHistory.length === 0 ? (
                <p style={{ fontSize: '13px', color: 'var(--text-3)', textAlign: 'center', padding: '16px 0' }}>No history yet</p>
              ) : (
                exHistory.map((session, si) => (
                  <div key={si} style={{ marginBottom: si < exHistory.length - 1 ? '14px' : 0 }}>
                    <p style={{ fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '5px' }}>
                      {fmtDate(session.date)}
                    </p>
                    {session.sets.map((s, i) => {
                      const hitTarget = s.actual_reps >= s.target_reps
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', borderRadius: '7px', marginBottom: '3px', background: 'var(--surface-2)' }}>
                          <span style={{ fontSize: '11px', color: 'var(--text-3)', width: '16px' }}>#{s.set_number}</span>
                          <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: 500 }}>{s.weight}</span>
                          <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>{ex.weight_unit}</span>
                          <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>×</span>
                          <span style={{ fontSize: '13px', color: hitTarget ? 'var(--text)' : '#c8a84b', fontWeight: 500 }}>{s.actual_reps}</span>
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
        </div>
      </div>

      {/* Scroll dots — live · history */}
      {!isSuperset && exHistory.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '5px', marginTop: '3px' }}>
          <div style={{ width: 4, height: 4, borderRadius: '50%', background: onHistoryPanel ? 'var(--border-2)' : 'var(--text-2)', transition: 'background 0.2s' }} />
          <div style={{ width: 4, height: 4, borderRadius: '50%', background: onHistoryPanel ? 'var(--text-2)' : 'var(--border-2)', transition: 'background 0.2s' }} />
        </div>
      )}
    </div>
  )
}
