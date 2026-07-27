import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { progressionTip } from '../lib/progression'

const DEFAULT_EXERCISE = {
  name: '',
  sets: 3,
  rep_min: 8,
  rep_max: 12,
  current_weight: 0,
  weight_unit: 'lbs',
  weight_increment: 5,
  notes: '',
}

const inp = {
  width: '100%',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: '10px',
  padding: '10px 12px',
  color: 'var(--text)',
  fontSize: '15px',
  outline: 'none',
  fontFamily: 'system-ui',
}

export default function ProgramBuilder() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { id } = useParams()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(false)
  const [days, setDays] = useState([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(!!id)
  const [expandedDay, setExpandedDay] = useState(0)
  const [expandedExercise, setExpandedExercise] = useState(null)

  useEffect(() => { if (id) loadProgram() }, [id])

  async function loadProgram() {
    const { data: prog } = await supabase
      .from('programs').select(`*, program_days(*, program_exercises(*))`)
      .eq('id', id).single()
    if (!prog) { navigate('/'); return }
    setName(prog.name)
    setDescription(prog.description || '')
    setIsActive(prog.is_active)
    const loadedDays = (prog.program_days || [])
      .sort((a, b) => a.day_order - b.day_order)
      .map((d) => ({
        id: d.id, name: d.name,
        exercises: (d.program_exercises || [])
          .sort((a, b) => a.exercise_order - b.exercise_order)
          .map((ex) => ({ ...DEFAULT_EXERCISE, ...ex })),
      }))
    setDays(loadedDays)
    setLoading(false)
  }

  function addDay() {
    const newDays = [...days, { name: `Day ${days.length + 1}`, exercises: [] }]
    setDays(newDays)
    setExpandedDay(newDays.length - 1)
  }
  function removeDay(idx) { setDays(days.filter((_, i) => i !== idx)) }
  function updateDayName(idx, val) { const d = [...days]; d[idx] = { ...d[idx], name: val }; setDays(d) }
  function addExercise(dayIdx) {
    const d = [...days]
    d[dayIdx] = { ...d[dayIdx], exercises: [...d[dayIdx].exercises, { ...DEFAULT_EXERCISE }] }
    setDays(d)
    setExpandedExercise(`${dayIdx}-${d[dayIdx].exercises.length - 1}`)
  }
  function removeExercise(dayIdx, exIdx) {
    const d = [...days]
    d[dayIdx].exercises = d[dayIdx].exercises.filter((_, i) => i !== exIdx)
    setDays(d)
  }
  function updateExercise(dayIdx, exIdx, field, value) {
    const d = [...days]
    d[dayIdx].exercises[exIdx] = { ...d[dayIdx].exercises[exIdx], [field]: value }
    setDays(d)
  }

  async function save() {
    if (!name.trim()) { alert('Program name is required'); return }
    if (days.length === 0) { alert('Add at least one day'); return }
    setSaving(true)
    try {
      let programId = id
      if (id) {
        const { error: progErr } = await supabase.from('programs').update({ name, description, is_active: isActive }).eq('id', id)
        if (progErr) throw progErr
        // Must delete exercises first (FK constraint), then days
        const { data: existingDays } = await supabase.from('program_days').select('id').eq('program_id', id)
        if (existingDays?.length) {
          const { error: exErr } = await supabase.from('program_exercises').delete().in('program_day_id', existingDays.map((d) => d.id))
          if (exErr) throw exErr
        }
        const { error: dayErr } = await supabase.from('program_days').delete().eq('program_id', id)
        if (dayErr) throw dayErr
      } else {
        if (isActive) await supabase.from('programs').update({ is_active: false }).eq('user_id', user.id)
        const { data: prog } = await supabase
          .from('programs').insert({ name, description, user_id: user.id, is_active: isActive })
          .select().single()
        programId = prog.id
      }
      for (let i = 0; i < days.length; i++) {
        const day = days[i]
        const { data: insertedDay } = await supabase
          .from('program_days').insert({ program_id: programId, day_order: i + 1, name: day.name })
          .select().single()
        if (day.exercises.length > 0) {
          await supabase.from('program_exercises').insert(
            day.exercises.map((ex, j) => ({
              program_day_id: insertedDay.id, exercise_order: j + 1,
              name: ex.name, sets: Number(ex.sets),
              rep_min: Number(ex.rep_min), rep_max: Number(ex.rep_max),
              current_weight: Number(ex.current_weight), weight_unit: ex.weight_unit,
              weight_increment: Number(ex.weight_increment), notes: ex.notes || null,
            }))
          )
        }
      }
      navigate('/')
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--bg)' }}>
      <div style={{ width: 26, height: 26, borderRadius: '50%', border: '2px solid var(--text)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
    </div>
  )

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100%', padding: '20px 20px 60px', paddingTop: 'max(20px, env(safe-area-inset-top, 20px))' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px' }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--text-3)' }}>
          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-3)', margin: '0 0 2px' }}>
            {id ? 'Edit' : 'New'} Program
          </p>
          <h1 style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '22px', fontWeight: 300, color: 'var(--text)', margin: 0, letterSpacing: '0.02em' }}>
            {name || 'Untitled'}
          </h1>
        </div>
      </div>

      {/* Program info */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '16px', marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div>
          <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '6px' }}>Program Name</p>
          <input style={inp} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 4-Day Upper/Lower" />
        </div>
        <div>
          <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '6px' }}>Description (optional)</p>
          <input style={inp} type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Hypertrophy focus, 4× per week" />
        </div>
        <div
          onClick={() => setIsActive(!isActive)}
          style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
        >
          <div style={{
            width: 40, height: 24, borderRadius: 12,
            background: isActive ? 'var(--text)' : 'var(--surface-3)',
            position: 'relative', transition: 'background 0.2s', flexShrink: 0,
            border: '1px solid var(--border-2)',
          }}>
            <div style={{
              position: 'absolute', top: 3, left: isActive ? 18 : 3,
              width: 16, height: 16, borderRadius: '50%',
              background: isActive ? 'var(--bg)' : 'var(--text-3)',
              transition: 'left 0.2s',
            }} />
          </div>
          <span style={{ fontSize: '14px', color: 'var(--text-2)' }}>Set as active program</span>
        </div>
      </div>

      {/* Days */}
      <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '10px' }}>Workout Days</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '10px' }}>
        {days.map((day, dayIdx) => (
          <div key={dayIdx} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', overflow: 'hidden' }}>
            {/* Day header */}
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px', cursor: 'pointer' }}
              onClick={() => setExpandedDay(expandedDay === dayIdx ? null : dayIdx)}
            >
              <div style={{ flex: 1 }}>
                <input
                  type="text"
                  value={day.name}
                  onChange={(e) => { e.stopPropagation(); updateDayName(dayIdx, e.target.value) }}
                  onClick={(e) => e.stopPropagation()}
                  placeholder={`Day ${dayIdx + 1}`}
                  style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: '16px', fontWeight: 500, width: '100%' }}
                />
                <p style={{ fontSize: '12px', color: 'var(--text-3)', margin: 0 }}>
                  {day.exercises.length} exercise{day.exercises.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeDay(dayIdx) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8b3a3a', fontSize: '16px', padding: '0 4px' }}
              >✕</button>
              <svg width="14" height="14" fill="none" stroke="var(--text-3)" strokeWidth="2" viewBox="0 0 24 24"
                style={{ transform: expandedDay === dayIdx ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>

            {/* Exercises */}
            {expandedDay === dayIdx && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px 16px' }}>
                {day.exercises.length === 0 && (
                  <p style={{ fontSize: '13px', color: 'var(--text-3)', textAlign: 'center', padding: '12px 0' }}>No exercises yet</p>
                )}
                {day.exercises.map((ex, exIdx) => {
                  const key = `${dayIdx}-${exIdx}`
                  const isOpen = expandedExercise === key
                  return (
                    <div key={exIdx} style={{ marginBottom: '8px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', cursor: 'pointer' }}
                        onClick={() => setExpandedExercise(isOpen ? null : key)}
                      >
                        <span style={{ color: 'var(--text-3)', fontSize: '12px', width: '16px', flexShrink: 0 }}>{exIdx + 1}</span>
                        <input
                          type="text"
                          value={ex.name}
                          onChange={(e) => { e.stopPropagation(); updateExercise(dayIdx, exIdx, 'name', e.target.value) }}
                          onClick={(e) => e.stopPropagation()}
                          placeholder="Exercise name"
                          style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: '14px', flex: 1 }}
                        />
                        <span style={{ fontSize: '11px', color: 'var(--text-3)', flexShrink: 0 }}>
                          {ex.sets}×{ex.rep_min}–{ex.rep_max}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeExercise(dayIdx, exIdx) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8b3a3a', fontSize: '14px', padding: '0 2px' }}
                        >✕</button>
                      </div>

                      {isOpen && (
                        <div style={{ borderTop: '1px solid var(--border)', padding: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                          <NumField label="Sets" value={ex.sets} onChange={(v) => updateExercise(dayIdx, exIdx, 'sets', v)} />
                          <NumField label="Min reps" value={ex.rep_min} onChange={(v) => updateExercise(dayIdx, exIdx, 'rep_min', v)} />
                          <NumField label="Max reps" value={ex.rep_max} onChange={(v) => updateExercise(dayIdx, exIdx, 'rep_max', v)} />
                          <div>
                            <p style={{ fontSize: '11px', color: 'var(--text-3)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Unit</p>
                            <select
                              value={ex.weight_unit}
                              onChange={(e) => updateExercise(dayIdx, exIdx, 'weight_unit', e.target.value)}
                              style={{ ...inp, padding: '8px 10px', fontSize: '13px' }}
                            >
                              <option value="lbs">lbs</option>
                              <option value="kg">kg</option>
                            </select>
                          </div>
                          <NumField label={`Start weight (${ex.weight_unit})`} value={ex.current_weight} onChange={(v) => updateExercise(dayIdx, exIdx, 'current_weight', v)} step="2.5" />
                          <NumField label={`+${ex.weight_unit} on progress`} value={ex.weight_increment} onChange={(v) => updateExercise(dayIdx, exIdx, 'weight_increment', v)} step="2.5" />
                          <div style={{ gridColumn: '1 / -1' }}>
                            <p style={{ fontSize: '11px', color: 'var(--text-3)', margin: 0 }}>
                              💡 {progressionTip(ex.rep_min, ex.rep_max, ex.weight_increment, ex.weight_unit)}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
                <button
                  onClick={() => addExercise(dayIdx)}
                  style={{ marginTop: '8px', width: '100%', background: 'none', border: '1px dashed var(--border-2)', borderRadius: '10px', padding: '10px', color: 'var(--text-3)', fontSize: '13px', cursor: 'pointer' }}
                >
                  + Add exercise
                </button>
              </div>
            )}
          </div>
        ))}

        <button
          onClick={addDay}
          style={{ width: '100%', background: 'none', border: '1px dashed var(--border-2)', borderRadius: '14px', padding: '16px', color: 'var(--text-3)', fontSize: '14px', cursor: 'pointer' }}
        >
          + Add day
        </button>
      </div>

      {/* Save */}
      <button
        onClick={save}
        disabled={saving}
        style={{
          width: '100%', marginTop: '8px',
          background: 'var(--text)', color: 'var(--bg)',
          border: 'none', borderRadius: '14px',
          padding: '16px', fontSize: '15px',
          fontFamily: "'Oxanium', sans-serif",
          fontWeight: 400, letterSpacing: '0.06em',
          cursor: saving ? 'not-allowed' : 'pointer',
          opacity: saving ? 0.5 : 1,
        }}
      >
        {saving ? 'Saving…' : id ? 'Save changes' : 'Create program'}
      </button>
    </div>
  )
}

function NumField({ label, value, onChange, step = '1' }) {
  return (
    <div>
      <p style={{ fontSize: '11px', color: 'var(--text-3)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</p>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        step={step}
        min="0"
        style={{
          width: '100%', background: 'var(--surface-3)',
          border: '1px solid var(--border)', borderRadius: '8px',
          padding: '8px 10px', color: 'var(--text)',
          fontSize: '14px', outline: 'none', fontFamily: 'system-ui',
        }}
      />
    </div>
  )
}
