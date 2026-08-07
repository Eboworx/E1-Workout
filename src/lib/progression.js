/**
 * Double Progression Logic
 * ─────────────────────────
 * Rule: If ALL completed sets for an exercise hit >= rep_max,
 *       increment current_weight by weight_increment next session.
 *
 * Returns an array of { exerciseId, newWeight } for exercises ready to progress.
 */

/**
 * @param {Array} completedSets  - set_logs rows for this session (completed=true)
 * @param {Array} exercises      - program_exercises for the day
 * @returns {Array<{exerciseId: string, newWeight: number, oldWeight: number}>}
 */
export function checkProgression(completedSets, exercises) {
  const progressions = []

  for (const exercise of exercises) {
    const exerciseSets = completedSets.filter(
      (s) => s.program_exercise_id === exercise.id && s.completed
    )

    // Need at least the target number of sets
    if (exerciseSets.length < exercise.sets) continue

    // Every completed set must hit or exceed rep_max
    const allHitMax = exerciseSets.every((s) => s.actual_reps >= exercise.rep_max)

    if (allHitMax) {
      const increment = parseFloat(exercise.weight_increment)
      progressions.push({
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        oldWeight: parseFloat(exercise.current_weight),
        newWeight: parseFloat(exercise.current_weight) + increment,
        increment,
        unit: exercise.weight_unit,
      })
    }
  }

  return progressions
}

/**
 * Returns a human-readable progression tip for the UI.
 */
export function progressionTip(repMin, repMax, increment, unit) {
  return `Hit ${repMax} reps on every set → weight increases by ${increment}${unit} next session`
}

/**
 * Given a set's reps vs target, return a readiness color class.
 */
export function repStatusClass(actual, repMin, repMax) {
  if (actual == null) return 'text-gray-400'
  if (actual >= repMax) return 'text-green-400'
  if (actual >= repMin) return 'text-yellow-400'
  return 'text-red-400'
}
