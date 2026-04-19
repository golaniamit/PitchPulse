import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { ThemeProvider } from './context/ThemeContext';
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
import OnboardingTour, { useTour } from './components/OnboardingTour';

const isDev = import.meta.env.DEV;

function AppShell() {
  const { user, loading } = useAuth();
  const { show, openTour, closeTour } = useTour(isDev ? user?.username : null);
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

  return (
    <SocketProvider>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-200">
        {isDev && show && <OnboardingTour onClose={closeTour} username={user?.username} />}
        <Navbar />
        <Routes>
          <Route path="/" element={<Home openTour={isDev ? openTour : undefined} />} />
          <Route path="/contract/:id" element={<Contract />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/feedback" element={<Feedback />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </SocketProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
