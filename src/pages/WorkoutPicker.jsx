import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

function getWeekBounds() {
  const now = new Date()
  const day = now.getDay() // 0 = Sun
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((day + 6) % 7))
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return { monday, sunday }
}

const OVERRIDE_KEY = (programId) => `e1_next_override_${programId}`

// Week-strip bubble labels:
// "Lower 1" → L1 · "Push" → PS · "Pull" → PL · "Run" → RUN · "Recover" → REC
// "Upper Body" → UB · fallback: first two letters
function dayInitials(name) {
  const n = (name || '').trim()
  const lower = n.toLowerCase()
  if (lower.startsWith('run')) return 'RUN'
  if (lower.startsWith('rec')) return 'REC'
  if (lower.startsWith('push')) return 'PS'
  if (lower.startsWith('pull')) return 'PL'
  const numbered = n.match(/^(\w)\w*\s+(\d+)$/) // "Lower 1" → L1
  if (numbered) return (numbered[1] + numbered[2]).toUpperCase()
  const words = n.split(/\s+/)
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase()
  return n.slice(0, 2).toUpperCase()
}

export default function WorkoutPicker() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [activeProgram, setActiveProgram] = useState(null)
  const [days, setDays] = useState([])
  const [exCounts, setExCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(null)
  const [weekSessions, setWeekSessions] = useState([])
  const [totalSessions, setTotalSessions] = useState(0)
  const [lastSession, setLastSession] = useState(null)
  const [overrideId, setOverrideId] = useState(null)
  const [backfillDate, setBackfillDate] = useState(null) // Date — day being retro-logged
  const [quickName, setQuickName] = useState('')
  const [backfillSaving, setBackfillSaving] = useState(false)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data: program } = await supabase
      .from('programs').select('*').eq('user_id', user.id).eq('is_active', true).limit(1).single()

    let programDays = []
    if (program) {
      setActiveProgram(program)
      const { data } = await supabase
        .from('program_days').select('*').eq('program_id', program.id).order('day_order')
      programDays = data || []
      setDays(programDays)

      if (programDays.length) {
        const { data: exs } = await supabase
          .from('program_exercises').select('id, program_day_id')
          .in('program_day_id', programDays.map((d) => d.id))
        const counts = {}
        for (const e of exs || []) counts[e.program_day_id] = (counts[e.program_day_id] || 0) + 1
        setExCounts(counts)
      }

      const saved = localStorage.getItem(OVERRIDE_KEY(program.id))
      if (saved) setOverrideId(saved)
    }

    const { monday, sunday } = getWeekBounds()
    const { data: sessions } = await supabase
      .from('workout_sessions')
      .select('id, program_day_id, completed_at, day_name')
      .eq('user_id', user.id)
      .not('completed_at', 'is', null)
      .gte('completed_at', monday.toISOString())
      .lte('completed_at', sunday.toISOString())
    setWeekSessions(sessions || [])

    const { count } = await supabase
      .from('workout_sessions').select('*', { count: 'exact', head: true })
      .eq('user_id', user.id).not('completed_at', 'is', null)
    setTotalSessions(count || 0)

    const { data: last } = await supabase
      .from('workout_sessions').select('day_name, completed_at')
      .eq('user_id', user.id).not('completed_at', 'is', null)
      .order('completed_at', { ascending: false }).limit(1).single()
    setLastSession(last)

    setLoading(false)
  }

  async function startWorkout(day) {
    setStarting(day.id)
    const { data: session, error } = await supabase
      .from('workout_sessions')
      .insert({ user_id: user.id, program_day_id: day.id, day_name: day.name })
      .select().single()
    if (error) { alert(error.message); setStarting(null); return }
    // Starting the hero clears any swap override
    if (activeProgram && overrideId === day.id) {
      localStorage.removeItem(OVERRIDE_KEY(activeProgram.id))
    }
    localStorage.setItem('activeSessionId', session.id)
    navigate(`/workout/${session.id}`)
  }

  function makeNext(dayId) {
    setOverrideId(dayId)
    if (activeProgram) localStorage.setItem(OVERRIDE_KEY(activeProgram.id), dayId)
  }

  // ── Retroactive logging ──
  function backfillNoon() {
    const d = new Date(backfillDate)
    d.setHours(12, 0, 0, 0)
    return d.toISOString()
  }

  async function backfillQuickLog() {
    if (!quickName.trim()) return
    setBackfillSaving(true)
    const iso = backfillNoon()
    const { error } = await supabase.from('workout_sessions')
      .insert({ user_id: user.id, day_name: quickName.trim(), started_at: iso, completed_at: iso })
    setBackfillSaving(false)
    if (error) { alert(error.message); return }
    setBackfillDate(null)
    setQuickName('')
    loadData()
  }

  async function backfillMarkDone(day) {
    setBackfillSaving(true)
    const iso = backfillNoon()
    const { error } = await supabase.from('workout_sessions')
      .insert({ user_id: user.id, program_day_id: day.id, day_name: day.name, started_at: iso, completed_at: iso })
    setBackfillSaving(false)
    if (error) { alert(error.message); return }
    setBackfillDate(null)
    loadData()
  }

  async function backfillWithSets(day) {
    setBackfillSaving(true)
    const iso = backfillNoon()
    const { data: session, error } = await supabase.from('workout_sessions')
      .insert({ user_id: user.id, program_day_id: day.id, day_name: day.name, started_at: iso })
      .select().single()
    setBackfillSaving(false)
    if (error) { alert(error.message); return }
    localStorage.setItem('activeSessionId', session.id)
    navigate(`/workout/${session.id}`)
  }

  const doneDayIds = weekSessions.map((s) => s.program_day_id)

  function suggestedDayIndex() {
    if (!days.length) return 0
    const lastDoneIdx = days.reduce((last, d, i) => doneDayIds.includes(d.id) ? i : last, -1)
    if (lastDoneIdx === -1) return 0
    for (let i = lastDoneIdx + 1; i < days.length; i++) {
      if (!doneDayIds.includes(days[i].id)) return i
    }
    return (lastDoneIdx + 1) % days.length
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', background: 'var(--bg)' }}>
      <div style={{ width: 26, height: 26, borderRadius: '50%', border: '2px solid var(--text)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
    </div>
  )

  // Hero: swap override wins if it's a valid, not-yet-done day
  let heroIdx = suggestedDayIndex()
  if (overrideId) {
    const oIdx = days.findIndex((d) => d.id === overrideId)
    if (oIdx !== -1 && !doneDayIds.includes(overrideId)) heroIdx = oIdx
  }
  const hero = days[heroIdx]

  const queueDays = days.filter((d, i) => i !== heroIdx && !doneDayIds.includes(d.id))
  const doneDays = days.filter((d) => doneDayIds.includes(d.id))

  const { monday, sunday } = getWeekBounds()
  const weekLabel = `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`.toUpperCase()
  const todayIdx = (new Date().getDay() + 6) % 7

  // Map each weekday (Mon..Sun) to a completed session, if any
  const weekdaySlots = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const sess = weekSessions.find((s) => {
      const c = new Date(s.completed_at)
      return c.getFullYear() === d.getFullYear() && c.getMonth() === d.getMonth() && c.getDate() === d.getDate()
    })
    return sess || null
  })

  const doneCount = weekSessions.length

  const rowStyle = {
    display: 'flex', alignItems: 'center', gap: '12px',
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: '14px', padding: '14px 16px', marginBottom: '8px',
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100%', padding: '20px 18px 40px', paddingTop: 'max(20px, env(safe-area-inset-top, 20px))' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '18px' }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--text-3)', marginTop: 2 }}>
          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div style={{ flex: 1 }}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-3)', margin: '0 0 2px' }}>Active Program</p>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 400, color: 'var(--text)', margin: 0, letterSpacing: '0.02em' }}>
            {activeProgram ? activeProgram.name : 'No program'}
          </h2>
        </div>
        {activeProgram && (
          <button onClick={() => navigate(`/programs/${activeProgram.id}/edit`)}
            style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: '11px', fontFamily: 'var(--font-display)', letterSpacing: '0.1em', cursor: 'pointer', padding: '4px 0', textTransform: 'uppercase' }}>
            Edit
          </button>
        )}
      </div>

      {!activeProgram ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <p style={{ color: 'var(--text-2)', marginBottom: '16px' }}>No active program.</p>
          <button
            onClick={() => navigate('/programs/new')}
            style={{ background: 'var(--text)', color: 'var(--bg)', border: 'none', borderRadius: '10px', padding: '12px 24px', fontFamily: 'var(--font-display)', fontSize: '14px', cursor: 'pointer' }}
          >
            Create a program
          </button>
        </div>
      ) : (
        <>
          {/* Week strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px', marginBottom: '6px' }}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((letter, i) => {
              const sess = weekdaySlots[i]
              const isToday = i === todayIdx
              const isPastOrToday = i <= todayIdx
              const slotDate = new Date(monday)
              slotDate.setDate(monday.getDate() + i)
              return (
                <div key={i} style={{ textAlign: 'center' }}>
                  <p style={{ fontFamily: 'var(--font-display)', fontSize: '10px', color: isToday ? 'var(--text)' : 'var(--text-3)', margin: '0 0 6px' }}>{letter}</p>
                  <button
                    onClick={() => isPastOrToday && setBackfillDate(slotDate)}
                    aria-label={`Log workout for ${slotDate.toLocaleDateString('en-US', { weekday: 'long' })}`}
                    style={{
                      width: 38, height: 38, margin: '0 auto', borderRadius: '50%',
                      background: sess ? 'var(--text)' : 'transparent',
                      border: sess ? 'none' : isToday ? '1.5px solid var(--text)' : '1px solid var(--border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: isPastOrToday ? 'pointer' : 'default', padding: 0,
                    }}>
                    {sess ? (
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: '11px', fontWeight: 600, color: 'var(--bg)' }}>{dayInitials(sess.day_name)}</span>
                    ) : isToday && hero ? (
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: '11px', color: 'var(--text-2)' }}>{dayInitials(hero.name)}</span>
                    ) : isPastOrToday ? (
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text-3)', fontWeight: 300 }}>+</span>
                    ) : null}
                  </button>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '18px', padding: '0 2px' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '10px', color: 'var(--text-3)' }}>{weekLabel}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '10px', color: 'var(--text-3)' }}>{doneCount}/{days.length} DONE</span>
          </div>

          {/* Up next hero */}
          {hero && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: '18px', padding: '18px 18px 16px', marginBottom: '16px' }}>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-2)', margin: '0 0 6px' }}>Up next</p>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 600, color: 'var(--text)', margin: 0 }}>{hero.name}</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-3)', margin: '3px 0 0' }}>
                {exCounts[hero.id] || 0} exercise{(exCounts[hero.id] || 0) !== 1 ? 's' : ''} · day {hero.day_order} of {days.length}
              </p>
              <button
                onClick={() => startWorkout(hero)}
                disabled={!!starting}
                style={{ width: '100%', marginTop: '16px', background: 'var(--text)', color: 'var(--bg)', border: 'none', borderRadius: '12px', padding: '15px', fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer', opacity: starting ? 0.5 : 1 }}
              >
                {starting === hero.id ? 'Starting…' : 'Start Workout'}
              </button>
            </div>
          )}

          {/* Queue — swap into the up-next slot */}
          {queueDays.length > 0 && (
            <>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-3)', margin: '0 0 10px' }}>Rest of the week</p>
              {queueDays.map((day) => (
                <div key={day.id} onClick={() => startWorkout(day)} style={{ ...rowStyle, cursor: 'pointer', opacity: starting && starting !== day.id ? 0.4 : 1 }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontFamily: 'var(--font-display)', fontSize: '15px', fontWeight: 600, color: 'var(--text)', margin: 0 }}>{day.name}</p>
                    <p style={{ fontSize: '11px', color: 'var(--text-3)', margin: '2px 0 0' }}>
                      {exCounts[day.id] || 0} exercise{(exCounts[day.id] || 0) !== 1 ? 's' : ''} · day {day.day_order} of {days.length}
                    </p>
                  </div>
                  {starting === day.id ? (
                    <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--text-2)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); makeNext(day.id) }}
                      aria-label="Do this next"
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '8px', width: 30, height: 30, color: 'var(--text-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}
                    >
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </>
          )}

          {/* Done this week */}
          {doneDays.map((day) => {
            const sess = weekSessions.find((s) => s.program_day_id === day.id)
            const doneDate = sess?.completed_at
              ? new Date(sess.completed_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
              : null
            return (
              <div key={day.id} onClick={() => startWorkout(day)} style={{ ...rowStyle, opacity: 0.55, cursor: 'pointer' }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontFamily: 'var(--font-display)', fontSize: '15px', fontWeight: 400, color: 'var(--text-2)', margin: 0 }}>{day.name}</p>
                  <p style={{ fontSize: '11px', color: 'var(--text-3)', margin: '2px 0 0' }}>Done{doneDate ? ` · ${doneDate}` : ''}</p>
                </div>
                <svg width="16" height="16" fill="none" stroke="var(--text-2)" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )
          })}

          {/* Progress footer */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--surface-2)', paddingTop: '14px', marginTop: '10px' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase' }}>
              {totalSessions} sessions{lastSession ? ` · last: ${new Date(lastSession.completed_at).toLocaleDateString('en-US', { weekday: 'short' })} ${dayInitials(lastSession.day_name)}` : ''}
            </span>
            <button onClick={() => navigate('/progress')} style={{ background: 'none', border: 'none', fontFamily: 'var(--font-display)', fontSize: '11px', letterSpacing: '0.08em', color: 'var(--text-2)', cursor: 'pointer', padding: 0, textTransform: 'uppercase' }}>
              Full Progress →
            </button>
          </div>
        </>
      )}

      {/* Retro-log sheet */}
      {backfillDate && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div onClick={() => { setBackfillDate(null); setQuickName('') }} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} />
          <div style={{ position: 'relative', background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '24px 20px', paddingBottom: 'max(32px, env(safe-area-inset-bottom, 32px))', zIndex: 1 }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '11px', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-3)', margin: '0 0 16px' }}>
              Log workout · <span style={{ color: 'var(--text-2)' }}>{backfillDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            </p>

            {days.map((day) => (
              <div key={day.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '12px', padding: '12px 14px', marginBottom: '8px' }}>
                <p style={{ flex: 1, fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 600, color: 'var(--text)', margin: 0 }}>{day.name}</p>
                <button
                  onClick={() => backfillWithSets(day)}
                  disabled={backfillSaving}
                  style={{ background: 'none', border: '1px solid var(--border-2)', borderRadius: '8px', padding: '7px 12px', fontFamily: 'var(--font-display)', fontSize: '10px', letterSpacing: '0.1em', color: 'var(--text-2)', cursor: 'pointer' }}>
                  LOG SETS
                </button>
                <button
                  onClick={() => backfillMarkDone(day)}
                  disabled={backfillSaving}
                  style={{ background: 'var(--text)', border: 'none', borderRadius: '8px', padding: '8px 12px', fontFamily: 'var(--font-display)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.1em', color: 'var(--bg)', cursor: 'pointer' }}>
                  ✓ DONE
                </button>
              </div>
            ))}

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '16px 0 12px' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '10px', letterSpacing: '0.14em', color: 'var(--text-3)' }}>OR QUICK LOG</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="Run, swim, pickup game…"
                value={quickName}
                onChange={(e) => setQuickName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && backfillQuickLog()}
                style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px 14px', fontSize: '15px', color: 'var(--text)', outline: 'none', boxSizing: 'border-box', fontFamily: 'system-ui' }}
              />
              <button
                onClick={backfillQuickLog}
                disabled={backfillSaving || !quickName.trim()}
                style={{ background: 'var(--text)', color: 'var(--bg)', border: 'none', borderRadius: '10px', padding: '0 18px', fontFamily: 'var(--font-display)', fontSize: '12px', fontWeight: 600, letterSpacing: '0.1em', cursor: 'pointer', opacity: !quickName.trim() || backfillSaving ? 0.4 : 1 }}>
                SAVE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
