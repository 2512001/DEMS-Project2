import { apiClient } from './client.js';

export async function submitVerificationRequest(formData) {
  const { data } = await apiClient.post('/admin/verification-request', formData, {
    timeout: 120000
  });
  return data;
}

export async function getVerificationRequests() {
  const { data } = await apiClient.get('/admin/verification-requests');
  return data;
}

export async function reviewVerificationRequest(payload) {
  const { data } = await apiClient.post('/admin/verification-requests/review', payload);
  return data;
}

export async function reviewMembershipApplication(payload) {
  const { data } = await apiClient.post('/admin/membership-applications/review', payload);
  return data;
}

export async function getUsers() {
  const { data } = await apiClient.get('/admin/users');
  return data;
}

export async function getAuditLogs(filters = {}) {
  const params = new URLSearchParams();
  if (filters.action) params.append('action', filters.action);
  if (filters.result) params.append('result', filters.result);
  if (filters.startDate) params.append('startDate', filters.startDate);
  if (filters.endDate) params.append('endDate', filters.endDate);
  if (filters.limit) params.append('limit', filters.limit);
  if (filters.skip) params.append('skip', filters.skip);

  const queryString = params.toString();
  const url = `/admin/audit-logs${queryString ? `?${queryString}` : ''}`;
  const { data } = await apiClient.get(url);
  return data;
}

export async function upgradeOfficer(walletAddress) {
  const { data } = await apiClient.post('/admin/upgrade-officer', { walletAddress });
  return data;
}

// Super Admin organization management
export async function listOrganizations() {
  const { data } = await apiClient.get('/organization/directory');
  return data;
}

export async function createOrganization(payload) {
  const { data } = await apiClient.post('/organization/create', payload);
  return data;
}

export async function assignOrganizationAdmin(payload) {
  const { data } = await apiClient.post('/organization/assign-admin', payload);
  return data;
}

export async function resolveOrganizationByCode(code) {
  const { data } = await apiClient.get(`/organization/resolve/${code}`);
  return data;
}

export async function getOrganization() {
  const { data } = await apiClient.get('/organization/me');
  return data.data;
}

export async function getOrganizationDetails(organizationId) {
  const { data } = await apiClient.get(`/organization/${organizationId}`);
  return data.data;
}

export async function getOrganizationAdmins(organizationId) {
  const { data } = await apiClient.get(`/organization/${organizationId}/admins`);
  return data;
}

export async function getOrganizationOverview() {
  const { data } = await apiClient.get('/organization/overview');
  return data.data;
}

export async function updateOrganizationSettings(payload) {
  const { data } = await apiClient.put('/organization/settings', payload);
  return data.data;
}

export async function listQuarantine() {
  const { data } = await apiClient.get('/quarantine');
  return data;
}

export async function getQuarantineById(id) {
  const { data } = await apiClient.get(`/quarantine/${id}`);
  return data;
}

export async function reviewQuarantine(id, payload) {
  const { data } = await apiClient.post(`/quarantine/${id}/review`, payload);
  return data;
}

export async function listModificationRequests() {
  const { data } = await apiClient.get('/modifications');
  return data;
}

export async function createModificationRequest(payload) {
  const { data } = await apiClient.post('/modifications', payload);
  return data;
}

export async function reviewModificationRequest(id, payload) {
  const { data } = await apiClient.post(`/modifications/${id}/review`, payload);
  return data;
}

export async function getPlatformUsers(params = {}) {
  const { page = 1, limit = 20, role, organizationId, membershipStatus, search } = params;
  const queryParams = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    ...(role && { role }),
    ...(organizationId && { organizationId }),
    ...(membershipStatus && { membershipStatus }),
    ...(search && { search })
  });
  const { data } = await apiClient.get(`/admin/platform-users?${queryParams}`);
  return data;
}

export async function updateOrganizationStatus(organizationId, status) {
  const { data } = await apiClient.put(`/organization/${organizationId}/status`, { status });
  return data;
}

export async function getPlatformEvidence(params = {}) {
  const {
    page = 1,
    limit = 20,
    search = '',
    status = '',
    blockchainStatus = '',
    organizationId = '',
    groupId = '',
    uploaderWallet = '',
    fileType = '',
    startDate = '',
    endDate = '',
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = params;

  const queryParams = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    ...(search && { search }),
    ...(status && { status }),
    ...(blockchainStatus && { blockchainStatus }),
    ...(organizationId && { organizationId }),
    ...(groupId && { groupId }),
    ...(uploaderWallet && { uploaderWallet }),
    ...(fileType && { fileType }),
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    sortBy,
    sortOrder
  });

  const { data } = await apiClient.get(`/evidence/platform?${queryParams}`);
  return data;
}

export async function getBlockchainMonitoring(params = {}) {
  const { status = '', organizationId = '', page = 1, limit = 20 } = params;
  const queryParams = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    ...(status && { status }),
    ...(organizationId && { organizationId })
  });
  const { data } = await apiClient.get(`/monitoring/blockchain?${queryParams}`);
  return data;
}

export async function getStorageMonitoring(params = {}) {
  const { organizationId = '' } = params;
  const queryParams = new URLSearchParams({ ...(organizationId && { organizationId }) });
  const { data } = await apiClient.get(`/monitoring/storage?${queryParams}`);
  return data;
}

export async function createRetentionPolicy(payload) {
  const { data } = await apiClient.post('/retention/create', payload);
  return data;
}

export async function signRetentionPolicy(payload) {
  const { data } = await apiClient.post('/retention/sign', payload);
  return data;
}

export async function requestExtension(payload) {
  const { data } = await apiClient.post('/retention/extend', payload);
  return data;
}

export async function getRetentionPolicies(params = {}) {
  const { status = '', organizationId = '', page = 1, limit = 20 } = params;
  const queryParams = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    ...(status && { status }),
    ...(organizationId && { organizationId })
  });
  const { data } = await apiClient.get(`/retention?${queryParams}`);
  return data;
}

export async function getRetentionPolicyDetails(policyId) {
  const { data } = await apiClient.get(`/retention/${policyId}`);
  return data;
}

export async function dryRunDeletion(payload) {
  const { data } = await apiClient.post('/retention/dry-run', payload);
  return data;
}

export async function getActiveOrganizations() {
  const { data } = await apiClient.get('/organization/active');
  return data.data;
}
