import { arrayMove } from '@dnd-kit/sortable'
import { supabase } from './supabase'

// ── Exercise ordering + superset grouping ────────────────────────────────────
//
// A superset (is_superset = true) attaches to the nearest non-superset
// exercise above it. Everything here works on the flat, ordered exercise
// array that the pages already hold in state.

/** Supersets that hang off the given exercise (empty if it's a superset itself). */
export function supersetChildren(exs, parentId) {
  const i = exs.findIndex((e) => e.id === parentId)
  if (i < 0 || exs[i].is_superset) return []
  const kids = []
  for (let j = i + 1; j < exs.length && exs[j].is_superset; j++) kids.push(exs[j])
  return kids
}

/** The parent + its supersets, for any exercise id in the group. */
export function groupOf(exs, id) {
  const i = exs.findIndex((e) => e.id === id)
  if (i < 0) return []
  let start = i
  while (start > 0 && exs[start].is_superset) start--
  const group = [exs[start]]
  for (let j = start + 1; j < exs.length && exs[j].is_superset; j++) group.push(exs[j])
  return group
}

/** True if this exercise is the last item of its group (nothing superset-attached below it). */
export function isGroupEnd(exs, idx) {
  return !exs[idx + 1]?.is_superset
}

/**
 * List to render while `activeId` is being dragged: a parent's supersets are
 * hidden so they ride along with it instead of being dropped over.
 */
export function visibleWhileDragging(exs, activeId) {
  if (!activeId) return exs
  const hidden = new Set(supersetChildren(exs, activeId).map((k) => k.id))
  return hidden.size ? exs.filter((e) => !hidden.has(e.id)) : exs
}

/**
 * Reorder after a drop. Dragging a parent carries its supersets; dragging a
 * superset moves it alone and it attaches to whatever ends up above it.
 */
export function reorderExercises(exs, activeId, overId) {
  if (!activeId || !overId || activeId === overId) return exs
  const kids = supersetChildren(exs, activeId)
  const kidIds = new Set(kids.map((k) => k.id))
  const list = kidIds.size ? exs.filter((e) => !kidIds.has(e.id)) : exs
  const from = list.findIndex((e) => e.id === activeId)
  const to = list.findIndex((e) => e.id === overId)
  if (from < 0 || to < 0 || from === to) return exs
  const active = list[from]

  if (active.is_superset) return arrayMove(list, from, to)

  // A plain exercise never lands inside another group: moving down it goes
  // after the target's supersets; moving up it goes above the target's parent.
  const rest = list.filter((e) => e.id !== activeId)
  let at = rest.findIndex((e) => e.id === overId)
  if (from < to) {
    at += 1
    while (rest[at]?.is_superset) at++
  } else {
    while (at > 0 && rest[at]?.is_superset) at--
  }
  rest.splice(at, 0, active, ...kids)
  return rest
}

/** Insert a new exercise right after index `afterIdx` (null/undefined = append). */
export function insertExerciseAfter(exs, afterIdx, newEx) {
  const next = [...exs]
  const at = afterIdx === null || afterIdx === undefined ? next.length : afterIdx + 1
  next.splice(at, 0, newEx)
  return next
}

/** Stamp exercise_order = position (1-based) onto a list. Pure. */
export function withOrder(exs) {
  return exs.map((e, i) => (e.exercise_order === i + 1 ? e : { ...e, exercise_order: i + 1 }))
}

/**
 * Save the current order to Supabase. Only rows whose order actually changed
 * are written. `prev` is the list as it was before the change (to diff against);
 * pass nothing to write every row.
 *
 * NOTE: supabase-js query builders are lazy — nothing is sent until awaited.
 */
export async function persistOrder(next, prev = []) {
  const prevOrder = new Map(prev.map((e) => [e.id, e.exercise_order]))
  const writes = next
    .map((e, i) => ({ id: e.id, order: i + 1 }))
    .filter(({ id, order }) => prevOrder.get(id) !== order)
    .map(({ id, order }) => supabase.from('program_exercises').update({ exercise_order: order }).eq('id', id))
  const results = await Promise.all(writes)
  const failed = results.find((r) => r?.error)
  if (failed) throw failed.error
}
