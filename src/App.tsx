import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuthStore } from '@/stores/authStore';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermissions } from '@/hooks/usePermissions';
import { EmptyState } from '@/components/shared/EmptyState';
import { ApiStatusBanner } from '@/components/shared/ApiStatusBanner';
import { AppToaster } from '@/components/shared/AppToaster';
import { Shield } from 'lucide-react';
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const POSPage = lazy(() => import('@/pages/POSPage'));
const ProductsPage = lazy(() => import('@/pages/ProductsPage'));
const InventoryPage = lazy(() => import('@/pages/InventoryPage'));
const PurchasesPage = lazy(() => import('@/pages/PurchasesPage'));
const FinancialsPage = lazy(() => import('@/pages/FinancialsPage'));
const EmployeesPage = lazy(() => import('@/pages/EmployeesPage'));
const ReportsPage = lazy(() => import('@/pages/ReportsPage'));
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const BillingPage = lazy(() => import('@/pages/BillingPage'));
const CustomersPage = lazy(() => import('@/pages/CustomersPage'));
const SalesPage = lazy(() => import('@/pages/SalesPage'));
const ManualPaymentsPage = lazy(() => import('@/pages/ManualPaymentsPage'));
const PlatformLoginPage = lazy(() => import('@/pages/platform/PlatformLoginPage'));
const PlatformBillingPage = lazy(() => import('@/pages/platform/PlatformBillingPage'));
const SetupWizardPage = lazy(() => import('@/pages/SetupWizardPage'));
const RegisterBusinessPage = lazy(() => import('@/pages/RegisterBusinessPage'));
const AcceptInvitePage = lazy(() => import('@/pages/AcceptInvitePage'));
const RequiredPasswordChangePage = lazy(() => import('@/pages/RequiredPasswordChangePage'));
const DiagnosticsPage = lazy(() => import('@/pages/DiagnosticsPage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function PageLoader() {
  return (
    <div className="p-6 space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full rounded-sm" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, accessToken, authReady, user } = useAuthStore();
  if (!authReady) {
    return <PageLoader />;
  }
  if (!isAuthenticated || !accessToken) {
    return <Navigate to="/login" replace />;
  }
  if (user?.mustChangePassword) {
    return <Navigate to="/account/change-password" replace />;
  }
  return <>{children}</>;
}

function PasswordChangeRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, accessToken, authReady, user } = useAuthStore();
  if (!authReady) {
    return <PageLoader />;
  }
  if (!isAuthenticated || !accessToken) {
    return <Navigate to="/login" replace />;
  }
  if (!user?.mustChangePassword) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function PermissionRoute({ permission, children }: { permission: string; children: React.ReactNode }) {
  const { can } = usePermissions();
  const allowed = can(permission) || (permission === 'billing.view' && can('subscription.view'));
  if (!allowed) {
    return (
      <div className="p-6">
        <EmptyState icon={Shield} title="Access Denied" description="You don't have permission to access this module." />
      </div>
    );
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/setup" element={<SetupWizardPage />} />
        <Route path="/register" element={<RegisterBusinessPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route
          path="/account/change-password"
          element={
            <PasswordChangeRoute>
              <RequiredPasswordChangePage />
            </PasswordChangeRoute>
          }
        />
        <Route path="/platform/login" element={<PlatformLoginPage />} />
        <Route path="/platform/billing" element={<PlatformBillingPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<PermissionRoute permission="dashboard.view"><DashboardPage /></PermissionRoute>} />
          <Route path="pos" element={<PermissionRoute permission="pos.access"><POSPage /></PermissionRoute>} />
          <Route path="products" element={<PermissionRoute permission="products.view"><ProductsPage /></PermissionRoute>} />
          <Route path="inventory" element={<PermissionRoute permission="inventory.view"><InventoryPage /></PermissionRoute>} />
          <Route path="customers" element={<PermissionRoute permission="customers.view"><CustomersPage /></PermissionRoute>} />
          <Route path="sales" element={<PermissionRoute permission="sales.view"><SalesPage /></PermissionRoute>} />
          <Route path="purchases" element={<PermissionRoute permission="purchases.view"><PurchasesPage /></PermissionRoute>} />
          <Route path="financials" element={<PermissionRoute permission="financials.view"><FinancialsPage /></PermissionRoute>} />
          <Route path="payments/manual" element={<PermissionRoute permission="reports.financial"><ManualPaymentsPage /></PermissionRoute>} />
          <Route path="employees" element={<PermissionRoute permission="staff.view"><EmployeesPage /></PermissionRoute>} />
          <Route path="reports" element={<PermissionRoute permission="reports.view"><ReportsPage /></PermissionRoute>} />
          <Route path="notifications" element={<PermissionRoute permission="notifications.view"><NotificationsPage /></PermissionRoute>} />
          <Route path="settings" element={<PermissionRoute permission="settings.view"><SettingsPage /></PermissionRoute>} />
          <Route path="diagnostics" element={<PermissionRoute permission="settings.view"><DiagnosticsPage /></PermissionRoute>} />
          <Route path="billing" element={<PermissionRoute permission="billing.view"><BillingPage /></PermissionRoute>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <ApiStatusBanner />
          <AppToaster />
          <AppRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
