import { apiClient } from './client.js';

export async function createPendingUpload(formData) {
  const { data } = await apiClient.post('/controlled-upload/pending', formData, {
    timeout: 120000
  });
  return data;
}

export async function approvePendingUpload(requestId, reason) {
  const { data } = await apiClient.post(`/controlled-upload/pending/${requestId}/approve`, { reason });
  return data;
}

export async function rejectPendingUpload(requestId, reason) {
  const { data } = await apiClient.post(`/controlled-upload/pending/${requestId}/reject`, { reason });
  return data;
}

export async function retryPendingFinalization(requestId) {
  const { data } = await apiClient.post(`/controlled-upload/pending/${requestId}/retry-finalization`);
  return data;
}

export async function getPendingUploads(params = {}) {
  const { page = 1, limit = 20, status = '', search = '' } = params;
  const queryParams = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    ...(status && { status }),
    ...(search && { search })
  });
  const { data } = await apiClient.get(`/controlled-upload/pending?${queryParams}`);
  return data;
}

export async function getPendingUploadById(requestId) {
  const { data } = await apiClient.get(`/controlled-upload/pending/${requestId}`);
  return data.data;
}

export async function getPendingUploadPreviewBlob(requestId) {
  const response = await apiClient.get(`/controlled-upload/pending/${requestId}/preview`, {
    responseType: 'blob'
  });
  return response.data;
}
