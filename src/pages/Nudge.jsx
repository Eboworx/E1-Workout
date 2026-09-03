import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { enablePush } from '../lib/push'

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
  return { mode: 'posture', durationMins: 30, intervalMins: 5, sound: true, haptic: true, soundId: 'chime', delivery: 'app' }
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
// Single decaying tone. All times relative to ctx.currentTime + delay.
function tone(ctx, { freq, type = 'sine', delay = 0, attack = 0.02, decay = 1.2, gain = 0.25, slideTo = null, vibrato = 0 }) {
  const t0 = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + decay * 0.7)
  if (vibrato) {
    const lfo = ctx.createOscillator()
    const lfoGain = ctx.createGain()
    lfo.frequency.value = 4.5
    lfoGain.gain.value = vibrato
    lfo.connect(lfoGain).connect(osc.frequency)
    lfo.start(t0)
    lfo.stop(t0 + attack + decay + 0.1)
  }
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay)
  osc.connect(g).connect(ctx.destination)
  osc.start(t0)
  osc.stop(t0 + attack + decay + 0.1)
}

// Filtered noise swell (waves / breath textures)
function noiseSwell(ctx, { delay = 0, dur = 2, gain = 0.18, filterType = 'lowpass', from = 400, to = 1400, q = 0.8 }) {
  const t0 = ctx.currentTime + delay
  const len = Math.ceil(ctx.sampleRate * dur)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buf
  const filt = ctx.createBiquadFilter()
  filt.type = filterType
  filt.Q.value = q
  filt.frequency.setValueAtTime(from, t0)
  filt.frequency.linearRampToValueAtTime(to, t0 + dur * 0.45)
  filt.frequency.linearRampToValueAtTime(from, t0 + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + dur * 0.4)
  g.gain.linearRampToValueAtTime(0.0001, t0 + dur)
  src.connect(filt).connect(g).connect(ctx.destination)
  src.start(t0)
  src.stop(t0 + dur)
}

export const SOUNDS = [
  { id: 'chime', label: 'Chime', play: (ctx) => {
    tone(ctx, { freq: 523.25 })
    tone(ctx, { freq: 783.99, delay: 0.18 })
  } },
  { id: 'bowl', label: 'Bowl', play: (ctx) => {
    tone(ctx, { freq: 220, decay: 3.2, gain: 0.22 })
    tone(ctx, { freq: 221.6, decay: 3.2, gain: 0.14 }) // beat frequency shimmer
    tone(ctx, { freq: 662, decay: 2.2, gain: 0.05 })
  } },
  { id: 'drift', label: 'Drift', play: (ctx) => {
    tone(ctx, { freq: 392, attack: 0.6, decay: 2.2, gain: 0.2, vibrato: 3 })
    tone(ctx, { freq: 587.33, attack: 0.9, decay: 1.9, gain: 0.09, vibrato: 3 })
  } },
  { id: 'wave', label: 'Wave', play: (ctx) => {
    noiseSwell(ctx, { dur: 2.6, gain: 0.16, from: 300, to: 1100 })
  } },
  { id: 'droplet', label: 'Droplet', play: (ctx) => {
    tone(ctx, { freq: 980, slideTo: 420, decay: 0.5, gain: 0.22 })
    tone(ctx, { freq: 1230, slideTo: 540, decay: 0.45, gain: 0.1, delay: 0.28 })
  } },
  { id: 'bell', label: 'Bell', play: (ctx) => {
    tone(ctx, { freq: 660, decay: 2.4, gain: 0.2 })
    tone(ctx, { freq: 1056, decay: 1.6, gain: 0.07 }) // inharmonic partial
  } },
  { id: 'marimba', label: 'Marimba', play: (ctx) => {
    tone(ctx, { freq: 440, type: 'triangle', decay: 0.6, gain: 0.28 })
    tone(ctx, { freq: 880, type: 'sine', decay: 0.35, gain: 0.08 })
    tone(ctx, { freq: 587.33, type: 'triangle', decay: 0.7, gain: 0.2, delay: 0.22 })
  } },
  { id: 'breath', label: 'Breath', play: (ctx) => {
    noiseSwell(ctx, { dur: 1.6, gain: 0.14, filterType: 'bandpass', from: 600, to: 1000, q: 1.2 })
  } },
  { id: 'pluck', label: 'Pluck', play: (ctx) => {
    tone(ctx, { freq: 587.33, type: 'triangle', attack: 0.005, decay: 0.4, gain: 0.26 })
    tone(ctx, { freq: 440, type: 'triangle', attack: 0.005, decay: 0.5, gain: 0.2, delay: 0.16 })
  } },
  { id: 'hum', label: 'Hum', play: (ctx) => {
    tone(ctx, { freq: 146.83, attack: 0.3, decay: 2.4, gain: 0.3 })
    tone(ctx, { freq: 293.66, attack: 0.4, decay: 2, gain: 0.1 })
  } },
]

function playSound(id) {
  const ctx = ensureAudio()
  if (!ctx) return
  const s = SOUNDS.find((x) => x.id === id) || SOUNDS[0]
  s.play(ctx)
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
  const { user } = useAuth()
  const [settings, setSettings] = useState(loadSettings)
  const [pushSession, setPushSession] = useState(null)
  const [pushBusy, setPushBusy] = useState(false)
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

  // Resume an active push session if one exists (e.g. app was closed)
  useEffect(() => {
    if (!user) return
    supabase.from('nudge_push_sessions').select('*')
      .eq('user_id', user.id).limit(1).maybeSingle()
      .then(({ data }) => { if (data) setPushSession(data) })
  }, [user])

  async function startPush() {
    setPushBusy(true)
    try {
      const sub = await enablePush()
      const intervalMins = Math.max(1, Math.round(settings.intervalMins))
      const nowMs = Date.now()
      const { data, error } = await supabase.from('nudge_push_sessions').insert({
        user_id: user.id,
        subscription: sub,
        interval_mins: intervalMins,
        cue: mode.cue,
        ends_at: settings.durationMins ? new Date(nowMs + settings.durationMins * 60000).toISOString() : null,
        next_at: new Date(nowMs + intervalMins * 60000).toISOString(),
      }).select().single()
      if (error) throw error
      setPushSession(data)
    } catch (e) {
      alert(e.message || 'Could not start notification nudges.')
    } finally {
      setPushBusy(false)
    }
  }

  async function endPush() {
    if (pushSession) await supabase.from('nudge_push_sessions').delete().eq('id', pushSession.id)
    setPushSession(null)
  }

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
    if (settings.sound) playSound(settings.soundId)
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
  }, [running, paused, settings.sound, settings.haptic, settings.intervalMins, settings.soundId])

  useEffect(() => () => { clearInterval(tickRef.current); releaseWakeLock() }, [])

  const remaining = endAtRef.current ? (endAtRef.current - now) / 1000 : null
  const untilNudge = nextNudgeRef.current ? (nextNudgeRef.current - now) / 1000 : null

  // ── Active push session view ──
  if (pushSession) {
    const endsAt = pushSession.ends_at ? new Date(pushSession.ends_at) : null
    return (
      <div style={{ background: '#0d0d0d', minHeight: '100dvh', display: 'flex', flexDirection: 'column', padding: '0 24px' }} className="safe-top safe-bottom">
        <div style={{ padding: '24px 0 0' }}>
          <p style={{ ...labelStyle, margin: 0 }}>Notification nudges · every {pushSession.interval_mins}m</p>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', textAlign: 'center' }}>
          <p style={{ fontFamily: F, fontWeight: 300, fontSize: '40px', lineHeight: 1.2, color: 'var(--text)', margin: 0 }}>
            Nudges are on
          </p>
          <p style={{ fontFamily: F, fontSize: '13px', letterSpacing: '0.06em', color: 'var(--text-2)', margin: 0, lineHeight: 1.6 }}>
            {pushSession.cue}
          </p>
          <p style={{ fontSize: '12px', color: 'var(--text-3)', margin: '8px 0 0', fontFamily: 'system-ui', lineHeight: 1.6 }}>
            You can close the app — nudges arrive as notifications
            {endsAt ? ` until ${endsAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ' until you end the session'}.
          </p>
        </div>
        <div style={{ paddingBottom: '24px' }}>
          <button
            onClick={endPush}
            style={{
              width: '100%', padding: '18px 0', borderRadius: '14px', cursor: 'pointer',
              background: 'var(--text)', border: 'none', color: '#141414',
              fontFamily: F, fontSize: '15px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase',
            }}
          >End session</button>
        </div>
      </div>
    )
  }

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
          <p style={labelStyle}>Delivery</p>
          <Segmented
            options={[{ label: 'In-app', value: 'app' }, { label: 'Notification', value: 'push' }]}
            value={settings.delivery || 'app'}
            onChange={(delivery) => set({ delivery })}
          />
          {settings.delivery === 'push' && (
            <p style={{ fontSize: '11px', color: 'var(--text-3)', margin: '8px 2px 0', fontFamily: 'system-ui', lineHeight: 1.5 }}>
              Works with the app closed. Uses your phone's notification sound & vibration. Minimum interval 1 minute.
            </p>
          )}
        </div>

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
          {/* Custom interval */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px',
            background: 'var(--surface)', borderRadius: '10px', padding: '6px 14px',
            border: `1px solid ${INTERVALS.some((i) => i.mins === settings.intervalMins) ? 'var(--border)' : 'var(--text)'}`,
          }}>
            <span style={{ fontFamily: F, fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
              Custom
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0.25"
              step="any"
              placeholder="min"
              value={INTERVALS.some((i) => i.mins === settings.intervalMins) ? '' : settings.intervalMins}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                if (!isNaN(v) && v > 0) set({ intervalMins: v })
              }}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                fontFamily: F, fontSize: '16px', color: 'var(--text)', textAlign: 'right',
                padding: '6px 0',
              }}
            />
            <span style={{ fontFamily: F, fontSize: '12px', color: 'var(--text-3)' }}>min</span>
          </div>
        </div>

        {settings.delivery !== 'push' && (
        <div>
          <p style={labelStyle}>Alert</p>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Toggle label="Sound" on={settings.sound} onChange={(sound) => set({ sound })} />
            <Toggle label="Vibrate" on={settings.haptic} onChange={(haptic) => set({ haptic })} />
          </div>
          {/* Sound picker — tap to select & preview */}
          {settings.sound && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', marginTop: '10px' }}>
              {SOUNDS.map((s) => {
                const on = s.id === (settings.soundId || 'chime')
                return (
                  <button
                    key={s.id}
                    onClick={() => { set({ soundId: s.id }); playSound(s.id) }}
                    style={{
                      padding: '10px 0', borderRadius: '10px', cursor: 'pointer',
                      fontFamily: F, fontSize: '11px', letterSpacing: '0.04em',
                      background: on ? 'var(--text)' : 'var(--surface)',
                      color: on ? '#141414' : 'var(--text-2)',
                      border: `1px solid ${on ? 'var(--text)' : 'var(--border)'}`,
                      transition: 'background 0.15s, color 0.15s',
                    }}
                  >{s.label}</button>
                )
              })}
            </div>
          )}
          {!navigator.vibrate && settings.haptic && (
            <p style={{ fontSize: '11px', color: 'var(--text-3)', margin: '8px 2px 0', fontFamily: 'system-ui' }}>
              Vibration isn't supported on this device (iOS) — sound will still play.
            </p>
          )}
        </div>
        )}

        {settings.delivery !== 'push' && (
        <p style={{ fontSize: '11px', color: 'var(--text-3)', margin: '0 2px', fontFamily: 'system-ui', lineHeight: 1.5 }}>
          Keep the app open during a session — the screen stays awake while it runs.
        </p>
        )}
      </div>

      <div style={{ paddingBottom: '24px' }}>
        <button
          onClick={settings.delivery === 'push' ? startPush : start}
          disabled={pushBusy}
          style={{
            width: '100%', padding: '18px 0', borderRadius: '14px', cursor: 'pointer',
            background: 'var(--text)', border: 'none', color: '#141414',
            fontFamily: F, fontSize: '15px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase',
            opacity: pushBusy ? 0.5 : 1,
          }}
        >{pushBusy ? 'Starting…' : 'Start session'}</button>
      </div>
    </div>
  )
}
