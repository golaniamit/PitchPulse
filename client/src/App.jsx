import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { ThemeProvider } from './context/ThemeContext';
import { GroupProvider } from './context/GroupContext';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import Home from './pages/Home';
import Contract from './pages/Contract';
import Portfolio from './pages/Portfolio';
import Leaderboard from './pages/Leaderboard';
import Admin from './pages/Admin';
import Feedback from './pages/Feedback';
import Verify from './pages/Verify';
import ResetPassword from './pages/ResetPassword';
import PickUsername from './pages/PickUsername';
import Settings from './pages/Settings';
import TradeHistory from './pages/TradeHistory';
import GroupJoin from './pages/GroupJoin';
import GroupSettings from './pages/GroupSettings';
import OnboardingTour, { useTour } from './components/OnboardingTour';
import ResolutionToast from './components/ResolutionToast';
import GroupNotificationToast from './components/GroupNotificationToast';

function AppShell() {
  const { user, loading } = useAuth();
  const { show, openTour, closeTour } = useTour(user);
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    );
  }

  // These pages must be reachable before login
  if (location.pathname === '/verify') return <Verify />;
  if (location.pathname === '/reset-password') return <ResetPassword />;

  if (!user) return <Login />;

  // Brand-new Google signups have no username yet — block everything else
  // until they pick one.
  if (user.needs_username) return <PickUsername />;

  return (
    <GroupProvider>
      <SocketProvider>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-200">
          {show && <OnboardingTour onClose={closeTour} />}
          <ResolutionToast />
          <GroupNotificationToast />
          <Navbar />
          <Routes>
            <Route path="/" element={<Home openTour={openTour} tourActive={show} />} />
            <Route path="/contract/:id" element={<Contract />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/feedback" element={<Feedback />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/trades" element={<TradeHistory />} />
            <Route path="/join/:code" element={<GroupJoin />} />
            <Route path="/group/settings" element={<GroupSettings />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </div>
      </SocketProvider>
    </GroupProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ThemeProvider>
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
