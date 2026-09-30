import { lazy, Suspense } from 'react';
import { Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { useApp } from './hooks/useApp';
import { Loading, Empty } from './components/ui';
import { hasDashboard } from '../../shared/account.js';
import { BRAND } from '../../shared/brand.js';

/**
 * Only the landing page and the sign-in form are loaded up front.
 *
 * Everything below used to be a plain import, which meant one bundle containing the collaborative
 * editor, the realtime client, and the admin dashboard — all of it downloaded by a stranger reading
 * the home page, none of it reachable without an account. Split by route, the first visit fetches
 * what it can actually see, and the rest arrives when somebody navigates to it.
 */
import HomePage from './pages/HomePage';
import PublicShell from './components/PublicShell';
import { AuthPage } from './pages/AccountPages';

/**
 * Reloads once when a chunk cannot be fetched.
 *
 * A page that fails to load is almost always a deploy that happened while this tab was open: the
 * running app is asking for filenames from a build the server has since replaced. There is nothing
 * to retry — those files are gone — but a reload fetches the new index.html and with it the new
 * names, so the recovery is simply to start again.
 *
 * Once per tab. If the very next load fails too then something is actually broken, and an error is
 * far more useful than a page that reloads forever.
 */
const RELOAD_KEY = 'remio:chunk-reload';
function recoverFromStaleBuild(error) {
  try {
    if (!sessionStorage.getItem(RELOAD_KEY)) {
      sessionStorage.setItem(RELOAD_KEY, '1');
      window.location.reload();
      // Never settles: the reload takes over before React can render anything from this.
      return new Promise(() => {});
    }
  } catch { /* private mode with no storage: fall through and report the error honestly */ }
  throw error;
}

const page = (load, name = 'default') => lazy(() => load().then(m => ({ default: m[name] })).catch(recoverFromStaleBuild));

const LibraryPage = page(() => import('./pages/LibraryPage'));
const FolderPage = page(() => import('./pages/FolderPage'));
const StudyPage = page(() => import('./pages/StudyPage'));
const FriendsPage = page(() => import('./pages/FriendsPage'));
const PremiumPage = page(() => import('./pages/PremiumPage'));
const DashboardPage = page(() => import('./pages/DashboardPage'));
const PricingPage = page(() => import('./pages/PricingPage'));
const Layout = page(() => import('./components/Layout'));
const RoomPage = page(() => import('./pages/RoomPage'));
const JoinRoomPage = page(() => import('./pages/RoomPage'), 'JoinRoomPage');
const SettingsPage = page(() => import('./pages/AccountPages'), 'SettingsPage');
const ProgressPage = page(() => import('./pages/AccountPages'), 'ProgressPage');
const VerifyEmailPage = page(() => import('./pages/AccountPages'), 'VerifyEmailPage');
const ForgotPasswordPage = page(() => import('./pages/AccountPages'), 'ForgotPasswordPage');
const ResetPasswordPage = page(() => import('./pages/AccountPages'), 'ResetPasswordPage');
const PublicFolderPage = page(() => import('./pages/PublicPages'), 'PublicFolderPage');
const PublicExplorePage = page(() => import('./pages/PublicPages'), 'PublicExplorePage');
const ProfilePage = page(() => import('./pages/PublicPages'), 'ProfilePage');
const ProjectsPage = page(() => import('./pages/ProjectPages'), 'ProjectsPage');
const ProjectPage = page(() => import('./pages/ProjectPages'), 'ProjectPage');
const ContactPage = page(() => import('./pages/LegalPages'), 'ContactPage');
const TermsPage = page(() => import('./pages/LegalPages'), 'TermsPage');
const PrivacyPage = page(() => import('./pages/LegalPages'), 'PrivacyPage');
const RefundsPage = page(() => import('./pages/LegalPages'), 'RefundsPage');
const TeamsPage = page(() => import('./pages/TeamPages'), 'TeamsPage');
const TeamPage = page(() => import('./pages/TeamPages'), 'TeamPage');
const TeamCheckoutPage = page(() => import('./pages/TeamPages'), 'TeamCheckoutPage');
const TeamProgressPage = page(() => import('./pages/TeamPages'), 'TeamProgressPage');
const TeamJoinLinkPage = page(() => import('./pages/TeamPages'), 'TeamJoinLinkPage');
const AuthorizePage = page(() => import('./pages/AuthorizePage'));

/** One boundary around each route tree: a page arriving late shows the same spinner as one loading its data. */
const Chunk = ({ children }) => <Suspense fallback={<Loading/>}>{children}</Suspense>;
export default function App() {
  const { user, loading } = useApp();
  // From the router rather than from `window`, because this component also renders on the server,
  // where there is no window and the location is whatever the request asked for.
  const location = useLocation();
  if (loading) return <div className="boot-screen"><img src="/favicon.svg" alt={BRAND.name}/><Loading/></div>;
  if (!user) return <Chunk><Routes>
    <Route path="/" element={<PublicShell wide><HomePage/></PublicShell>}/>
    <Route path="/login" element={<AuthPage/>}/><Route path="/signup" element={<AuthPage mode="signup"/>}/>
    <Route path="/verify-email" element={<PublicShell><VerifyEmailPage/></PublicShell>}/>
    <Route path="/forgot-password" element={<PublicShell><ForgotPasswordPage/></PublicShell>}/>
    <Route path="/reset-password" element={<PublicShell><ResetPasswordPage/></PublicShell>}/>
    <Route path="/folders/:id" element={<PublicShell><PublicFolderPage/></PublicShell>}/><Route path="/u/:username" element={<PublicShell><ProfilePage/></PublicShell>}/><Route path="/explore" element={<PublicShell><PublicExplorePage/></PublicShell>}/>
    <Route path="/contact" element={<PublicShell><ContactPage/></PublicShell>}/><Route path="/terms" element={<PublicShell><TermsPage/></PublicShell>}/><Route path="/privacy" element={<PublicShell><PrivacyPage/></PublicShell>}/><Route path="/refunds" element={<PublicShell><RefundsPage/></PublicShell>}/><Route path="/pricing" element={<PublicShell wide><PricingPage/></PublicShell>}/>
    <Route path="/teams/join/:code" element={<Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace/>}/>
    <Route path="/rooms/:code" element={<Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace/>}/>
    {/* The only `next` that has to carry a query string: the authorization request lives in it,
        and losing it would send them back to an approval screen with nothing to approve. */}
    <Route path="/oauth/authorize" element={<Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace/>}/>
    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Routes></Chunk>;
  // After signing in, honour a safe same-app `next` path (used by quiz invite links).
  const next = new URLSearchParams(location.search).get('next'); const after = <Navigate to={next && /^\/[^/]/.test(next) ? next : '/'} replace/>;
  // Outside the Layout on purpose: an approval screen is a decision, and the sidebar and its
  // navigation are an invitation to wander off half way through one.
  return <Chunk><Routes><Route path="login" element={after}/><Route path="signup" element={after}/><Route path="oauth/authorize" element={<AuthorizePage/>}/><Route element={<Layout/>}><Route index element={<LibraryPage/>}/><Route path="shared" element={<LibraryPage mode="shared"/>}/><Route path="explore" element={<LibraryPage mode="explore"/>}/><Route path="archive" element={<LibraryPage mode="archive"/>}/><Route path="projects" element={<ProjectsPage/>}/><Route path="projects/:id" element={<ProjectPage/>}/><Route path="friends" element={<FriendsPage/>}/><Route path="teams" element={<TeamsPage/>}/><Route path="teams/join/:code" element={<TeamJoinLinkPage/>}/><Route path="teams/:id" element={<TeamPage/>}/><Route path="teams/:id/checkout" element={<TeamCheckoutPage/>}/><Route path="teams/:id/progress" element={<TeamProgressPage/>}/><Route path="folders/:id" element={<FolderPage/>}/><Route path="folders/:id/study" element={<StudyPage/>}/><Route path="u/:username" element={<ProfilePage/>}/><Route path="settings" element={<SettingsPage/>}/><Route path="verify-email" element={<VerifyEmailPage/>}/><Route path="forgot-password" element={<ForgotPasswordPage/>}/><Route path="reset-password" element={<ResetPasswordPage/>}/><Route path="progress" element={<ProgressPage/>}/><Route path="premium" element={<PremiumPage/>}/>{hasDashboard(user) && <Route path="dashboard" element={<DashboardPage/>}/>}<Route path="rooms" element={<JoinRoomPage/>}/><Route path="rooms/:code" element={<RoomPage/>}/><Route path="contact" element={<ContactPage/>}/><Route path="terms" element={<TermsPage/>}/><Route path="privacy" element={<PrivacyPage/>}/><Route path="refunds" element={<RefundsPage/>}/><Route path="pricing" element={<PricingPage/>}/><Route path="*" element={<Empty title="This page turned over" text="We couldn’t find what you were looking for." action={<Link to="/" className="button primary">Back to library</Link>}/>}/></Route></Routes></Chunk>;
}
