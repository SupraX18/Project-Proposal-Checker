const configuredApiBase = import.meta.env.VITE_API_BASE?.trim();
const isLocalhostApiBase =
  !!configuredApiBase &&
  /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/?$/i.test(configuredApiBase);

export const API_BASE =
  import.meta.env.DEV
    ? ''
    : (configuredApiBase && !isLocalhostApiBase ? configuredApiBase : '');

type ApiError = {
  error: string;
};

function getToken() {
  return sessionStorage.getItem('token');
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (options.auth !== false) {
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    if (res.status === 401) {
      sessionStorage.removeItem('auth');
      sessionStorage.removeItem('role');
      sessionStorage.removeItem('token');
      localStorage.removeItem('proposal-checker-current-user');
      localStorage.removeItem('proposal-checker-token');
    }
    let data: ApiError | null = null;
    try {
      data = (await res.json()) as ApiError;
    } catch {
      // ignore
    }
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export type AuthUser = { id: string; name: string; email: string; role: 'student' | 'admin' | 'coadmin' };
export type UserDirectoryItem = {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'admin' | 'coadmin';
  created_at?: string;
};
export type ProposalStatus = 'Pending' | 'In Review' | 'Approved' | 'Revision Requested' | 'Rejected';
export type EvaluationRecommendation = 'Approve' | 'Revise' | 'Reject';
export type ProposalDocument = {
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
};
export type EvaluationScores = {
  problemClarity: number;
  technicalFeasibility: number;
  methodologyStrength: number;
  innovation: number;
  impact: number;
  documentationReadiness: number;
};
export type ProposalEvaluation = {
  criteria: EvaluationScores;
  overallScore: number;
  recommendation: EvaluationRecommendation;
  strengths: string;
  risks: string;
  summary: string;
  evaluatorName: string;
  evaluatedAt: string;
};

export type WorkspaceSettings = {
  submissionDeadline: string | null;
  reviewDeadline: string | null;
};

export type SimilarityPair = {
  id: string;
  similarityScore: number;
  riskLevel: 'High' | 'Medium' | 'Low';
  overlappingTerms: string[];
  sections: Array<{ name: string; score: number }>;
  left: {
    id: string;
    title: string;
    student: string;
    domain: string;
    status: ProposalStatus;
  };
  right: {
    id: string;
    title: string;
    student: string;
    domain: string;
    status: ProposalStatus;
  };
};

export type SimilarityReport = {
  generatedAt: string;
  totalProposals: number;
  comparedPairs: number;
  flaggedPairs: number;
  averageSimilarity: number;
  pairs: SimilarityPair[];
};

export async function login(email: string, password: string) {
  return apiFetch<{ token: string; user: AuthUser }>(`/api/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    auth: false,
  });
}

export async function register(payload: { name: string; email: string; password: string; role?: 'student' | 'admin' | 'coadmin' }) {
  return apiFetch<{ token: string; user: AuthUser }>(`/api/auth/register`, {
    method: 'POST',
    body: JSON.stringify(payload),
    auth: false,
  });
}

export type ProposalListItem = {
  id: string;
  title: string;
  domain: string;
  status: ProposalStatus;
  updated_at: string;
  student: string;
  reviewer: string | null;
  document: ProposalDocument | null;
  evaluation: ProposalEvaluation | null;
};

export async function listProposals() {
  return apiFetch<{ items: ProposalListItem[] }>(`/api/proposals`);
}

export type ProposalDetailsItem = {
  id: string;
  title: string;
  domain: string;
  status: ProposalStatus;
  abstract: string;
  problem: string;
  objectives: string[];
  methodology: string;
  tech_stack: string[];
  team: { name: string; role: string }[];
  created_at: string;
  updated_at: string;
  student: string;
  reviewer: string | null;
  document: ProposalDocument | null;
  evaluation: ProposalEvaluation | null;
};

export async function getProposal(id: string) {
  return apiFetch<{ item: ProposalDetailsItem }>(`/api/proposals/${id}`);
}

export async function createProposal(payload: {
  title: string;
  domain: string;
  abstract: string;
  problem: string;
  objectives: string[];
  methodology: string;
  techStack: string[];
  team: { name: string; role: string }[];
}) {
  return apiFetch<{ id: string }>(`/api/proposals`, { method: 'POST', body: JSON.stringify(payload) });
}

export async function deleteProposal(id: string) {
  return apiFetch<{ ok: true; id: string; title: string }>(`/api/proposals/${id}`, {
    method: 'DELETE',
  });
}

export async function uploadProposalDocument(id: string, file: File) {
  const body = new FormData();
  body.append('document', file);
  return apiFetch<{ document: ProposalDocument }>(`/api/proposals/${id}/document`, {
    method: 'POST',
    body,
  });
}

export async function downloadProposalDocument(id: string) {
  const token = getToken();
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE}/api/proposals/${id}/document`, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    let data: ApiError | null = null;
    try {
      data = (await res.json()) as ApiError;
    } catch {
      // ignore
    }
    throw new Error(data?.error || `Request failed (${res.status})`);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/i);
  return {
    blob,
    fileName: match?.[1] || 'proposal-document.pdf',
  };
}

export async function updateProposalStatus(id: string, payload: { status: ProposalListItem['status']; reviewerId?: string | null }) {
  return apiFetch<{ ok: true }>(`/api/proposals/${id}/status`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export async function saveProposalEvaluation(
  id: string,
  payload: {
    criteria: EvaluationScores;
    recommendation: EvaluationRecommendation;
    strengths: string;
    risks: string;
    summary: string;
  }
) {
  return apiFetch<{ item: ProposalEvaluation; status: ProposalStatus }>(`/api/proposals/${id}/evaluation`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function listUsers() {
  return apiFetch<{ items: UserDirectoryItem[] }>(`/api/users`);
}

export async function getWorkspaceSettings() {
  return apiFetch<{ item: WorkspaceSettings }>(`/api/workspace-settings`);
}

export async function updateWorkspaceSettings(payload: WorkspaceSettings) {
  return apiFetch<{ item: WorkspaceSettings }>(`/api/workspace-settings`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function getSimilarityReport() {
  return apiFetch<{ item: SimilarityReport }>(`/api/proposals/similarity-report`);
}

