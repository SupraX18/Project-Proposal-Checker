const configuredApiBase = import.meta.env.VITE_API_BASE?.trim();
const isLocalhostApiBase =
  !!configuredApiBase &&
  /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/?$/i.test(configuredApiBase);

export const API_BASE =
  import.meta.env.DEV
    ? ''
    : (configuredApiBase && !isLocalhostApiBase ? configuredApiBase : '');

export const TOKEN_STORAGE_KEY = 'proposal_checker_token';

type ApiError = {
  error: string;
};

function getToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setAuthToken(token: string) {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const headers = new Headers(options.headers);

  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (options.auth !== false) {
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearAuthToken();
    }

    let data: ApiError | null = null;
    try {
      data = (await response.json()) as ApiError;
    } catch {
      data = null;
    }

    throw new Error(data?.error || `Request failed (${response.status})`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export type Role = 'student' | 'admin';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt?: string;
};

export type ProposalStatus =
  | 'Draft'
  | 'Submitted'
  | 'Under Review'
  | 'Changes Requested'
  | 'Approved'
  | 'Rejected';

export type TeamMember = {
  name: string;
  role: string;
};

export type ProposalSummary = {
  id: string;
  title: string;
  domain: string;
  scheme: string;
  status: ProposalStatus;
  abstract: string;
  problem: string;
  objectives: string[];
  methodology: string;
  techStack: string[];
  team: TeamMember[];
  reviewNotes: string;
  studentId: string;
  studentName: string;
  reviewerId: string | null;
  reviewerName: string | null;
  documentCount: number;
  folderCount: number;
  createdAt: string;
  updatedAt: string;
  submittedAt: string;
  lastStatusChangedAt: string;
};

export type FolderItem = {
  id: string;
  name: string;
  parentId: string | null;
  proposalId: string;
  studentId: string;
  scheme: string;
  color: string;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type DocumentItem = {
  id: string;
  proposalId: string;
  folderId: string | null;
  uploadedBy: string | null;
  uploadedByName: string | null;
  folderName: string | null;
  name: string;
  mimeType: string;
  size: number;
  category: string;
  description: string;
  uploadedAt: string;
  downloadUrl: string;
};

export type StatusHistoryItem = {
  id: string;
  proposalId: string;
  changedBy: string | null;
  changedByName: string | null;
  fromStatus: ProposalStatus | null;
  toStatus: ProposalStatus;
  note: string;
  createdAt: string;
};

export type ProposalWorkspace = {
  item: ProposalSummary;
  folders: FolderItem[];
  documents: DocumentItem[];
  history: StatusHistoryItem[];
};

export type UserDirectoryItem = {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
  proposalCount: number;
};

export type ActivityLog = {
  id: string;
  userId: string | null;
  userName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};

export type ProposalPayload = {
  title: string;
  domain: string;
  scheme: string;
  abstract: string;
  problem: string;
  objectives: string[];
  methodology: string;
  techStack: string[];
  team: TeamMember[];
};

export async function login(email: string, password: string, role: Role) {
  return apiFetch<{ token: string; user: AuthUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, role: role === 'admin' ? 'admin' : 'student' }),
    auth: false,
  });
}

export async function register(name: string, email: string, password: string, role: Role) {
  return apiFetch<{ token: string; user: AuthUser }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password, role: role === 'admin' ? 'admin' : 'student' }),
    auth: false,
  });
}

export async function getCurrentUser() {
  return apiFetch<{ user: AuthUser }>('/api/auth/me');
}

export async function listProposals() {
  return apiFetch<{ items: ProposalSummary[] }>('/api/proposals');
}

export async function getProposal(id: string) {
  return apiFetch<ProposalWorkspace>(`/api/proposals/${id}`);
}

export async function createProposal(payload: ProposalPayload) {
  return apiFetch<{ id: string }>('/api/proposals', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateProposal(id: string, payload: ProposalPayload) {
  return apiFetch<{ ok: true }>(`/api/proposals/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function updateProposalStatus(id: string, status: ProposalStatus, note = '') {
  return apiFetch<{ ok: true; status: ProposalStatus }>(`/api/proposals/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, note }),
  });
}

export async function deleteProposal(id: string) {
  return apiFetch<{ ok: true }>(`/api/proposals/${id}`, {
    method: 'DELETE',
  });
}

export async function listFolders(proposalId?: string) {
  const search = proposalId ? `?proposalId=${encodeURIComponent(proposalId)}` : '';
  return apiFetch<{ items: FolderItem[] }>(`/api/folders${search}`);
}

export async function createFolder(payload: {
  name: string;
  proposalId: string;
  parentId?: string | null;
  scheme?: string;
  color?: string;
}) {
  return apiFetch<{ item: FolderItem }>('/api/folders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteFolder(id: string) {
  return apiFetch<{ ok: true }>(`/api/folders/${id}`, {
    method: 'DELETE',
  });
}

export async function listDocuments(filters: { proposalId?: string; folderId?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.proposalId) params.set('proposalId', filters.proposalId);
  if (filters.folderId) params.set('folderId', filters.folderId);
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<{ items: DocumentItem[] }>(`/api/documents${query}`);
}

export async function uploadDocument(payload: {
  proposalId: string;
  file: File;
  folderId?: string | null;
  category?: string;
  description?: string;
}) {
  const body = new FormData();
  body.append('document', payload.file);
  body.append('proposalId', payload.proposalId);
  if (payload.folderId) body.append('folderId', payload.folderId);
  if (payload.category) body.append('category', payload.category);
  if (payload.description) body.append('description', payload.description);

  return apiFetch<{ document: DocumentItem }>('/api/documents', {
    method: 'POST',
    body,
  });
}

export async function deleteDocument(id: string) {
  return apiFetch<{ ok: true }>(`/api/documents/${id}`, {
    method: 'DELETE',
  });
}

export async function downloadDocument(id: string) {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_BASE}/api/documents/${id}/download`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    let data: ApiError | null = null;
    try {
      data = (await response.json()) as ApiError;
    } catch {
      data = null;
    }
    throw new Error(data?.error || `Request failed (${response.status})`);
  }

  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/i);

  return {
    blob,
    fileName: match?.[1] || 'document',
  };
}

export async function listUsers() {
  return apiFetch<{ items: UserDirectoryItem[] }>('/api/users');
}

export async function createUser(payload: {
  name: string;
  email: string;
  password: string;
  role: Role;
}) {
  return apiFetch<{ id: string }>('/api/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteUser(id: string) {
  return apiFetch<{ ok: true }>(`/api/users/${id}`, {
    method: 'DELETE',
  });
}

export async function listLogs(limit = 100) {
  return apiFetch<{ items: ActivityLog[] }>(`/api/logs?limit=${encodeURIComponent(String(limit))}`);
}
