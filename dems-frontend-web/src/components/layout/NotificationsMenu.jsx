import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle2, Shield, UploadCloud, Eye, X, Check } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { listQuarantine, getOrganizationOverview } from '../../api/admin.js';
import { getPlatformAnalytics } from '../../api/analytics.js';
import { getNotifications, markAllNotificationsAsRead, markNotificationAsRead } from '../../api/notifications.js';
import { getWorkflowCounts } from '../../api/viewAccess.js';
import { useToast } from '../../components/ui/Toast.jsx';
import { subscribeToUploadEvents, subscribeToViewAccessEvents } from '../../api/socket.js';
import { formatRelativeTime } from '../../utils/format.js';

export default function NotificationsMenu() {
  const { role, user } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const navigate = useNavigate();

  const isAdmin = role === 'admin';
  const isOfficer = role === 'officer';
  const isSuperAdmin = role === 'super_admin';

  // Fetch in-app notifications
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: getNotifications,
    enabled: Boolean(user),
    refetchInterval: 30000
  });

  // Fetch unified real database workflow counters
  const workflowCountsQuery = useQuery({
    queryKey: ['workflow-counts'],
    queryFn: getWorkflowCounts,
    enabled: Boolean(user),
    refetchInterval: 15000
  });

  const markAllRead = useMutation({
    mutationFn: markAllNotificationsAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-counts'] });
    }
  });

  const markSingleRead = useMutation({
    mutationFn: markNotificationAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-counts'] });
    }
  });

  // Real-time socket events for both uploads and view requests
  useEffect(() => {
    const unsubUpload = subscribeToUploadEvents(() => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-counts'] });
      queryClient.invalidateQueries({ queryKey: ['org-overview'] });
    });

    const unsubView = subscribeToViewAccessEvents(() => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-counts'] });
      queryClient.invalidateQueries({ queryKey: ['incoming-view-requests'] });
      queryClient.invalidateQueries({ queryKey: ['my-view-requests'] });
    });

    return () => {
      unsubUpload();
      unsubView();
    };
  }, [queryClient]);

  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const counts = workflowCountsQuery.data?.data || {};
  const unreadCount = counts.unreadNotifications ?? (notifications.data?.unreadCount || 0);
  const pendingUploads = counts.pendingUploadApprovals || 0;
  const pendingViewRequests = counts.pendingViewApprovals || 0;

  const totalBadge = unreadCount + pendingUploads + pendingViewRequests;

  const notificationItems = notifications.data?.data || [];

  const handleNotificationClick = async (notif) => {
    setOpen(false);
    if (!notif.read) {
      try {
        await markSingleRead.mutateAsync(notif._id);
      } catch (err) {
        console.warn('Failed to mark read:', err);
      }
    }

    let targetUrl = notif.actionUrl;
    if (notif.type?.startsWith('view_request_')) {
      targetUrl = isSuperAdmin ? '/superadmin/view-requests' : '/admin/view-requests';
    } else if (notif.type?.startsWith('upload_') || notif.metadata?.requestId) {
      targetUrl = isSuperAdmin ? '/superadmin/upload-requests' : '/admin/upload-requests';
    }

    if (targetUrl && targetUrl !== '#') {
      navigate(targetUrl);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((curr) => !curr)}
        className="icon-btn relative"
        aria-label={totalBadge ? `Notifications (${totalBadge})` : 'Notifications'}
        aria-expanded={open}
      >
        <Bell size={16} />
        {totalBadge > 0 ? (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-warn px-1 text-[10px] font-bold text-white ring-2 ring-card">
            {totalBadge > 99 ? '99+' : totalBadge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-11 z-50 w-[360px] animate-slide-up overflow-hidden rounded-card border border-line bg-card shadow-pop">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <p className="text-[13px] font-semibold text-ink">Notifications & Tasks</p>
              <p className="text-[11px] text-ink-faint">Live database activity</p>
            </div>
            {unreadCount > 0 ? (
              <button
                type="button"
                className="text-[11.5px] text-brand hover:underline font-medium"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
              >
                Mark all read
              </button>
            ) : null}
          </div>

          {/* Separate, accurate counts bar */}
          {(isAdmin || isSuperAdmin) && (
            <div className="grid grid-cols-3 divide-x divide-line border-b border-line bg-surface py-2 text-center text-[11.5px]">
              <div className="px-1.5">
                <span className="block text-ink-faint text-[10.5px]">Unread</span>
                <span className={`font-semibold ${unreadCount > 0 ? 'text-brand' : 'text-ink-muted'}`}>
                  {unreadCount}
                </span>
              </div>
              <Link
                to={isSuperAdmin ? '/superadmin/upload-requests' : '/admin/upload-requests'}
                onClick={() => setOpen(false)}
                className="px-1.5 hover:bg-[#e8ebf0] transition rounded"
              >
                <span className="block text-ink-faint text-[10.5px]">Uploads</span>
                <span className={`font-semibold ${pendingUploads > 0 ? 'text-warn' : 'text-ink-muted'}`}>
                  {pendingUploads} pending
                </span>
              </Link>
              <Link
                to={isSuperAdmin ? '/superadmin/view-requests' : '/admin/view-requests'}
                onClick={() => setOpen(false)}
                className="px-1.5 hover:bg-[#e8ebf0] transition rounded"
              >
                <span className="block text-ink-faint text-[10.5px]">View Access</span>
                <span className={`font-semibold ${pendingViewRequests > 0 ? 'text-success' : 'text-ink-muted'}`}>
                  {pendingViewRequests} pending
                </span>
              </Link>
            </div>
          )}

          {/* Quick Pending Banners */}
          {pendingViewRequests > 0 && (isAdmin || isSuperAdmin) && (
            <Link
              to={isSuperAdmin ? '/superadmin/view-requests' : '/admin/view-requests'}
              onClick={() => setOpen(false)}
              className="flex items-center justify-between border-b border-success/20 bg-success-soft px-4 py-2.5 transition hover:bg-success/15"
            >
              <div className="flex items-center gap-2">
                <Eye size={15} className="text-success shrink-0" />
                <span className="text-[12.5px] font-medium text-success">
                  {pendingViewRequests} view access request{pendingViewRequests === 1 ? '' : 's'} awaiting review
                </span>
              </div>
              <span className="text-[11px] font-semibold text-success hover:underline">Review &rarr;</span>
            </Link>
          )}

          {pendingUploads > 0 && (isAdmin || isSuperAdmin) && (
            <Link
              to={isSuperAdmin ? '/superadmin/upload-requests' : '/admin/upload-requests'}
              onClick={() => setOpen(false)}
              className="flex items-center justify-between border-b border-warn/20 bg-warn-soft px-4 py-2.5 transition hover:bg-warn/15"
            >
              <div className="flex items-center gap-2">
                <UploadCloud size={15} className="text-warn shrink-0" />
                <span className="text-[12.5px] font-medium text-warn">
                  {pendingUploads} upload request{pendingUploads === 1 ? '' : 's'} awaiting decision
                </span>
              </div>
              <span className="text-[11px] font-semibold text-warn hover:underline">Review &rarr;</span>
            </Link>
          )}

          {/* Notifications List */}
          <div className="max-h-[380px] overflow-y-auto">
            {notificationItems.length === 0 && totalBadge === 0 ? (
              <div className="flex items-start gap-2.5 px-4 py-6">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />
                <div>
                  <p className="text-[13px] font-medium text-ink">You&apos;re all caught up</p>
                  <p className="mt-0.5 text-[12px] leading-5 text-ink-muted">
                    No pending view requests, uploads, or unread alerts.
                  </p>
                </div>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {notificationItems.map((notif) => {
                  const isView = notif.type?.startsWith('view_request_');
                  return (
                    <li key={notif._id} className="relative group">
                      <button
                        type="button"
                        onClick={() => handleNotificationClick(notif)}
                        className={`w-full text-left flex items-start gap-2.5 px-4 py-3 transition hover:bg-surface cursor-pointer ${
                          !notif.read ? 'bg-brand-soft/40' : ''
                        }`}
                      >
                        <span
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                            !notif.read
                              ? isView
                                ? 'bg-brand ring-2 ring-brand-soft'
                                : 'bg-warn ring-2 ring-warn-soft'
                              : 'bg-ink-faint'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[12.5px] font-semibold text-ink leading-tight">
                            {notif.title}
                          </p>
                          <p className="mt-1 text-[12px] leading-snug text-ink-muted line-clamp-2">
                            {notif.message}
                          </p>
                          <span className="mt-1 block text-[10.5px] text-ink-faint">
                            {formatRelativeTime(notif.createdAt)}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
