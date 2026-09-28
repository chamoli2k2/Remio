import { Routes, Route, Link, Navigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import { useApp } from './hooks/useApp';
import Layout from './components/Layout';
import LibraryPage from './pages/LibraryPage';
import FolderPage from './pages/FolderPage';
import StudyPage from './pages/StudyPage';
import { AuthPage, SettingsPage, ProgressPage, VerifyEmailPage, ForgotPasswordPage, ResetPasswordPage } from './pages/AccountPages';
import { Loading, Empty } from './components/ui';
import { PublicShell, PublicFolderPage, PublicExplorePage, ProfilePage } from './pages/PublicPages';
import RoomPage, { JoinRoomPage } from './pages/RoomPage';
import FriendsPage from './pages/FriendsPage';
import { ProjectsPage, ProjectPage } from './pages/ProjectPages';
import { ContactPage, TermsPage, PrivacyPage, RefundsPage } from './pages/LegalPages';
import PricingPage from './pages/PricingPage';
import PremiumPage from './pages/PremiumPage';
import DashboardPage from './pages/DashboardPage';
import { TeamsPage, TeamPage, TeamCheckoutPage, TeamProgressPage, TeamJoinLinkPage } from './pages/TeamPages';
import { hasDashboard } from '../../shared/account.js';
import { BRAND } from '../../shared/brand.js';
export default function App() {
  const { user, loading } = useApp();
  if (loading) return <div className="boot-screen"><img src="/favicon.svg" alt={BRAND.name}/><Loading/></div>;
  if (!user) return <Routes>
    <Route path="/" element={<PublicShell wide><HomePage/></PublicShell>}/>
    <Route path="/login" element={<AuthPage/>}/><Route path="/signup" element={<AuthPage mode="signup"/>}/>
    <Route path="/verify-email" element={<PublicShell><VerifyEmailPage/></PublicShell>}/>
    <Route path="/forgot-password" element={<PublicShell><ForgotPasswordPage/></PublicShell>}/>
    <Route path="/reset-password" element={<PublicShell><ResetPasswordPage/></PublicShell>}/>
    <Route path="/folders/:id" element={<PublicShell><PublicFolderPage/></PublicShell>}/><Route path="/u/:username" element={<PublicShell><ProfilePage/></PublicShell>}/><Route path="/explore" element={<PublicShell><PublicExplorePage/></PublicShell>}/>
    <Route path="/contact" element={<PublicShell><ContactPage/></PublicShell>}/><Route path="/terms" element={<PublicShell><TermsPage/></PublicShell>}/><Route path="/privacy" element={<PublicShell><PrivacyPage/></PublicShell>}/><Route path="/refunds" element={<PublicShell><RefundsPage/></PublicShell>}/><Route path="/pricing" element={<PublicShell wide><PricingPage/></PublicShell>}/>
    <Route path="/teams/join/:code" element={<Navigate to={`/login?next=${encodeURIComponent(window.location.pathname)}`} replace/>}/>
    <Route path="/rooms/:code" element={<Navigate to={`/login?next=${encodeURIComponent(window.location.pathname)}`} replace/>}/>
    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Routes>;
  // After signing in, honour a safe same-app `next` path (used by quiz invite links).
  const next = new URLSearchParams(window.location.search).get('next'); const after = <Navigate to={next && /^\/[^/]/.test(next) ? next : '/'} replace/>;
  return <Routes><Route path="login" element={after}/><Route path="signup" element={after}/><Route element={<Layout/>}><Route index element={<LibraryPage/>}/><Route path="shared" element={<LibraryPage mode="shared"/>}/><Route path="explore" element={<LibraryPage mode="explore"/>}/><Route path="archive" element={<LibraryPage mode="archive"/>}/><Route path="projects" element={<ProjectsPage/>}/><Route path="projects/:id" element={<ProjectPage/>}/><Route path="friends" element={<FriendsPage/>}/><Route path="teams" element={<TeamsPage/>}/><Route path="teams/join/:code" element={<TeamJoinLinkPage/>}/><Route path="teams/:id" element={<TeamPage/>}/><Route path="teams/:id/checkout" element={<TeamCheckoutPage/>}/><Route path="teams/:id/progress" element={<TeamProgressPage/>}/><Route path="folders/:id" element={<FolderPage/>}/><Route path="folders/:id/study" element={<StudyPage/>}/><Route path="u/:username" element={<ProfilePage/>}/><Route path="settings" element={<SettingsPage/>}/><Route path="verify-email" element={<VerifyEmailPage/>}/><Route path="forgot-password" element={<ForgotPasswordPage/>}/><Route path="reset-password" element={<ResetPasswordPage/>}/><Route path="progress" element={<ProgressPage/>}/><Route path="premium" element={<PremiumPage/>}/>{hasDashboard(user) && <Route path="dashboard" element={<DashboardPage/>}/>}<Route path="rooms" element={<JoinRoomPage/>}/><Route path="rooms/:code" element={<RoomPage/>}/><Route path="contact" element={<ContactPage/>}/><Route path="terms" element={<TermsPage/>}/><Route path="privacy" element={<PrivacyPage/>}/><Route path="refunds" element={<RefundsPage/>}/><Route path="pricing" element={<PricingPage/>}/><Route path="*" element={<Empty title="This page turned over" text="We couldn’t find what you were looking for." action={<Link to="/" className="button primary">Back to library</Link>}/>}/></Route></Routes>;
}
