import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import PublicLayout from './layouts/PublicLayout.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import RequireAuth from './routes/RequireAuth.jsx';
import LandingPage from './pages/public/LandingPage.jsx';
import About from './pages/public/About.jsx';
import Features from './pages/public/Features.jsx';
import WalletLogin from './pages/auth/WalletLogin.jsx';
import EmailVerificationSetup from './pages/auth/EmailVerificationSetup.jsx';
import CitizenDashboard from './pages/citizen/Dashboard.jsx';
import EvidenceVault from './pages/citizen/EvidenceVault.jsx';
import EvidenceDetails from './pages/citizen/EvidenceDetails.jsx';
import Profile from './pages/citizen/Profile.jsx';
import OfficerDashboard from './pages/officer/OfficerDashboard.jsx';
import UploadEvidence from './pages/officer/UploadEvidence.jsx';
import ChainOfCustody from './pages/officer/ChainOfCustody.jsx';
import EvidenceTracking from './pages/officer/EvidenceTracking.jsx';
import AdminDashboard from './pages/admin/AdminDashboard.jsx';
import OfficerApproval from './pages/admin/OfficerApproval.jsx';
import UserManagement from './pages/admin/UserManagement.jsx';
import AuditLogs from './pages/admin/AuditLogs.jsx';
import QuarantineReview from './pages/admin/QuarantineReview.jsx';
import OrgEvidence from './pages/admin/OrgEvidence.jsx';
import OrganizationSettings from './pages/admin/OrganizationSettings.jsx';
import AdminModifications from './pages/admin/AdminModifications.jsx';
import Groups from './pages/admin/Groups.jsx';
import PendingReviews from './pages/officer/PendingReviews.jsx';
import EmployeeModifications from './pages/officer/EmployeeModifications.jsx';
import SuperAdminDashboard from './pages/superadmin/SuperAdminDashboard.jsx';
import GlobalUsers from './pages/superadmin/GlobalUsers.jsx';
import GlobalEvidence from './pages/superadmin/GlobalEvidence.jsx';
import BlockchainMonitoring from './pages/superadmin/BlockchainMonitoring.jsx';
import StorageMonitoring from './pages/superadmin/StorageMonitoring.jsx';
import RetentionManagement from './pages/superadmin/RetentionManagement.jsx';
import SuperAdminPendingUploads from './pages/superadmin/PendingUploads.jsx';
import AdminInvitation from './pages/invitation/AdminInvitation.jsx';
import EmployeeInvitation from './pages/invitation/EmployeeInvitation.jsx';
import PendingUploads from './pages/admin/PendingUploads.jsx';
import UploadRequestDetails from './pages/admin/UploadRequestDetails.jsx';
import AdminViewRequests from './pages/admin/AdminViewRequests.jsx';
import SuperAdminViewRequests from './pages/superadmin/SuperAdminViewRequests.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/public" element={<LandingPage />} />
        <Route path="/public/about" element={<About />} />
        <Route path="/public/features" element={<Features />} />
        <Route path="/auth/wallet-login" element={<WalletLogin />} />
        <Route path="/auth" element={<Navigate to="/auth/wallet-login" replace />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route path="/auth/email-verification" element={<EmailVerificationSetup />} />
      </Route>

      <Route element={<RequireAuth roles={['citizen']} />}>
        <Route element={<AppLayout section="citizen" />}>
          <Route path="/citizen" element={<CitizenDashboard />} />
          <Route path="/citizen/dashboard" element={<CitizenDashboard />} />
          <Route path="/citizen/upload-evidence" element={<UploadEvidence />} />
          <Route path="/citizen/evidence-vault" element={<EvidenceVault />} />
          <Route path="/citizen/evidence/:evidenceId" element={<EvidenceDetails />} />
          <Route path="/citizen/profile" element={<Profile />} />
        </Route>
      </Route>

      <Route element={<RequireAuth roles={['officer']} />}>
        <Route element={<AppLayout section="officer" />}>
          <Route path="/officer" element={<OfficerDashboard />} />
          <Route path="/officer/dashboard" element={<OfficerDashboard />} />
          <Route path="/officer/upload-evidence" element={<UploadEvidence />} />
          <Route path="/officer/pending-reviews" element={<PendingReviews />} />
          <Route path="/officer/modifications" element={<EmployeeModifications />} />
          <Route path="/officer/chain-of-custody" element={<ChainOfCustody />} />
          <Route path="/officer/evidence-tracking" element={<EvidenceTracking />} />
        </Route>
      </Route>

      <Route element={<RequireAuth roles={['admin']} />}>
        <Route element={<AppLayout section="admin" />}>
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/officer-approval" element={<OfficerApproval />} />
          <Route path="/admin/users" element={<UserManagement />} />
          <Route path="/admin/groups" element={<Groups />} />
          <Route path="/admin/evidence" element={<OrgEvidence />} />
          <Route path="/admin/evidence/:evidenceId" element={<EvidenceDetails />} />
          <Route path="/admin/quarantine" element={<QuarantineReview />} />
          <Route path="/admin/view-requests" element={<AdminViewRequests />} />
          <Route path="/admin/upload-requests" element={<PendingUploads />} />
          <Route path="/admin/upload-requests/:requestId" element={<UploadRequestDetails />} />
          <Route path="/admin/pending-uploads" element={<PendingUploads />} />
          <Route path="/admin/pending-uploads/:requestId" element={<UploadRequestDetails />} />
          <Route path="/admin/modifications" element={<AdminModifications />} />
          <Route path="/admin/organization" element={<OrganizationSettings />} />
          <Route path="/admin/audit-logs" element={<AuditLogs />} />
        </Route>
      </Route>

      <Route element={<RequireAuth roles={['super_admin']} />}>
        <Route element={<AppLayout section="superadmin" />}>
          <Route path="/superadmin" element={<SuperAdminDashboard />} />
          <Route path="/superadmin/dashboard" element={<SuperAdminDashboard />} />
          <Route path="/superadmin/users" element={<GlobalUsers />} />
          <Route path="/superadmin/evidence" element={<GlobalEvidence />} />
          <Route path="/superadmin/evidence/:evidenceId" element={<EvidenceDetails />} />
          <Route path="/superadmin/blockchain" element={<BlockchainMonitoring />} />
          <Route path="/superadmin/storage" element={<StorageMonitoring />} />
          <Route path="/superadmin/retention" element={<RetentionManagement />} />
          <Route path="/superadmin/upload-requests" element={<SuperAdminPendingUploads />} />
          <Route path="/superadmin/view-requests" element={<SuperAdminViewRequests />} />
          <Route path="/superadmin/upload-requests/:requestId" element={<UploadRequestDetails />} />
          <Route path="/superadmin/pending-uploads" element={<SuperAdminPendingUploads />} />
          <Route path="/superadmin/pending-uploads/:requestId" element={<UploadRequestDetails />} />
        </Route>
      </Route>

      {/* Public invitation routes */}
      <Route path="/invitation/admin/:token" element={<AdminInvitation />} />
      <Route path="/invitation/employee/:token" element={<EmployeeInvitation />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
