import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useConfig } from "../hooks/useConfig";
import { ErrorBoundary } from "../components/ui/ErrorBoundary";
import { SuspenseFallbackPage } from "../components/ui/SuspenseFallback";
import { DashboardLayout } from "../components/layout/DashboardLayout";

// Lazy-loaded pages — each page is a separate JS chunk
// Suspense here is only for the brief JS chunk download (happens once).
// Data-fetching Suspense boundaries live inside each page component.
const Home = lazy(() =>
  import("../pages/Home").then(m => ({ default: m.Home }))
);
const Login = lazy(() =>
  import("../pages/Login").then(m => ({ default: m.Login }))
);
const Register = lazy(() =>
  import("../pages/Register").then(m => ({ default: m.Register }))
);
const Settings = lazy(() =>
  import("../pages/Settings").then(m => ({ default: m.Settings }))
);
const Transactions = lazy(() =>
  import("../pages/Transactions").then(m => ({ default: m.Transactions }))
);
const Metrics = lazy(() =>
  import("../pages/Metrics").then(m => ({ default: m.Metrics }))
);
const Subscriptions = lazy(() =>
  import("../pages/Subscriptions").then(m => ({ default: m.Subscriptions }))
);
const Assistant = lazy(() =>
  import("../pages/Assistant").then(m => ({ default: m.Assistant }))
);
const NotFound = lazy(() =>
  import("../pages/NotFound").then(m => ({ default: m.NotFound }))
);
const Reports = lazy(() =>
  import("../pages/Reports").then(m => ({ default: m.Reports }))
);
const ReportDetail = lazy(() =>
  import("../pages/ReportDetail").then(m => ({ default: m.ReportDetail }))
);
const AccountBilling = lazy(() =>
  import("../pages/AccountBilling").then(m => ({
    default: m.AccountBilling,
  }))
);
const AuthCallback = lazy(() =>
  import("../pages/AuthCallback").then(m => ({ default: m.AuthCallback }))
);
const ForgotPassword = lazy(() =>
  import("../pages/ForgotPassword").then(m => ({ default: m.ForgotPassword }))
);
const ResetPassword = lazy(() =>
  import("../pages/ResetPassword").then(m => ({ default: m.ResetPassword }))
);
const LandingPage = lazy(() =>
  import("../pages/LandingPage").then(m => ({ default: m.LandingPage }))
);
const PrivacyPolicy = lazy(() =>
  import("../pages/PrivacyPolicy").then(m => ({ default: m.PrivacyPolicy }))
);

// Admin pages
const AdminIndex = lazy(() =>
  import("../pages/admin/AdminIndex").then(m => ({ default: m.AdminIndex }))
);
const AdminUsers = lazy(() =>
  import("../pages/admin/Users").then(m => ({ default: m.Users }))
);
const AdminUserDetail = lazy(() =>
  import("../pages/admin/UserDetail").then(m => ({ default: m.UserDetail }))
);
const AdminSubscriptions = lazy(() =>
  import("../pages/admin/Subscriptions").then(m => ({
    default: m.Subscriptions,
  }))
);
const AdminPayments = lazy(() =>
  import("../pages/admin/Payments").then(m => ({ default: m.Payments }))
);
const AdminSeeds = lazy(() =>
  import("../pages/admin/Seeds").then(m => ({ default: m.Seeds }))
);
const AdminUsageLimits = lazy(() =>
  import("../pages/admin/UsageLimits").then(m => ({ default: m.UsageLimits }))
);

const chunkFallback = <SuspenseFallbackPage />;

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">Loading…</div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">Loading…</div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

/**
 * Gate for `/admin/*` routes. Reads the `user_role` JWT claim injected by
 * `public.custom_access_token_hook`. The role is authoritative — every
 * `payments.admin_*` RPC enforces the same guard server-side, so this
 * wrapper is defense in depth (and gives non-admins a clean redirect
 * instead of a 401 from postgrest). See docs/access-control.md for the
 * full access-control matrix.
 */
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, role } = useAuth();

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">Loading…</div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (role !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

export function AppRoutes() {
  const { data: config } = useConfig();
  const isChatEnabled = config?.chatEnabled !== false;

  return (
    // ErrorBoundary catches any unhandled query errors
    <ErrorBoundary>
      <Routes>
        {/* Public-only routes */}
        <Route
          path="/login"
          element={
            <PublicOnlyRoute>
              <Suspense fallback={chunkFallback}>
                <Login />
              </Suspense>
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/register"
          element={
            <PublicOnlyRoute>
              <Suspense fallback={chunkFallback}>
                <Register />
              </Suspense>
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <PublicOnlyRoute>
              <Suspense fallback={chunkFallback}>
                <ForgotPassword />
              </Suspense>
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/reset-password"
          element={
            <Suspense fallback={chunkFallback}>
              <ResetPassword />
            </Suspense>
          }
        />
        <Route
          path="/auth/callback"
          element={
            <Suspense fallback={chunkFallback}>
              <AuthCallback />
            </Suspense>
          }
        />
        <Route
          path="/"
          element={
            <PublicOnlyRoute>
              <Suspense fallback={chunkFallback}>
                <LandingPage />
              </Suspense>
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/privacy"
          element={
            <Suspense fallback={chunkFallback}>
              <PrivacyPolicy />
            </Suspense>
          }
        />

        {/* Protected routes — DashboardLayout is imported statically so sidebar/header
            are always visible. Each page handles its own data Suspense boundaries. */}
        <Route
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route
            path="/dashboard"
            element={
              <Suspense fallback={chunkFallback}>
                <Home />
              </Suspense>
            }
          />
          <Route
            path="/settings"
            element={
              <Suspense fallback={chunkFallback}>
                <Settings />
              </Suspense>
            }
          />
          <Route
            path="/transactions"
            element={
              <Suspense fallback={chunkFallback}>
                <Transactions />
              </Suspense>
            }
          />
          <Route
            path="/subscriptions"
            element={
              <Suspense fallback={chunkFallback}>
                <Subscriptions />
              </Suspense>
            }
          />
          <Route
            path="/emails"
            element={<Navigate to="/transactions" replace />}
          />
          <Route
            path="/metrics"
            element={
              <Suspense fallback={chunkFallback}>
                <Metrics />
              </Suspense>
            }
          />
          <Route
            path="/assistant"
            element={
              isChatEnabled ? (
                <Suspense fallback={chunkFallback}>
                  <Assistant />
                </Suspense>
              ) : (
                <Navigate to="/dashboard" replace />
              )
            }
          />
          <Route
            path="/assistant/:threadId"
            element={
              isChatEnabled ? (
                <Suspense fallback={chunkFallback}>
                  <Assistant />
                </Suspense>
              ) : (
                <Navigate to="/dashboard" replace />
              )
            }
          />
          <Route
            path="/account/billing"
            element={
              <Suspense fallback={chunkFallback}>
                <AccountBilling />
              </Suspense>
            }
          />
          <Route
            path="/reports"
            element={
              <Suspense fallback={chunkFallback}>
                <Reports />
              </Suspense>
            }
          />
          <Route
            path="/reports/:reportId"
            element={
              <Suspense fallback={chunkFallback}>
                <ReportDetail />
              </Suspense>
            }
          />

          {/* Admin routes — gated by AdminRoute on the JWT user_role claim.
              Sidebar only links here when role==='admin' (see Sidebar.tsx). */}
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <Suspense fallback={chunkFallback}>
                  <AdminIndex />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <AdminRoute>
                <Suspense fallback={chunkFallback}>
                  <AdminUsers />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/users/:userId"
            element={
              <AdminRoute>
                <Suspense fallback={chunkFallback}>
                  <AdminUserDetail />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/subscriptions"
            element={
              <AdminRoute>
                <Suspense fallback={chunkFallback}>
                  <AdminSubscriptions />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/payments"
            element={
              <AdminRoute>
                <Suspense fallback={chunkFallback}>
                  <AdminPayments />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/seeds"
            element={
              <AdminRoute>
                <Suspense fallback={chunkFallback}>
                  <AdminSeeds />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/usage-limits"
            element={
              <AdminRoute>
                <Suspense fallback={chunkFallback}>
                  <AdminUsageLimits />
                </Suspense>
              </AdminRoute>
            }
          />
        </Route>

        <Route
          path="*"
          element={
            <Suspense fallback={chunkFallback}>
              <NotFound />
            </Suspense>
          }
        />
      </Routes>
    </ErrorBoundary>
  );
}
