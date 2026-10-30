import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Eye,
  Shield,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Search,
  Filter,
  RefreshCw,
  Plus,
  ArrowUpRight,
  User,
  Building2,
  Calendar,
  Lock,
  Unlock,
  Ban
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { TableSkeleton } from '../../components/ui/Skeleton.jsx';
import RequestViewAccessModal from '../../components/viewAccess/RequestViewAccessModal.jsx';
import ViewRequestDetailsModal from '../../components/viewAccess/ViewRequestDetailsModal.jsx';
import {
  getIncomingViewRequests,
  getMyViewRequests,
  approveViewRequest,
  rejectViewRequest,
  revokeViewPermission
} from '../../api/viewAccess.js';
import { subscribeToViewAccessEvents } from '../../api/socket.js';
import { formatDate, formatRelativeTime } from '../../utils/format.js';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

export default function AdminViewRequests() {
  const { user } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState('incoming'); // 'incoming' | 'my'
  const [statusFilter, setStatusFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);

  // Modals state
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);

  // Incoming requests query (Super Admin requesting Org Admin's organization)
  const incomingQuery = useQuery({
    queryKey: ['incoming-view-requests', statusFilter, searchTerm, page],
    queryFn: () => getIncomingViewRequests({ status: statusFilter, search: searchTerm, page, limit: 15 }),
    enabled: activeTab === 'incoming',
    refetchInterval: 15000
  });

  // My requests query (Org Admin requesting Super Admin approval)
  const myQuery = useQuery({
    queryKey: ['my-view-requests', statusFilter, searchTerm, page],
    queryFn: () => getMyViewRequests({ status: statusFilter, search: searchTerm, page, limit: 15 }),
    enabled: activeTab === 'my',
    refetchInterval: 15000
  });

  // Real-time socket events
  useEffect(() => {
    const unsub = subscribeToViewAccessEvents((event) => {
      queryClient.invalidateQueries({ queryKey: ['incoming-view-requests'] });
      queryClient.invalidateQueries({ queryKey: ['my-view-requests'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-counts'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });

      if (event.eventName === 'view_access_request_created') {
        push(`New view access request: ${event.requestId}`, { tone: 'brand' });
      } else if (event.eventName === 'view_access_approved') {
        push(`View access approved: ${event.requestId}`, { tone: 'success' });
      } else if (event.eventName === 'view_access_rejected') {
        push(`View access rejected: ${event.requestId}`, { tone: 'warning' });
      } else if (event.eventName === 'view_access_revoked') {
        push(`View access revoked: ${event.requestId}`, { tone: 'neutral' });
      }
    });

    return () => unsub();
  }, [queryClient, push]);

  const approveMutation = useMutation({
    mutationFn: (requestId) => approveViewRequest(requestId),
    onSuccess: (data, reqId) => {
      push(`View access approved for request ${reqId}`, { tone: 'success' });
      queryClient.invalidateQueries({ queryKey: ['incoming-view-requests'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-counts'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err) => push(err.response?.data?.message || 'Approval failed.', { tone: 'error' })
  });

  const currentQuery = activeTab === 'incoming' ? incomingQuery : myQuery;
  const requests = currentQuery.data?.data || [];
  const pagination = currentQuery.data?.pagination || {};
  const total = pagination.totalRecords || requests.length;

  const handleOpenDetails = (req) => {
    setSelectedRequest(req);
    setDetailsModalOpen(true);
  };

  const handleViewEvidence = (req) => {
    if (req.targetType === 'evidence' && req.targetId) {
      navigate(`/admin/evidence/${req.targetId}`);
    } else {
      navigate('/admin/evidence');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Organization Governance"
        title="View Access Approval System"
        subtitle="Review Super Admin view requests and track your own requests to inspect protected evidence."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => currentQuery.refetch()}
              disabled={currentQuery.isFetching}
            >
              <RefreshCw size={14} className={currentQuery.isFetching ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setShowRequestModal(true)}
            >
              <Plus size={15} />
              Request View Access
            </button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex border-b border-line">
        <button
          type="button"
          onClick={() => { setActiveTab('incoming'); setPage(1); }}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-[13px] font-medium transition ${
            activeTab === 'incoming'
              ? 'border-brand text-brand font-semibold'
              : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          <Shield size={16} />
          <span>Incoming Requests</span>
          {(() => {
            const pendingCount = incomingQuery.data?.data?.filter(req => req.status === 'pending').length || 0;
            return pendingCount > 0 ? (
              <span className="badge-warn text-[11px] px-1.5 py-0.2">
                {pendingCount}
              </span>
            ) : null;
          })()}
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('my'); setPage(1); }}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-[13px] font-medium transition ${
            activeTab === 'my'
              ? 'border-brand text-brand font-semibold'
              : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          <Eye size={16} />
          <span>My Requests</span>
          {(() => {
            const pendingCount = myQuery.data?.data?.filter(req => req.status === 'pending').length || 0;
            return pendingCount > 0 ? (
              <span className="badge-brand text-[11px] px-1.5 py-0.2">
                {pendingCount}
              </span>
            ) : null;
          })()}
        </button>
      </div>

      {/* Filters and Search Bar */}
      <div className="section-card flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="relative w-full sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            className="input pl-8"
            placeholder="Search request ID, target, or reason…"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-medium text-ink-muted flex items-center gap-1 mr-1">
            <Filter size={13} /> Status:
          </span>
          {[
            { value: '', label: 'All' },
            { value: 'pending', label: 'Pending' },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Rejected' },
            { value: 'expired', label: 'Expired' },
            { value: 'revoked', label: 'Revoked' }
          ].map((st) => (
            <button
              key={st.value}
              type="button"
              onClick={() => { setStatusFilter(st.value); setPage(1); }}
              className={`rounded-[7px] px-2.5 py-1 text-[12px] transition ${
                statusFilter === st.value
                  ? 'bg-brand text-white font-medium'
                  : 'bg-surface text-ink-muted hover:bg-[#e8ebf0]'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>

      {/* Requests Table */}
      {currentQuery.isLoading ? (
        <TableSkeleton rows={6} columns={7} />
      ) : requests.length === 0 ? (
        <EmptyState
          icon={Shield}
          title={activeTab === 'incoming' ? 'No incoming requests to review' : 'No view requests submitted'}
          description={
            statusFilter
              ? 'No requests match the selected filter. Try clearing filters.'
              : activeTab === 'incoming'
              ? 'No requests from Super Admin require your decision right now.'
              : 'You have not submitted any view access requests. Click "Request View Access" to begin.'
          }
        />
      ) : (
        <div className="section-card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Request ID</th>
                  <th scope="col">{activeTab === 'incoming' ? 'Requester' : 'Target Organization'}</th>
                  <th scope="col">Scope</th>
                  <th scope="col">Target Item</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Duration</th>
                  <th scope="col">Status</th>
                  <th scope="col">Requested</th>
                  <th scope="col" className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((req) => {
                  const isActive = req.status === 'approved' && req.permission?.status === 'active' && new Date(req.permission.expiresAt) > new Date();
                  const isExpired = req.status === 'expired' || (req.permission?.expiresAt && new Date(req.permission.expiresAt) <= new Date());
                  const displayStatus = isExpired && req.status === 'approved' ? 'expired' : req.status;

                  return (
                    <tr key={req._id}>
                      <td>
                        <button
                          type="button"
                          onClick={() => handleOpenDetails(req)}
                          className="font-mono text-[12.5px] font-semibold text-brand hover:underline"
                        >
                          {req.requestId}
                        </button>
                      </td>
                      <td>
                        {activeTab === 'incoming' ? (
                          <div>
                            <p className="text-[13px] font-medium text-ink">
                              {req.requesterId?.profile?.displayName || 'Super Admin'}
                            </p>
                            <p className="text-[11px] text-ink-faint">Platform Super Admin</p>
                          </div>
                        ) : (
                          <div>
                            <p className="text-[13px] font-medium text-ink">
                              {req.organizationId?.name || 'Your Organization'}
                            </p>
                            <p className="text-[11px] text-ink-faint">{req.organizationId?.organizationCode || ''}</p>
                          </div>
                        )}
                      </td>
                      <td>
                        <span className="badge-surface text-[11px] uppercase font-semibold">
                          {req.targetType}
                        </span>
                      </td>
                      <td>
                        <div className="max-w-[200px]">
                          <p className="truncate text-[13px] font-medium text-ink" title={req.targetName || req.targetId}>
                            {req.targetName || req.targetId}
                          </p>
                          <p className="text-[11px] text-ink-faint truncate font-mono">
                            {req.targetId}
                          </p>
                        </div>
                      </td>
                      <td>
                        <p className="max-w-[220px] truncate text-[12.5px] text-ink-muted" title={req.reason}>
                          {req.reason}
                        </p>
                      </td>
                      <td className="whitespace-nowrap text-[12.5px] text-ink">
                        {req.requestedDuration}
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <StatusBadge status={displayStatus} />
                          {isActive && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-1.5 py-0.5 text-[10.5px] font-medium text-success border border-[#c7e9dd]">
                              Active
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-[12px] text-ink-muted" title={formatDate(req.createdAt)}>
                        {formatRelativeTime(req.createdAt)}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenDetails(req)}
                            className="btn-ghost btn-sm"
                            title="View request details"
                          >
                            <Eye size={13} />
                            View Details
                          </button>

                          {activeTab === 'my' && isActive && (
                            <button
                              type="button"
                              onClick={() => handleViewEvidence(req)}
                              className="btn-primary btn-sm"
                            >
                              <Unlock size={13} />
                              View Evidence
                            </button>
                          )}

                          {activeTab === 'incoming' && req.status === 'pending' && (
                            <>
                              <button
                                type="button"
                                onClick={() => approveMutation.mutate(req.requestId)}
                                disabled={approveMutation.isPending}
                                className="btn-primary btn-sm"
                                title="Approve view access"
                              >
                                <CheckCircle2 size={13} />
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenDetails(req)}
                                className="btn-secondary btn-sm text-danger hover:bg-danger-soft"
                                title="Reject view access"
                              >
                                <XCircle size={13} />
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      <RequestViewAccessModal
        open={showRequestModal}
        onClose={() => setShowRequestModal(false)}
        onSuccess={() => {
          setActiveTab('my');
          queryClient.invalidateQueries({ queryKey: ['my-view-requests'] });
        }}
      />

      <ViewRequestDetailsModal
        request={selectedRequest}
        open={detailsModalOpen}
        onClose={() => setDetailsModalOpen(false)}
        canApprove={activeTab === 'incoming' && selectedRequest?.status === 'pending'}
        canRevoke={activeTab === 'incoming' && selectedRequest?.status === 'approved'}
        onActionComplete={() => {
          queryClient.invalidateQueries({ queryKey: ['incoming-view-requests'] });
          queryClient.invalidateQueries({ queryKey: ['my-view-requests'] });
        }}
      />
    </div>
  );
}
