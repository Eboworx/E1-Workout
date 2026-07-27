import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useProfile } from '../context/ProfileContext'

export default function Dashboard() {
  const { user, signOut } = useAuth()
  const { profile } = useProfile()
  const navigate = useNavigate()
  const isFemale = profile?.avatar_gender === 'f'
  const avatarSrc = isFemale ? '/splash_f.png' : '/splash.png'
  const [activeProgram, setActiveProgram] = useState(null)
  const [recentSession, setRecentSession] = useState(null)
  const [totalSessions, setTotalSessions] = useState(0)
  const [loading, setLoading] = useState(true)
  const [resumeSessionId, setResumeSessionId] = useState(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const { data: program } = await supabase
      .from('programs').select('*').eq('user_id', user.id).eq('is_active', true).limit(1).single()
    setActiveProgram(program)

    const { data: session } = await supabase
      .from('workout_sessions').select('*, program_days(name)')
      .eq('user_id', user.id).not('completed_at', 'is', null)
      .order('completed_at', { ascending: false }).limit(1).single()
    setRecentSession(session)

    const { count } = await supabase
      .from('workout_sessions').select('*', { count: 'exact', head: true })
      .eq('user_id', user.id).not('completed_at', 'is', null)
    setTotalSessions(count || 0)

    setLoading(false)

    // Check for an in-progress workout the user navigated away from
    const savedId = localStorage.getItem('activeSessionId')
    if (savedId) {
      const { data: openSession } = await supabase
        .from('workout_sessions').select('id, completed_at, started_at')
        .eq('id', savedId).single()
      if (openSession && !openSession.completed_at) {
        // Auto-clear if session is older than 12 hours (stale)
        const startedAt = new Date(openSession.started_at || 0)
        const ageHours = (Date.now() - startedAt) / 1000 / 3600
        if (ageHours > 12) {
          await supabase.from('workout_sessions').delete().eq('id', savedId)
          localStorage.removeItem('activeSessionId')
        } else {
          setResumeSessionId(savedId)
        }
      } else {
        localStorage.removeItem('activeSessionId')
      }
    }
  }

  const modules = [
    {
      id: 'program',
      label: 'Active Program',
      sub: loading ? '—' : (activeProgram ? activeProgram.name : 'No active program'),
      detail: loading ? '' : (recentSession
        ? `Last: ${recentSession.day_name || recentSession.program_days?.name}`
        : 'Start your first session'),
      action: () => navigate('/workout-picker'),
    },
    {
      id: 'progress',
      label: 'Progress',
      sub: loading ? '—' : `${totalSessions} session${totalSessions !== 1 ? 's' : ''} logged`,
      detail: 'Analytics + progress photos',
      action: () => navigate('/progress'),
    },
    {
      id: 'create',
      label: 'Create Program',
      sub: 'Build a new program',
      detail: 'Set days, exercises, weights',
      action: () => navigate('/programs/new'),
    },
  ]

  return (
    <div style={{ background: '#000', height: '100dvh', display: 'flex', flexDirection: 'column' }}>

      {/* Truncated splash illustration */}
      <div style={{ height: '44vh', flexShrink: 0, position: 'relative', overflow: 'hidden', marginTop: '20px' }}>
        <img
          src={avatarSrc}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center', display: 'block', transform: isFemale ? 'scaleX(-1)' : 'none' }}
        />
        {/* Sun accent — male only; female image already has a sun baked in */}
        {!isFemale && (
          <div style={{
            position: 'absolute',
            width: '48vw', height: '48vw',
            borderRadius: '50%',
            background: '#8b1a1a',
            top: 'calc(-24vw)',
            right: 'calc(-24vw)',
            zIndex: 2,
            mixBlendMode: 'screen',
          }} />
        )}
        {/* Fade into content */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '70%',
          background: 'linear-gradient(to bottom, transparent, #0d0d0d)',
          zIndex: 3, pointerEvents: 'none',
        }} />
      </div>

      {/* Content — fills remaining screen, cards spaced to bottom */}
      <div style={{ flex: 1, background: '#0d0d0d', padding: '0 20px', paddingBottom: 'env(safe-area-inset-bottom, 24px)', display: 'flex', flexDirection: 'column' }}>

        {/* Wordmark */}
        <div style={{ padding: '10px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'stretch' }}>
            <h1 style={{
              fontFamily: "'Oxanium', sans-serif",
              fontWeight: 300, fontSize: '52px',
              color: '#f0ece4', letterSpacing: '0.04em',
              margin: 0, lineHeight: 1,
            }}>{profile?.code || 'E1'}</h1>
            <p style={{
              fontFamily: "'Oxanium', sans-serif",
              fontSize: '10px', color: '#525248',
              margin: '1px 0 0', textTransform: 'uppercase',
              textAlign: 'justify', textAlignLast: 'justify',
            }}>Move</p>
          </div>
          <button
            onClick={() => signOut()}
            style={{ background: 'none', border: 'none', color: '#525248', fontSize: '11px', fontFamily: "'Oxanium', sans-serif", letterSpacing: '0.1em', cursor: 'pointer', padding: '4px 0', marginTop: '4px' }}
          >Sign out</button>
        </div>

        {/* Resume workout banner */}
        {resumeSessionId && (
          <div style={{ width: '100%', marginBottom: '8px', background: '#1a1a0f', border: '1px solid #3a3a1a', borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button
              onClick={() => navigate(`/workout/${resumeSessionId}`)}
              style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', padding: 0 }}
            >
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#c8a84b', flexShrink: 0 }} />
              <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '13px', color: '#c8a84b', margin: 0, letterSpacing: '0.06em' }}>
                Workout in progress — tap to resume
              </p>
            </button>
            <button
              onClick={async () => {
                await supabase.from('workout_sessions').delete().eq('id', resumeSessionId)
                localStorage.removeItem('activeSessionId')
                setResumeSessionId(null)
              }}
              style={{ background: 'none', border: 'none', color: '#c8a84b', opacity: 0.5, fontSize: '16px', cursor: 'pointer', padding: '0 0 0 12px', flexShrink: 0 }}
            >✕</button>
          </div>
        )}

        {/* Module cards — fill remaining space evenly */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', paddingBottom: '8px' }}>
          {modules.map((mod) => (
            <button
              key={mod.id}
              onClick={mod.action}
              style={{
                width: '100%', textAlign: 'left',
                background: '#1c1c1c',
                border: '1px solid #2e2e2e',
                borderRadius: '14px',
                padding: '16px 18px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                cursor: 'pointer',
              }}
            >
              <div>
                <p style={{
                  fontFamily: "'Oxanium', sans-serif",
                  fontSize: '10px', letterSpacing: '0.18em',
                  textTransform: 'uppercase', color: '#525248',
                  margin: '0 0 4px',
                }}>{mod.label}</p>
                <p style={{
                  fontFamily: "'Oxanium', sans-serif",
                  fontSize: '17px', fontWeight: 400,
                  color: '#f0ece4', margin: '0 0 2px', letterSpacing: '0.02em',
                }}>{mod.sub}</p>
                <p style={{ fontSize: '12px', color: '#525248', margin: 0, fontFamily: 'system-ui' }}>
                  {mod.detail}
                </p>
              </div>
              <svg width="18" height="18" fill="none" stroke="#525248" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
