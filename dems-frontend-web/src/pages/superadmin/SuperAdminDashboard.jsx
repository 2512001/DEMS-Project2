import React, { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Building2,
  Check,
  Clock,
  Globe,
  Mail,
  MapPin,
  Phone,
  Plus,
  Shield,
  ShieldCheck,
  UserPlus,
  Users,
  X,
  FileText,
  HardDrive,
  Link as LinkIcon,
  Eye,
  ArrowRight
} from 'lucide-react';

import {
  listOrganizations,
  createOrganization,
  assignOrganizationAdmin,
  getOrganizationDetails,
  getOrganizationAdmins,
  updateOrganizationStatus
} from '../../api/admin.js';
import { getPlatformAnalytics } from '../../api/analytics.js';
import { getWorkflowCounts } from '../../api/viewAccess.js';
import { subscribeToViewAccessEvents } from '../../api/socket.js';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Modal from '../../components/ui/Modal.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { StatCardSkeleton, TableSkeleton } from '../../components/ui/Skeleton.jsx';
import { formatDate, formatRelativeTime } from '../../utils/format.js';

const ORG_TYPES = [
  ['other', 'Other'],
  ['law_enforcement', 'Law enforcement'],
  ['corporate', 'Corporate'],
  ['government', 'Government'],
  ['legal', 'Legal'],
  ['healthcare', 'Healthcare'],
  ['education', 'Education']
];

function CreateOrganizationModal({ open, onClose, mutation }) {
  const [form, setForm] = useState({
    name: '',
    organizationType: 'other',
    description: '',
    officialEmail: '',
    officialPhone: '',
    website: '',
    street: '',
    city: '',
    state: '',
    country: '',
    postalCode: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    contactDesignation: ''
  });

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = (event) => {
    event.preventDefault();
    mutation.mutate(
      {
        name: form.name,
        organizationType: form.organizationType,
        description: form.description,
        officialEmail: form.officialEmail,
        officialPhone: form.officialPhone,
        website: form.website,
        address: {
          street: form.street,
          city: form.city,
          state: form.state,
          country: form.country,
          postalCode: form.postalCode
        },
        primaryContact: {
          name: form.contactName,
          email: form.contactEmail,
          phone: form.contactPhone,
          designation: form.contactDesignation
        }
      },
      { onSuccess: onClose }
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create organization"
      description="Organizations group employees, files, and policy settings."
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="create-org-form" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create organization'}
          </button>
        </>
      }
    >
      <form id="create-org-form" onSubmit={submit} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="label">Organization name</span>
            <input className="input" value={form.name} onChange={set('name')} placeholder="Acme Corporation" required />
          </label>
          <label className="block">
            <span className="label">Type</span>
            <select className="select" value={form.organizationType} onChange={set('organizationType')}>
              {ORG_TYPES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="label">Description</span>
          <textarea className="textarea min-h-[72px]" value={form.description} onChange={set('description')} placeholder="What this organization uses DEMS for" />
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="label">Official email</span>
            <input className="input" type="email" value={form.officialEmail} onChange={set('officialEmail')} placeholder="org@example.com" />
          </label>
          <label className="block">
            <span className="label">Official phone</span>
            <input className="input" value={form.officialPhone} onChange={set('officialPhone')} placeholder="+1 555 000 0000" />
          </label>
          <label className="block">
            <span className="label">Website</span>
            <input className="input" value={form.website} onChange={set('website')} placeholder="https://example.com" />
          </label>
        </div>

        <div className="border-t border-line pt-4">
          <p className="eyebrow mb-3">Address</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="label">Street address</span>
              <input className="input" value={form.street} onChange={set('street')} placeholder="123 Main Street" />
            </label>
            <label className="block">
              <span className="label">City</span>
              <input className="input" value={form.city} onChange={set('city')} />
            </label>
            <label className="block">
              <span className="label">State / Province</span>
              <input className="input" value={form.state} onChange={set('state')} />
            </label>
            <label className="block">
              <span className="label">Country</span>
              <input className="input" value={form.country} onChange={set('country')} />
            </label>
            <label className="block">
              <span className="label">Postal code</span>
              <input className="input" value={form.postalCode} onChange={set('postalCode')} />
            </label>
          </div>
        </div>

        <div className="border-t border-line pt-4">
          <p className="eyebrow mb-3">Primary contact</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="label">Name</span>
              <input className="input" value={form.contactName} onChange={set('contactName')} />
            </label>
            <label className="block">
              <span className="label">Email</span>
              <input className="input" type="email" value={form.contactEmail} onChange={set('contactEmail')} />
            </label>
            <label className="block">
              <span className="label">Phone</span>
              <input className="input" value={form.contactPhone} onChange={set('contactPhone')} />
            </label>
            <label className="block">
              <span className="label">Designation</span>
              <input className="input" value={form.contactDesignation} onChange={set('contactDesignation')} />
            </label>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function InviteAdminModal({ open, onClose, mutation, organizations }) {
  const [organizationId, setOrganizationId] = useState('');
  const [invitedEmail, setInvitedEmail] = useState('');
  const [invitedName, setInvitedName] = useState('');

  const submit = (event) => {
    event.preventDefault();
    mutation.mutate(
      { organizationId, invitedEmail, invitedName },
      {
        onSuccess: () => {
          setOrganizationId('');
          setInvitedEmail('');
          setInvitedName('');
          onClose();
        }
      }
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite organization administrator"
      description="The recipient receives an email with a signed invitation link."
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="invite-admin-form" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Sending…' : 'Send invitation'}
          </button>
        </>
      }
    >
      <form id="invite-admin-form" onSubmit={submit} className="grid gap-4">
        <label className="block">
          <span className="label">Organization</span>
          <select className="select" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} required>
            <option value="">Select organization</option>
            {(organizations || []).map((org) => (
              <option key={org._id} value={org._id}>
                {org.name} · {org.organizationCode}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Administrator email</span>
          <input className="input" type="email" value={invitedEmail} onChange={(event) => setInvitedEmail(event.target.value)} placeholder="admin@example.com" required />
        </label>
        <label className="block">
          <span className="label">Administrator name</span>
          <input className="input" value={invitedName} onChange={(event) => setInvitedName(event.target.value)} placeholder="Jane Doe" required />
        </label>
        <div className="alert-info">
          <Mail size={15} className="mt-0.5 shrink-0" />
          <span>Email delivery requires SMTP configuration on the backend. If it is not configured, the invitation is still created and can be shared manually.</span>
        </div>
      </form>
    </Modal>
  );
}

function OrganizationDetailsModal({ organizationId, onClose }) {
  const details = useQuery({
    queryKey: ['organization', organizationId],
    queryFn: () => getOrganizationDetails(organizationId),
    enabled: Boolean(organizationId)
  });
  const admins = useQuery({
    queryKey: ['organization-admins', organizationId],
    queryFn: () => getOrganizationAdmins(organizationId),
    enabled: Boolean(organizationId)
  });

  const org = details.data;

  return (
    <Modal open={Boolean(organizationId)} onClose={onClose} title="Organization details" size="lg">
      {details.isLoading ? (
        <div className="space-y-3">
          <span className="skeleton h-4 w-40" />
          <span className="skeleton h-3 w-full" />
          <span className="skeleton h-3 w-2/3" />
        </div>
      ) : !org ? (
        <div className="alert-danger">Failed to load organization details.</div>
      ) : (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[18px] font-semibold text-ink">{org.name}</h3>
              <p className="mt-1 text-[13px] text-ink-muted">{org.description || 'No description provided.'}</p>
            </div>
            <StatusBadge status={org.status} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="detail-label">Organization code</p>
              <p className="detail-value font-mono text-brand">{org.organizationCode}</p>
            </div>
            <div>
              <p className="detail-label">Type</p>
              <p className="detail-value capitalize">{String(org.organizationType || 'other').replaceAll('_', ' ')}</p>
            </div>
            <div>
              <p className="detail-label">Created</p>
              <p className="detail-value">{formatDate(org.createdAt)}</p>
            </div>
          </div>

          <div className="grid gap-2 text-[13px] text-ink-muted">
            {org.officialEmail ? (
              <span className="flex items-center gap-2"><Mail size={14} className="text-ink-faint" />{org.officialEmail}</span>
            ) : null}
            {org.officialPhone ? (
              <span className="flex items-center gap-2"><Phone size={14} className="text-ink-faint" />{org.officialPhone}</span>
            ) : null}
            {org.website ? (
              <span className="flex items-center gap-2">
                <Globe size={14} className="text-ink-faint" />
                <a href={org.website} target="_blank" rel="noopener noreferrer" className="link">{org.website}</a>
              </span>
            ) : null}
            {org.address?.city ? (
              <span className="flex items-center gap-2">
                <MapPin size={14} className="text-ink-faint" />
                {[org.address.street, org.address.city, org.address.state, org.address.country].filter(Boolean).join(', ')}
              </span>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['Administrators', org.stats?.adminCount ?? 0],
              ['Employees', org.stats?.employeeCount ?? 0],
              ['Files', org.stats?.evidenceCount ?? 0]
            ].map(([label, value]) => (
              <div key={label} className="rounded-[10px] border border-line bg-[#FBFCFD] p-3">
                <p className="text-[19px] font-semibold text-ink">{value}</p>
                <p className="text-[12px] text-ink-muted">{label}</p>
              </div>
            ))}
          </div>

          <div className="border-t border-line pt-4">
            <p className="eyebrow mb-3">Assigned administrators</p>
            {admins.isLoading ? (
              <span className="skeleton h-3 w-48" />
            ) : admins.data?.data?.length ? (
              <ul className="divide-y divide-line rounded-[10px] border border-line">
                {admins.data.data.map((admin) => (
                  <li key={admin._id} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-brand-soft text-[11px] font-semibold text-brand">
                      {(admin.profile?.displayName || admin.walletAddress || 'A').slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-ink">{admin.profile?.displayName || 'Unnamed admin'}</p>
                      <p className="truncate text-[11.5px] text-ink-faint">{admin.profile?.email || admin.walletAddress}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-muted">No administrators assigned yet.</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function SuperAdminDashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [activeTab, setActiveTab] = useState('overview');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState(null);

  const organizations = useQuery({
    queryKey: ['organizations'],
    queryFn: listOrganizations,
    enabled: user?.role === 'super_admin'
  });

  const platformAnalytics = useQuery({
    queryKey: ['platform-analytics'],
    queryFn: getPlatformAnalytics,
    enabled: user?.role === 'super_admin',
    refetchInterval: 60000
  });

  const workflowCounts = useQuery({
    queryKey: ['workflow-counts'],
    queryFn: getWorkflowCounts,
    enabled: user?.role === 'super_admin',
    refetchInterval: 15000
  });

  useEffect(() => {
    const unsubView = subscribeToViewAccessEvents((event) => {
      queryClient.invalidateQueries({ queryKey: ['workflow-counts'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      if (event.eventName === 'view_access_request_created') {
        push(`Organization Admin requested view access: ${event.requestId || ''}`, { tone: 'brand' });
      } else if (event.eventName === 'view_access_approved') {
        push(`View access approved: ${event.requestId || ''}`, { tone: 'success' });
      }
    });
    return () => unsubView();
  }, [queryClient, push]);

  const createOrg = useMutation({
    mutationFn: createOrganization,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
    }
  });

  const inviteAdmin = useMutation({
    mutationFn: assignOrganizationAdmin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
    }
  });

  const updateOrgStatus = useMutation({
    mutationFn: ({ organizationId, status }) => updateOrganizationStatus(organizationId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
    }
  });

  if (user?.role !== 'super_admin') {
    return (
      <div className="section-card">
        <p className="text-[13px] text-ink-muted">Super Admin access is required to view this page.</p>
      </div>
    );
  }

  const overview = platformAnalytics.data?.overview;
  const orgs = organizations.data?.data || [];
  const activeOrgs = orgs.filter((org) => org.status === 'active');
  const securityEvents = platformAnalytics.data?.recentSecurityEvents || [];
  const pendingViewCount = workflowCounts.data?.data?.pendingViewApprovals || 0;

  const tabs = [
    { value: 'overview', label: 'Overview', icon: BarChart3 },
    { value: 'organizations', label: 'Organizations', icon: Building2, count: orgs.length },
    { value: 'users', label: 'Users', icon: Users },
    { value: 'evidence', label: 'Evidence', icon: FileText },
    { value: 'blockchain', label: 'Blockchain', icon: LinkIcon },
    { value: 'storage', label: 'Storage', icon: HardDrive },
    { value: 'administrators', label: 'Administrators', icon: Users },
    { value: 'security', label: 'Security', icon: Shield }
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Platform administration"
        title="Platform overview"
        subtitle="Manage organizations, administrators, and platform-wide security."
        actions={
          <>
            <Link to="/superadmin/view-requests" className="btn-secondary">
              <Eye size={15} />
              View Access Requests
              {pendingViewCount > 0 && (
                <span className="ml-1 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {pendingViewCount}
                </span>
              )}
            </Link>
            <button type="button" className="btn-secondary" onClick={() => setShowInviteForm(true)}>
              <Mail size={15} />
              Invite admin
            </button>
            <button type="button" className="btn-primary" onClick={() => setShowCreateForm(true)}>
              <Plus size={15} />
              Create organization
            </button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {platformAnalytics.isLoading ? (
          Array.from({ length: 5 }).map((_, index) => <StatCardSkeleton key={index} />)
        ) : (
          <>
            <StatCard
              icon={Building2}
              label="Organizations"
              value={overview?.totalOrganizations ?? 0}
              detail={`${overview?.activeOrganizations ?? 0} active · ${overview?.suspendedOrganizations ?? 0} suspended`}
              tone="brand"
            />
            <StatCard
              icon={Users}
              label="Users"
              value={overview?.totalUsers ?? 0}
              detail={`${overview?.citizens ?? 0} users · ${overview?.officers ?? 0} employees · ${overview?.admins ?? 0} admins`}
              tone="neutral"
            />
            <StatCard
              icon={ShieldCheck}
              label="Files"
              value={overview?.totalEvidence ?? 0}
              detail={`${overview?.blockchainVerifiedEvidence ?? 0} with blockchain proofs`}
              tone="success"
            />
            <StatCard
              icon={AlertTriangle}
              label="Needs attention"
              value={(overview?.quarantinedEvidence ?? 0) + (overview?.pendingInvitations ?? 0)}
              detail={`${overview?.quarantinedEvidence ?? 0} quarantined · ${overview?.pendingInvitations ?? 0} pending invitations`}
              tone={(overview?.quarantinedEvidence ?? 0) + (overview?.pendingInvitations ?? 0) > 0 ? 'warn' : 'neutral'}
            />
            <Link to="/superadmin/view-requests" className="block transition hover:opacity-90">
              <StatCard
                icon={Eye}
                label="View Access Requests"
                value={pendingViewCount}
                detail={pendingViewCount > 0 ? `${pendingViewCount} awaiting review` : 'All requests processed'}
                tone={pendingViewCount > 0 ? 'brand' : 'neutral'}
              />
            </Link>
          </>
        )}
      </div>

      {/* Alert Banner for Pending View Access Requests */}
      {pendingViewCount > 0 ? (
        <div className="flex items-center justify-between rounded-[9px] border border-brand/30 bg-brand-soft px-4 py-3">
          <div className="flex items-center gap-2.5 text-[13px] font-medium text-brand">
            <Eye size={17} />
            <span>You have <strong>{pendingViewCount}</strong> Organization Admin view access request(s) awaiting your decision.</span>
          </div>
          <Link to="/superadmin/view-requests" className="btn-primary btn-sm">
            Review View Requests
            <ArrowRight size={13} />
          </Link>
        </div>
      ) : null}

      <Tabs tabs={tabs} value={activeTab} onChange={setActiveTab} />

      {activeTab === 'overview' ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <section className="panel overflow-hidden">
            <div className="card-header">
              <div>
                <h2 className="section-title">Recent security events</h2>
                <p className="section-subtitle">Failures, quarantines, and rejections across the platform</p>
              </div>
            </div>
            {platformAnalytics.isLoading ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 4 }).map((_, index) => <span key={index} className="skeleton h-3 w-full" />)}
              </div>
            ) : securityEvents.length === 0 ? (
              <div className="p-5">
                <EmptyState compact icon={ShieldCheck} title="No security events" description="Nothing concerning has been recorded recently." />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {securityEvents.map((event, index) => (
                  <li key={event._id || index} className="flex items-start gap-3 px-5 py-3.5">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium capitalize text-ink">
                        {String(event.action || 'event').replaceAll('_', ' ')}
                      </p>
                      <p className="mt-0.5 truncate text-[12px] text-ink-faint">
                        {event.actorWallet ? `${event.actorWallet.slice(0, 8)}…${event.actorWallet.slice(-6)}` : 'System'}
                        {event.reason ? ` · ${event.reason}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11.5px] text-ink-faint">{formatRelativeTime(event.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="section-card">
            <h2 className="section-title">Platform health</h2>
            <p className="section-subtitle">Snapshot of verification coverage</p>
            <ul className="mt-4 divide-y divide-line">
              {[
                ['Integrity verified', overview?.integrityVerified ?? 0, 'success'],
                ['Integrity failures', overview?.integrityFailures ?? 0, 'danger'],
                ['Quarantined files', overview?.quarantinedEvidence ?? 0, 'warn'],
                ['Accepted invitations', overview?.acceptedInvitations ?? 0, 'brand'],
                ['Pending invitations', overview?.pendingInvitations ?? 0, 'neutral'],
                ['Expired invitations', overview?.expiredInvitations ?? 0, 'neutral']
              ].map(([label, value, tone]) => (
                <li key={label} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-[13px] text-ink-muted">{label}</span>
                  <span
                    className={`text-[13px] font-semibold ${
                      tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-ink'
                    }`}
                  >
                    {value}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {activeTab === 'organizations' ? (
        <section className="panel overflow-hidden">
          <div className="card-header">
            <div>
              <h2 className="section-title">Organizations</h2>
              <p className="section-subtitle">{activeOrgs.length} active of {orgs.length} total</p>
            </div>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setShowCreateForm(true)}>
              <Plus size={13} />
              New
            </button>
          </div>
          {organizations.isLoading ? (
            <div className="p-4"><TableSkeleton rows={4} columns={5} /></div>
          ) : orgs.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={Building2}
                title="No organizations yet"
                description="Create the first organization to start assigning administrators and employees."
                action={
                  <button type="button" className="btn-primary btn-sm" onClick={() => setShowCreateForm(true)}>
                    <Plus size={14} />
                    Create organization
                  </button>
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Code</th>
                    <th>Status</th>
                    <th>Admins</th>
                    <th>Employees</th>
                    <th>Status actions</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((org) => (
                    <tr key={org._id}>
                      <td>
                        <button
                          type="button"
                          onClick={() => setSelectedOrg(org._id)}
                          className="text-left text-[13.5px] font-medium text-ink transition hover:text-brand"
                        >
                          {org.name}
                        </button>
                      </td>
                      <td><span className="font-mono text-[12px] text-ink-muted">{org.organizationCode}</span></td>
                      <td><StatusBadge status={org.status} /></td>
                      <td className="text-[13px] text-ink-muted">{org.stats?.adminCount ?? 0}</td>
                      <td className="text-[13px] text-ink-muted">{org.stats?.employeeCount ?? 0}</td>
                      <td>
                        <select
                          value={org.status}
                          onChange={(e) => updateOrgStatus.mutate({ organizationId: org._id, status: e.target.value })}
                          className="input text-[12px] py-1"
                          disabled={updateOrgStatus.isPending}
                        >
                          <option value="active">Active</option>
                          <option value="suspended">Suspended</option>
                          <option value="pending">Pending</option>
                        </select>
                      </td>
                      <td className="text-right">
                        <button type="button" className="btn-ghost btn-sm" onClick={() => setSelectedOrg(org._id)}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'evidence' ? (
        <section className="panel overflow-hidden">
          <div className="card-header">
            <div>
              <h2 className="section-title">Global evidence</h2>
              <p className="section-subtitle">View all evidence files across the platform</p>
            </div>
            <Link to="/superadmin/evidence" className="btn-primary btn-sm">
              View all evidence
            </Link>
          </div>
          <div className="p-5">
            <EmptyState
              icon={FileText}
              title="Manage evidence"
              description="View detailed evidence listings with organization, uploader, and blockchain filters."
              action={
                <Link to="/superadmin/evidence" className="btn-primary btn-sm">
                  Open evidence management
                </Link>
              }
            />
          </div>
        </section>
      ) : null}

      {activeTab === 'blockchain' ? (
        <section className="panel overflow-hidden">
          <div className="card-header">
            <div>
              <h2 className="section-title">Blockchain monitoring</h2>
              <p className="section-subtitle">View blockchain transaction status and verification</p>
            </div>
            <Link to="/superadmin/blockchain" className="btn-primary btn-sm">
              View blockchain status
            </Link>
          </div>
          <div className="p-5">
            <EmptyState
              icon={LinkIcon}
              title="Blockchain operations"
              description="Monitor transaction confirmations, pending operations, and failures."
              action={
                <Link to="/superadmin/blockchain" className="btn-primary btn-sm">
                  Open blockchain monitoring
                </Link>
              }
            />
          </div>
        </section>
      ) : null}

      {activeTab === 'storage' ? (
        <section className="panel overflow-hidden">
          <div className="card-header">
            <div>
              <h2 className="section-title">Storage monitoring</h2>
              <p className="section-subtitle">View evidence storage statistics and IPFS status</p>
            </div>
            <Link to="/superadmin/storage" className="btn-primary btn-sm">
              View storage status
            </Link>
          </div>
          <div className="p-5">
            <EmptyState
              icon={HardDrive}
              title="Storage statistics"
              description="View evidence distribution by organization and file type."
              action={
                <Link to="/superadmin/storage" className="btn-primary btn-sm">
                  Open storage monitoring
                </Link>
              }
            />
          </div>
        </section>
      ) : null}

      {activeTab === 'users' ? (
        <section className="panel overflow-hidden">
          <div className="card-header">
            <div>
              <h2 className="section-title">Platform users</h2>
              <p className="section-subtitle">View all users across organizations</p>
            </div>
            <Link to="/superadmin/users" className="btn-primary btn-sm">
              View all users
            </Link>
          </div>
          <div className="p-5">
            <EmptyState
              icon={Users}
              title="Manage users"
              description="View detailed user listings with role, organization, and membership filters."
              action={
                <Link to="/superadmin/users" className="btn-primary btn-sm">
                  Open user management
                </Link>
              }
            />
          </div>
        </section>
      ) : null}

      {activeTab === 'evidence' ? (
        <section className="panel overflow-hidden">
          <div className="card-header">
            <div>
              <h2 className="section-title">Global evidence</h2>
              <p className="section-subtitle">View all evidence files across the platform</p>
            </div>
            <Link to="/superadmin/evidence" className="btn-primary btn-sm">
              View all evidence
            </Link>
          </div>
          <div className="p-5">
            <EmptyState
              icon={FileText}
              title="Manage evidence"
              description="View detailed evidence listings with organization, uploader, and blockchain filters."
              action={
                <Link to="/superadmin/evidence" className="btn-primary btn-sm">
                  Open evidence management
                </Link>
              }
            />
          </div>
        </section>
      ) : null}

      {activeTab === 'blockchain' ? (
        <section className="panel overflow-hidden">
          <div className="card-header">
            <div>
              <h2 className="section-title">Blockchain monitoring</h2>
              <p className="section-subtitle">View blockchain transaction status and verification</p>
            </div>
            <Link to="/superadmin/blockchain" className="btn-primary btn-sm">
              View blockchain status
            </Link>
          </div>
          <div className="p-5">
            <EmptyState
              icon={LinkIcon}
              title="Blockchain operations"
              description="Monitor transaction confirmations, pending operations, and failures."
              action={
                <Link to="/superadmin/blockchain" className="btn-primary btn-sm">
                  Open blockchain monitoring
                </Link>
              }
            />
          </div>
        </section>
      ) : null}

      {activeTab === 'storage' ? (
        <section className="panel overflow-hidden">
          <div className="card-header">
            <div>
              <h2 className="section-title">Storage monitoring</h2>
              <p className="section-subtitle">View evidence storage statistics and IPFS status</p>
            </div>
            <Link to="/superadmin/storage" className="btn-primary btn-sm">
              View storage status
            </Link>
          </div>
          <div className="p-5">
            <EmptyState
              icon={HardDrive}
              title="Storage statistics"
              description="View evidence distribution by organization and file type."
              action={
                <Link to="/superadmin/storage" className="btn-primary btn-sm">
                  Open storage monitoring
                </Link>
              }
            />
          </div>
        </section>
      ) : null}

      {activeTab === 'administrators' ? (
        <section className="panel overflow-hidden">
          <div className="card-header">
            <div>
              <h2 className="section-title">Organization administrators</h2>
              <p className="section-subtitle">Assign and manage organization administrators</p>
            </div>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setShowInviteForm(true)}>
              <Mail size={13} />
              Invite admin
            </button>
          </div>
          <div className="p-5">
            <EmptyState
              icon={UserPlus}
              title="Admin invitations"
              description="Send invitations to users to become organization administrators."
              action={
                <button type="button" className="btn-primary btn-sm" onClick={() => setShowInviteForm(true)}>
                  <Mail size={14} />
                  Send invitation
                </button>
              }
            />
          </div>
        </section>
      ) : null}

      {activeTab === 'retention' ? (
        <section className="panel overflow-hidden">
          <div className="card-header">
            <div>
              <h2 className="section-title">Retention management</h2>
              <p className="section-subtitle">Manage evidence retention policies and scheduled deletions</p>
            </div>
            <Link to="/superadmin/retention" className="btn-primary btn-sm">
              Manage retention
            </Link>
          </div>
          <div className="p-5">
            <EmptyState
              icon={Trash2}
              title="Retention policies"
              description="Configure evidence expiration dates, view scheduled deletions, and run dry-run previews."
              action={
                <Link to="/superadmin/retention" className="btn-primary btn-sm">
                  Open retention management
                </Link>
              }
            />
          </div>
        </section>
      ) : null}

      {activeTab === 'security' ? (
        <section className="panel overflow-hidden">
          <div className="card-header">
            <div>
              <h2 className="section-title">Security events</h2>
              <p className="section-subtitle">Recent security-relevant events across the platform</p>
            </div>
          </div>
          {platformAnalytics.isLoading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 4 }).map((_, index) => <span key={index} className="skeleton h-3 w-full" />)}
            </div>
          ) : securityEvents.length === 0 ? (
            <div className="p-5">
              <EmptyState compact icon={ShieldCheck} title="No security events" description="Nothing concerning has been recorded recently." />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {securityEvents.map((event, index) => (
                <li key={index} className="flex items-start gap-3 px-5 py-3.5">
                  <span className={`h-1.5 w-1.5 shrink-0 mt-2 rounded-full ${event.result && event.result !== 'success' ? 'bg-danger' : 'bg-success'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-ink">{event.action}</p>
                    <p className="mt-0.5 text-[12px] text-ink-muted">{event.reason || 'No details provided'}</p>
                  </div>
                  <span className="shrink-0 text-[11.5px] text-ink-faint">{formatRelativeTime(event.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <CreateOrganizationModal
        open={showCreateForm}
        onClose={() => setShowCreateForm(false)}
        mutation={createOrg}
      />
      <InviteAdminModal
        open={showInviteForm}
        onClose={() => setShowInviteForm(false)}
        mutation={inviteAdmin}
        organizations={orgs}
      />
      <OrganizationDetailsModal
        organizationId={selectedOrg}
        onClose={() => setSelectedOrg(null)}
      />
    </div>
  );
}
