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

export default function WorkoutPicker() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [activeProgram, setActiveProgram] = useState(null)
  const [days, setDays] = useState([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(null)
  const [weekSessions, setWeekSessions] = useState([]) // sessions completed this week

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data: program } = await supabase
      .from('programs').select('*').eq('user_id', user.id).eq('is_active', true).limit(1).single()

    if (program) {
      setActiveProgram(program)
      const { data: programDays } = await supabase
        .from('program_days').select('*').eq('program_id', program.id).order('day_order')
      setDays(programDays || [])
    }

    // Load this week's completed sessions
    const { monday, sunday } = getWeekBounds()
    const { data: sessions } = await supabase
      .from('workout_sessions')
      .select('id, program_day_id, completed_at, day_name')
      .eq('user_id', user.id)
      .not('completed_at', 'is', null)
      .gte('completed_at', monday.toISOString())
      .lte('completed_at', sunday.toISOString())
    setWeekSessions(sessions || [])

    setLoading(false)
  }

  async function startWorkout(day) {
    setStarting(day.id)
    const { data: session, error } = await supabase
      .from('workout_sessions')
      .insert({ user_id: user.id, program_day_id: day.id, day_name: day.name })
      .select().single()
    if (error) { alert(error.message); setStarting(null); return }
    localStorage.setItem('activeSessionId', session.id)
    navigate(`/workout/${session.id}`)
  }

  function suggestedDayIndex() {
    if (!days.length) return 0
    // Find the last completed day this week, suggest next
    const doneDayIds = weekSessions.map((s) => s.program_day_id)
    const lastDoneIdx = days.reduce((last, d, i) => doneDayIds.includes(d.id) ? i : last, -1)
    if (lastDoneIdx === -1) return 0
    // Find next undone day
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

  const suggestedIdx = suggestedDayIndex()
  const doneCount = weekSessions.length
  const totalDays = days.length

  // Week label
  const { monday, sunday } = getWeekBounds()
  const weekLabel = `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100%', padding: '20px 20px 40px', paddingTop: 'max(20px, env(safe-area-inset-top, 20px))' }}>

      {/* Back + header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--text-3)' }}>
          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-3)', margin: '0 0 2px' }}>Active Program</p>
          <h2 style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '20px', fontWeight: 400, color: 'var(--text)', margin: 0, letterSpacing: '0.02em' }}>
            {activeProgram ? activeProgram.name : 'No program'}
          </h2>
        </div>
      </div>

      {!activeProgram ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <p style={{ color: 'var(--text-2)', marginBottom: '16px' }}>No active program.</p>
          <button
            onClick={() => navigate('/programs/new')}
            style={{ background: 'var(--text)', color: 'var(--bg)', border: 'none', borderRadius: '10px', padding: '12px 24px', fontFamily: "'Oxanium', sans-serif", fontSize: '14px', cursor: 'pointer' }}
          >
            Create a program
          </button>
        </div>
      ) : (
        <>
          {/* Week progress */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '12px 16px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '10px', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-3)', margin: 0 }}>
                This week
              </p>
              <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '10px', color: 'var(--text-3)', margin: 0 }}>{weekLabel}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ height: '100%', background: 'var(--text)', borderRadius: '2px', width: `${totalDays > 0 ? (doneCount / totalDays) * 100 : 0}%`, transition: 'width 0.3s' }} />
              </div>
              <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '12px', color: 'var(--text-2)', margin: 0, flexShrink: 0 }}>
                {doneCount}/{totalDays}
              </p>
            </div>
          </div>

          <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '12px' }}>
            Pick a day
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {days.map((day, idx) => {
              const isSuggested = idx === suggestedIdx
              const weekSession = weekSessions.find((s) => s.program_day_id === day.id)
              const isDoneThisWeek = !!weekSession
              const doneDate = weekSession?.completed_at
                ? new Date(weekSession.completed_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                : null

              return (
                <button
                  key={day.id}
                  onClick={() => startWorkout(day)}
                  disabled={!!starting}
                  style={{
                    width: '100%', textAlign: 'left',
                    background: isDoneThisWeek ? 'var(--surface)' : isSuggested ? 'var(--surface-3)' : 'var(--surface-2)',
                    border: `1px solid ${isDoneThisWeek ? 'var(--border)' : isSuggested ? 'var(--border-2)' : 'var(--border)'}`,
                    borderRadius: '14px',
                    padding: '14px 18px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    cursor: 'pointer',
                    opacity: starting && starting !== day.id ? 0.4 : 1,
                  }}
                >
                  <div>
                    {isSuggested && !isDoneThisWeek && (
                      <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-2)', margin: '0 0 4px' }}>
                        Up next
                      </p>
                    )}
                    <p style={{ fontSize: '17px', fontWeight: isDoneThisWeek ? 400 : 600, color: isDoneThisWeek ? 'var(--text-2)' : 'var(--text)', margin: '0 0 2px' }}>
                      {day.name}
                    </p>
                    <p style={{ fontSize: '12px', color: 'var(--text-3)', margin: 0 }}>
                      {isDoneThisWeek ? `Done · ${doneDate}` : `Day ${day.day_order}`}
                    </p>
                  </div>
                  {starting === day.id ? (
                    <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--text-2)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
                  ) : isDoneThisWeek ? (
                    <svg width="18" height="18" fill="none" stroke="var(--text-2)" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" fill="none" stroke="var(--text-3)" strokeWidth="1.8" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
