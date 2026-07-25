import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function WorkoutPicker() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [activeProgram, setActiveProgram] = useState(null)
  const [days, setDays] = useState([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(null)
  const [recentSession, setRecentSession] = useState(null)

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

    const { data: session } = await supabase
      .from('workout_sessions').select('*, program_days(name)')
      .eq('user_id', user.id).not('completed_at', 'is', null)
      .order('completed_at', { ascending: false }).limit(1).single()
    setRecentSession(session)
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
    if (!recentSession || !days.length) return 0
    const lastIdx = days.findIndex((d) => d.id === recentSession.program_day_id)
    return (lastIdx + 1) % days.length
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', background: 'var(--bg)' }}>
      <div style={{ width: 26, height: 26, borderRadius: '50%', border: '2px solid var(--text)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
    </div>
  )

  const suggestedIdx = suggestedDayIndex()

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100%', padding: '20px 20px 40px', paddingTop: 'max(20px, env(safe-area-inset-top, 20px))' }}>

      {/* Back + header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
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
          {recentSession && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '10px 14px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-2)', flexShrink: 0 }} />
              <p style={{ fontSize: '13px', color: 'var(--text-2)', margin: 0 }}>
                Last: <span style={{ color: 'var(--text)' }}>{recentSession.day_name || recentSession.program_days?.name}</span>
              </p>
            </div>
          )}

          <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '12px' }}>
            Pick a day
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {days.map((day, idx) => {
              const isSuggested = idx === suggestedIdx
              return (
                <button
                  key={day.id}
                  onClick={() => startWorkout(day)}
                  disabled={!!starting}
                  style={{
                    width: '100%', textAlign: 'left',
                    background: isSuggested ? 'var(--surface-3)' : 'var(--surface-2)',
                    border: `1px solid ${isSuggested ? 'var(--border-2)' : 'var(--border)'}`,
                    borderRadius: '14px',
                    padding: '16px 18px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    cursor: 'pointer',
                    opacity: starting && starting !== day.id ? 0.4 : 1,
                  }}
                >
                  <div>
                    {isSuggested && (
                      <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-2)', margin: '0 0 4px' }}>
                        Up next
                      </p>
                    )}
                    <p style={{ fontSize: '17px', fontWeight: 600, color: 'var(--text)', margin: '0 0 2px' }}>{day.name}</p>
                    <p style={{ fontSize: '12px', color: 'var(--text-3)', margin: 0 }}>Day {day.day_order}</p>
                  </div>
                  {starting === day.id ? (
                    <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--text-2)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
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
