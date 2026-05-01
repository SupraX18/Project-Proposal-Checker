import fs from 'fs';
import path from 'path';

const oldApp = fs.readFileSync('old-app.tsx', 'utf8');

// Extract the utility components from the bottom of old-app.tsx
const componentsStartIndex = oldApp.indexOf('function StatCard({');
const componentsCode = oldApp.slice(componentsStartIndex);

const newAppCode = `
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Bell, CheckCircle2, Clock3, FileText, LayoutDashboard, Menu, Moon, LogOut,
  Search, SunMedium, Trash2, Upload, Users, Plus, Folder as FolderIcon, Download, XCircle, FileUp, Activity, UserPlus,
  BarChart3, PieChart
} from "lucide-react";
import {
  PieChart as RePieChart, Pie, Cell, ResponsiveContainer, Tooltip as ReTooltip, Legend as ReLegend,
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid
} from "recharts";
import {
  API_BASE, createProposal, deleteProposal, downloadDocument, listProposals, listUsers,
  login, register, uploadDocument, listFolders, createFolder, deleteFolder, listDocuments, deleteDocument,
  updateProposalStatus, createUser, deleteUser,
  type AuthUser, type Document, type Folder, type ProposalListItem, type ProposalStatus, type UserDirectoryItem,
} from "./api/client";
import { ProjectLogoMark } from "./components/BrandLogo";

type Role = "student" | "admin";
type View = "overview" | "submit" | "users";
type AuthMode = "login" | "register";
type ThemeMode = "light" | "dark";
type Toast = { kind: "success" | "error"; text: string } | null;

const STORAGE_KEYS = { theme: "proposal_theme_preference", token: "proposal_auth_token" };
const chartColors = ["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#6366f1", "#14b8a6", "#f97316"];

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem(STORAGE_KEYS.theme) as ThemeMode) || "dark");
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

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const [proposalForm, setProposalForm] = useState({ title: "", domain: "", abstract: "", problem: "", objectives: "", methodology: "", techStack: "" });
  const [newUserForm, setNewUserForm] = useState({ name: "", email: "", password: "", role: "student" as Role });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEYS.theme, theme);
  }, [theme]);

  useEffect(() => {
    const token = localStorage.getItem(STORAGE_KEYS.token);
    if (token) sessionStorage.setItem("token", token);
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    if (apiAvailable) {
      void refreshProposals();
      void refreshDocuments();
      void refreshFolders();
      if (currentUser.role === "admin") void refreshUsers();
    }
  }, [apiAvailable, currentUser]);

  async function refreshProposals() {
    try {
      const res = await listProposals();
      setProposals(res.items);
      setApiAvailable(true);
    } catch { setApiAvailable(false); }
  }

  async function refreshUsers() {
    try { setUserDirectory((await listUsers()).items); } catch {}
  }
  async function refreshDocuments() {
    try { setDocuments((await listDocuments()).items); } catch {}
  }
  async function refreshFolders() {
    try { setFolders((await listFolders()).items); } catch {}
  }

  const visibleProposals = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    return proposals
      .filter((proposal) => (currentUser?.role === "student" ? proposal.student === currentUser.name : true))
      .filter((proposal) => (statusFilter === "All" ? true : proposal.status === statusFilter))
      .filter((proposal) => lowered ? [proposal.title, proposal.domain, proposal.student].join(" ").toLowerCase().includes(lowered) : true);
  }, [proposals, query, statusFilter, currentUser]);

  const adminMetrics = useMemo(() => {
    return {
      total: proposals.length,
      approved: proposals.filter((p) => p.status === "Approved").length,
      rejected: proposals.filter((p) => p.status === "Rejected").length,
      inReview: proposals.filter((p) => p.status === "In Review").length,
      domains: proposals.reduce((acc, p) => {
        const found = acc.find((d) => d.name === p.domain);
        if (found) found.value++;
        else acc.push({ name: p.domain, value: 1 });
        return acc;
      }, [] as { name: string; value: number }[]),
    };
  }, [proposals]);

  const adminDomainChartData = useMemo(() => adminMetrics.domains.map((d, i) => ({ ...d, fill: chartColors[i % chartColors.length] })), [adminMetrics.domains]);

  const adminStatusChartData = useMemo(() => {
    const groups = ["Pending", "In Review", "Revision Requested", "Approved", "Rejected"] as ProposalStatus[];
    return groups.map((status, index) => ({
      name: status,
      value: proposals.filter((p) => p.status === status).length,
      fill: chartColors[index % chartColors.length],
      signal: proposals.filter((p) => p.status === status).length,
    }));
  }, [proposals]);


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
        showToast("success", "Account created");
      }
    } catch (err: any) { showToast("error", err.message || "Auth failed"); }
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
    try {
      await createProposal({
        ...proposalForm,
        objectives: proposalForm.objectives.split("\\n").filter(Boolean),
        techStack: proposalForm.techStack.split(",").map((s) => s.trim()).filter(Boolean),
        team: [{ name: currentUser?.name || "", role: "Student" }],
      });
      await refreshProposals();
      setView("overview");
      showToast("success", "Project registered");
    } catch (error: any) { showToast("error", error.message); }
  }

  if (!currentUser) {
    return (
      <div className="auth-layout">
        {toast && <ToastView toast={toast} />}
        <div className="auth-card glass-panel">
          <div className="auth-header">
            <ProjectLogoMark size={48} />
            <h2>{authMode === "login" ? "Welcome Back" : "Create Account"}</h2>
          </div>
          <form onSubmit={handleAuth} className="auth-form">
            {authMode === "register" && <label>Full Name<input type="text" value={name} onChange={(e) => setName(e.target.value)} required /></label>}
            <label>Email Address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            <button type="submit" className="primary-button full-width">{authMode === "login" ? "Sign In" : "Register"}</button>
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
      {toast && <ToastView toast={toast} />}
      
      <aside className={\`sidebar \${sidebarOpen ? "open" : ""}\`}>
        <div className="sidebar-header">
          <ProjectLogoMark size={32} />
          <div className="brand-text"><strong>Tracker</strong><span>v2.0</span></div>
          <button className="ghost-button icon-only mobile-close" onClick={() => setSidebarOpen(false)}><XCircle size={20} /></button>
        </div>
        <div className="user-profile">
          <div className="avatar">{currentUser.name.charAt(0)}</div>
          <div className="user-info"><strong>{currentUser.name}</strong><span className="role-badge">{currentUser.role}</span></div>
        </div>
        <nav className="sidebar-nav">
          <button className={view === "overview" ? "nav-item active" : "nav-item"} onClick={() => setView("overview")}><LayoutDashboard size={18} /> Overview</button>
          {currentUser.role === "student" && !myProposal && (
            <button className={view === "submit" ? "nav-item active" : "nav-item"} onClick={() => setView("submit")}><FileUp size={18} /> Submit Project</button>
          )}
          {currentUser.role === "admin" && (
            <button className={view === "users" ? "nav-item active" : "nav-item"} onClick={() => setView("users")}><Users size={18} /> User Management</button>
          )}
        </nav>
        <div className="sidebar-footer">
          <button className="ghost-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <SunMedium size={18} /> : <Moon size={18} />}{theme === "dark" ? "Light Mode" : "Dark Mode"}</button>
          <button className="ghost-button danger-text" onClick={handleLogout}><LogOut size={18} /> Sign Out</button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button className="ghost-button icon-only mobile-menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
            <h2>{view === "overview" && (currentUser.role === "admin" ? "Global Tracking Board" : "My Tracking Board")}{view === "submit" && "New Project"}{view === "users" && "User Directory"}</h2>
          </div>
          {view === "overview" && <div className="search-bar"><Search size={18} /><input type="text" placeholder="Search..." value={query} onChange={(e) => setQuery(e.target.value)} /></div>}
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
                    <>
                      <div className="dashboard-grid stats-grid">
                        <StatCard icon={<CheckCircle2 size={24} />} label="Project Status" value={myProposal.status} tone={myProposal.status === "Approved" ? "success" : "neutral"} />
                        <StatCard icon={<FolderIcon size={24} />} label="Folders" value={folders.length} tone="neutral" />
                        <StatCard icon={<FileText size={24} />} label="Documents" value={documents.length} tone="neutral" />
                        <StatCard icon={<Activity size={24} />} label="Last Updated" value={new Date(myProposal.updated_at).toLocaleDateString()} tone="neutral" />
                      </div>
                      
                      <div className="dashboard-grid-split">
                        <div className="split-left">
                          <article className="stat-card futuristic-stat-card">
                            <div className="panel-title-row">
                              <h3>Update Project Status</h3>
                            </div>
                            <div className="action-row" style={{marginTop: "1rem"}}>
                              <button className="ghost-button" onClick={() => updateProposalStatus(myProposal.id, "Pending").then(refreshProposals)}>Pending</button>
                              <button className="ghost-button" onClick={() => updateProposalStatus(myProposal.id, "In Review").then(refreshProposals)}>In Review</button>
                              <button className="ghost-button success-text" onClick={() => updateProposalStatus(myProposal.id, "Approved").then(refreshProposals)}>Approved</button>
                              <button className="ghost-button danger-text" onClick={() => updateProposalStatus(myProposal.id, "Rejected").then(refreshProposals)}>Rejected</button>
                            </div>
                            <div style={{marginTop: "2rem"}}>
                              <h4>{myProposal.title}</h4>
                              <p style={{marginTop: "0.5rem", color: "var(--text-secondary)"}}>{myProposal.abstract}</p>
                            </div>
                          </article>
                          
                          <article className="stat-card futuristic-stat-card">
                            <div className="panel-title-row">
                              <h3>Document Center</h3>
                              <div className="action-row">
                                <button className="ghost-button icon-only" onClick={() => {
                                  const n = prompt("Folder Name:");
                                  if (n) createFolder(n).then(refreshFolders);
                                }}><FolderIcon size={16}/></button>
                                <label className="ghost-button icon-only upload-trigger" style={{margin:0}}>
                                  <input type="file" className="visually-hidden" onChange={async (e) => {
                                    if(e.target.files?.[0]) { await uploadDocument(myProposal.id, e.target.files[0]); refreshDocuments(); }
                                  }}/>
                                  <Upload size={16}/>
                                </label>
                              </div>
                            </div>
                            <div className="list-group">
                              {folders.map(f => (
                                <div key={f.id} className="list-item">
                                  <div className="item-main">
                                    <FolderIcon size={16} className="item-icon" style={{color: f.color}}/>
                                    <div className="item-text"><strong>{f.name}</strong></div>
                                  </div>
                                  <button className="ghost-button icon-only" onClick={() => deleteFolder(f.id).then(refreshFolders)}><Trash2 size={14}/></button>
                                </div>
                              ))}
                              {documents.map(d => (
                                <div key={d.id} className="list-item">
                                  <div className="item-main">
                                    <FileText size={16} className="item-icon"/>
                                    <div className="item-text"><strong>{d.name}</strong></div>
                                  </div>
                                  <button className="ghost-button icon-only" onClick={() => downloadDocument(d.id).then(res => {
                                      const url = window.URL.createObjectURL(res.blob);
                                      const link = document.createElement("a"); link.href = url; link.download = res.fileName;
                                      document.body.appendChild(link); link.click(); document.body.removeChild(link);
                                  })}><Download size={14}/></button>
                                </div>
                              ))}
                            </div>
                          </article>
                        </div>
                        <div className="split-right">
                           <article className="chart-card futuristic-chart-card">
                              <div className="panel-title-row"><h3>Activity Timeline</h3></div>
                              <div className="dashboard-chart-frame" style={{padding: "1rem"}}>
                                <div className="list-group">
                                  <div className="list-item">
                                    <div className="item-main">
                                      <CheckCircle2 size={16} className="item-icon success-text"/>
                                      <div className="item-text"><strong>Project Created</strong><span>{new Date(myProposal.created_at).toLocaleString()}</span></div>
                                    </div>
                                  </div>
                                  <div className="list-item">
                                    <div className="item-main">
                                      <Activity size={16} className="item-icon info-text"/>
                                      <div className="item-text"><strong>Status: {myProposal.status}</strong><span>{new Date(myProposal.updated_at).toLocaleString()}</span></div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                           </article>
                        </div>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="dashboard-grid stats-grid">
                    <StatCard icon={<FileText size={24} />} label="Total Projects" value={adminMetrics.total} tone="neutral" />
                    <StatCard icon={<Clock3 size={24} />} label="In Review" value={adminMetrics.inReview} tone="warning" />
                    <StatCard icon={<CheckCircle2 size={24} />} label="Approved" value={adminMetrics.approved} tone="success" />
                    <StatCard icon={<AlertTriangle size={24} />} label="Rejected" value={adminMetrics.rejected} tone="danger" />
                  </div>
                  <div className="dashboard-grid-split">
                    <div className="split-left">
                      <article className="stat-card futuristic-stat-card">
                        <div className="panel-title-row"><h3>All Tracked Projects</h3></div>
                        <div className="list-group">
                          {visibleProposals.map(p => (
                            <div key={p.id} className="list-item">
                              <div className="item-main">
                                <div className="item-text"><strong>{p.title}</strong><span>{p.student} - {p.domain}</span></div>
                              </div>
                              <div className="item-actions"><span className={\`status-chip \${p.status.toLowerCase().replace(" ", "-")}\`}>{p.status}</span></div>
                            </div>
                          ))}
                        </div>
                      </article>
                    </div>
                    <div className="split-right">
                      <FuturisticDonutChart title="Project Domains" data={adminDomainChartData} centerValue={adminMetrics.total} centerLabel="Total" emptyMessage="No domains tracked yet." />
                      <FuturisticHistogramChart title="Project Status" data={adminStatusChartData} xKey="name" barKey="value" lineKey="signal" labelKey="name" barLabel="Projects" lineLabel="Trend" valueFormatter={(val) => val.toString()} emptyMessage="No projects tracked yet." />
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {view === "submit" && (
            <article className="stat-card futuristic-stat-card">
              <div className="panel-title-row"><h3>Register New Project</h3></div>
              <form onSubmit={handleSubmitProposal} className="auth-form" style={{marginTop: "1rem"}}>
                <label>Title<input type="text" value={proposalForm.title} onChange={e => setProposalForm({...proposalForm, title: e.target.value})} required/></label>
                <label>Domain<input type="text" value={proposalForm.domain} onChange={e => setProposalForm({...proposalForm, domain: e.target.value})} required/></label>
                <label>Tech Stack<input type="text" value={proposalForm.techStack} onChange={e => setProposalForm({...proposalForm, techStack: e.target.value})}/></label>
                <label>Abstract<textarea value={proposalForm.abstract} onChange={e => setProposalForm({...proposalForm, abstract: e.target.value})} required/></label>
                <label>Problem<textarea value={proposalForm.problem} onChange={e => setProposalForm({...proposalForm, problem: e.target.value})} required/></label>
                <button type="submit" className="primary-button">Submit Project</button>
              </form>
            </article>
          )}

          {view === "users" && currentUser.role === "admin" && (
            <div className="dashboard-grid-split">
              <div className="split-left">
                <article className="stat-card futuristic-stat-card">
                  <div className="panel-title-row"><h3>Add New User</h3></div>
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    await createUser(newUserForm);
                    await refreshUsers();
                    setNewUserForm({ name: "", email: "", password: "", role: "student" });
                    showToast("success", "User created");
                  }} className="auth-form" style={{marginTop: "1rem"}}>
                    <label>Name<input type="text" value={newUserForm.name} onChange={e => setNewUserForm({...newUserForm, name: e.target.value})} required/></label>
                    <label>Email<input type="email" value={newUserForm.email} onChange={e => setNewUserForm({...newUserForm, email: e.target.value})} required/></label>
                    <label>Password<input type="password" value={newUserForm.password} onChange={e => setNewUserForm({...newUserForm, password: e.target.value})} required/></label>
                    <label>Role<select value={newUserForm.role} onChange={e => setNewUserForm({...newUserForm, role: e.target.value as Role})}><option value="student">Student</option><option value="admin">Admin</option></select></label>
                    <button type="submit" className="primary-button">Create User</button>
                  </form>
                </article>
              </div>
              <div className="split-right">
                <article className="stat-card futuristic-stat-card">
                  <div className="panel-title-row"><h3>User Directory ({userDirectory.length})</h3></div>
                  <div className="list-group">
                    {userDirectory.map(user => (
                      <div key={user.id} className="list-item">
                        <div className="item-main">
                          <div className="item-text"><strong>{user.name}</strong><span>{user.email}</span></div>
                        </div>
                        <div className="item-actions">
                          <span className="role-badge">{user.role}</span>
                          {user.id !== currentUser.id && <button className="ghost-button icon-only danger-text" onClick={async () => {
                            if (confirm("Delete user?")) { await deleteUser(user.id); refreshUsers(); }
                          }}><Trash2 size={16}/></button>}
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

${componentsCode}`;

fs.writeFileSync('frontend/src/app/App.tsx', newAppCode);
console.log('Successfully generated App.tsx matching old UI perfectly!');
