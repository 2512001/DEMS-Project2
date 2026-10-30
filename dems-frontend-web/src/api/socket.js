import { io } from 'socket.io-client';

let socketInstance = null;

export function getSocket() {
  const token = localStorage.getItem('token');
  if (!token) {
    if (socketInstance) {
      socketInstance.disconnect();
      socketInstance = null;
    }
    return null;
  }

  if (socketInstance && socketInstance.connected) {
    return socketInstance;
  }

  // Determine backend URL
  const backendUrl = import.meta.env.VITE_API_URL
    ? import.meta.env.VITE_API_URL.replace('/api', '')
    : 'http://127.0.0.1:3000';

  socketInstance = io(backendUrl, {
    auth: {
      token: `Bearer ${token}`
    },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
  });

  socketInstance.on('connect', () => {
    console.log('[SOCKET] Connected to DEMS real-time server:', socketInstance.id);
  });

  socketInstance.on('connect_error', (err) => {
    console.warn('[SOCKET] Connection error:', err.message);
  });

  socketInstance.on('disconnect', (reason) => {
    console.log('[SOCKET] Disconnected:', reason);
  });

  return socketInstance;
}

export function subscribeToUploadEvents(onEvent) {
  const socket = getSocket();
  if (!socket) return () => {};

  const events = [
    'upload_request_created',
    'upload_approved',
    'upload_rejected',
    'permanent_processing_started',
    'ipfs_stored',
    'blockchain_pending',
    'finalization_completed',
    'processing_failed',
    'temporary_cleanup_completed',
    'upload_status_update',
    'notification_created',
    'workflow_counts_update'
  ];

  const handler = (data) => {
    if (typeof onEvent === 'function') {
      onEvent(data);
    }
  };

  events.forEach((ev) => socket.on(ev, handler));

  return () => {
    events.forEach((ev) => socket.off(ev, handler));
  };
}

export function subscribeToViewAccessEvents(onEvent) {
  const socket = getSocket();
  if (!socket) return () => {};

  const events = [
    'view_access_request_created',
    'view_access_approved',
    'view_access_rejected',
    'view_access_revoked',
    'view_access_status_update',
    'view_access_counts_update',
    'notification_created',
    'workflow_counts_update'
  ];

  const handler = (data) => {
    if (typeof onEvent === 'function') {
      onEvent(data);
    }
  };

  events.forEach((ev) => socket.on(ev, handler));

  return () => {
    events.forEach((ev) => socket.off(ev, handler));
  };
}
