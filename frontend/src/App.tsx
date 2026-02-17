import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import Dashboard from "./pages/Dashboard";
import EventDetail from "./pages/EventDetail";
import SetPage from "./pages/SetPage";
import AdminReports from "./pages/AdminReports";
import AdminReportDetail from "./pages/AdminReportDetail";
import AdminLiveSet from "./pages/AdminLiveSet";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const AppRoutes = () => (
  <AuthProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/oauth/callback" element={<AuthCallback />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/events/:eventId"
          element={
            <ProtectedRoute>
              <EventDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sets/:setId"
          element={
            <ProtectedRoute>
              <SetPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/reports"
          element={
            <ProtectedRoute requireAdmin>
              <AdminReports />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/reports/:reportId"
          element={
            <ProtectedRoute requireAdmin>
              <AdminReportDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/sets/:setId/live"
          element={
            <ProtectedRoute requireAdmin>
              <AdminLiveSet />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </TooltipProvider>
  </AuthProvider>
);

const App = () => (
  <BrowserRouter basename={import.meta.env.BASE_URL}>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AppRoutes />
      </ThemeProvider>
    </QueryClientProvider>
  </BrowserRouter>
);

export default App;
