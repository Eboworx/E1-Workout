import { useEffect, useState } from 'react'
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
import { useAuth } from '../context/AuthContext'
import { reorderExercises, visibleWhileDragging, withOrder, persistOrder } from '../lib/exerciseOrder'

const F = 'var(--font-display)'

const EMPTY_FORM = { name: '', sets: 3, rep_min: 8, rep_max: 12, current_weight: 0, weight_unit: 'lbs', is_superset: false }

export default function DayPreview() {
  const { dayId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [day, setDay] = useState(null)
  const [exercises, setExercises] = useState([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [sheet, setSheet] = useState(null) // { mode: 'add'|'edit', form, exId? }
  const [saving, setSaving] = useState(false)
  const [dragId, setDragId] = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  )

  useEffect(() => { load() }, [dayId])

  async function load() {
    const { data: d } = await supabase.from('program_days').select('*').eq('id', dayId).single()
    if (!d) { navigate('/workout-picker'); return }
    setDay(d)
    const { data: exs } = await supabase
      .from('program_exercises').select('*').eq('program_day_id', dayId)
      .order('exercise_order').order('id')
    setExercises(exs || [])
    setLoading(false)
  }

  async function handleDragEnd(event) {
    const { active, over } = event
    setDragId(null)
    if (!over || active.id === over.id) return
    const prev = exercises
    const next = withOrder(reorderExercises(prev, active.id, over.id))
    if (next === prev) return
    setExercises(next)
    try {
      await persistOrder(next, prev)
    } catch (err) {
      alert(`Couldn't save order: ${err.message}`)
    }
  }

  async function renameDay() {
    const input = window.prompt('Rename workout', day.name)
    const newName = input?.trim()
    if (!newName || newName === day.name) return
    await supabase.from('program_days').update({ name: newName }).eq('id', dayId)
    await supabase.from('workout_sessions').update({ day_name: newName })
      .eq('user_id', user.id).eq('day_name', day.name)
    const { data: prog } = await supabase.from('programs').select('id, week_schedule').eq('id', day.program_id).single()
    if (Array.isArray(prog?.week_schedule)) {
      const sched = prog.week_schedule.map((l) => (l === day.name ? newName : l))
      await supabase.from('programs').update({ week_schedule: sched }).eq('id', prog.id)
    }
    setDay((d) => ({ ...d, name: newName }))
  }

  async function saveSheet() {
    const f = sheet.form
    if (!f.name.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: f.name.trim(), sets: Number(f.sets) || 3,
        rep_min: Number(f.rep_min) || 8, rep_max: Number(f.rep_max) || 12,
        current_weight: Number(f.current_weight) || 0, weight_unit: f.weight_unit,
        is_superset: !!f.is_superset,
      }
      if (sheet.mode === 'edit') {
        const { error } = await supabase.from('program_exercises').update(payload).eq('id', sheet.exId)
        if (error) throw error
        const old = exercises.find((e) => e.id === sheet.exId)
        if (old && old.name !== payload.name) {
          await supabase.from('set_logs').update({ exercise_name: payload.name }).eq('program_exercise_id', sheet.exId)
        }
        setExercises((prev) => prev.map((e) => e.id === sheet.exId ? { ...e, ...payload } : e))
      } else {
        const { data: ins, error } = await supabase.from('program_exercises').insert({
          ...payload, program_day_id: dayId, weight_increment: 2.5,
          exercise_order: exercises.length + 1,
        }).select().single()
        if (error) throw error
        setExercises((prev) => withOrder([...prev, ins]))
      }
      setSheet(null)
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function removeExercise() {
    if (!window.confirm(`Remove ${sheet.form.name} from this day? Past logs keep their data.`)) return
    setSaving(true)
    const { error } = await supabase.from('program_exercises').delete().eq('id', sheet.exId)
    setSaving(false)
    if (error) { alert(error.message); return }
    const prev = exercises
    const next = withOrder(prev.filter((e) => e.id !== sheet.exId))
    setExercises(next)
    setSheet(null)
    persistOrder(next, prev).catch(() => {})
  }

  async function startWorkout() {
    setStarting(true)
    const { data: session, error } = await supabase
      .from('workout_sessions')
      .insert({ user_id: user.id, program_day_id: dayId, day_name: day.name })
      .select().single()
    if (error) { alert(error.message); setStarting(false); return }
    localStorage.setItem('activeSessionId', session.id)
    navigate(`/workout/${session.id}`)
  }

  const visibleList = visibleWhileDragging(exercises, dragId)

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', background: 'var(--bg)' }}>
      <div style={{ width: 26, height: 26, borderRadius: '50%', border: '2px solid var(--text)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
    </div>
  )

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100%', display: 'flex', flexDirection: 'column', padding: '20px 18px 0', paddingTop: 'max(20px, env(safe-area-inset-top, 20px))' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <button onClick={() => navigate('/workout-picker')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--text-3)' }}>
          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div style={{ flex: 1 }}>
          <p style={{ fontFamily: F, fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-3)', margin: '0 0 2px' }}>Preview</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontFamily: F, fontSize: '22px', fontWeight: 600, color: 'var(--text)', margin: 0 }}>{day.name}</h2>
            <button onClick={renameDay} aria-label="Rename workout"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: '13px', padding: '2px 4px' }}>✎</button>
          </div>
        </div>
        <span style={{ fontFamily: F, fontSize: '11px', color: 'var(--text-3)' }}>
          {exercises.length} exercise{exercises.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Exercise list */}
      <div style={{ flex: 1, paddingBottom: '120px' }}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => setDragId(e.active.id)}
          onDragCancel={() => setDragId(null)}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={visibleList.map((e) => e.id)} strategy={verticalListSortingStrategy}>
            {visibleList.map((ex, i) => (
              <SortableRow
                key={ex.id}
                ex={ex}
                isFirst={i === 0}
                carrying={ex.id === dragId ? exercises.length - visibleList.length : 0}
                onEdit={() => setSheet({ mode: 'edit', exId: ex.id, form: { ...EMPTY_FORM, ...ex } })}
              />
            ))}
          </SortableContext>
        </DndContext>

        {/* Add buttons */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
          <button onClick={() => setSheet({ mode: 'add', form: { ...EMPTY_FORM } })}
            style={{ flex: 1, background: 'none', border: '1px dashed var(--border-2)', borderRadius: '12px', padding: '12px', fontSize: '11px', color: 'var(--text-2)', cursor: 'pointer', letterSpacing: '0.12em', fontFamily: F }}>
            + EXERCISE
          </button>
          <button onClick={() => setSheet({ mode: 'add', form: { ...EMPTY_FORM, is_superset: true } })}
            style={{ flex: 1, background: 'none', border: '1px dashed rgba(200,168,75,0.4)', borderRadius: '12px', padding: '12px', fontSize: '11px', color: 'var(--gold)', cursor: 'pointer', letterSpacing: '0.12em', fontFamily: F }}>
            + SUPERSET
          </button>
        </div>
        <p style={{ fontSize: '11px', color: 'var(--text-3)', margin: '12px 2px 0', lineHeight: 1.5 }}>
          Hold & drag to reorder · tap an exercise to edit. A superset attaches to the exercise above it and moves with it.
        </p>
      </div>

      {/* Start bar */}
      <div className="sticky bottom-0" style={{ background: 'var(--bg)', borderTop: '1px solid var(--border)', margin: '0 -18px', padding: '14px 18px', paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))' }}>
        <button onClick={startWorkout} disabled={starting || exercises.length === 0}
          style={{ width: '100%', background: 'var(--text)', color: 'var(--bg)', border: 'none', borderRadius: '14px', padding: '16px', fontFamily: F, fontSize: '14px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer', opacity: starting || exercises.length === 0 ? 0.4 : 1 }}>
          {starting ? 'Starting…' : 'Start Workout'}
        </button>
      </div>

      {/* Add / edit sheet */}
      {sheet && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div onClick={() => setSheet(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} />
          <div style={{ position: 'relative', background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '24px 20px', paddingBottom: 'max(32px, env(safe-area-inset-bottom, 32px))', zIndex: 1 }}>
            <p style={{ fontFamily: F, fontSize: '11px', letterSpacing: '0.18em', textTransform: 'uppercase', color: sheet.form.is_superset ? 'var(--gold)' : 'var(--text-3)', marginBottom: '16px' }}>
              {sheet.mode === 'edit' ? 'Edit' : 'Add'} {sheet.form.is_superset ? 'Superset' : 'Exercise'}
            </p>

            <input
              type="text" placeholder="Exercise name" value={sheet.form.name}
              onChange={(e) => setSheet((s) => ({ ...s, form: { ...s.form, name: e.target.value } }))}
              autoFocus={sheet.mode === 'add'}
              style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px 14px', fontSize: '15px', color: 'var(--text)', outline: 'none', marginBottom: '12px', boxSizing: 'border-box', fontFamily: 'system-ui' }}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '12px' }}>
              {[['SETS', 'sets'], ['REP MIN', 'rep_min'], ['REP MAX', 'rep_max']].map(([label, key]) => (
                <div key={key}>
                  <p style={{ fontSize: '10px', color: 'var(--text-3)', letterSpacing: '0.1em', marginBottom: '4px', fontFamily: F }}>{label}</p>
                  <input type="number" value={sheet.form[key]}
                    onChange={(e) => setSheet((s) => ({ ...s, form: { ...s.form, [key]: e.target.value } }))}
                    onFocus={(e) => e.target.select()}
                    style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 8px', fontSize: '15px', color: 'var(--text)', outline: 'none', textAlign: 'center' }}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '8px', marginBottom: '16px', alignItems: 'end' }}>
              <div>
                <p style={{ fontSize: '10px', color: 'var(--text-3)', letterSpacing: '0.1em', marginBottom: '4px', fontFamily: F }}>WEIGHT</p>
                <input type="number" value={sheet.form.current_weight} min="0" step="2.5"
                  onChange={(e) => setSheet((s) => ({ ...s, form: { ...s.form, current_weight: e.target.value } }))}
                  onFocus={(e) => e.target.select()}
                  style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 8px', fontSize: '15px', color: 'var(--text)', outline: 'none', textAlign: 'center', boxSizing: 'border-box' }}
                />
              </div>
              <select value={sheet.form.weight_unit}
                onChange={(e) => setSheet((s) => ({ ...s, form: { ...s.form, weight_unit: e.target.value } }))}
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 8px', fontSize: '15px', color: 'var(--text)', outline: 'none', height: '42px' }}>
                <option value="lbs">lbs</option>
                <option value="kg">kg</option>
              </select>
              <button
                onClick={() => setSheet((s) => ({ ...s, form: { ...s.form, is_superset: !s.form.is_superset } }))}
                style={{
                  height: '42px', padding: '0 14px', borderRadius: '8px', cursor: 'pointer', fontFamily: F, fontSize: '11px', letterSpacing: '0.08em',
                  background: sheet.form.is_superset ? 'rgba(200,168,75,0.15)' : 'var(--surface-2)',
                  color: sheet.form.is_superset ? 'var(--gold)' : 'var(--text-3)',
                  border: `1px solid ${sheet.form.is_superset ? 'rgba(200,168,75,0.4)' : 'var(--border)'}`,
                }}>
                SS
              </button>
            </div>

            <button
              onClick={saveSheet}
              disabled={saving || !sheet.form.name.trim()}
              style={{ width: '100%', background: 'var(--text)', color: 'var(--bg)', border: 'none', borderRadius: '12px', padding: '15px', fontSize: '14px', fontWeight: 600, fontFamily: F, letterSpacing: '0.08em', cursor: 'pointer', opacity: (!sheet.form.name.trim() || saving) ? 0.4 : 1 }}
            >
              {saving ? '…' : sheet.mode === 'edit' ? 'Save' : 'Add'}
            </button>
            {sheet.mode === 'edit' && (
              <button onClick={removeExercise} disabled={saving}
                style={{ width: '100%', marginTop: '10px', background: 'none', border: 'none', color: 'var(--text-3)', fontSize: '12px', fontFamily: F, letterSpacing: '0.1em', cursor: 'pointer', padding: '4px 0 0' }}>
                Remove from this day
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SortableRow({ ex, onEdit, isFirst, carrying }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ex.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.85 : 1,
  }
  const isSS = ex.is_superset && !isFirst
  return (
    <div ref={setNodeRef} style={style}>
      <div
        onClick={onEdit}
        style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          background: 'var(--surface)',
          border: `1px solid ${isSS ? 'rgba(200,168,75,0.3)' : 'var(--border)'}`,
          borderRadius: '12px',
          padding: isSS ? '10px 14px' : '13px 14px',
          marginBottom: '7px',
          marginLeft: isSS ? '22px' : 0,
          cursor: 'pointer', position: 'relative',
        }}
      >
        {isSS && (
          <div style={{ position: 'absolute', left: -12, top: -10, width: 2, height: 'calc(50% + 10px)', background: 'rgba(200,168,75,0.35)', borderRadius: 1 }} />
        )}
        <div {...listeners} {...attributes} onClick={(e) => e.stopPropagation()}
          style={{ touchAction: 'none', cursor: 'grab', padding: '4px 6px 4px 0', color: 'var(--text-3)', flexShrink: 0 }}>
          <svg width="11" height="15" viewBox="0 0 12 16" fill="currentColor">
            <circle cx="3" cy="3" r="1.5" /><circle cx="9" cy="3" r="1.5" />
            <circle cx="3" cy="8" r="1.5" /><circle cx="9" cy="8" r="1.5" />
            <circle cx="3" cy="13" r="1.5" /><circle cx="9" cy="13" r="1.5" />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontFamily: F, fontSize: isSS ? '13px' : '15px', fontWeight: 600, color: isSS ? 'var(--gold-soft)' : 'var(--text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ex.name}
            {ex.is_superset && <span style={{ fontSize: '8px', letterSpacing: '0.12em', color: 'var(--gold)', border: '1px solid rgba(200,168,75,0.3)', borderRadius: '3px', padding: '0 4px', marginLeft: 7, verticalAlign: '2px' }}>SS</span>}
            {carrying > 0 && <span style={{ fontSize: '9px', letterSpacing: '0.1em', color: 'var(--gold)', marginLeft: 7 }}>+{carrying} SS</span>}
          </p>
          <p style={{ fontSize: '11px', color: 'var(--text-3)', margin: '2px 0 0' }}>
            {ex.sets} × {ex.rep_min}–{ex.rep_max} · {ex.current_weight} {ex.weight_unit}
          </p>
        </div>
        <svg width="15" height="15" fill="none" stroke="var(--text-3)" strokeWidth="1.5" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      </div>
    </div>
  )
}
