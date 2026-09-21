# E1 Move — Project Log

> Master record of every session, decision, and build. Updated at end of every session.

---

## Session 1 — 2026-07-20

### What was built

**Full app scaffolded from scratch** — React + Vite + Tailwind + Supabase + Vercel.

#### Project structure
- `package.json` — React 18, React Router v6, Recharts, Supabase JS client
- `vite.config.js`, `tailwind.config.js`, `postcss.config.js`
- `index.html` — PWA meta tags, no-zoom viewport, theme color, "E1 Move" title
- `.env.example` — documents required env vars

#### Database (Supabase)
- `supabase/schema.sql` — full schema with RLS policies and indexes
- Tables: `programs`, `program_days`, `program_exercises`, `workout_sessions`, `set_logs`
- Row Level Security: every table locked to `auth.uid()` — users only see their own data
- Indexes on all foreign keys and `started_at DESC` for history queries

#### Core library
- `src/lib/supabase.js` — Supabase client init from env vars
- `src/lib/progression.js` — **Double progression logic**:
  - `checkProgression()` — after a session, checks if all sets hit `rep_max`; if yes, returns list of exercises to increment
  - `progressionTip()` — human-readable tip shown in program builder
  - `repStatusClass()` — returns color class (white/yellow/red) based on reps vs range
- `src/context/AuthContext.jsx` — user session, signIn, signUp, signOut

#### Pages built
| Page | File | Description |
|------|------|-------------|
| Auth | `src/pages/Auth.jsx` | Login / signup, Supabase auth |
| Dashboard | `src/pages/Dashboard.jsx` | Today tab — picks workout day, shows "up next", last session |
| Programs | `src/pages/Programs.jsx` | List programs, activate/delete |
| Program Builder | `src/pages/ProgramBuilder.jsx` | Create/edit programs — days, exercises, rep ranges, weight increments |
| Active Workout | `src/pages/ActiveWorkout.jsx` | Live logger — log sets, auto-fill weight, toggle complete, finish + progression check |
| History | `src/pages/History.jsx` | Past sessions, expandable set-by-set breakdown |
| Exercise Progress | `src/pages/ExerciseProgress.jsx` | Per-exercise weight-over-time chart (Recharts), stats row |

#### Components
- `src/components/Layout.jsx` — shell with bottom nav (Today / Programs / History)
- `src/components/Avatar.jsx` — E1 monogram avatar (placeholder until custom illustration)

#### Routing (`src/App.jsx`)
- Protected routes via `<RequireAuth>` wrapper
- Active Workout (`/workout/:sessionId`) is full-screen, no bottom nav
- Auth redirects handled

### Program seeded via SQL
Full "E1 Workout Program #1" inserted directly into Supabase for user `1b138130-4f7f-4f58-8b6f-95e754b2e275`:
- Day 1: Legs Heavy (4 exercises)
- Day 2: Upper Push (4 exercises)
- Day 3: Run
- Day 4: Upper Pull (5 exercises)
- Day 5: Lower 2 (4 exercises)
- Day 6: Run
- Day 7: Recovery

### Deployment
- GitHub: `e1world/E1-Workout`
- Vercel: auto-deploys on push to `main`
- Supabase: project created, schema applied, auth configured
- Supabase Site URL set to Vercel production URL (fixes post-login redirect)
- Production URL: `e1-workout.vercel.app` (exact URL TBC)
- Added to iPhone home screen as PWA

### Design decisions
- **Double progression** chosen for hypertrophy focus: hit rep_max on all sets → weight auto-increases by `weight_increment` on next session
- Rep color coding during workout: off-white = at max, yellow = in range, red = below min
- **B&W / off-white palette** — `#141414` bg, `#f0ece4` text, no color accents
- No emojis anywhere in the UI
- `user-scalable=no` in viewport — feels like a native app

### Known issues / to-dos
- [ ] Avatar: placeholder E1 monogram — replace with custom line-art illustration when ready (prompt for Midjourney/Firefly ready)
- [ ] Active Workout: no rest timer between sets
- [ ] No body weight / bodyweight exercise support (weight = 0 stays 0)
- [ ] No notes field exposed in the workout logger UI
- [ ] Programs page: Edit route uses `:id` param but ProgramBuilder loads via edit mode — verify edit flow end-to-end
- [ ] Progression celebration screen uses "🎉" emoji — remove to match no-emoji rule
- [ ] Consider adding RPE (Rate of Perceived Exertion) field per set

---

## Session 2 — 2026-07-21

### What was built

**Full visual redesign — dark minimal aesthetic, new pages, swipeable workout cards.**

#### Typography
- Oxanium (Google Fonts, wght@300;400;600) added to `index.html` — used for all headings, labels, and codes throughout the app
- All UI text switches between Oxanium (brand/structural) and `system-ui` (data/inputs)

#### Splash screen (Auth.jsx)
- Replaced plain login form with a full-screen splash: line-art male avatar illustration (`public/splash.png`) fills top 62vh, fade gradient into login form below
- Multiple iterations on sun placement and figure crop — final: sun circle (`#8b1a1a`, `mixBlendMode: screen`) top-right corner, figure cropped at waist
- Splash animation on app open: fade in → hold → fade out → main routes (later removed, see Session 3)
- `App.jsx` splash screen fades in/out on every cold open

#### Dashboard redesign (`src/pages/Dashboard.jsx`)
- Replaced tab-based layout with full-screen home: avatar illustration top 44vh, three module cards below filling remaining screen with `justifyContent: space-evenly`
- Cards: Active Program, Progress, Create Program — each navigates to respective page
- Avatar source: `profile?.avatar_gender === 'f' ? '/splash_f.png' : '/splash.png'`
- Sun accent: absolutely positioned dark-red circle top-right, `mixBlendMode: screen`
- `height: 100dvh`, safe area padding, `marginTop: 20px` on image container
- Shows `profile?.code || 'E1'` as large heading

#### New pages
| Page | File | Description |
|------|------|-------------|
| WorkoutPicker | `src/pages/WorkoutPicker.jsx` | Day selection extracted from old Dashboard — shows all program days, "up next" suggestion, starts session on tap |
| Progress | `src/pages/Progress.jsx` | Stats row (total/month/week), progress photos placeholder (wired to `alert`), full session history with collapsible set-by-set view |

#### Layout simplification
- Bottom nav bar removed entirely from `src/components/Layout.jsx`
- History merged into Progress page — no standalone History tab
- Layout is now just `<Outlet>` wrapper with overflow-y scroll
- Back arrows added to WorkoutPicker (`→ /`), Progress (`→ /`), ProgramBuilder (`→ -1`)

#### ProgramBuilder restyle (`src/pages/ProgramBuilder.jsx`)
- Full dark theme applied — replaced Tailwind gray-800/700 classes with CSS variable inline styles
- Save button: `background: var(--text), color: var(--bg)` (off-white on black)
- After save: navigates to `/` not `/programs`

#### Active Workout — swipeable exercise cards (`src/pages/ActiveWorkout.jsx`)
- `ExerciseCard` extracted as sub-component
- Each card is a horizontal scroll container with two snap panels:
  - Panel 1 (left): history — shows last 3 sessions' sets for that exercise
  - Panel 2 (right): live logging — default view on mount
- CSS scroll snap: `scrollSnapType: x mandatory`, both panels `flex: 0 0 100%` + `minWidth: 100%`
- `useEffect` sets `scrollLeft = scrollWidth / 2` on mount to default to live panel
- History loaded at workout start: 2 queries (last 3 sessions for the day + all their set_logs filtered to current exercise IDs), organized into `{ [exId]: [{date, sets}] }`
- "← history" hint shown when history exists; left dot lit = history view
- Scroll indicator dots below each card

#### Safe area fixes
- `paddingTop: 'max(20px, env(safe-area-inset-top, 20px))'` applied to WorkoutPicker, ProgramBuilder, Progress
- `paddingBottom: env(safe-area-inset-bottom, 24px)` on Dashboard content area
- `100dvh` used throughout for dynamic viewport height

#### ProfileContext (`src/context/ProfileContext.jsx`)
- New React context providing `profile`, `profileLoading`, `updateProfile` (upsert), `loadProfile`
- Fetches from `user_profiles` table on auth user change
- `ProfileProvider` wraps `AppRoutes` in `App.jsx` (inside `AuthContext`)

#### Female avatar
- `public/splash_f.png` — female line-art illustration uploaded to GitHub
- Dashboard reads `profile?.avatar_gender` to switch between `splash.png` and `splash_f.png`
- Female avatar mirrored with `transform: scaleX(-1)` in CSS (no image processing needed)
- Sun accent moves to top-left (`left: calc(-24vw)`) for female, top-right for male

### Design decisions
- Scroll snap panels require `flex: 0 0 100%` + `minWidth: 100%` — `width: 100%` does NOT constrain flex children in a horizontal row
- History data loaded in 2 queries (not N+1 per exercise) for performance
- `100dvh` instead of `100vh` — accounts for dynamic browser chrome on mobile

---

## Session 3 — 2026-07-22

### What was built

**Onboarding flow, auth redesign, bug fixes, PWA icon.**

#### user_profiles table (`sql/03_user_profiles.sql`)
- New table: `user_profiles` — `user_id`, `display_name`, `code`, `avatar_gender`, `goal`, `experience`, `onboarding_completed`, `created_at`
- RLS: users manage only their own row
- Goal constraint updated to: `('muscle_strength', 'endurance', 'general')` — previously had `('strength', 'hypertrophy', 'endurance', 'general')` which caused onboarding loop
- Run in Supabase SQL editor

#### Onboarding flow (`src/pages/Onboarding.jsx`)
Full multi-step onboarding shown to new users before entering the app:

| Step | Screen | Notes |
|------|--------|-------|
| 1 | Name | Text input, live-generates personal code (first initial + "1": Eli → E1, Brittney → B1) |
| 2 | Avatar | Male / Female image cards — tapping immediately advances |
| 3 | Goal | 3 options: Build muscle & strength / Endurance / General fitness |
| 4 | Experience | Beginner / Some experience / Veteran |
| 5 | Program | Filtered program bank based on goal + experience |
| 6 | Done | Avatar image, code large, program summary, "Let's go" saves everything |

- `makeCode(name)`: `name.trim()[0].toUpperCase() + '1'`
- Progress bar across all steps (except Done)
- "Sign out" escape hatch in top-right of every step
- On finish: upserts `user_profiles` with `onboarding_completed: true`, creates selected program in Supabase with all days/exercises

#### Program bank (in `Onboarding.jsx`)
4 pre-built programs with full exercise specs:
- **Full Body 3×/week** — beginner/general — tags: `[beginner, general, strength, hypertrophy]`
- **Upper / Lower 4×/week** — beginner-intermediate/hypertrophy — tags: `[beginner, intermediate, hypertrophy, general]`
- **Push Pull Legs 6×/week** — intermediate-advanced/hypertrophy — tags: `[intermediate, advanced, hypertrophy]`
- **Strength 4×/week** — intermediate-advanced/strength — tags: `[intermediate, advanced, strength]`

`filterPrograms(goal, experience)` maps goal categories to tag sets and filters accordingly.

#### Onboarding gate in App.jsx
- `AppRoutes` sub-component reads both `useAuth` and `useProfile`
- If `user && !profile?.onboarding_completed` → renders `<Onboarding onComplete={() => window.location.reload()} />`
- Loading spinner shown while auth + profile load

#### Auth redesign (`src/pages/Auth.jsx`)
- Removed splash avatar illustration from login screen
- Landing screen: large red sun circle centered + "Move" heading + two buttons: "Create account" (primary) / "Sign in" (outline)
- Tapping either transitions to the relevant email/password form with a Back button
- No more toggle — clear separation of new vs returning user path

#### Splash screen removed
- `SplashScreen` component and fade-in/out animation removed from `App.jsx`
- App goes straight to routes on open — home screen already provides the visual identity

#### Dashboard updates
- Sign out button added top-right next to code/heading
- `isFemale` flag drives both avatar `scaleX(-1)` flip and sun position (left vs right)

#### Branding cleanup
- Removed all "E1 Movement" labels from onboarding avatar step
- "We'll generate your E1 code from it" → "Your first initial becomes your personal code"
- "YOUR CODE" label → "YOUR ID"
- Auth page title changed from "E1 Move" to "Move"; tagline unchanged
- `<title>` in `index.html` changed from "E1 Move" to "Move"

#### PWA app icon
- `public/icon-180.png`, `public/icon-192.png`, `public/icon-512.png` — generated programmatically
- `public/manifest.json` — PWA manifest: name "Move", `display: standalone`, black theme/bg, icon references
- `index.html` updated: `<link rel="apple-touch-icon-precomposed">`, `<link rel="manifest">`, favicon updated
- Multiple icon design iterations tested on device — final design: large centered red circle on near-black background
- Note: iOS applies its own depth/shadow to PWA web clip icons; native App Store apps render differently

### Bugs fixed
| Bug | Root cause | Fix |
|-----|-----------|-----|
| Onboarding infinite loop | `goal` DB constraint rejected `'muscle_strength'` → upsert failed → `onboarding_completed` never set | Updated SQL constraint + user manually updated via Supabase SQL editor |
| Wrong program on home screen | Onboarding's `finish()` partially ran before crashing, creating a pre-built program marked `is_active: true` | Swapped `is_active` flags via SQL |
| No way to exit onboarding if stuck | No logout button | Added "Sign out" link to all onboarding steps |
| Female avatar mirrored wrong direction | `FLIP_LEFT_RIGHT` vs user expectation | Switched to CSS `scaleX(-1)` — no image processing needed |
| Git lock file conflicts | Bash sandbox and Mac Terminal running git concurrently on shared mount | User runs `rm -f .git/index.lock .git/HEAD.lock` before Terminal pushes |

### Known issues / to-dos
- [ ] Progress photos: Supabase Storage upload not yet wired (placeholder `alert`)
- [ ] Female avatar image style doesn't fully match male (different lighting/style from separate AI generation)
- [ ] Program bank is minimal — needs more program variety as user base grows
- [ ] No rest timer between sets in Active Workout
- [ ] No bodyweight exercise support (weight = 0 never increments)
- [ ] Onboarding goal constraint was `('strength', 'hypertrophy', 'endurance', 'general')` in original SQL — needs to match `('muscle_strength', 'endurance', 'general')` for new signups
- [ ] PWA icon has iOS-applied depth effects (unavoidable for web clips; fix = App Store native app)
- [ ] `public/splash_f_processed.png` and `public/splash_f_v2.png` are contrast-test artifacts — can be deleted

---

## Sessions 4–? — 2026-07-25 → 2026-09-03 (NOT LOGGED — backfill needed)

The log stops at Session 3 but the code moved on. From the source as of 2026-09-03 the following exists and has no log entry (dates from file mtimes, not commits — run `git log` to fill in properly):

- **DayPreview page** (`src/pages/DayPreview.jsx`, route `/day/:dayId`) — per-day exercise list with drag-to-reorder (dnd-kit), add/edit/remove exercise sheet, rename day, Start Workout
- **Supersets** — `program_exercises.is_superset` boolean (column exists in Supabase; **no migration file in `sql/`** — add one). Rendered indented + gold connector, "attaches to the exercise above"
- **Active Workout additions** — rest timer (presets, ±15s, beep + vibrate), ab warm-up picker (`src/lib/abBank.js`), insert exercise/superset between cards, in-card edit of name / sets / rep range, per-set weights carried from last session, "add weight" indicator, backdated (retro-log) sessions, session-history panel
- **Week strip / schedule** — `programs.week_schedule` jsonb (`sql/04_week_schedule.sql`), WorkoutPicker rewritten around it
- **Nudge** — `src/pages/Nudge.jsx`, `src/lib/push.js`, `sql/05_nudge_push.sql`, edge function `supabase/functions/send-nudges`
- **Goals** — `src/lib/goals.js`; Progress page expanded
- Design tokens now include `--gold` / `--gold-soft` (progression + supersets only)

---

## Session — 2026-09-21

### Bugs fixed

| Bug | Root cause | Fix |
|-----|-----------|-----|
| Reordering an exercise mid-workout flipped the card to its History panel | React moves the card's DOM node on reorder; browsers reset a moved scroll container to `scrollLeft = 0`, which was the History panel (Live was on the right, set via a mount-only `scrollLeft` hack) | Panels swapped: **Live is now first (scrollLeft 0), swipe left for history.** No mount hack needed; reorders and remounts always land on Live |
| Reordering never persisted (DayPreview *and* Active Workout) | `reordered.forEach(ex => supabase.from(...).update(...))` without `await` — supabase-js builders are lazy and only send when awaited/`.then`-ed, so **no reorder has ever been saved** | `persistOrder(next, prev)` in `src/lib/exerciseOrder.js` — awaits `Promise.all` of updates, only writes rows whose order changed, alerts on failure |
| Supersets all ended up at the bottom of a workout | Every insert used `exercise_order = exercises.length + 1` regardless of where "+ ss" was tapped, and (see above) drag fixes were never saved | Insert stamps the real position, then the whole list is re-numbered and persisted |
| Dragging a parent exercise left its supersets behind | Flat sort | A dragged parent **carries its supersets** (they're hidden during the drag, shown as "+N SS" on the card, re-attached on drop). A dragged superset moves alone and attaches to whatever is above it. A plain exercise can't be dropped into the middle of another group — it snaps after the target's supersets (moving down) or above the target's parent (moving up) |

### Roadmap view (Active Workout)
- Only the **current group** (first exercise with an unfinished set + its supersets) is expanded. Every other exercise collapses to a one-line row: name · `sets × reps · weight`, or the logged result (`135 lbs × 10 · 10 · 9 ✓`) once done, or `2/3 done` mid-way
- Tap any row/heading to expand or collapse it manually; finishing an exercise's last set hands it back to auto-collapse so the next one opens
- "+ ex / + ss" insert row now only appears under the open group (plus one at the end of the day) instead of between every card
- Set rows tightened: 36px inputs (32px in supersets), 34px check button, less padding; scroll dots only when history exists
- Exercise query now orders by `exercise_order, id` so ties are stable

### Files
- `src/lib/exerciseOrder.js` — new: `supersetChildren`, `groupOf`, `isGroupEnd`, `visibleWhileDragging`, `reorderExercises`, `insertExerciseAfter`, `withOrder`, `persistOrder`
- `src/pages/ActiveWorkout.jsx` — panels swapped, collapsed rows, drag/insert/persist rewired, `DragHandle` / `SSBadge` / `SupersetConnector` / `CollapsedExerciseRow` components
- `src/pages/DayPreview.jsx` — same drag/persist rewiring
- `src/index.css` — `.set-grid` check column `auto`, `.chk-btn` 34px

### Notes
- No SQL this session. `is_superset` still needs a migration file for the record: `alter table program_exercises add column if not exists is_superset boolean not null default false;`
- Session was run from Claude (cloud) linked to the Mac. The repo lives in iCloud Documents; several source files were cloud-only and had to be downloaded to read them. Git could not be read from the sandbox — commits/pushes done from Terminal.
- Direction change to remember: **history is now to the right** (swipe left), hint reads "hist →"

### Known issues / to-dos
- [ ] Backfill Sessions 4+ in this log from `git log`
- [ ] `sql/06_supersets.sql` for `is_superset`
- [ ] Manual expand/collapse state is per-session (not persisted to localStorage)

---

## End-of-session prompt (copy-paste this every session)

```
Commit all uncommitted changes with an accurate message describing what changed. Push to origin/main. Then run git log --oneline for the full commit history. Cross-reference every commit against docs/PROJECT_LOG.md — identify anything built or changed in the code that is missing or incomplete in the log. Update PROJECT_LOG.md to fill in any gaps across all sessions and all time. Also update docs/E1-Move-Tech-Stack.md and any other briefing docs if anything in them is stale or incomplete. Don't rewrite entries that are already accurate — only add or correct what's missing. Be thorough, this is the master record for the whole project. Commit and push the updated docs when done.
```
