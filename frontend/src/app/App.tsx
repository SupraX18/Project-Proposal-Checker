import { useDeferredValue, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  ArrowDownToLine,
  CheckCircle2,
  FilePlus2,
  FolderPlus,
  FolderTree,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Search,
  Shield,
  Trash2,
  Upload,
  UserCog,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import {
  TOKEN_STORAGE_KEY,
  clearAuthToken,
  createFolder,
  createProposal,
  createUser,
  deleteDocument,
  deleteFolder,
  deleteUser,
  downloadDocument,
  getCurrentUser,
  getProposal,
  listProposals,
  listUsers,
  login,
  register,
  setAuthToken,
  updateProposal,
  updateProposalStatus,
  uploadDocument,
  type AuthUser,
  type DocumentItem,
  type FolderItem,
  type ProposalPayload,
  type ProposalStatus,
  type ProposalSummary,
  type ProposalWorkspace,
  type Role,
  type StatusHistoryItem,
  type UserDirectoryItem,
} from './api/client';
import { BrandLogo, ProjectLogoMark } from './components/BrandLogo';

type View = 'dashboard' | 'workspace' | 'users';
type AuthMode = 'login' | 'register';
type Toast = { kind: 'success' | 'error'; text: string } | null;
type FolderNode = FolderItem & { children: FolderNode[] };

type ProposalFormState = {
  title: string;
  domain: string;
  scheme: string;
  abstract: string;
  problem: string;
  objectives: string;
  methodology: string;
  techStack: string;
  teamMembers: string;
};

const proposalStatusOptions: ProposalStatus[] = [
  'Submitted',
  'Under Review',
  'Changes Requested',
  'Approved',
  'Rejected',
];

const initialProposalForm: ProposalFormState = {
  title: '',
  domain: '',
  scheme: '',
  abstract: '',
  problem: '',
  objectives: '',
  methodology: '',
  techStack: '',
  teamMembers: '',
};

const initialFolderForm = {
  name: '',
  scheme: '',
  parentId: '',
};

const initialUploadForm = {
  folderId: '',
  category: 'supporting-document',
  description: '',
};

const initialNewUserForm = {
  name: '',
  email: '',
  password: '',
  role: 'student' as Role,
};

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authRole, setAuthRole] = useState<Role>('student');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [view, setView] = useState<View>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [users, setUsers] = useState<UserDirectoryItem[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<ProposalWorkspace | null>(null);

  const [proposalForm, setProposalForm] = useState<ProposalFormState>(initialProposalForm);
  const [statusForm, setStatusForm] = useState<{ status: ProposalStatus; note: string }>({
    status: 'Submitted',
    note: '',
  });
  const [folderForm, setFolderForm] = useState(initialFolderForm);
  const [uploadForm, setUploadForm] = useState(initialUploadForm);
  const [newUserForm, setNewUserForm] = useState(initialNewUserForm);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapAuth() {
      try {
        const { user } = await getCurrentUser();
        if (!cancelled) setCurrentUser(user);
      } catch {
        clearAuthToken();
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    }

    if (!localStorage.getItem(TOKEN_STORAGE_KEY)) {
      setAuthLoading(false);
      return () => {
        cancelled = true;
      };
    }

    void bootstrapAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setProposals([]);
      setUsers([]);
      setWorkspace(null);
      setSelectedProposalId(null);
      return;
    }

    void refreshOverview(currentUser);
  }, [currentUser]);

  useEffect(() => {
    if (!selectedProposalId) {
      setWorkspace(null);
      return;
    }

    void refreshWorkspace(selectedProposalId);
  }, [selectedProposalId]);

  useEffect(() => {
    if (!workspace?.item) return;

    setStatusForm({
      status: workspace.item.status,
      note: workspace.item.reviewNotes || '',
    });

    if (currentUser?.role === 'student') {
      setProposalForm(proposalToForm(workspace.item));
    }
  }, [workspace?.item?.id, workspace?.item?.status, workspace?.item?.reviewNotes, currentUser?.role]);

  const personalProposal = currentUser?.role === 'student' ? proposals[0] ?? null : null;
  const folderTree = useMemo(() => buildFolderTree(workspace?.folders ?? []), [workspace?.folders]);
  const folderOptions = useMemo(() => flattenFolderOptions(folderTree), [folderTree]);

  const filteredProposals = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();
    if (!normalized) return proposals;

    return proposals.filter((proposal) =>
      [proposal.title, proposal.domain, proposal.scheme, proposal.studentName, proposal.status]
        .join(' ')
        .toLowerCase()
        .includes(normalized),
    );
  }, [deferredQuery, proposals]);

  const metrics = useMemo(() => ({
    total: proposals.length,
    underReview: proposals.filter((proposal) => proposal.status === 'Under Review').length,
    approved: proposals.filter((proposal) => proposal.status === 'Approved').length,
    rejected: proposals.filter((proposal) => proposal.status === 'Rejected').length,
    documents: proposals.reduce((sum, proposal) => sum + proposal.documentCount, 0),
    folders: proposals.reduce((sum, proposal) => sum + proposal.folderCount, 0),
  }), [proposals]);

  function showToast(kind: 'success' | 'error', text: string) {
    setToast({ kind, text });
    window.clearTimeout((showToast as typeof showToast & { timer?: number }).timer);
    (showToast as typeof showToast & { timer?: number }).timer = window.setTimeout(() => {
      setToast(null);
    }, 3200);
  }

  async function refreshOverview(user: AuthUser) {
    setDataLoading(true);
    try {
      if (user.role === 'admin') {
        const [proposalResponse, userResponse] = await Promise.all([listProposals(), listUsers()]);
        setProposals(proposalResponse.items);
        setUsers(userResponse.items);
        setSelectedProposalId((current) => {
          if (current && proposalResponse.items.some((item) => item.id === current)) return current;
          return proposalResponse.items[0]?.id ?? null;
        });
      } else {
        const proposalResponse = await listProposals();
        setProposals(proposalResponse.items);
        setSelectedProposalId(proposalResponse.items[0]?.id ?? null);
      }
    } catch (error) {
      showToast('error', getErrorMessage(error));
      if (String(getErrorMessage(error)).toLowerCase().includes('unauthorized')) {
        handleLogout();
      }
    } finally {
      setDataLoading(false);
    }
  }

  async function refreshWorkspace(proposalId: string) {
    setWorkspaceLoading(true);
    try {
      setWorkspace(await getProposal(proposalId));
    } catch (error) {
      setWorkspace(null);
      showToast('error', getErrorMessage(error));
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionLoading(true);
    try {
      const authResponse =
        authMode === 'login'
          ? await login(email, password, authRole)
          : await register(name, email, password, authRole);

      setAuthToken(authResponse.token);
      setCurrentUser(authResponse.user);
      setName('');
      setEmail('');
      setPassword('');
      showToast('success', authMode === 'login' ? 'Signed in successfully.' : 'Account created successfully.');
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }

  function handleLogout() {
    clearAuthToken();
    setCurrentUser(null);
    setView('dashboard');
    setSidebarOpen(false);
  }

  async function handleProposalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser || currentUser.role !== 'student') return;

    setActionLoading(true);
    try {
      const payload = formToProposalPayload(proposalForm, currentUser);

      if (personalProposal) {
        await updateProposal(personalProposal.id, payload);
        await Promise.all([refreshOverview(currentUser), refreshWorkspace(personalProposal.id)]);
        showToast('success', 'Project details updated.');
      } else {
        const response = await createProposal(payload);
        await refreshOverview(currentUser);
        setSelectedProposalId(response.id);
        setView('workspace');
        showToast('success', 'Project proposal created.');
      }
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStatusSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser || currentUser.role !== 'student' || !workspace?.item) return;

    setActionLoading(true);
    try {
      await updateProposalStatus(workspace.item.id, statusForm.status, statusForm.note);
      await Promise.all([refreshOverview(currentUser), refreshWorkspace(workspace.item.id)]);
      showToast('success', 'Tracking status updated.');
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCreateFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser || currentUser.role !== 'student' || !workspace?.item) return;

    setActionLoading(true);
    try {
      const response = await createFolder({
        name: folderForm.name,
        proposalId: workspace.item.id,
        parentId: folderForm.parentId || null,
        scheme: folderForm.scheme,
      });

      await Promise.all([refreshOverview(currentUser), refreshWorkspace(workspace.item.id)]);
      setFolderForm(initialFolderForm);
      setUploadForm((current) => ({ ...current, folderId: response.item.id }));
      showToast('success', 'Folder created and selected for uploads.');
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleUploadDocuments(event: ChangeEvent<HTMLInputElement>) {
    if (!currentUser || currentUser.role !== 'student' || !workspace?.item) return;

    const files = Array.from(event.currentTarget.files || []);
    if (!files.length) return;

    setActionLoading(true);
    try {
      await Promise.all(
        files.map((file) =>
          uploadDocument({
            proposalId: workspace.item.id,
            file,
            folderId: uploadForm.folderId || null,
            category: uploadForm.category,
            description: uploadForm.description,
          }),
        ),
      );

      await Promise.all([refreshOverview(currentUser), refreshWorkspace(workspace.item.id)]);
      event.currentTarget.value = '';
      showToast('success', `${files.length} document${files.length === 1 ? '' : 's'} uploaded.`);
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDownloadDocument(documentId: string) {
    try {
      const { blob, fileName } = await downloadDocument(documentId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      showToast('error', getErrorMessage(error));
    }
  }

  async function handleDeleteDocument(documentId: string) {
    if (!currentUser || currentUser.role !== 'admin' || !workspace?.item) return;
    if (!window.confirm('Delete this uploaded document?')) return;

    setActionLoading(true);
    try {
      await deleteDocument(documentId);
      await Promise.all([refreshOverview(currentUser), refreshWorkspace(workspace.item.id)]);
      showToast('success', 'Document deleted.');
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteFolder(folderId: string) {
    if (!currentUser || currentUser.role !== 'student' || !workspace?.item) return;
    if (!window.confirm('Delete this folder?')) return;

    setActionLoading(true);
    try {
      await deleteFolder(folderId);
      await Promise.all([refreshOverview(currentUser), refreshWorkspace(workspace.item.id)]);
      setUploadForm((current) => ({
        ...current,
        folderId: current.folderId === folderId ? '' : current.folderId,
      }));
      showToast('success', 'Folder deleted.');
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser || currentUser.role !== 'admin') return;

    setActionLoading(true);
    try {
      await createUser(newUserForm);
      setNewUserForm(initialNewUserForm);
      setUsers((await listUsers()).items);
      showToast('success', 'User added successfully.');
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteUser(userId: string) {
    if (!currentUser || currentUser.role !== 'admin') return;
    if (!window.confirm('Remove this user and all of their project data?')) return;

    setActionLoading(true);
    try {
      await deleteUser(userId);
      const [proposalResponse, userResponse] = await Promise.all([listProposals(), listUsers()]);
      setProposals(proposalResponse.items);
      setUsers(userResponse.items);
      setSelectedProposalId((current) => {
        if (current && proposalResponse.items.some((item) => item.id === current)) return current;
        return proposalResponse.items[0]?.id ?? null;
      });
      showToast('success', 'User removed.');
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }

  if (authLoading) {
    return null;
  }

  if (!currentUser) {
    return (
      <div className="auth-screen">
        {toast ? <ToastView toast={toast} /> : null}
        <div className="auth-shell">

          {/* ── LEFT PANEL ── */}
          <section className="auth-hero">
            <div className="auth-hero-mesh" />
            <div className="auth-hero-inner">
              <div className="auth-hero-brand">
                <div className="auth-hero-mark">
                  <ProjectLogoMark size={52} />
                </div>
                <div className="auth-hero-brand-copy">
                  <p className="eyebrow">Project Proposal Checker</p>
                  <h1>One platform.<br />Every proposal.</h1>
                </div>
              </div>

              <div className="auth-stat-row">
                <div className="auth-stat">
                  <span className="auth-stat-icon"><CheckCircle2 size={16} /></span>
                  <div>
                    <strong>Proposal Tracking</strong>
                    <span>End-to-end status flow</span>
                  </div>
                </div>
                <div className="auth-stat">
                  <span className="auth-stat-icon"><FolderTree size={16} /></span>
                  <div>
                    <strong>Folder Vault</strong>
                    <span>Nested folders per project</span>
                  </div>
                </div>
                <div className="auth-stat">
                  <span className="auth-stat-icon"><Shield size={16} /></span>
                  <div>
                    <strong>Role-Based Access</strong>
                    <span>Student · Reviewer · Admin</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── RIGHT PANEL ── */}
          <section className="auth-card">
            <div className="auth-card-inner">

              <div className="auth-role-panel">
                <div className="auth-role-copy">
                  <span className="auth-role-label">{authMode === 'login' ? 'Sign in as' : 'Register as'}</span>
                </div>

                {/* Sliding role pill */}
                <div className="pill-toggle role-toggle">
                  <div
                    className="pill-thumb"
                    style={{ transform: authRole === 'admin' ? 'translateX(100%)' : 'translateX(0)' }}
                  />
                  <button
                    className={`pill-btn${authRole === 'student' ? ' active' : ''}`}
                    type="button"
                    onClick={() => setAuthRole('student')}
                  >
                    <Users size={14} /> User
                  </button>
                  <button
                    className={`pill-btn${authRole === 'admin' ? ' active' : ''}`}
                    type="button"
                    onClick={() => setAuthRole('admin')}
                  >
                    <Shield size={14} /> Admin
                  </button>
                </div>
              </div>

              {/* Header */}
              <div className="auth-card-header">
                <div className="auth-card-logo-mark">
                  <ProjectLogoMark size={28} />
                </div>
                <div>
                  <h2>
                    {authMode === 'login'
                      ? `${authRole === 'admin' ? 'Admin' : 'User'} Sign In`
                      : `Create ${authRole === 'admin' ? 'Admin' : 'User'} Account`}
                  </h2>
                  <p>
                    {authMode === 'login'
                      ? 'Welcome back — enter your credentials.'
                      : 'Join the platform and start tracking.'}
                  </p>
                </div>
              </div>

              {/* Form */}
              <form className="auth-form" onSubmit={handleAuthSubmit}>
                {authMode === 'register' ? (
                  <label>
                    Full name
                    <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your full name" required />
                  </label>
                ) : null}

                <label>
                  Email address
                  <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
                </label>

                <label>
                  Password
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" required />
                </label>

                <button className="primary-button auth-submit-btn" type="submit" disabled={actionLoading}>
                  {actionLoading ? <LoaderCircle className="spin" size={18} /> : null}
                  {authMode === 'login' ? 'Sign in' : 'Create account'}
                </button>
              </form>

              {/* Sliding mode toggle */}
              <div className="pill-toggle mode-toggle">
                <div
                  className="pill-thumb"
                  style={{ transform: authMode === 'register' ? 'translateX(100%)' : 'translateX(0)' }}
                />
                <button
                  className={`pill-btn${authMode === 'login' ? ' active' : ''}`}
                  type="button"
                  onClick={() => setAuthMode('login')}
                >
                  Sign In
                </button>
                <button
                  className={`pill-btn${authMode === 'register' ? ' active' : ''}`}
                  type="button"
                  onClick={() => setAuthMode('register')}
                >
                  Register
                </button>
              </div>

              <div style={{ textAlign: 'center', marginTop: '32px', color: 'var(--muted)', fontSize: '0.8rem', fontWeight: 600 }}>
                Version 2.0 Developed By Supratim
              </div>

            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {toast ? <ToastView toast={toast} /> : null}

      <button className="mobile-menu-button" type="button" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle navigation">
        {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
      </button>
      <button className={`mobile-overlay ${sidebarOpen ? 'open' : ''}`} type="button" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" />

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-top">
          <BrandLogo compact />
        </div>

        <div className="profile-card">
          <div className="profile-avatar">{currentUser.name.charAt(0).toUpperCase()}</div>
          <div>
            <strong>{currentUser.name}</strong>
            <span>{roleLabel(currentUser.role)}</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button className={view === 'dashboard' ? 'nav-link active' : 'nav-link'} type="button" onClick={() => { setView('dashboard'); setSidebarOpen(false); }}>
            <LayoutDashboard size={18} />
            Dashboard
          </button>
          <button className={view === 'workspace' ? 'nav-link active' : 'nav-link'} type="button" onClick={() => { setView('workspace'); setSidebarOpen(false); }}>
            <Workflow size={18} />
            Workspace
          </button>
          {currentUser.role === 'admin' ? (
            <button className={view === 'users' ? 'nav-link active' : 'nav-link'} type="button" onClick={() => { setView('users'); setSidebarOpen(false); }}>
              <UserCog size={18} />
              User Management
            </button>
          ) : null}
        </nav>

        <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <button className="secondary-button" style={{ width: '100%' }} type="button" onClick={handleLogout}>
            <LogOut size={16} />
            Sign out
          </button>
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.75rem', fontWeight: 600 }}>
            Version 2.0 Developed By Supratim
          </div>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Project Proposal Checker</p>
            <h1>{viewTitle(view, currentUser.role)}</h1>
          </div>

          <div className="topbar-actions">
            {view === 'dashboard' || (view === 'workspace' && currentUser.role === 'admin') ? (
              <label className="search-field">
                <Search size={16} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search project, domain, scheme, or user"
                />
              </label>
            ) : null}
          </div>
        </header>

        {view === 'dashboard' ? (
          <DashboardView
            currentUser={currentUser}
            dataLoading={dataLoading}
            users={users}
            proposals={filteredProposals}
            metrics={metrics}
            personalProposal={personalProposal}
            onOpenWorkspace={(proposalId) => {
              setSelectedProposalId(proposalId);
              setView('workspace');
            }}
          />
        ) : null}

        {view === 'workspace' ? (
          <WorkspaceView
            currentUser={currentUser}
            proposals={filteredProposals}
            workspace={workspace}
            workspaceLoading={workspaceLoading}
            actionLoading={actionLoading}
            selectedProposalId={selectedProposalId}
            query={query}
            proposalForm={proposalForm}
            folderForm={folderForm}
            uploadForm={uploadForm}
            statusForm={statusForm}
            folderTree={folderTree}
            folderOptions={folderOptions}
            onProposalSelect={setSelectedProposalId}
            onProposalFormChange={setProposalForm}
            onFolderFormChange={setFolderForm}
            onUploadFormChange={setUploadForm}
            onStatusFormChange={setStatusForm}
            onUploadFolderPick={(folderId) => setUploadForm((current) => ({ ...current, folderId }))}
            onSaveProposal={handleProposalSubmit}
            onSaveStatus={handleStatusSubmit}
            onCreateFolder={handleCreateFolder}
            onUploadFiles={handleUploadDocuments}
            onDownloadDocument={handleDownloadDocument}
            onDeleteDocument={handleDeleteDocument}
            onDeleteFolder={handleDeleteFolder}
          />
        ) : null}

        {view === 'users' && currentUser.role === 'admin' ? (
          <UsersView
            currentUser={currentUser}
            users={users}
            actionLoading={actionLoading}
            newUserForm={newUserForm}
            onFormChange={setNewUserForm}
            onCreateUser={handleCreateUser}
            onDeleteUser={handleDeleteUser}
          />
        ) : null}
      </main>
    </div>
  );
}

function DashboardView({
  currentUser,
  dataLoading,
  users,
  proposals,
  metrics,
  personalProposal,
  onOpenWorkspace,
}: {
  currentUser: AuthUser;
  dataLoading: boolean;
  users: UserDirectoryItem[];
  proposals: ProposalSummary[];
  metrics: {
    total: number;
    underReview: number;
    approved: number;
    rejected: number;
    documents: number;
    folders: number;
  };
  personalProposal: ProposalSummary | null;
  onOpenWorkspace: (proposalId: string) => void;
}) {
  return (
    <div className="page-grid">
      <section className="metric-row">
        <MetricCard icon={<Workflow size={18} />} label="Total Projects" value={metrics.total} tone="neutral" />
        <MetricCard icon={<FolderTree size={18} />} label="Folders" value={metrics.folders} tone="neutral" />
        <MetricCard icon={<ArrowDownToLine size={18} />} label="Documents" value={metrics.documents} tone="neutral" />
        <MetricCard icon={<CheckCircle2 size={18} />} label="Approved" value={metrics.approved} tone="success" />
      </section>

      {dataLoading ? (
        <SectionCard title="Loading dashboard" description="Refreshing project and workspace data.">
          <div className="empty-state">
            <LoaderCircle className="spin" size={20} />
            <span>Loading current records...</span>
          </div>
        </SectionCard>
      ) : currentUser.role === 'student' ? (
        <SectionCard title="My project board" description="Your proposal, folder system, and document activity in one view.">
          {!personalProposal ? (
            <EmptyState
              icon={<FilePlus2 size={18} />}
              title="No proposal submitted yet"
              description="Create one project proposal in the workspace to start using folders and documents."
            />
          ) : (
            <div className="student-highlight">
              <div className="student-highlight-copy">
                <StatusPill status={personalProposal.status} />
                <h3>{personalProposal.title}</h3>
                <p>{personalProposal.abstract}</p>
                <div className="inline-meta">
                  <span>{personalProposal.domain}</span>
                  <span>{personalProposal.scheme || 'General scheme'}</span>
                  <span>{personalProposal.folderCount} folders</span>
                  <span>{personalProposal.documentCount} documents</span>
                </div>
              </div>
              <button className="primary-button" type="button" onClick={() => onOpenWorkspace(personalProposal.id)}>
                Open workspace
              </button>
            </div>
          )}
        </SectionCard>
      ) : (
        <>
          <SectionCard title="Admin overview" description="Admin can manage users and remove uploaded documents when necessary.">
            <div className="admin-overview-grid">
              <MetaItem label="Users" value={String(users.length)} />
              <MetaItem label="Under review" value={String(metrics.underReview)} />
              <MetaItem label="Rejected" value={String(metrics.rejected)} />
              <MetaItem label="Approved" value={String(metrics.approved)} />
            </div>
          </SectionCard>

          <SectionCard title="Project access" description="Open a project workspace to inspect folders and delete documents if needed.">
            {!proposals.length ? (
              <EmptyState icon={<Users size={18} />} title="No projects yet" description="User projects will appear here." />
            ) : (
              <div className="proposal-selector-grid">
                {proposals.map((proposal) => (
                  <button key={proposal.id} className="proposal-selector" type="button" onClick={() => onOpenWorkspace(proposal.id)}>
                    <strong>{proposal.title}</strong>
                    <span>{proposal.studentName}</span>
                    <small>{proposal.domain}{proposal.scheme ? ` / ${proposal.scheme}` : ''}</small>
                  </button>
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}

function WorkspaceView({
  currentUser,
  proposals,
  workspace,
  workspaceLoading,
  actionLoading,
  selectedProposalId,
  query,
  proposalForm,
  folderForm,
  uploadForm,
  statusForm,
  folderTree,
  folderOptions,
  onProposalSelect,
  onProposalFormChange,
  onFolderFormChange,
  onUploadFormChange,
  onStatusFormChange,
  onUploadFolderPick,
  onSaveProposal,
  onSaveStatus,
  onCreateFolder,
  onUploadFiles,
  onDownloadDocument,
  onDeleteDocument,
  onDeleteFolder,
}: {
  currentUser: AuthUser;
  proposals: ProposalSummary[];
  workspace: ProposalWorkspace | null;
  workspaceLoading: boolean;
  actionLoading: boolean;
  selectedProposalId: string | null;
  query: string;
  proposalForm: ProposalFormState;
  folderForm: { name: string; scheme: string; parentId: string };
  uploadForm: { folderId: string; category: string; description: string };
  statusForm: { status: ProposalStatus; note: string };
  folderTree: FolderNode[];
  folderOptions: Array<{ id: string; label: string }>;
  onProposalSelect: (proposalId: string) => void;
  onProposalFormChange: (value: ProposalFormState) => void;
  onFolderFormChange: (value: { name: string; scheme: string; parentId: string }) => void;
  onUploadFormChange: (value: { folderId: string; category: string; description: string }) => void;
  onStatusFormChange: (value: { status: ProposalStatus; note: string }) => void;
  onUploadFolderPick: (folderId: string) => void;
  onSaveProposal: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSaveStatus: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onCreateFolder: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onUploadFiles: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  onDownloadDocument: (documentId: string) => Promise<void>;
  onDeleteDocument: (documentId: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
}) {
  if (currentUser.role === 'admin' && proposals.length) {
    const summary = query.trim()
      ? `${proposals.length} matching project${proposals.length === 1 ? '' : 's'}`
      : `${proposals.length} project${proposals.length === 1 ? '' : 's'}`;

    return (
      <div className="page-grid">
        <SectionCard title="Choose project workspace" description={summary}>
          <div className="proposal-selector-grid">
            {proposals.map((proposal) => (
              <button
                key={proposal.id}
                className={selectedProposalId === proposal.id ? 'proposal-selector active' : 'proposal-selector'}
                type="button"
                onClick={() => onProposalSelect(proposal.id)}
              >
                <strong>{proposal.title}</strong>
                <span>{proposal.studentName}</span>
                <small>{proposal.domain}{proposal.scheme ? ` / ${proposal.scheme}` : ''}</small>
              </button>
            ))}
          </div>
        </SectionCard>

        <WorkspaceDetailPanel
          currentUser={currentUser}
          workspace={workspace}
          workspaceLoading={workspaceLoading}
          actionLoading={actionLoading}
          proposalForm={proposalForm}
          folderForm={folderForm}
          uploadForm={uploadForm}
          statusForm={statusForm}
          folderTree={folderTree}
          folderOptions={folderOptions}
          onProposalFormChange={onProposalFormChange}
          onFolderFormChange={onFolderFormChange}
          onUploadFormChange={onUploadFormChange}
          onStatusFormChange={onStatusFormChange}
          onUploadFolderPick={onUploadFolderPick}
          onSaveProposal={onSaveProposal}
          onSaveStatus={onSaveStatus}
          onCreateFolder={onCreateFolder}
          onUploadFiles={onUploadFiles}
          onDownloadDocument={onDownloadDocument}
          onDeleteDocument={onDeleteDocument}
          onDeleteFolder={onDeleteFolder}
        />
      </div>
    );
  }

  if (currentUser.role === 'student' && !workspace && !workspaceLoading) {
    return (
      <div className="page-grid">
        <SectionCard title="Create your project proposal" description="Create one proposal and then organize folders, subfolders, and all related documents inside it.">
          <ProjectForm
            currentUser={currentUser}
            proposalForm={proposalForm}
            actionLoading={actionLoading}
            onProposalFormChange={onProposalFormChange}
            onSubmit={onSaveProposal}
            submitLabel="Create project proposal"
          />
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="page-grid">
      <WorkspaceDetailPanel
        currentUser={currentUser}
        workspace={workspace}
        workspaceLoading={workspaceLoading}
        actionLoading={actionLoading}
        proposalForm={proposalForm}
        folderForm={folderForm}
        uploadForm={uploadForm}
        statusForm={statusForm}
        folderTree={folderTree}
        folderOptions={folderOptions}
        onProposalFormChange={onProposalFormChange}
        onFolderFormChange={onFolderFormChange}
        onUploadFormChange={onUploadFormChange}
        onStatusFormChange={onStatusFormChange}
        onUploadFolderPick={onUploadFolderPick}
        onSaveProposal={onSaveProposal}
        onSaveStatus={onSaveStatus}
        onCreateFolder={onCreateFolder}
        onUploadFiles={onUploadFiles}
        onDownloadDocument={onDownloadDocument}
        onDeleteDocument={onDeleteDocument}
        onDeleteFolder={onDeleteFolder}
      />
    </div>
  );
}

function WorkspaceDetailPanel({
  currentUser,
  workspace,
  workspaceLoading,
  actionLoading,
  proposalForm,
  folderForm,
  uploadForm,
  statusForm,
  folderTree,
  folderOptions,
  onProposalFormChange,
  onFolderFormChange,
  onUploadFormChange,
  onStatusFormChange,
  onUploadFolderPick,
  onSaveProposal,
  onSaveStatus,
  onCreateFolder,
  onUploadFiles,
  onDownloadDocument,
  onDeleteDocument,
  onDeleteFolder,
}: {
  currentUser: AuthUser;
  workspace: ProposalWorkspace | null;
  workspaceLoading: boolean;
  actionLoading: boolean;
  proposalForm: ProposalFormState;
  folderForm: { name: string; scheme: string; parentId: string };
  uploadForm: { folderId: string; category: string; description: string };
  statusForm: { status: ProposalStatus; note: string };
  folderTree: FolderNode[];
  folderOptions: Array<{ id: string; label: string }>;
  onProposalFormChange: (value: ProposalFormState) => void;
  onFolderFormChange: (value: { name: string; scheme: string; parentId: string }) => void;
  onUploadFormChange: (value: { folderId: string; category: string; description: string }) => void;
  onStatusFormChange: (value: { status: ProposalStatus; note: string }) => void;
  onUploadFolderPick: (folderId: string) => void;
  onSaveProposal: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSaveStatus: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onCreateFolder: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onUploadFiles: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  onDownloadDocument: (documentId: string) => Promise<void>;
  onDeleteDocument: (documentId: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
}) {
  const activeUploadFolder = folderOptions.find((folder) => folder.id === uploadForm.folderId) || null;

  if (workspaceLoading || !workspace) {
    return (
      <SectionCard title="Loading workspace" description="Gathering project details, folders, and documents.">
        <div className="empty-state">
          <LoaderCircle className="spin" size={20} />
          <span>Loading workspace...</span>
        </div>
      </SectionCard>
    );
  }

  return (
    <>
      <section className="metric-row">
        <MetricCard icon={<Workflow size={18} />} label="Current Status" value={workspace.item.status} tone={statusTone(workspace.item.status)} />
        <MetricCard icon={<FolderTree size={18} />} label="Folders" value={workspace.item.folderCount} tone="neutral" />
        <MetricCard icon={<ArrowDownToLine size={18} />} label="Documents" value={workspace.item.documentCount} tone="neutral" />
        <MetricCard icon={<CheckCircle2 size={18} />} label="Scheme" value={workspace.item.scheme || 'General'} tone="neutral" />
      </section>

      <SectionCard title="Project summary" description="Core project tracking information.">
        <div className="summary-panel">
          <div className="summary-primary">
            <StatusPill status={workspace.item.status} />
            <h2>{workspace.item.title}</h2>
            <p>{workspace.item.abstract}</p>
          </div>
          <div className="summary-meta-grid">
            <MetaItem label="User" value={workspace.item.studentName} />
            <MetaItem label="Domain" value={workspace.item.domain} />
            <MetaItem label="Submitted" value={formatDateTime(workspace.item.submittedAt)} />
            <MetaItem label="Updated" value={formatDateTime(workspace.item.updatedAt)} />
            <MetaItem label="Note" value={workspace.item.reviewNotes || 'No note yet'} />
          </div>
        </div>
      </SectionCard>

      <div className="workspace-grid">
        {currentUser.role === 'student' ? (
          <SectionCard title="Status tracking" description="Update your project status and keep notes with it.">
            <form className="stack-form" onSubmit={onSaveStatus}>
              <label>
                Status
                <select
                  value={statusForm.status}
                  onChange={(event) => onStatusFormChange({ ...statusForm, status: event.target.value as ProposalStatus })}
                >
                  {proposalStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tracking note
                <textarea
                  value={statusForm.note}
                  onChange={(event) => onStatusFormChange({ ...statusForm, note: event.target.value })}
                  rows={5}
                />
              </label>
              <button className="primary-button" type="submit" disabled={actionLoading}>
                {actionLoading ? <LoaderCircle className="spin" size={18} /> : null}
                Save tracking status
              </button>
            </form>
          </SectionCard>
        ) : (
          <SectionCard title="Admin scope" description="Admin can inspect this workspace and remove uploaded documents only.">
            <div className="readonly-panel">
              <StatusPill status={workspace.item.status} />
              <p>{workspace.item.reviewNotes || 'No tracking note has been saved yet.'}</p>
            </div>
          </SectionCard>
        )}

        {currentUser.role === 'student' ? (
          <SectionCard title="Folder builder" description="Create parent folders and nested subfolders for this project.">
            <form className="stack-form" onSubmit={onCreateFolder}>
              <label>
                Folder name
                <input
                  value={folderForm.name}
                  onChange={(event) => onFolderFormChange({ ...folderForm, name: event.target.value })}
                  required
                />
              </label>
              <label>
                Scheme
                <input
                  value={folderForm.scheme}
                  onChange={(event) => onFolderFormChange({ ...folderForm, scheme: event.target.value })}
                  placeholder="Internal review, final, phase 1"
                />
              </label>
              <label>
                Parent folder
                <select
                  value={folderForm.parentId}
                  onChange={(event) => onFolderFormChange({ ...folderForm, parentId: event.target.value })}
                >
                  <option value="">Create as parent folder</option>
                  {folderOptions.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="secondary-button" type="submit" disabled={actionLoading}>
                <FolderPlus size={16} />
                Create folder
              </button>
            </form>
          </SectionCard>
        ) : (
          <SectionCard title="Workspace structure" description="Admin can inspect the folder structure here.">
            {!folderTree.length ? (
              <EmptyState icon={<FolderTree size={18} />} title="No folders created yet" description="The user has not created project folders yet." />
            ) : (
              <FolderTreeView
                nodes={folderTree}
                canDelete={false}
                activeFolderId={uploadForm.folderId || null}
                onSelect={onUploadFolderPick}
                onDelete={onDeleteFolder}
              />
            )}
          </SectionCard>
        )}
      </div>

      {currentUser.role === 'student' ? (
        <SectionCard title="Project details" description="Keep the main proposal details current.">
          <ProjectForm
            currentUser={currentUser}
            proposalForm={proposalForm}
            actionLoading={actionLoading}
            onProposalFormChange={onProposalFormChange}
            onSubmit={onSaveProposal}
            submitLabel="Save project details"
          />
        </SectionCard>
      ) : null}

      <div className="workspace-grid">
        {currentUser.role === 'student' ? (
          <SectionCard title="Upload materials" description="Choose a folder and save related project documents into it.">
            <div className="stack-form">
              {activeUploadFolder ? (
                <div className="active-target-banner">
                  Upload target: <strong>{activeUploadFolder.label}</strong>
                </div>
              ) : null}
              <label>
                Folder destination
                <select
                  value={uploadForm.folderId}
                  onChange={(event) => onUploadFormChange({ ...uploadForm, folderId: event.target.value })}
                >
                  <option value="">No folder</option>
                  {folderOptions.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <input
                  value={uploadForm.category}
                  onChange={(event) => onUploadFormChange({ ...uploadForm, category: event.target.value })}
                />
              </label>
              <label>
                Description
                <textarea
                  value={uploadForm.description}
                  onChange={(event) => onUploadFormChange({ ...uploadForm, description: event.target.value })}
                  rows={4}
                />
              </label>
              <label className="upload-dropzone">
                <Upload size={18} />
                <div>
                  <strong>Choose one or more files</strong>
                  <span>Click a folder in the tree first if you want these files saved into that folder.</span>
                </div>
                <input type="file" multiple onChange={onUploadFiles} />
              </label>
            </div>
          </SectionCard>
        ) : (
          <SectionCard title="Document controls" description="Admin can inspect the workspace and remove uploaded documents when needed.">
            <div className="readonly-panel">
              <p>Folders: {workspace.item.folderCount}</p>
              <p>Documents: {workspace.item.documentCount}</p>
            </div>
          </SectionCard>
        )}

        <SectionCard title="Folder tree" description="Click a folder to make it the current upload destination.">
          {!folderTree.length ? (
            <EmptyState
              icon={<FolderTree size={18} />}
              title="No folders created yet"
              description={currentUser.role === 'student' ? 'Create a parent folder or subfolder to organize your project materials.' : 'The user has not created any folders yet.'}
            />
          ) : (
            <FolderTreeView
              nodes={folderTree}
              canDelete={currentUser.role === 'student'}
              activeFolderId={uploadForm.folderId || null}
              onSelect={onUploadFolderPick}
              onDelete={onDeleteFolder}
            />
          )}
        </SectionCard>
      </div>

      <SectionCard title="Document library" description={currentUser.role === 'admin' ? 'Admin can delete uploaded documents.' : 'Your uploaded documents live here. Only admin can delete them.'}>
        <DocumentTable
          currentUser={currentUser}
          documents={workspace.documents}
          onDownload={onDownloadDocument}
          onDelete={onDeleteDocument}
        />
      </SectionCard>

      <SectionCard title="Tracking history" description="Every status update is saved in the backend.">
        <HistoryList items={workspace.history} emptyText="Tracking updates will appear here." />
      </SectionCard>
    </>
  );
}

function UsersView({
  currentUser,
  users,
  actionLoading,
  newUserForm,
  onFormChange,
  onCreateUser,
  onDeleteUser,
}: {
  currentUser: AuthUser;
  users: UserDirectoryItem[];
  actionLoading: boolean;
  newUserForm: { name: string; email: string; password: string; role: Role };
  onFormChange: (value: { name: string; email: string; password: string; role: Role }) => void;
  onCreateUser: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onDeleteUser: (userId: string) => Promise<void>;
}) {
  return (
    <div className="page-grid">
      <SectionCard title="Add user" description="Admin can add users and create another admin when needed.">
        <form className="stack-form" onSubmit={onCreateUser}>
          <label>
            Full name
            <input value={newUserForm.name} onChange={(event) => onFormChange({ ...newUserForm, name: event.target.value })} required />
          </label>
          <label>
            Email
            <input type="email" value={newUserForm.email} onChange={(event) => onFormChange({ ...newUserForm, email: event.target.value })} required />
          </label>
          <label>
            Password
            <input type="password" value={newUserForm.password} onChange={(event) => onFormChange({ ...newUserForm, password: event.target.value })} required />
          </label>
          <label>
            Role
            <select value={newUserForm.role} onChange={(event) => onFormChange({ ...newUserForm, role: event.target.value as Role })}>
              <option value="student">User</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button className="primary-button" type="submit" disabled={actionLoading}>
            {actionLoading ? <LoaderCircle className="spin" size={18} /> : null}
            Add user
          </button>
        </form>
      </SectionCard>

      <SectionCard title="User directory" description="Admin can remove users from the system here.">
        {!users.length ? (
          <EmptyState icon={<Users size={18} />} title="No users found" description="Created users will appear here." />
        ) : (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Projects</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td>{user.email}</td>
                    <td>{roleLabel(user.role)}</td>
                    <td>{user.proposalCount}</td>
                    <td>{formatDateTime(user.createdAt)}</td>
                    <td className="table-actions">
                      {user.id !== currentUser.id ? (
                        <button className="ghost-button danger" type="button" onClick={() => onDeleteUser(user.id)}>
                          <Trash2 size={16} />
                          Remove
                        </button>
                      ) : (
                        <span className="table-note">Current admin</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function ProjectForm({
  currentUser,
  proposalForm,
  actionLoading,
  onProposalFormChange,
  onSubmit,
  submitLabel,
}: {
  currentUser: AuthUser;
  proposalForm: ProposalFormState;
  actionLoading: boolean;
  onProposalFormChange: (value: ProposalFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  submitLabel: string;
}) {
  return (
    <form className="project-form" onSubmit={onSubmit}>
      <label>
        Project title
        <input value={proposalForm.title} onChange={(event) => onProposalFormChange({ ...proposalForm, title: event.target.value })} required />
      </label>
      <label>
        Domain
        <input value={proposalForm.domain} onChange={(event) => onProposalFormChange({ ...proposalForm, domain: event.target.value })} required />
      </label>
      <label>
        Scheme
        <input value={proposalForm.scheme} onChange={(event) => onProposalFormChange({ ...proposalForm, scheme: event.target.value })} />
      </label>
      <label>
        Tech stack
        <input value={proposalForm.techStack} onChange={(event) => onProposalFormChange({ ...proposalForm, techStack: event.target.value })} />
      </label>
      <label className="full-span">
        Abstract
        <textarea value={proposalForm.abstract} onChange={(event) => onProposalFormChange({ ...proposalForm, abstract: event.target.value })} rows={4} required />
      </label>
      <label className="full-span">
        Problem statement
        <textarea value={proposalForm.problem} onChange={(event) => onProposalFormChange({ ...proposalForm, problem: event.target.value })} rows={4} required />
      </label>
      <label className="full-span">
        Objectives
        <textarea value={proposalForm.objectives} onChange={(event) => onProposalFormChange({ ...proposalForm, objectives: event.target.value })} rows={4} placeholder="One objective per line" required />
      </label>
      <label className="full-span">
        Methodology
        <textarea value={proposalForm.methodology} onChange={(event) => onProposalFormChange({ ...proposalForm, methodology: event.target.value })} rows={4} required />
      </label>
      <label className="full-span">
        Team members
        <textarea
          value={proposalForm.teamMembers}
          onChange={(event) => onProposalFormChange({ ...proposalForm, teamMembers: event.target.value })}
          rows={4}
          placeholder={`One member per line. ${currentUser.name} will be added automatically if the list is empty.`}
        />
      </label>
      <button className="primary-button full-span" type="submit" disabled={actionLoading}>
        {actionLoading ? <LoaderCircle className="spin" size={18} /> : null}
        {submitLabel}
      </button>
    </form>
  );
}

function DocumentTable({
  currentUser,
  documents,
  onDownload,
  onDelete,
}: {
  currentUser: AuthUser;
  documents: DocumentItem[];
  onDownload: (documentId: string) => Promise<void>;
  onDelete: (documentId: string) => Promise<void>;
}) {
  if (!documents.length) {
    return <EmptyState icon={<ArrowDownToLine size={18} />} title="No documents uploaded" description="Project files will appear here once uploaded." />;
  }

  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            <th>Document</th>
            <th>Folder</th>
            <th>Category</th>
            <th>Uploaded by</th>
            <th>Uploaded at</th>
            <th>Size</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => (
            <tr key={document.id}>
              <td>
                <div className="table-title">{document.name}</div>
                <div className="table-subtitle">{document.description || 'No description provided'}</div>
              </td>
              <td>{document.folderName || 'No folder'}</td>
              <td>{document.category}</td>
              <td>{document.uploadedByName || 'Unknown'}</td>
              <td>{formatDateTime(document.uploadedAt)}</td>
              <td>{formatFileSize(document.size)}</td>
              <td className="table-actions">
                <button className="ghost-button" type="button" onClick={() => onDownload(document.id)}>
                  <ArrowDownToLine size={16} />
                  Download
                </button>
                {currentUser.role === 'admin' ? (
                  <button className="ghost-button danger" type="button" onClick={() => onDelete(document.id)}>
                    <Trash2 size={16} />
                    Delete
                  </button>
                ) : (
                  <span className="table-note">Only admin can delete</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryList({
  items,
  emptyText,
}: {
  items: StatusHistoryItem[];
  emptyText: string;
}) {
  if (!items.length) {
    return <EmptyState icon={<Workflow size={18} />} title="No history yet" description={emptyText} />;
  }

  return (
    <div className="timeline-list">
      {items.map((item) => (
        <article key={item.id} className="timeline-item">
          <div className="timeline-dot" />
          <div>
            <div className="timeline-head">
              <strong>{item.toStatus}</strong>
              <span>{formatDateTime(item.createdAt)}</span>
            </div>
            <p>{item.fromStatus ? `Moved from ${item.fromStatus}` : 'Project created'} / {item.changedByName || 'System'}</p>
            {item.note ? <small>{item.note}</small> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function FolderTreeView({
  nodes,
  canDelete,
  activeFolderId,
  onSelect,
  onDelete,
}: {
  nodes: FolderNode[];
  canDelete: boolean;
  activeFolderId: string | null;
  onSelect: (folderId: string) => void;
  onDelete: (folderId: string) => Promise<void>;
}) {
  return (
    <div className="folder-tree">
      {nodes.map((node) => (
        <FolderBranch
          key={node.id}
          node={node}
          canDelete={canDelete}
          activeFolderId={activeFolderId}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function FolderBranch({
  node,
  canDelete,
  activeFolderId,
  onSelect,
  onDelete,
}: {
  node: FolderNode;
  canDelete: boolean;
  activeFolderId: string | null;
  onSelect: (folderId: string) => void;
  onDelete: (folderId: string) => Promise<void>;
}) {
  return (
    <div className="folder-branch">
      <button className={activeFolderId === node.id ? 'folder-card active' : 'folder-card'} type="button" onClick={() => onSelect(node.id)}>
        <div className="folder-card-main">
          <span className="folder-chip" style={{ backgroundColor: node.color }} />
          <div>
            <strong>{node.name}</strong>
            <span>{node.scheme || 'No scheme'} / {node.documentCount} document{node.documentCount === 1 ? '' : 's'}</span>
          </div>
        </div>
        {canDelete ? (
          <span
            className="icon-button danger folder-delete-button"
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              void onDelete(node.id);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                void onDelete(node.id);
              }
            }}
          >
            <Trash2 size={14} />
          </span>
        ) : null}
      </button>
      {node.children.length ? (
        <div className="folder-children">
          {node.children.map((child) => (
            <FolderBranch
              key={child.id}
              node={child}
              canDelete={canDelete}
              activeFolderId={activeFolderId}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="section-card">
      <div className="section-card-head">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function StatusPill({ status }: { status: ProposalStatus }) {
  return <span className={`status-pill ${statusClassName(status)}`}>{status}</span>;
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      {icon}
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
    </div>
  );
}

function ToastView({ toast }: { toast: NonNullable<Toast> }) {
  return <div className={toast.kind === 'success' ? 'toast success' : 'toast error'}>{toast.text}</div>;
}


function buildFolderTree(folders: FolderItem[]) {
  const nodes = new Map<string, FolderNode>();
  const roots: FolderNode[] = [];

  folders.forEach((folder) => {
    nodes.set(folder.id, { ...folder, children: [] });
  });

  folders.forEach((folder) => {
    const node = nodes.get(folder.id);
    if (!node) return;
    if (folder.parentId && nodes.has(folder.parentId)) {
      nodes.get(folder.parentId)?.children.push(node);
      return;
    }
    roots.push(node);
  });

  const sortBranch = (branch: FolderNode[]) => {
    branch.sort((left, right) => left.name.localeCompare(right.name));
    branch.forEach((node) => sortBranch(node.children));
  };

  sortBranch(roots);
  return roots;
}

function flattenFolderOptions(nodes: FolderNode[], depth = 0) {
  return nodes.flatMap((node) => {
    const label = `${'  '.repeat(depth)}${depth ? '-> ' : ''}${node.name}`;
    return [{ id: node.id, label }, ...flattenFolderOptions(node.children, depth + 1)];
  });
}

function proposalToForm(proposal: ProposalSummary): ProposalFormState {
  return {
    title: proposal.title,
    domain: proposal.domain,
    scheme: proposal.scheme,
    abstract: proposal.abstract,
    problem: proposal.problem,
    objectives: proposal.objectives.join('\n'),
    methodology: proposal.methodology,
    techStack: proposal.techStack.join(', '),
    teamMembers: proposal.team.map((member) => member.name).join('\n'),
  };
}

function formToProposalPayload(form: ProposalFormState, currentUser: AuthUser): ProposalPayload {
  const members = form.teamMembers
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
  const uniqueMembers = Array.from(new Set(members.length ? members : [currentUser.name]));

  return {
    title: form.title.trim(),
    domain: form.domain.trim(),
    scheme: form.scheme.trim(),
    abstract: form.abstract.trim(),
    problem: form.problem.trim(),
    objectives: form.objectives.split('\n').map((value) => value.trim()).filter(Boolean),
    methodology: form.methodology.trim(),
    techStack: form.techStack.split(',').map((value) => value.trim()).filter(Boolean),
    team: uniqueMembers.map((name, index) => ({
      name,
      role: index === 0 ? 'Lead' : 'Member',
    })),
  };
}

function roleLabel(role: Role) {
  return role === 'admin' ? 'Admin' : 'User';
}

function viewTitle(view: View, role: Role) {
  if (view === 'dashboard') return role === 'admin' ? 'Admin Overview' : 'My Tracking Board';
  if (view === 'workspace') return 'Project Workspace';
  return 'User Management';
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusClassName(status: ProposalStatus) {
  return status.toLowerCase().replace(/\s+/g, '-');
}

function statusTone(status: ProposalStatus) {
  if (status === 'Approved') return 'success';
  if (status === 'Rejected') return 'danger';
  if (status === 'Under Review' || status === 'Changes Requested') return 'warning';
  return 'neutral';
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
