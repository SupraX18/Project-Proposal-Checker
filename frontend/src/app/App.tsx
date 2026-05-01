import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  FileText,
  LayoutDashboard,
  Menu,
  Moon,
  LogOut,
  Search,
  SunMedium,
  Trash2,
  Upload,
  Users,
  Plus,
  Folder as FolderIcon,
  Download,
  XCircle,
  FileUp,
  Activity,
  UserPlus
} from "lucide-react";
import {
  API_BASE,
  createProposal,
  deleteProposal,
  downloadDocument,
  listProposals,
  listUsers,
  login,
  register,
  uploadDocument,
  listFolders,
  createFolder,
  deleteFolder,
  listDocuments,
  deleteDocument,
  updateProposalStatus,
  createUser,
  deleteUser,
  type AuthUser,
  type Document,
  type Folder,
  type ProposalListItem,
  type ProposalStatus,
  type UserDirectoryItem,
} from "./api/client";
import { ProjectLogoMark } from "./components/BrandLogo";

type Role = "student" | "admin";
type View = "overview" | "submit" | "users";
type AuthMode = "login" | "register";
type ThemeMode = "light" | "dark";
type Toast = { kind: "success" | "error"; text: string } | null;

const STORAGE_KEYS = {
  theme: "proposal_theme_preference",
  token: "proposal_auth_token",
};

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    return (localStorage.getItem(STORAGE_KEYS.theme) as ThemeMode) || "dark";
  });
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [apiAvailable, setApiAvailable] = useState(true);
  const [toast, setToast] = useState<Toast>(null);
  const [view, setView] = useState<View>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProposalStatus | "All">("All");

  const [proposals, setProposals] = useState<ProposalListItem[]>([]);
  const [userDirectory, setUserDirectory] = useState<UserDirectoryItem[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);

  // Auth Forms
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  // Submit Form
  const [proposalForm, setProposalForm] = useState({
    title: "",
    domain: "",
    abstract: "",
    problem: "",
    objectives: "",
    methodology: "",
    techStack: "",
  });

  // User Mgmt Form
  const [newUserForm, setNewUserForm] = useState({ name: "", email: "", password: "", role: "student" as Role });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEYS.theme, theme);
  }, [theme]);

  useEffect(() => {
    const token = localStorage.getItem(STORAGE_KEYS.token);
    if (token) {
      sessionStorage.setItem("token", token);
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    if (apiAvailable) {
      void refreshProposals();
      void refreshDocuments();
      void refreshFolders();
      if (currentUser.role === "admin") {
        void refreshUsers();
      }
    }
  }, [apiAvailable, currentUser]);

  async function refreshProposals() {
    try {
      const res = await listProposals();
      setProposals(res.items);
      setApiAvailable(true);
    } catch {
      setApiAvailable(false);
    }
  }

  async function refreshUsers() {
    try {
      const res = await listUsers();
      setUserDirectory(res.items);
    } catch {
      // ignore
    }
  }

  async function refreshDocuments() {
    try {
      const res = await listDocuments();
      setDocuments(res.items);
    } catch {
      // ignore
    }
  }

  async function refreshFolders() {
    try {
      const res = await listFolders();
      setFolders(res.items);
    } catch {
      // ignore
    }
  }

  const visibleProposals = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    return proposals
      .filter((proposal) => (currentUser?.role === "student" ? proposal.student === currentUser.name : true))
      .filter((proposal) => (statusFilter === "All" ? true : proposal.status === statusFilter))
      .filter((proposal) =>
        lowered ? [proposal.title, proposal.domain, proposal.student].join(" ").toLowerCase().includes(lowered) : true
      );
  }, [proposals, query, statusFilter, currentUser]);

  function showToast(kind: "success" | "error", text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3000);
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (authMode === "login") {
        const { token, user } = await login(email, password);
        localStorage.setItem(STORAGE_KEYS.token, token);
        setCurrentUser(user);
        showToast("success", "Welcome back!");
      } else {
        const { token, user } = await register(name, email, password, "student");
        localStorage.setItem(STORAGE_KEYS.token, token);
        setCurrentUser(user);
        showToast("success", "Account created successfully");
      }
    } catch (err: any) {
      showToast("error", err.message || "Authentication failed");
    }
  }

  function handleLogout() {
    localStorage.removeItem(STORAGE_KEYS.token);
    sessionStorage.removeItem("token");
    setCurrentUser(null);
    setProposals([]);
    setUserDirectory([]);
    setView("overview");
  }

  async function handleSubmitProposal(e: React.FormEvent) {
    e.preventDefault();
    if (!proposalForm.title || !proposalForm.domain || !proposalForm.abstract) {
      showToast("error", "Please fill in all required fields.");
      return;
    }
    try {
      await createProposal({
        ...proposalForm,
        objectives: proposalForm.objectives.split("\\n").filter(Boolean),
        techStack: proposalForm.techStack.split(",").map((s) => s.trim()).filter(Boolean),
        team: [{ name: currentUser?.name || "", role: "Student" }],
      });
      await refreshProposals();
      setView("overview");
      showToast("success", "Proposal submitted successfully.");
    } catch (error: any) {
      showToast("error", error.message || "Failed to submit proposal");
    }
  }

  async function handleStatusChange(proposalId: string, newStatus: ProposalStatus) {
    try {
      await updateProposalStatus(proposalId, newStatus);
      await refreshProposals();
      showToast("success", "Status updated");
    } catch (error: any) {
      showToast("error", error.message || "Failed to update status");
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createUser(newUserForm);
      await refreshUsers();
      setNewUserForm({ name: "", email: "", password: "", role: "student" });
      showToast("success", "User created");
    } catch (err: any) {
      showToast("error", err.message || "Failed to create user");
    }
  }

  async function handleDeleteUser(id: string) {
    if (!confirm("Are you sure?")) return;
    try {
      await deleteUser(id);
      await refreshUsers();
      showToast("success", "User deleted");
    } catch (err: any) {
      showToast("error", err.message || "Failed to delete user");
    }
  }

  if (!currentUser) {
    return (
      <div className="auth-layout">
        {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
        <div className="auth-card glass-panel">
          <div className="auth-header">
            <ProjectLogoMark size={48} />
            <h2>{authMode === "login" ? "Welcome Back" : "Create Account"}</h2>
            <p>{authMode === "login" ? "Sign in to your tracker" : "Register as a student"}</p>
          </div>
          <form onSubmit={handleAuth} className="auth-form">
            {authMode === "register" && (
              <label>
                Full Name
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
            )}
            <label>
              Email Address
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <button type="submit" className="primary-button full-width">
              {authMode === "login" ? "Sign In" : "Register"}
            </button>
          </form>
          <button className="ghost-button" onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}>
            {authMode === "login" ? "Need an account? Register" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    );
  }

  const myProposal = currentUser.role === "student" ? visibleProposals[0] : null;

  return (
    <div className="app-container">
      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
      
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <ProjectLogoMark size={32} />
          <div className="brand-text">
            <strong>Tracker</strong>
            <span>v2.0</span>
          </div>
          <button className="ghost-button icon-only mobile-close" onClick={() => setSidebarOpen(false)}>
            <XCircle size={20} />
          </button>
        </div>

        <div className="user-profile">
          <div className="avatar">{currentUser.name.charAt(0)}</div>
          <div className="user-info">
            <strong>{currentUser.name}</strong>
            <span className="role-badge">{currentUser.role}</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button className={view === "overview" ? "nav-item active" : "nav-item"} onClick={() => setView("overview")}>
            <LayoutDashboard size={18} /> Overview
          </button>
          {currentUser.role === "student" && !myProposal && (
            <button className={view === "submit" ? "nav-item active" : "nav-item"} onClick={() => setView("submit")}>
              <FileUp size={18} /> Submit Project
            </button>
          )}
          {currentUser.role === "admin" && (
            <button className={view === "users" ? "nav-item active" : "nav-item"} onClick={() => setView("users")}>
              <Users size={18} /> User Management
            </button>
          )}
        </nav>

        <div className="sidebar-footer">
          <button className="ghost-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <SunMedium size={18} /> : <Moon size={18} />}
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </button>
          <button className="ghost-button danger-text" onClick={handleLogout}>
            <LogOut size={18} /> Sign Out
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button className="ghost-button icon-only mobile-menu" onClick={() => setSidebarOpen(true)}>
              <Menu size={20} />
            </button>
            <h2>
              {view === "overview" && (currentUser.role === "admin" ? "Global Tracking Board" : "My Tracking Board")}
              {view === "submit" && "New Project Registration"}
              {view === "users" && "User Directory"}
            </h2>
          </div>
          {view === "overview" && (
            <div className="search-bar">
              <Search size={18} />
              <input type="text" placeholder="Search projects..." value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          )}
        </header>

        <div className="page-transition-shell">
          {view === "overview" && (
            <>
              {currentUser.role === "student" ? (
                <>
                  {!myProposal ? (
                    <div className="empty-state">
                      <FileUp size={48} />
                      <h3>No Project Found</h3>
                      <p>You haven't submitted your project yet. Click Submit Project to begin tracking.</p>
                      <button className="primary-button" onClick={() => setView("submit")}>Start Tracking</button>
                    </div>
                  ) : (
                    <div className="tracking-board">
                      <section className="panel status-panel glass-panel">
                        <div className="panel-title-row">
                          <h3>Project Status</h3>
                          <span className={`status-chip ${myProposal.status.toLowerCase().replace(" ", "-")}`}>
                            {myProposal.status}
                          </span>
                        </div>
                        <div className="status-updater">
                          <p>Update your project status as you progress with your real-life reviews.</p>
                          <div className="action-row">
                            <button className="ghost-button" onClick={() => handleStatusChange(myProposal.id, "Pending")}>Pending</button>
                            <button className="ghost-button" onClick={() => handleStatusChange(myProposal.id, "In Review")}>In Review</button>
                            <button className="ghost-button success-text" onClick={() => handleStatusChange(myProposal.id, "Approved")}>Approved</button>
                            <button className="ghost-button danger-text" onClick={() => handleStatusChange(myProposal.id, "Rejected")}>Rejected</button>
                          </div>
                        </div>
                        <div className="project-details-mini" style={{marginTop: "1rem"}}>
                          <h4>{myProposal.title}</h4>
                          <p>{myProposal.abstract}</p>
                        </div>
                      </section>

                      <div className="tracking-grid">
                        <section className="panel document-center glass-panel">
                          <div className="panel-title-row">
                            <h3>Document Center</h3>
                            <span>Manage related files</span>
                          </div>
                          <div className="action-row" style={{marginBottom: "1rem"}}>
                            <button className="ghost-button" onClick={() => {
                              const name = prompt("Folder Name:");
                              const color = prompt("Color hex (e.g. #ff0000) or leave empty:");
                              if (name) createFolder(name, color || undefined).then(refreshFolders);
                            }}>
                              <FolderIcon size={16}/> New Folder
                            </button>
                            <label className="ghost-button upload-trigger" style={{margin:0}}>
                              <input type="file" className="visually-hidden" onChange={async (e) => {
                                if(e.target.files?.[0]) {
                                  await uploadDocument(myProposal.id, e.target.files[0]);
                                  await refreshDocuments();
                                }
                              }}/>
                              <Upload size={16}/> Upload File
                            </label>
                          </div>
                          <div className="table-like-list">
                            {folders.map(f => (
                              <div key={f.id} className="table-like-row">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <FolderIcon size={18} style={{color: f.color}} />
                                  <strong>{f.name}</strong>
                                </div>
                                <div className="table-like-meta">
                                  <button className="ghost-button icon-only" onClick={() => deleteFolder(f.id).then(refreshFolders)}>
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>
                            ))}
                            {documents.map(d => (
                              <div key={d.id} className="table-like-row">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <FileText size={18} />
                                  <strong>{d.name}</strong>
                                </div>
                                <div className="table-like-meta">
                                  <button className="ghost-button icon-only" onClick={() => downloadDocument(d.id).then(res => {
                                      const url = window.URL.createObjectURL(res.blob);
                                      const link = document.createElement("a");
                                      link.href = url;
                                      link.download = res.fileName;
                                      document.body.appendChild(link);
                                      link.click();
                                      document.body.removeChild(link);
                                  })}>
                                    <Download size={16} />
                                  </button>
                                  {/* Delete hidden for students as per backend rules, but let's show it if it fails they see toast */}
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>

                        <section className="panel timeline-panel glass-panel">
                          <div className="panel-title-row">
                            <h3>Activity Timeline</h3>
                            <Activity size={18}/>
                          </div>
                          <div className="timeline">
                            <div className="timeline-item">
                              <div className="timeline-marker success"></div>
                              <div className="timeline-content">
                                <strong>Project Created</strong>
                                <span>{new Date(myProposal.created_at).toLocaleDateString()}</span>
                              </div>
                            </div>
                            <div className="timeline-item">
                              <div className="timeline-marker"></div>
                              <div className="timeline-content">
                                <strong>Status: {myProposal.status}</strong>
                                <span>{new Date(myProposal.updated_at).toLocaleDateString()}</span>
                              </div>
                            </div>
                            <div className="timeline-line"></div>
                          </div>
                        </section>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <section className="panel glass-panel">
                  <div className="panel-title-row">
                    <h3>All Tracked Projects</h3>
                    <span>Global Read-only View</span>
                  </div>
                  <div className="table-like-list">
                    {visibleProposals.map(p => (
                      <div key={p.id} className="table-like-row">
                        <div>
                          <strong>{p.title}</strong>
                          <span>{p.student} - {p.domain}</span>
                        </div>
                        <div className="table-like-meta">
                          <span className={`status-chip ${p.status.toLowerCase().replace(" ", "-")}`}>{p.status}</span>
                        </div>
                      </div>
                    ))}
                    {!visibleProposals.length && (
                      <div className="empty-state">
                        <span>No projects tracked yet.</span>
                      </div>
                    )}
                  </div>
                </section>
              )}
            </>
          )}

          {view === "submit" && (
            <section className="panel glass-panel">
              <form onSubmit={handleSubmitProposal} className="proposal-form">
                <div className="form-group form-group-span-2">
                  <label>Project Title<input type="text" value={proposalForm.title} onChange={e => setProposalForm({...proposalForm, title: e.target.value})} required/></label>
                </div>
                <div className="form-group">
                  <label>Domain<input type="text" value={proposalForm.domain} onChange={e => setProposalForm({...proposalForm, domain: e.target.value})} required/></label>
                </div>
                <div className="form-group">
                  <label>Tech Stack (comma separated)<input type="text" value={proposalForm.techStack} onChange={e => setProposalForm({...proposalForm, techStack: e.target.value})}/></label>
                </div>
                <div className="form-group form-group-span-2">
                  <label>Abstract<textarea value={proposalForm.abstract} onChange={e => setProposalForm({...proposalForm, abstract: e.target.value})} required/></label>
                </div>
                <div className="form-group form-group-span-2">
                  <label>Problem Statement<textarea value={proposalForm.problem} onChange={e => setProposalForm({...proposalForm, problem: e.target.value})} required/></label>
                </div>
                <div className="action-row" style={{gridColumn: "1 / -1", marginTop: "1rem"}}>
                  <button type="submit" className="primary-button">Register Project</button>
                </div>
              </form>
            </section>
          )}

          {view === "users" && currentUser.role === "admin" && (
            <div className="admin-grid">
              <section className="panel glass-panel">
                <div className="panel-title-row">
                  <h3>Add New User</h3>
                  <UserPlus size={18}/>
                </div>
                <form onSubmit={handleCreateUser} className="auth-form">
                  <input type="text" placeholder="Name" value={newUserForm.name} onChange={e => setNewUserForm({...newUserForm, name: e.target.value})} required/>
                  <input type="email" placeholder="Email" value={newUserForm.email} onChange={e => setNewUserForm({...newUserForm, email: e.target.value})} required/>
                  <input type="password" placeholder="Password" value={newUserForm.password} onChange={e => setNewUserForm({...newUserForm, password: e.target.value})} required/>
                  <select value={newUserForm.role} onChange={e => setNewUserForm({...newUserForm, role: e.target.value as Role})}>
                    <option value="student">Student</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button type="submit" className="primary-button">Create User</button>
                </form>
              </section>

              <section className="panel glass-panel">
                <div className="panel-title-row">
                  <h3>User Directory</h3>
                  <span>{userDirectory.length} Total Users</span>
                </div>
                <div className="table-like-list">
                  {userDirectory.map(user => (
                    <div key={user.id} className="table-like-row">
                      <div>
                        <strong>{user.name}</strong>
                        <span>{user.email}</span>
                      </div>
                      <div className="table-like-meta">
                        <span className="role-badge">{user.role}</span>
                        {user.id !== currentUser.id && (
                          <button className="ghost-button danger-text icon-only" onClick={() => handleDeleteUser(user.id)}>
                            <Trash2 size={16}/>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
