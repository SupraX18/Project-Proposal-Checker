import { useDeferredValue, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Activity,
  ArrowDownToLine,
  CheckCircle2,
  FileBadge2,
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
  deleteProposal,
  deleteUser,
  downloadDocument,
  getCurrentUser,
  getProposal,
  listLogs,
  listProposals,
  listUsers,
  login,
  register,
  setAuthToken,
  updateProposal,
  updateProposalStatus,
  uploadDocument,
  type ActivityLog,
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

type View = 'dashboard' | 'workspace' | 'users' | 'activity';
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

const initialNewUserForm = {
  name: '',
  email: '',
  password: '',
  role: 'student' as Role,
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

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode>('login');
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

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<ProposalWorkspace | null>(null);
  const [users, setUsers] = useState<UserDirectoryItem[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);

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
      setWorkspace(null);
      setUsers([]);
      setLogs([]);
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
  const filteredProposals = useMemo(() => {
    const search = deferredQuery.trim().toLowerCase();
    if (!search) return proposals;

    return proposals.filter((proposal) =>
      [
        proposal.title,
        proposal.domain,
        proposal.scheme,
        proposal.studentName,
        proposal.status,
      ]
        .join(' ')
        .toLowerCase()
        .includes(search),
    );
  }, [deferredQuery, proposals]);

  const proposalMetrics = useMemo(() => {
    const statuses = {
      total: proposals.length,
      submitted: proposals.filter((proposal) => proposal.status === 'Submitted').length,
      underReview: proposals.filter((proposal) => proposal.status === 'Under Review').length,
      changesRequested: proposals.filter((proposal) => proposal.status === 'Changes Requested').length,
      approved: proposals.filter((proposal) => proposal.status === 'Approved').length,
      rejected: proposals.filter((proposal) => proposal.status === 'Rejected').length,
      documents: proposals.reduce((sum, proposal) => sum + proposal.documentCount, 0),
      folders: proposals.reduce((sum, proposal) => sum + proposal.folderCount, 0),
    };

    return statuses;
  }, [proposals]);

  const folderTree = useMemo(() => buildFolderTree(workspace?.folders ?? []), [workspace?.folders]);
  const folderSelectOptions = useMemo(
    () => flattenFolderOptions(folderTree),
    [folderTree],
  );

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
        const [proposalResponse, userResponse, logResponse] = await Promise.all([
          listProposals(),
          listUsers(),
          listLogs(120),
        ]);
        setProposals(proposalResponse.items);
        setUsers(userResponse.items);
        setLogs(logResponse.items);
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
      const nextWorkspace = await getProposal(proposalId);
      setWorkspace(nextWorkspace);
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
      if (authMode === 'login') {
        const { token, user } = await login(email, password);
        setAuthToken(token);
        setCurrentUser(user);
        showToast('success', 'Signed in successfully.');
      } else {
        const { token, user } = await register(name, email, password);
        setAuthToken(token);
        setCurrentUser(user);
        showToast('success', 'Account created successfully.');
      }

      setEmail('');
      setPassword('');
      setName('');
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
    if (!currentUser) return;

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
    if (!currentUser || !workspace?.item) return;

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
    if (!currentUser || !workspace?.item) return;

    setActionLoading(true);
    try {
      await createFolder({
        name: folderForm.name,
        proposalId: workspace.item.id,
        parentId: folderForm.parentId || null,
        scheme: folderForm.scheme,
      });
      await Promise.all([refreshOverview(currentUser), refreshWorkspace(workspace.item.id)]);
      setFolderForm(initialFolderForm);
      showToast('success', 'Folder created successfully.');
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleUploadDocuments(event: ChangeEvent<HTMLInputElement>) {
    if (!currentUser || !workspace?.item) return;

    const input = event.currentTarget;
    const files = Array.from(input.files || []);
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
      input.value = '';
      showToast('success', `${files.length} document${files.length > 1 ? 's' : ''} uploaded.`);
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
    if (!currentUser || !workspace?.item) return;
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
    if (!currentUser || !workspace?.item) return;
    if (!window.confirm('Delete this folder? Documents inside it will stay available.')) return;

    setActionLoading(true);
    try {
      await deleteFolder(folderId);
      await Promise.all([refreshOverview(currentUser), refreshWorkspace(workspace.item.id)]);
      showToast('success', 'Folder deleted.');
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteProposal() {
    if (!currentUser || !workspace?.item) return;
    if (!window.confirm('Delete this project proposal and all its documents?')) return;

    setActionLoading(true);
    try {
      const proposalId = workspace.item.id;
      await deleteProposal(proposalId);
      await refreshOverview(currentUser);
      setWorkspace(null);
      showToast('success', 'Project proposal deleted.');
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
      const [nextUsers, nextLogs] = await Promise.all([listUsers(), listLogs(120)]);
      setUsers(nextUsers.items);
      setLogs(nextLogs.items);
      showToast('success', 'User added successfully.');
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteUser(userId: string) {
    if (!currentUser || currentUser.role !== 'admin') return;
    if (!window.confirm('Remove this user and their project data?')) return;

    setActionLoading(true);
    try {
      await deleteUser(userId);
      const [proposalResponse, userResponse, logResponse] = await Promise.all([
        listProposals(),
        listUsers(),
        listLogs(120),
      ]);
      setProposals(proposalResponse.items);
      setUsers(userResponse.items);
      setLogs(logResponse.items);
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
    return <LoadingScreen />;
  }

  if (!currentUser) {
    return (
      <div className="auth-screen">
        {toast ? <ToastView toast={toast} /> : null}
        <div className="auth-shell">
          <section className="auth-hero">
            <BrandLogo />
            <div className="auth-hero-copy">
              <p className="eyebrow">Project Proposal Checker</p>
              <h1>Track proposals, folders, and supporting documents in one place.</h1>
              <p>
                The login flow stays simple, while the rest of the application now focuses on
                proposal tracking, document organization, and clear review updates.
              </p>
            </div>
            <div className="hero-points">
              <article>
                <Workflow size={18} />
                <strong>Status Tracking</strong>
                <span>Submitted, under review, approved, rejected, and changes requested.</span>
              </article>
              <article>
                <FolderTree size={18} />
                <strong>Nested Folders</strong>
                <span>Parent folders, subfolders, and scheme-based organization.</span>
              </article>
              <article>
                <Shield size={18} />
                <strong>Controlled Access</strong>
                <span>Admin manages users and deletions. Users handle project work.</span>
              </article>
            </div>
          </section>

          <section className="auth-card">
            <div className="auth-card-header">
              <ProjectLogoMark size={44} />
              <div>
                <h2>{authMode === 'login' ? 'Welcome back' : 'Create account'}</h2>
                <p>{authMode === 'login' ? 'Sign in to continue tracking.' : 'Register as a user.'}</p>
              </div>
            </div>

            <form className="auth-form" onSubmit={handleAuthSubmit}>
              {authMode === 'register' ? (
                <label>
                  Full name
                  <input value={name} onChange={(event) => setName(event.target.value)} required />
                </label>
              ) : null}

              <label>
                Email address
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>

              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>

              <button className="primary-button" type="submit" disabled={actionLoading}>
                {actionLoading ? <LoaderCircle className="spin" size={18} /> : null}
                {authMode === 'login' ? 'Sign in' : 'Register'}
              </button>
            </form>

            <button
              className="secondary-button auth-toggle"
              onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
              type="button"
            >
              {authMode === 'login'
                ? 'Need an account? Register'
                : 'Already have an account? Sign in'}
            </button>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {toast ? <ToastView toast={toast} /> : null}
      <button
        className="mobile-menu-button"
        type="button"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open navigation"
      >
        <Menu size={18} />
      </button>
      <button
        className={`mobile-overlay ${sidebarOpen ? 'open' : ''}`}
        type="button"
        onClick={() => setSidebarOpen(false)}
        aria-label="Close navigation"
      />

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-top">
          <BrandLogo compact />
          <button
            className="icon-button sidebar-close"
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        <div className="profile-card">
          <div className="profile-avatar">{currentUser.name.charAt(0).toUpperCase()}</div>
          <div>
            <strong>{currentUser.name}</strong>
            <span>{roleLabel(currentUser.role)}</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button
            className={view === 'dashboard' ? 'nav-link active' : 'nav-link'}
            type="button"
            onClick={() => {
              setView('dashboard');
              setSidebarOpen(false);
            }}
          >
            <LayoutDashboard size={18} />
            Dashboard
          </button>
          <button
            className={view === 'workspace' ? 'nav-link active' : 'nav-link'}
            type="button"
            onClick={() => {
              setView('workspace');
              setSidebarOpen(false);
            }}
          >
            <Workflow size={18} />
            Project Workspace
          </button>
          {currentUser.role === 'admin' ? (
            <button
              className={view === 'users' ? 'nav-link active' : 'nav-link'}
              type="button"
              onClick={() => {
                setView('users');
                setSidebarOpen(false);
              }}
            >
              <UserCog size={18} />
              User Management
            </button>
          ) : null}
          {currentUser.role === 'admin' ? (
            <button
              className={view === 'activity' ? 'nav-link active' : 'nav-link'}
              type="button"
              onClick={() => {
                setView('activity');
                setSidebarOpen(false);
              }}
            >
              <Activity size={18} />
              Activity Logs
            </button>
          ) : null}
        </nav>

        <div className="sidebar-footer">
          <button className="secondary-button" type="button" onClick={handleLogout}>
            <LogOut size={16} />
            Sign out
          </button>
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
            proposals={filteredProposals}
            metrics={proposalMetrics}
            personalProposal={personalProposal}
            workspace={workspace}
            logs={logs}
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
            folderOptions={folderSelectOptions}
            onProposalSelect={(proposalId) => setSelectedProposalId(proposalId)}
            onProposalFormChange={setProposalForm}
            onFolderFormChange={setFolderForm}
            onUploadFormChange={setUploadForm}
            onStatusFormChange={setStatusForm}
            onSaveProposal={handleProposalSubmit}
            onSaveStatus={handleStatusSubmit}
            onCreateFolder={handleCreateFolder}
            onUploadFiles={handleUploadDocuments}
            onDownloadDocument={handleDownloadDocument}
            onDeleteDocument={handleDeleteDocument}
            onDeleteFolder={handleDeleteFolder}
            onDeleteProposal={handleDeleteProposal}
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

        {view === 'activity' && currentUser.role === 'admin' ? (
          <ActivityView logs={logs} />
        ) : null}
      </main>
    </div>
  );
}

function DashboardView({
  currentUser,
  dataLoading,
  proposals,
  metrics,
  personalProposal,
  workspace,
  logs,
  onOpenWorkspace,
}: {
  currentUser: AuthUser;
  dataLoading: boolean;
  proposals: ProposalSummary[];
  metrics: {
    total: number;
    submitted: number;
    underReview: number;
    changesRequested: number;
    approved: number;
    rejected: number;
    documents: number;
    folders: number;
  };
  personalProposal: ProposalSummary | null;
  workspace: ProposalWorkspace | null;
  logs: ActivityLog[];
  onOpenWorkspace: (proposalId: string) => void;
}) {
  const boardStatuses: ProposalStatus[] = [
    'Submitted',
    'Under Review',
    'Changes Requested',
    'Approved',
    'Rejected',
  ];

  return (
    <div className="page-grid">
      <section className="metric-row">
        <MetricCard icon={<FileBadge2 size={18} />} label="Total Submitted" value={metrics.total} tone="neutral" />
        <MetricCard icon={<Workflow size={18} />} label="Under Review" value={metrics.underReview} tone="warning" />
        <MetricCard icon={<CheckCircle2 size={18} />} label="Approved" value={metrics.approved} tone="success" />
        <MetricCard icon={<FolderTree size={18} />} label="Folders" value={metrics.folders} tone="neutral" />
        <MetricCard icon={<ArrowDownToLine size={18} />} label="Documents" value={metrics.documents} tone="neutral" />
      </section>

      {dataLoading ? (
        <SectionCard title="Loading dashboard" description="Refreshing project and tracking data.">
          <div className="empty-state">
            <LoaderCircle className="spin" size={20} />
            <span>Loading current records...</span>
          </div>
        </SectionCard>
      ) : null}

      {currentUser.role === 'student' ? (
        <>
          <SectionCard
            title="My proposal board"
            description="See how many proposals you have submitted and where your current project stands."
          >
            {!personalProposal ? (
              <EmptyState
                icon={<FilePlus2 size={18} />}
                title="No proposal submitted yet"
                description="Create one project proposal in the workspace to start the tracking flow."
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
                    <span>Updated {formatDateTime(personalProposal.updatedAt)}</span>
                  </div>
                </div>
                <button className="primary-button" type="button" onClick={() => onOpenWorkspace(personalProposal.id)}>
                  Open workspace
                </button>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Recent tracking history"
            description="Your latest status updates and proposal movement."
          >
            <HistoryList items={workspace?.history ?? []} emptyText="Status updates will appear here after you start tracking." />
          </SectionCard>
        </>
      ) : (
        <>
          <SectionCard
            title="Admin tracking board"
            description="Monitor submitted proposals and jump into any project workspace."
          >
            {!proposals.length ? (
              <EmptyState
                icon={<Users size={18} />}
                title="No proposals yet"
                description="Submitted projects will appear here as users start working."
              />
            ) : (
              <div className="board-grid">
                {boardStatuses.map((status) => (
                  <article key={status} className="board-column">
                    <div className="board-column-header">
                      <StatusPill status={status} />
                      <strong>{proposals.filter((proposal) => proposal.status === status).length}</strong>
                    </div>
                    <div className="board-column-list">
                      {proposals
                        .filter((proposal) => proposal.status === status)
                        .map((proposal) => (
                          <button
                            key={proposal.id}
                            className="board-card"
                            type="button"
                            onClick={() => onOpenWorkspace(proposal.id)}
                          >
                            <strong>{proposal.title}</strong>
                            <span>{proposal.studentName}</span>
                            <small>
                              {proposal.domain}
                              {proposal.scheme ? ` · ${proposal.scheme}` : ''}
                            </small>
                          </button>
                        ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Recent backend logs" description="Latest recorded actions across users and proposals.">
            <ActivityList items={logs.slice(0, 8)} />
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
  onSaveProposal,
  onSaveStatus,
  onCreateFolder,
  onUploadFiles,
  onDownloadDocument,
  onDeleteDocument,
  onDeleteFolder,
  onDeleteProposal,
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
  onSaveProposal: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSaveStatus: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onCreateFolder: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onUploadFiles: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  onDownloadDocument: (documentId: string) => Promise<void>;
  onDeleteDocument: (documentId: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onDeleteProposal: () => Promise<void>;
}) {
  const canDelete = currentUser.role === 'admin';

  if (currentUser.role === 'admin' && proposals.length) {
    const querySummary = query.trim() ? `${proposals.length} project match${proposals.length === 1 ? '' : 'es'}` : `${proposals.length} project${proposals.length === 1 ? '' : 's'}`;
    return (
      <div className="page-grid">
        <SectionCard title="Select project" description={querySummary}>
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
                <small>
                  {proposal.domain}
                  {proposal.scheme ? ` · ${proposal.scheme}` : ''}
                </small>
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
          canDelete={canDelete}
          onProposalFormChange={onProposalFormChange}
          onFolderFormChange={onFolderFormChange}
          onUploadFormChange={onUploadFormChange}
          onStatusFormChange={onStatusFormChange}
          onSaveProposal={onSaveProposal}
          onSaveStatus={onSaveStatus}
          onCreateFolder={onCreateFolder}
          onUploadFiles={onUploadFiles}
          onDownloadDocument={onDownloadDocument}
          onDeleteDocument={onDeleteDocument}
          onDeleteFolder={onDeleteFolder}
          onDeleteProposal={onDeleteProposal}
        />
      </div>
    );
  }

  if (currentUser.role === 'student' && !workspace && !workspaceLoading) {
    return (
      <div className="page-grid">
        <SectionCard
          title="Create your project proposal"
          description="Each user can create one project and then manage documents, folders, and status tracking in the same workspace."
        >
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

  if (!workspace && !workspaceLoading) {
    return (
      <div className="page-grid">
        <SectionCard title="No workspace selected" description="Pick a proposal to view documents, folders, and tracking details.">
          <EmptyState
            icon={<Workflow size={18} />}
            title="No active workspace"
            description="Select a project from the dashboard or the list above."
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
        canDelete={canDelete}
        onProposalFormChange={onProposalFormChange}
        onFolderFormChange={onFolderFormChange}
        onUploadFormChange={onUploadFormChange}
        onStatusFormChange={onStatusFormChange}
        onSaveProposal={onSaveProposal}
        onSaveStatus={onSaveStatus}
        onCreateFolder={onCreateFolder}
        onUploadFiles={onUploadFiles}
        onDownloadDocument={onDownloadDocument}
        onDeleteDocument={onDeleteDocument}
        onDeleteFolder={onDeleteFolder}
        onDeleteProposal={onDeleteProposal}
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
  canDelete,
  onProposalFormChange,
  onFolderFormChange,
  onUploadFormChange,
  onStatusFormChange,
  onSaveProposal,
  onSaveStatus,
  onCreateFolder,
  onUploadFiles,
  onDownloadDocument,
  onDeleteDocument,
  onDeleteFolder,
  onDeleteProposal,
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
  canDelete: boolean;
  onProposalFormChange: (value: ProposalFormState) => void;
  onFolderFormChange: (value: { name: string; scheme: string; parentId: string }) => void;
  onUploadFormChange: (value: { folderId: string; category: string; description: string }) => void;
  onStatusFormChange: (value: { status: ProposalStatus; note: string }) => void;
  onSaveProposal: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSaveStatus: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onCreateFolder: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onUploadFiles: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  onDownloadDocument: (documentId: string) => Promise<void>;
  onDeleteDocument: (documentId: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onDeleteProposal: () => Promise<void>;
}) {
  if (workspaceLoading || !workspace) {
    return (
      <SectionCard title="Loading workspace" description="Gathering project details, folders, and logs.">
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
        <MetricCard icon={<Activity size={18} />} label="Last Updated" value={formatDate(workspace.item.updatedAt)} tone="neutral" />
      </section>

      <SectionCard title="Project summary" description="Core tracking details for the selected proposal.">
        <div className="summary-panel">
          <div className="summary-primary">
            <StatusPill status={workspace.item.status} />
            <h2>{workspace.item.title}</h2>
            <p>{workspace.item.abstract}</p>
          </div>
          <div className="summary-meta-grid">
            <MetaItem label="User" value={workspace.item.studentName} />
            <MetaItem label="Domain" value={workspace.item.domain} />
            <MetaItem label="Scheme" value={workspace.item.scheme || 'General'} />
            <MetaItem label="Submitted" value={formatDateTime(workspace.item.submittedAt)} />
            <MetaItem label="Updated" value={formatDateTime(workspace.item.updatedAt)} />
            <MetaItem label="Review note" value={workspace.item.reviewNotes || 'No note added yet'} />
          </div>
        </div>
      </SectionCard>

      <div className="workspace-grid">
        <SectionCard title="Status tracking" description="Save review progress, approval, rejection, or requested changes.">
          <form className="stack-form" onSubmit={onSaveStatus}>
            <label>
              Status
              <select
                value={statusForm.status}
                onChange={(event) =>
                  onStatusFormChange({
                    ...statusForm,
                    status: event.target.value as ProposalStatus,
                  })
                }
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
                onChange={(event) =>
                  onStatusFormChange({
                    ...statusForm,
                    note: event.target.value,
                  })
                }
                placeholder="Add approval notes, rejection reasons, or review updates."
                rows={5}
              />
            </label>
            <button className="primary-button" type="submit" disabled={actionLoading}>
              {actionLoading ? <LoaderCircle className="spin" size={18} /> : null}
              Save tracking status
            </button>
          </form>
        </SectionCard>

        <SectionCard title="Folder structure" description="Create parent folders and subfolders with a scheme name.">
          <form className="stack-form" onSubmit={onCreateFolder}>
            <label>
              Folder name
              <input
                value={folderForm.name}
                onChange={(event) => onFolderFormChange({ ...folderForm, name: event.target.value })}
                placeholder="Example: Main submission pack"
                required
              />
            </label>
            <label>
              Scheme
              <input
                value={folderForm.scheme}
                onChange={(event) => onFolderFormChange({ ...folderForm, scheme: event.target.value })}
                placeholder="Example: Internal review"
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
      </div>

      {currentUser.role === 'student' ? (
        <SectionCard title="Project details" description="Edit your one project proposal and keep the tracking information fresh.">
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
        <SectionCard title="Upload related material" description="Save multiple supporting documents under the project and folder structure.">
          <div className="stack-form">
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
                placeholder="supporting-document"
              />
            </label>
            <label>
              Description
              <textarea
                value={uploadForm.description}
                onChange={(event) => onUploadFormChange({ ...uploadForm, description: event.target.value })}
                placeholder="Optional note for the uploaded files."
                rows={4}
              />
            </label>
            <label className="upload-dropzone">
              <Upload size={18} />
              <div>
                <strong>Choose one or more files</strong>
                <span>PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, PNG, JPG, TXT, ZIP</span>
              </div>
              <input type="file" multiple onChange={onUploadFiles} />
            </label>
          </div>
        </SectionCard>

        <SectionCard title="Folder tree" description="Systematic parent and child folders for this project.">
          {!folderTree.length ? (
            <EmptyState
              icon={<FolderTree size={18} />}
              title="No folders created yet"
              description="Create a parent folder or a subfolder to organize project material."
            />
          ) : (
            <FolderTreeView nodes={folderTree} canDelete={canDelete} onDelete={onDeleteFolder} />
          )}
        </SectionCard>
      </div>

      <SectionCard title="Document library" description="Users can upload documents. Only admin can remove them.">
        <DocumentTable
          currentUser={currentUser}
          documents={workspace.documents}
          onDownload={onDownloadDocument}
          onDelete={onDeleteDocument}
        />
      </SectionCard>

      <SectionCard title="Tracking history" description="Every status change is stored in the backend.">
        <HistoryList items={workspace.history} emptyText="Tracking events will appear here." />
      </SectionCard>

      {canDelete ? (
        <SectionCard title="Admin actions" description="Only admin can remove uploaded content and project records.">
          <button className="danger-button" type="button" onClick={onDeleteProposal} disabled={actionLoading}>
            <Trash2 size={16} />
            Delete project proposal
          </button>
        </SectionCard>
      ) : null}
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
      <SectionCard title="Add user" description="Admin can add users and optionally create another admin.">
        <form className="stack-form" onSubmit={onCreateUser}>
          <label>
            Full name
            <input
              value={newUserForm.name}
              onChange={(event) => onFormChange({ ...newUserForm, name: event.target.value })}
              required
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={newUserForm.email}
              onChange={(event) => onFormChange({ ...newUserForm, email: event.target.value })}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={newUserForm.password}
              onChange={(event) => onFormChange({ ...newUserForm, password: event.target.value })}
              required
            />
          </label>
          <label>
            Role
            <select
              value={newUserForm.role}
              onChange={(event) => onFormChange({ ...newUserForm, role: event.target.value as Role })}
            >
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

      <SectionCard title="User directory" description="Admin can see every user and remove accounts when needed.">
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

function ActivityView({ logs }: { logs: ActivityLog[] }) {
  return (
    <div className="page-grid">
      <SectionCard title="Backend activity logs" description="Logs are stored in the backend for important user and proposal actions.">
        <ActivityList items={logs} />
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
        <input
          value={proposalForm.title}
          onChange={(event) => onProposalFormChange({ ...proposalForm, title: event.target.value })}
          required
        />
      </label>
      <label>
        Domain
        <input
          value={proposalForm.domain}
          onChange={(event) => onProposalFormChange({ ...proposalForm, domain: event.target.value })}
          placeholder="AI, ERP, Healthcare, Education"
          required
        />
      </label>
      <label>
        Scheme
        <input
          value={proposalForm.scheme}
          onChange={(event) => onProposalFormChange({ ...proposalForm, scheme: event.target.value })}
          placeholder="Scheme or review track"
        />
      </label>
      <label>
        Tech stack
        <input
          value={proposalForm.techStack}
          onChange={(event) => onProposalFormChange({ ...proposalForm, techStack: event.target.value })}
          placeholder="React, Node.js, PostgreSQL"
        />
      </label>
      <label className="full-span">
        Abstract
        <textarea
          value={proposalForm.abstract}
          onChange={(event) => onProposalFormChange({ ...proposalForm, abstract: event.target.value })}
          rows={4}
          required
        />
      </label>
      <label className="full-span">
        Problem statement
        <textarea
          value={proposalForm.problem}
          onChange={(event) => onProposalFormChange({ ...proposalForm, problem: event.target.value })}
          rows={4}
          required
        />
      </label>
      <label className="full-span">
        Objectives
        <textarea
          value={proposalForm.objectives}
          onChange={(event) => onProposalFormChange({ ...proposalForm, objectives: event.target.value })}
          rows={4}
          placeholder="One objective per line"
          required
        />
      </label>
      <label className="full-span">
        Methodology
        <textarea
          value={proposalForm.methodology}
          onChange={(event) => onProposalFormChange({ ...proposalForm, methodology: event.target.value })}
          rows={4}
          required
        />
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
    return (
      <EmptyState
        icon={<ArrowDownToLine size={18} />}
        title="No documents uploaded"
        description="Upload proposal files, related material, and supporting documents here."
      />
    );
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
    return <EmptyState icon={<Activity size={18} />} title="No history yet" description={emptyText} />;
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
            <p>
              {item.changedByName || 'System'}
              {item.fromStatus ? ` moved the project from ${item.fromStatus}.` : ' created the project tracking record.'}
            </p>
            {item.note ? <small>{item.note}</small> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function ActivityList({ items }: { items: ActivityLog[] }) {
  if (!items.length) {
    return <EmptyState icon={<Activity size={18} />} title="No logs found" description="Recent actions will appear here." />;
  }

  return (
    <div className="activity-list">
      {items.map((item) => (
        <article key={item.id} className="activity-item">
          <div className="activity-icon">
            <Activity size={16} />
          </div>
          <div>
            <strong>{humanizeAction(item.action)}</strong>
            <p>
              {item.userName || 'System'} · {item.entityType}
              {item.entityId ? ` · ${item.entityId}` : ''}
            </p>
          </div>
          <span>{formatDateTime(item.createdAt)}</span>
        </article>
      ))}
    </div>
  );
}

function FolderTreeView({
  nodes,
  canDelete,
  onDelete,
}: {
  nodes: FolderNode[];
  canDelete: boolean;
  onDelete: (folderId: string) => Promise<void>;
}) {
  return (
    <div className="folder-tree">
      {nodes.map((node) => (
        <FolderBranch key={node.id} node={node} canDelete={canDelete} onDelete={onDelete} />
      ))}
    </div>
  );
}

function FolderBranch({
  node,
  canDelete,
  onDelete,
}: {
  node: FolderNode;
  canDelete: boolean;
  onDelete: (folderId: string) => Promise<void>;
}) {
  return (
    <div className="folder-branch">
      <div className="folder-card">
        <div className="folder-card-main">
          <span className="folder-chip" style={{ backgroundColor: node.color }} />
          <div>
            <strong>{node.name}</strong>
            <span>
              {node.scheme || 'No scheme'} · {node.documentCount} document{node.documentCount === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        {canDelete ? (
          <button className="icon-button danger" type="button" onClick={() => onDelete(node.id)}>
            <Trash2 size={14} />
          </button>
        ) : null}
      </div>
      {node.children.length ? (
        <div className="folder-children">
          {node.children.map((child) => (
            <FolderBranch key={child.id} node={child} canDelete={canDelete} onDelete={onDelete} />
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

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-mark">
        <ProjectLogoMark size={48} />
      </div>
      <h1>Project Proposal Checker</h1>
      <p>Preparing your tracking workspace.</p>
    </div>
  );
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

  const sortNodes = (items: FolderNode[]) => {
    items.sort((left, right) => left.name.localeCompare(right.name));
    items.forEach((item) => sortNodes(item.children));
  };

  sortNodes(roots);
  return roots;
}

function flattenFolderOptions(nodes: FolderNode[], depth = 0) {
  return nodes.flatMap((node) => {
    const label = `${'  '.repeat(depth)}${depth ? '↳ ' : ''}${node.name}`;
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
    objectives: form.objectives
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean),
    methodology: form.methodology.trim(),
    techStack: form.techStack
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
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
  if (view === 'dashboard') return role === 'admin' ? 'Admin Dashboard' : 'My Tracking Board';
  if (view === 'workspace') return 'Project Workspace';
  if (view === 'users') return 'User Management';
  return 'Activity Logs';
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString();
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function humanizeAction(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
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
