import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { mondayOf, plannedPerWeek, weekScores, perfectStreak, strengthTrends } from '../lib/goals'

const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

function buildCalendarGrid(year, mon) {
  const firstDow = new Date(year, mon, 1).getDay() // 0=Sun
  const offset = (firstDow + 6) % 7 // Mon-first: Sun→6, Mon→0, ...
  const daysInMonth = new Date(year, mon + 1, 0).getDate()
  const cells = Array(offset).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  // pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

export default function Progress() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [stats, setStats] = useState({ total: 0, thisWeek: 0, thisMonth: 0 })
  const [goals, setGoals] = useState(null)
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [sessionSets, setSessionSets] = useState({})

  // Calendar state
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [calSessions, setCalSessions] = useState([])
  const [selectedDay, setSelectedDay] = useState(null)

  useEffect(() => { loadData() }, [])
  useEffect(() => { loadCalSessions() }, [calMonth])

  async function loadData() {
    const now = new Date()
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
    const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()

    const [{ count: total }, { count: thisWeek }, { count: thisMonth }, { data: allSessions }] = await Promise.all([
      supabase.from('workout_sessions').select('*', { count: 'exact', head: true })
        .eq('user_id', user.id).not('completed_at', 'is', null),
      supabase.from('workout_sessions').select('*', { count: 'exact', head: true })
        .eq('user_id', user.id).not('completed_at', 'is', null).gte('completed_at', weekAgo),
      supabase.from('workout_sessions').select('*', { count: 'exact', head: true })
        .eq('user_id', user.id).not('completed_at', 'is', null).gte('completed_at', monthAgo),
      supabase.from('workout_sessions').select('*')
        .eq('user_id', user.id).not('completed_at', 'is', null)
        .order('completed_at', { ascending: false }).limit(50),
    ])

    setStats({ total: total || 0, thisWeek: thisWeek || 0, thisMonth: thisMonth || 0 })
    setSessions(allSessions || [])
    setLoading(false)
    loadGoals()
  }

  async function loadGoals() {
    // Sessions for the last 8 weeks (Mon-based)
    const start8 = mondayOf(new Date())
    start8.setDate(start8.getDate() - 7 * 7)

    const [{ data: program }, { data: recentSessions }] = await Promise.all([
      supabase.from('programs').select('id, week_schedule').eq('user_id', user.id).eq('is_active', true).limit(1).single(),
      supabase.from('workout_sessions').select('id, completed_at')
        .eq('user_id', user.id).not('completed_at', 'is', null)
        .gte('completed_at', start8.toISOString()),
    ])

    const planned = plannedPerWeek(program?.week_schedule)
    const scores = weekScores(recentSessions || [], planned)
    const streak = perfectStreak(scores)

    let strength = { ups: 0, total: 0, list: [] }
    if (program && recentSessions?.length) {
      const { data: pDays } = await supabase.from('program_days').select('id').eq('program_id', program.id)
      if (pDays?.length) {
        const { data: exs } = await supabase.from('program_exercises')
          .select('id, name').in('program_day_id', pDays.map((d) => d.id)).order('exercise_order')
        if (exs?.length) {
          const { data: logs } = await supabase.from('set_logs')
            .select('program_exercise_id, session_id, weight, actual_reps')
            .in('session_id', recentSessions.map((s) => s.id))
            .in('program_exercise_id', exs.map((e) => e.id))
            .eq('completed', true)
          strength = strengthTrends(exs, recentSessions, logs || [])
        }
      }
    }

    setGoals({ scores, streak, planned, strength })
  }

  async function loadCalSessions() {
    const year = calMonth.getFullYear()
    const mon = calMonth.getMonth()
    const start = new Date(year, mon, 1).toISOString()
    const end = new Date(year, mon + 1, 0, 23, 59, 59, 999).toISOString()

    const { data } = await supabase
      .from('workout_sessions')
      .select('id, completed_at, day_name, started_at')
      .eq('user_id', user.id)
      .not('completed_at', 'is', null)
      .gte('completed_at', start)
      .lte('completed_at', end)
    setCalSessions(data || [])
    setSelectedDay(null)
  }

  async function loadSets(sessionId) {
    if (sessionSets[sessionId]) {
      setExpanded(expanded === sessionId ? null : sessionId)
      return
    }
    const { data } = await supabase
      .from('set_logs').select('*').eq('session_id', sessionId)
      .order('exercise_name').order('set_number')
    setSessionSets((prev) => ({ ...prev, [sessionId]: data || [] }))
    setExpanded(sessionId)
  }

  function groupByExercise(sets) {
    const groups = {}
    for (const s of sets) {
      if (!groups[s.exercise_name]) groups[s.exercise_name] = []
      groups[s.exercise_name].push(s)
    }
    return groups
  }

  function durationStr(start, end) {
    if (!start || !end) return ''
    const mins = Math.round((new Date(end) - new Date(start)) / 60000)
    return `${mins} min`
  }

  // Calendar helpers
  const calYear = calMonth.getFullYear()
  const calMon = calMonth.getMonth()
  const weeks = buildCalendarGrid(calYear, calMon)
  const today = new Date()

  const sessionsByDay = {}
  for (const s of calSessions) {
    const d = new Date(s.completed_at).getDate()
    if (!sessionsByDay[d]) sessionsByDay[d] = []
    sessionsByDay[d].push(s)
  }

  const selectedSessions = selectedDay ? (sessionsByDay[selectedDay] || []) : []

  const monthLabel = calMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  function prevMonth() {
    setCalMonth(new Date(calYear, calMon - 1, 1))
  }
  function nextMonth() {
    setCalMonth(new Date(calYear, calMon + 1, 1))
  }
  function isToday(d) {
    return d === today.getDate() && calMon === today.getMonth() && calYear === today.getFullYear()
  }
  function isFuture(d) {
    return new Date(calYear, calMon, d) > today
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100%', padding: '28px 20px 80px', paddingTop: 'max(28px, env(safe-area-inset-top, 28px))' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--text-3)', flexShrink: 0 }}>
          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-3)', margin: '0 0 4px' }}>E1</p>
          <h1 style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '26px', fontWeight: 300, color: 'var(--text)', margin: 0, letterSpacing: '0.02em' }}>Progress</h1>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '24px' }}>
        {[
          { label: 'Total', value: loading ? '—' : stats.total },
          { label: 'This month', value: loading ? '—' : stats.thisMonth },
          { label: 'This week', value: loading ? '—' : stats.thisWeek },
        ].map((s) => (
          <div key={s.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px 12px', textAlign: 'center' }}>
            <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '26px', fontWeight: 400, color: 'var(--text)', margin: '0 0 4px', lineHeight: 1 }}>{s.value}</p>
            <p style={{ fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', margin: 0 }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Goals ── */}
      {goals && (
        <div style={{ marginBottom: '28px' }}>
          <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '10px' }}>Goals</p>

          {/* Headline numbers */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            {(() => {
              const cur = goals.scores[goals.scores.length - 1]
              const weekPct = Math.round(cur.score * 100)
              const strPct = goals.strength.total > 0 ? Math.round((goals.strength.ups / goals.strength.total) * 100) : null
              return (
                <>
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px 12px', textAlign: 'center' }}>
                    <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '26px', fontWeight: 400, color: 'var(--text)', margin: '0 0 4px', lineHeight: 1 }}>{weekPct}%</p>
                    <p style={{ fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', margin: 0 }}>Week · {cur.count}/{goals.planned}</p>
                  </div>
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px 12px', textAlign: 'center' }}>
                    <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '26px', fontWeight: 400, color: 'var(--text)', margin: '0 0 4px', lineHeight: 1 }}>{strPct === null ? '—' : `${strPct}%`}</p>
                    <p style={{ fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', margin: 0 }}>
                      Strength{goals.strength.total > 0 ? ` · ${goals.strength.ups}/${goals.strength.total} up` : ''}
                    </p>
                  </div>
                </>
              )
            })()}
          </div>

          {/* 8-week consistency bars */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px 16px 12px', marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: 44 }}>
              {goals.scores.map((w, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                  <div style={{
                    height: `${Math.max(w.score * 100, 6)}%`,
                    borderRadius: '3px',
                    background: w.score >= 1 ? 'var(--text)' : w.score > 0 ? 'var(--text-3)' : 'var(--surface-3)',
                    border: w.current ? '1px solid var(--border-2)' : 'none',
                  }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
              <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '10px', letterSpacing: '0.12em', color: 'var(--text-3)', margin: 0 }}>LAST 8 WEEKS</p>
              {goals.streak > 0 && (
                <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '10px', letterSpacing: '0.12em', color: 'var(--text-2)', margin: 0 }}>
                  {goals.streak} PERFECT WEEK{goals.streak !== 1 ? 'S' : ''}
                </p>
              )}
            </div>
          </div>

          {/* Per-exercise trends */}
          {goals.strength.list.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
              {goals.strength.list.map((ex, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: i < goals.strength.list.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <p style={{ fontSize: '13px', color: ex.trend === null ? 'var(--text-3)' : 'var(--text)', margin: 0 }}>{ex.name}</p>
                  {ex.trend === null ? (
                    <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>needs 2 sessions</span>
                  ) : (
                    <span style={{
                      fontFamily: "'Oxanium', sans-serif", fontSize: '12px', fontWeight: 600,
                      color: ex.trend === 'up' ? 'var(--text)' : ex.trend === 'flat' ? 'var(--text-3)' : 'var(--gold)',
                    }}>
                      {ex.trend === 'up' ? '↑' : ex.trend === 'flat' ? '→' : '↓'} {ex.latest.weight}×{ex.latest.reps}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Calendar ── */}
      <div style={{ marginBottom: '28px' }}>
        {/* Month navigation */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <button onClick={prevMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: '4px 8px' }}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '13px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-2)', margin: 0 }}>
            {monthLabel}
          </p>
          <button onClick={nextMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: '4px 8px' }}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', overflow: 'hidden', padding: '12px 10px' }}>
          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: '6px' }}>
            {DAY_LABELS.map((d) => (
              <div key={d} style={{ textAlign: 'center', fontSize: '10px', fontFamily: "'Oxanium', sans-serif", letterSpacing: '0.08em', color: 'var(--text-3)', padding: '4px 0' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Weeks */}
          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '2px' }}>
              {week.map((day, di) => {
                if (!day) return <div key={di} />
                const hasSession = !!sessionsByDay[day]
                const isSelected = selectedDay === day
                const todayFlag = isToday(day)
                const futureFlag = isFuture(day)

                let bg = 'transparent'
                let color = futureFlag ? 'var(--text-3)' : 'var(--text-2)'
                let border = 'none'
                let fontWeight = 400

                if (hasSession && isSelected) {
                  bg = 'var(--text)'; color = 'var(--bg)'; fontWeight = 600
                } else if (hasSession) {
                  bg = 'var(--surface-3)'; color = 'var(--text)'; fontWeight = 500
                  border = '1px solid var(--border-2)'
                } else if (todayFlag) {
                  border = '1px solid var(--text-3)'
                }

                return (
                  <button
                    key={di}
                    onClick={() => hasSession ? setSelectedDay(isSelected ? null : day) : null}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      height: 38, borderRadius: '8px', cursor: hasSession ? 'pointer' : 'default',
                      background: bg, border, position: 'relative',
                    }}
                  >
                    <span style={{ fontSize: '13px', color, fontWeight, fontFamily: "'Oxanium', sans-serif" }}>
                      {day}
                    </span>
                    {hasSession && !isSelected && (
                      <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--text)', position: 'absolute', bottom: 4 }} />
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Selected day detail */}
        {selectedDay && selectedSessions.length > 0 && (
          <div style={{ marginTop: '10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
            {selectedSessions.map((s, i) => (
              <div key={s.id}>
                {i > 0 && <div style={{ height: 1, background: 'var(--border)' }} />}
                <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <p style={{ fontSize: '15px', color: 'var(--text)', margin: '0 0 2px', fontWeight: 500 }}>{s.day_name}</p>
                    <p style={{ fontSize: '11px', color: 'var(--text-3)', margin: 0 }}>
                      {new Date(s.completed_at).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                      {s.started_at ? ` · ${durationStr(s.started_at, s.completed_at)}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => loadSets(s.id)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: '11px', fontFamily: "'Oxanium', sans-serif", letterSpacing: '0.1em', cursor: 'pointer', padding: 0 }}
                  >
                    {expanded === s.id ? 'Hide' : 'Details'}
                  </button>
                </div>
                {expanded === s.id && (sessionSets[s.id] || []).length > 0 && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px 14px' }}>
                    {Object.entries(groupByExercise(sessionSets[s.id] || [])).map(([exName, exSets]) => (
                      <div key={exName} style={{ marginBottom: '12px' }}>
                        <p style={{ fontSize: '12px', color: 'var(--text)', margin: '0 0 4px', fontWeight: 500 }}>{exName}</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          {exSets.map((s, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                              <span style={{ color: 'var(--text-3)', width: '18px' }}>#{s.set_number}</span>
                              <span style={{ color: 'var(--text)' }}>{s.weight} {s.weight_unit}</span>
                              <span style={{ color: 'var(--text-3)' }}>×</span>
                              <span style={{ color: s.actual_reps >= s.target_reps ? 'var(--text)' : '#c8a84b' }}>{s.actual_reps} reps</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* History list */}
      <div>
        <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '10px' }}>History</p>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--text-3)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
          </div>
        ) : sessions.length === 0 ? (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '28px', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-3)', fontSize: '14px', margin: 0 }}>No workouts logged yet.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sessions.map((sess) => {
              const isOpen = expanded === sess.id
              const sets = sessionSets[sess.id] || []
              const grouped = groupByExercise(sets)

              return (
                <div key={sess.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
                  <button
                    onClick={() => loadSets(sess.id)}
                    style={{ width: '100%', textAlign: 'left', padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <div>
                      <p style={{ fontSize: '15px', color: 'var(--text)', margin: '0 0 2px' }}>{sess.day_name}</p>
                      <p style={{ fontSize: '12px', color: 'var(--text-3)', margin: 0 }}>
                        {new Date(sess.completed_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        {sess.started_at && ` · ${durationStr(sess.started_at, sess.completed_at)}`}
                      </p>
                    </div>
                    <svg width="14" height="14" fill="none" stroke="var(--text-3)" strokeWidth="2" viewBox="0 0 24 24"
                      style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isOpen && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px 16px' }}>
                      {Object.entries(grouped).map(([exName, exSets]) => (
                        <div key={exName} style={{ marginBottom: '14px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <p style={{ fontSize: '13px', color: 'var(--text)', margin: 0, fontWeight: 500 }}>{exName}</p>
                            <button
                              onClick={() => { const exId = exSets[0]?.program_exercise_id; if (exId) navigate(`/exercise/${exId}`) }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: 'var(--text-3)', padding: 0 }}
                            >
                              Progress →
                            </button>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {exSets.map((s, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                                <span style={{ color: 'var(--text-3)', width: '20px' }}>#{s.set_number}</span>
                                <span style={{ color: 'var(--text)' }}>{s.weight} {s.weight_unit}</span>
                                <span style={{ color: 'var(--text-3)' }}>×</span>
                                <span style={{ color: s.actual_reps >= s.target_reps ? 'var(--text)' : '#c8a84b' }}>{s.actual_reps} reps</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
