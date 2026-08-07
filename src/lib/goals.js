/**
 * Goal metrics
 * ────────────
 * Consistency: week-level, swap-friendly. A week's score = completed
 * sessions / planned workouts (Recover days excluded from the plan).
 * Doing Push on Wednesday instead of Tuesday still counts.
 *
 * Strength: double progression. An exercise is "up" if its latest
 * session added weight, or added reps at the same weight, vs the best
 * of its previous 3 sessions (best-of window smooths one bad day).
 */

export function mondayOf(date) {
  const d = new Date(date)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  d.setHours(0, 0, 0, 0)
  return d
}

export function plannedPerWeek(schedule) {
  if (!Array.isArray(schedule) || schedule.length !== 7) return 6
  return schedule.filter((s) => s && !s.toLowerCase().startsWith('rec')).length
}

// sessions: [{ completed_at }] → 8 entries, oldest → current week
export function weekScores(sessions, planned, weeks = 8) {
  const thisMon = mondayOf(new Date())
  const out = []
  for (let w = weeks - 1; w >= 0; w--) {
    const start = new Date(thisMon)
    start.setDate(start.getDate() - 7 * w)
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    const count = sessions.filter((s) => {
      const c = new Date(s.completed_at)
      return c >= start && c < end
    }).length
    out.push({ start, count, score: planned > 0 ? Math.min(count / planned, 1) : 0, current: w === 0 })
  }
  return out
}

// Consecutive perfect weeks, counting back from the last full week
// (current week joins the streak early if it's already perfect)
export function perfectStreak(scores) {
  let streak = 0
  const current = scores[scores.length - 1]
  if (current?.score >= 1) streak++
  for (let i = scores.length - 2; i >= 0; i--) {
    if (scores[i].score >= 1) streak++
    else break
  }
  return streak
}

// exercises: [{ id, name }], sessions: [{ id, completed_at }] (any order),
// setLogs: [{ program_exercise_id, session_id, weight, actual_reps }]
export function strengthTrends(exercises, sessions, setLogs) {
  const ordered = [...sessions].sort((a, b) => new Date(a.completed_at) - new Date(b.completed_at))
  const orderIdx = {}
  ordered.forEach((s, i) => { orderIdx[s.id] = i })

  const list = []
  let ups = 0
  let total = 0

  for (const ex of exercises) {
    const bySession = {}
    for (const l of setLogs) {
      if (l.program_exercise_id !== ex.id || l.weight == null) continue
      if (orderIdx[l.session_id] === undefined) continue
      ;(bySession[l.session_id] ||= []).push(l)
    }

    // Best set per session: heaviest weight, most reps at that weight
    const bests = Object.entries(bySession)
      .map(([id, ls]) => {
        const weight = Math.max(...ls.map((l) => parseFloat(l.weight)))
        const reps = Math.max(...ls.filter((l) => parseFloat(l.weight) === weight).map((l) => l.actual_reps || 0))
        return { idx: orderIdx[id], weight, reps }
      })
      .sort((a, b) => a.idx - b.idx)

    if (bests.length < 2) {
      list.push({ name: ex.name, trend: null })
      continue
    }

    const latest = bests[bests.length - 1]
    const prev = bests.slice(-4, -1).reduce((best, c) =>
      c.weight > best.weight || (c.weight === best.weight && c.reps > best.reps) ? c : best
    )

    let trend
    if (latest.weight > prev.weight) trend = 'up'
    else if (latest.weight === prev.weight && latest.reps > prev.reps) trend = 'up'
    else if (latest.weight === prev.weight && latest.reps === prev.reps) trend = 'flat'
    else trend = 'down'

    total++
    if (trend === 'up') ups++
    list.push({ name: ex.name, trend, latest, prev })
  }

  return { ups, total, list }
}
