import { apiClient } from './client.js';
const client = apiClient;

/**
 * Submit a new view access request
 */
export async function createViewAccessRequest(data) {
  const response = await client.post('/view-access/requests', data);
  return response.data;
}

/**
 * Get current user's submitted requests (My View Requests)
 */
export async function getMyViewRequests(params = {}) {
  const response = await client.get('/view-access/requests/my', { params });
  return response.data;
}

/**
 * Get requests assigned to the current user to review (Incoming View Requests)
 */
export async function getIncomingViewRequests(params = {}) {
  const response = await client.get('/view-access/requests/incoming', { params });
  return response.data;
}

/**
 * Get single view access request details
 */
export async function getViewRequestById(requestId) {
  const response = await client.get(`/view-access/requests/${requestId}`);
  return response.data;
}

/**
 * Approve a view access request
 */
export async function approveViewRequest(requestId) {
  const response = await client.post(`/view-access/requests/${requestId}/approve`);
  return response.data;
}

/**
 * Reject a view access request with optional reason
 */
export async function rejectViewRequest(requestId, reason = '') {
  const response = await client.post(`/view-access/requests/${requestId}/reject`, { reason });
  return response.data;
}

/**
 * Revoke an active view permission
 */
export async function revokeViewPermission(requestId, reason = '') {
  const response = await client.post(`/view-access/requests/${requestId}/revoke`, { reason });
  return response.data;
}

/**
 * List active temporary permissions for the authenticated user
 */
export async function getActiveViewPermissions() {
  const response = await client.get('/view-access/permissions/active');
  return response.data;
}

/**
 * Get accurate, database-backed workflow counters (unread notifications, pending upload approvals, pending view approvals)
 */
export async function getWorkflowCounts() {
  const response = await client.get('/view-access/counts');
  return response.data;
}

/**
 * Retrieve decrypted evidence content only with active permission
 */
export async function getProtectedEvidenceContent(evidenceId) {
  const response = await client.get(`/view-access/evidence/${evidenceId}/content?format=json`);
  return response.data;
}
