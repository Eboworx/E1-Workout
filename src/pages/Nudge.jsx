import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

// ── Session presets ──
const DURATIONS = [
  { label: '15m', mins: 15 },
  { label: '30m', mins: 30 },
  { label: '1h', mins: 60 },
  { label: '2h', mins: 120 },
  { label: '∞', mins: null }, // until stopped
]
const INTERVALS = [
  { label: '1m', mins: 1 },
  { label: '2m', mins: 2 },
  { label: '5m', mins: 5 },
  { label: '10m', mins: 10 },
  { label: '15m', mins: 15 },
]
const MODES = [
  { id: 'posture', label: 'Posture', cue: 'Sit tall. Shoulders back.' },
  { id: 'breathing', label: 'Breathing', cue: 'Slow breath in… slow breath out.' },
  { id: 'both', label: 'Both', cue: 'Posture check. Then one slow breath.' },
]

const STORE_KEY = 'nudgeSettings'

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY))
    if (s && typeof s === 'object') return s
  } catch { /* ignore */ }
  return { mode: 'posture', durationMins: 30, intervalMins: 5, sound: true, haptic: true }
}

// ── Audio: soft two-note chime via Web Audio (no asset needed) ──
let audioCtx = null
function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (Ctx) audioCtx = new Ctx()
  }
  if (audioCtx?.state === 'suspended') audioCtx.resume()
  return audioCtx
}
function playChime() {
  const ctx = ensureAudio()
  if (!ctx) return
  const now = ctx.currentTime
  ;[[523.25, 0], [783.99, 0.18]].forEach(([freq, delay]) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0, now + delay)
    gain.gain.linearRampToValueAtTime(0.25, now + delay + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 1.2)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now + delay)
    osc.stop(now + delay + 1.3)
  })
}
function buzz() {
  if (navigator.vibrate) navigator.vibrate([180, 90, 180])
}

function fmt(secs) {
  if (secs == null) return '—'
  const s = Math.max(0, Math.round(secs))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${m}:${String(ss).padStart(2, '0')}`
}

const F = "'Oxanium', sans-serif"
const labelStyle = {
  fontFamily: F, fontSize: '10px', letterSpacing: '0.18em',
  textTransform: 'uppercase', color: 'var(--text-3)', margin: '0 0 10px',
}

function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: '8px' }}>
      {options.map((opt) => {
        const on = opt.value === value
        return (
          <button
            key={String(opt.value)}
            onClick={() => onChange(opt.value)}
            style={{
              flex: 1, padding: '12px 0', borderRadius: '10px', cursor: 'pointer',
              fontFamily: F, fontSize: '14px', letterSpacing: '0.04em',
              background: on ? 'var(--text)' : 'var(--surface)',
              color: on ? '#141414' : 'var(--text-2)',
              border: `1px solid ${on ? 'var(--text)' : 'var(--border)'}`,
              transition: 'background 0.15s, color 0.15s',
            }}
          >{opt.label}</button>
        )
      })}
    </div>
  )
}

function Toggle({ label, on, onChange }) {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px',
        padding: '14px 16px', cursor: 'pointer',
      }}
    >
      <span style={{ fontFamily: F, fontSize: '13px', letterSpacing: '0.08em', textTransform: 'uppercase', color: on ? 'var(--text)' : 'var(--text-3)' }}>
        {label}
      </span>
      <span style={{
        width: 38, height: 22, borderRadius: 11, flexShrink: 0, position: 'relative',
        background: on ? 'var(--text)' : 'var(--surface-3)', transition: 'background 0.18s',
      }}>
        <span style={{
          position: 'absolute', top: 3, left: on ? 19 : 3, width: 16, height: 16,
          borderRadius: '50%', background: on ? '#141414' : 'var(--text-3)', transition: 'left 0.18s',
        }} />
      </span>
    </button>
  )
}

export default function Nudge() {
  const navigate = useNavigate()
  const [settings, setSettings] = useState(loadSettings)
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [cueFlash, setCueFlash] = useState(false)
  const [nudgeCount, setNudgeCount] = useState(0)

  // Refs for timing state that shouldn't re-render
  const endAtRef = useRef(null)       // ms epoch, or null for ∞
  const nextNudgeRef = useRef(null)   // ms epoch of next nudge
  const pausedAtRef = useRef(null)
  const wakeLockRef = useRef(null)
  const tickRef = useRef(null)

  const set = (patch) => setSettings((s) => {
    const next = { ...s, ...patch }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
    return next
  })

  const mode = MODES.find((m) => m.id === settings.mode) || MODES[0]

  async function acquireWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen')
    } catch { /* not fatal */ }
  }
  function releaseWakeLock() {
    try { wakeLockRef.current?.release() } catch { /* ignore */ }
    wakeLockRef.current = null
  }

  // Re-acquire wake lock when returning to the app mid-session
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && running && !paused) acquireWakeLock()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [running, paused])

  function fireNudge() {
    if (settings.sound) playChime()
    if (settings.haptic) buzz()
    setNudgeCount((c) => c + 1)
    setCueFlash(true)
    setTimeout(() => setCueFlash(false), 4000)
  }

  function start() {
    ensureAudio() // unlock audio inside the user gesture
    const nowMs = Date.now()
    endAtRef.current = settings.durationMins ? nowMs + settings.durationMins * 60000 : null
    nextNudgeRef.current = nowMs + settings.intervalMins * 60000
    setNudgeCount(0)
    setRunning(true)
    setPaused(false)
    setNow(nowMs)
    acquireWakeLock()
  }

  function stop() {
    setRunning(false)
    setPaused(false)
    setCueFlash(false)
    releaseWakeLock()
  }

  function togglePause() {
    if (!paused) {
      pausedAtRef.current = Date.now()
      setPaused(true)
      releaseWakeLock()
    } else {
      const delta = Date.now() - pausedAtRef.current
      if (endAtRef.current) endAtRef.current += delta
      nextNudgeRef.current += delta
      setPaused(false)
      acquireWakeLock()
    }
  }

  // Tick loop
  useEffect(() => {
    if (!running || paused) {
      clearInterval(tickRef.current)
      return
    }
    const intervalMs = (settings.intervalMins || 5) * 60000
    tickRef.current = setInterval(() => {
      const t = Date.now()
      setNow(t)
      // Fire one nudge per tick; skip missed ones if the tab was throttled
      if (t >= nextNudgeRef.current) {
        while (nextNudgeRef.current <= t) nextNudgeRef.current += intervalMs
        fireNudge()
      }
      if (endAtRef.current && t >= endAtRef.current) {
        fireNudge()
        stop()
      }
    }, 250)
    return () => clearInterval(tickRef.current)
  }, [running, paused, settings.sound, settings.haptic, settings.intervalMins])

  useEffect(() => () => { clearInterval(tickRef.current); releaseWakeLock() }, [])

  const remaining = endAtRef.current ? (endAtRef.current - now) / 1000 : null
  const untilNudge = nextNudgeRef.current ? (nextNudgeRef.current - now) / 1000 : null

  // ── Running view ──
  if (running) {
    return (
      <div style={{ background: '#0d0d0d', minHeight: '100dvh', display: 'flex', flexDirection: 'column', padding: '0 24px' }} className="safe-top safe-bottom">
        <div style={{ padding: '24px 0 0' }}>
          <p style={{ ...labelStyle, margin: 0 }}>{mode.label} · every {settings.intervalMins}m</p>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
          {/* Next-nudge countdown */}
          <p style={{ ...labelStyle, margin: 0 }}>Next nudge</p>
          <p style={{
            fontFamily: F, fontWeight: 300, fontSize: '72px', lineHeight: 1,
            color: cueFlash ? 'var(--gold)' : 'var(--text)', margin: 0,
            transition: 'color 0.3s',
          }}>
            {paused ? 'paused' : fmt(untilNudge)}
          </p>

          {/* Cue text on nudge */}
          <p style={{
            fontFamily: F, fontSize: '14px', letterSpacing: '0.06em', textAlign: 'center',
            color: 'var(--gold)', margin: '8px 0 0', minHeight: '20px',
            opacity: cueFlash ? 1 : 0, transition: 'opacity 0.4s',
          }}>{mode.cue}</p>

          <div style={{ display: 'flex', gap: '28px', marginTop: '28px' }}>
            <div style={{ textAlign: 'center' }}>
              <p style={{ ...labelStyle, margin: '0 0 4px' }}>Session left</p>
              <p style={{ fontFamily: F, fontSize: '20px', color: 'var(--text-2)', margin: 0 }}>
                {remaining == null ? '∞' : fmt(remaining)}
              </p>
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ ...labelStyle, margin: '0 0 4px' }}>Nudges</p>
              <p style={{ fontFamily: F, fontSize: '20px', color: 'var(--text-2)', margin: 0 }}>{nudgeCount}</p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', paddingBottom: '24px' }}>
          <button
            onClick={togglePause}
            style={{
              flex: 1, padding: '16px 0', borderRadius: '12px', cursor: 'pointer',
              background: 'var(--surface)', border: '1px solid var(--border-2)',
              color: 'var(--text)', fontFamily: F, fontSize: '14px', letterSpacing: '0.1em', textTransform: 'uppercase',
            }}
          >{paused ? 'Resume' : 'Pause'}</button>
          <button
            onClick={stop}
            style={{
              flex: 1, padding: '16px 0', borderRadius: '12px', cursor: 'pointer',
              background: 'var(--text)', border: '1px solid var(--text)',
              color: '#141414', fontFamily: F, fontSize: '14px', letterSpacing: '0.1em', textTransform: 'uppercase',
            }}
          >End</button>
        </div>
      </div>
    )
  }

  // ── Setup view ──
  return (
    <div style={{ background: '#0d0d0d', minHeight: '100dvh', display: 'flex', flexDirection: 'column', padding: '0 20px' }} className="safe-top safe-bottom">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '20px 0 4px' }}>
        <button
          onClick={() => navigate('/')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', marginLeft: '-4px' }}
        >
          <svg width="20" height="20" fill="none" stroke="var(--text-2)" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 style={{ fontFamily: F, fontWeight: 300, fontSize: '28px', color: 'var(--text)', margin: 0, letterSpacing: '0.04em' }}>Nudge</h1>
          <p style={{ fontFamily: F, fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-3)', margin: 0 }}>Posture · Breathing</p>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px', paddingTop: '24px' }}>
        <div>
          <p style={labelStyle}>Focus</p>
          <Segmented
            options={MODES.map((m) => ({ label: m.label, value: m.id }))}
            value={settings.mode}
            onChange={(mode) => set({ mode })}
          />
        </div>

        <div>
          <p style={labelStyle}>Session length</p>
          <Segmented
            options={DURATIONS.map((d) => ({ label: d.label, value: d.mins }))}
            value={settings.durationMins}
            onChange={(durationMins) => set({ durationMins })}
          />
        </div>

        <div>
          <p style={labelStyle}>Nudge every</p>
          <Segmented
            options={INTERVALS.map((i) => ({ label: i.label, value: i.mins }))}
            value={settings.intervalMins}
            onChange={(intervalMins) => set({ intervalMins })}
          />
        </div>

        <div>
          <p style={labelStyle}>Alert</p>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Toggle label="Sound" on={settings.sound} onChange={(sound) => set({ sound })} />
            <Toggle label="Vibrate" on={settings.haptic} onChange={(haptic) => set({ haptic })} />
          </div>
          {!navigator.vibrate && settings.haptic && (
            <p style={{ fontSize: '11px', color: 'var(--text-3)', margin: '8px 2px 0', fontFamily: 'system-ui' }}>
              Vibration isn't supported on this device (iOS) — sound will still play.
            </p>
          )}
        </div>

        <p style={{ fontSize: '11px', color: 'var(--text-3)', margin: '0 2px', fontFamily: 'system-ui', lineHeight: 1.5 }}>
          Keep the app open during a session — the screen stays awake while it runs.
        </p>
      </div>

      <div style={{ paddingBottom: '24px' }}>
        <button
          onClick={start}
          style={{
            width: '100%', padding: '18px 0', borderRadius: '14px', cursor: 'pointer',
            background: 'var(--text)', border: 'none', color: '#141414',
            fontFamily: F, fontSize: '15px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase',
          }}
        >Start session</button>
      </div>
    </div>
  )
}
