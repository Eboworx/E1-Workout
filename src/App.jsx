import { useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { ProfileProvider, useProfile } from './context/ProfileContext'
import Layout from './components/Layout'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import Programs from './pages/Programs'
import ProgramBuilder from './pages/ProgramBuilder'
import ActiveWorkout from './pages/ActiveWorkout'
import History from './pages/History'
import ExerciseProgress from './pages/ExerciseProgress'
import WorkoutPicker from './pages/WorkoutPicker'
import Progress from './pages/Progress'
import Onboarding from './pages/Onboarding'
import Nudge from './pages/Nudge'
import DayPreview from './pages/DayPreview'

function SplashScreen({ opacity }) {
  return (
    <div style={{ background: '#000', height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden', opacity, transition: 'opacity 0.5s ease', position: 'relative' }}>
      {/* Sun — absolutely positioned in top-right, stays above the figure */}
      <div style={{
        position: 'absolute',
        width: '72vw',
        height: '72vw',
        borderRadius: '50%',
        background: '#8b1a1a',
        top: 'calc(-36vw)',
        right: 'calc(-36vw)',
        zIndex: 10,
      }} />
      {/* Spacer pushes figure down from top edge */}
      <div style={{ height: '10vh', background: '#000', flexShrink: 0 }} />
      {/* Image area */}
      <div style={{ height: '65vh', flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
        <img
          src="/splash.png"
          alt=""
          style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center', display: 'block' }}
        />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '120px', background: 'linear-gradient(to bottom, transparent, #0d0d0d)', pointerEvents: 'none', zIndex: 3 }} />
      </div>
      {/* Text area */}
      <div style={{ flex: 1, padding: '12px 28px 48px', background: '#0d0d0d', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
        <h1 style={{ fontFamily: "'Oxanium', sans-serif", fontWeight: 300, fontSize: '52px', color: '#f0ece4', letterSpacing: '0.04em', margin: '0 0 2px', lineHeight: 1 }}>E1</h1>
        <p style={{ fontFamily: "'Oxanium', sans-serif", fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#525248', margin: 0 }}>Movement</p>
      </div>
    </div>
  )
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: 'var(--bg)' }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--text)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
    </div>
  )
  return user ? children : <Navigate to="/auth" replace />
}

export default function App() {
  return (
    <ProfileProvider>
      <AppRoutes />
    </ProfileProvider>
  )
}

function AppRoutes() {
  const { user, loading } = useAuth()
  const { profile, profileLoading } = useProfile()

  if (loading || (user && profileLoading)) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: 'var(--bg)' }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--text)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
    </div>
  )

  // Show onboarding if logged in but not completed
  if (user && !profile?.onboarding_completed) {
    return <Onboarding onComplete={() => window.location.reload()} />
  }

  return (
    <Routes>
      <Route path="/auth" element={user ? <Navigate to="/" replace /> : <Auth />} />

      <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="programs" element={<Programs />} />
        <Route path="programs/new" element={<ProgramBuilder />} />
        <Route path="programs/:id/edit" element={<ProgramBuilder />} />
        <Route path="workout-picker" element={<WorkoutPicker />} />
        <Route path="day/:dayId" element={<DayPreview />} />
        <Route path="progress" element={<Progress />} />
        <Route path="nudge" element={<Nudge />} />
        <Route path="history" element={<History />} />
        <Route path="exercise/:exerciseId" element={<ExerciseProgress />} />
      </Route>

      <Route path="/workout/:sessionId" element={<RequireAuth><ActiveWorkout /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
