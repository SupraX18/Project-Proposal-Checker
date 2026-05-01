import fs from 'fs';
import path from 'path';

const file = 'frontend/src/app/App.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Fix Imports
content = content.replace(/getWorkspaceSettings,\n\s*getSimilarityReport,\n/, '');
content = content.replace(/saveProposalEvaluation,\n\s*updateWorkspaceSettings,\n/, '');
content = content.replace(/type EvaluationRecommendation,\n\s*type EvaluationScores,\n\s*type ProposalEvaluation,\n\s*type SimilarityReport,\n\s*type WorkspaceSettings,\n/, '');
content = content.replace(/type Document,/g, 'type Document,\ntype Folder,\ncreateUser,\ndeleteUser,\nupdateProposalStatus,');

// 2. Add Users to View Type
content = content.replace(/type View = "overview" \| "submit" \| "review" \| "analytics" \| "similarity" \| "notifications" \| "settings";/, 'type View = "overview" | "submit" | "users" | "notifications";');

// 3. Remove State
content = content.replace(/const \[workspaceSettings, setWorkspaceSettings\] = useState<WorkspaceSettings \| null>\(null\);\n/g, '');
content = content.replace(/const \[similarityReport, setSimilarityReport\] = useState<SimilarityReport \| null>\(null\);\n/g, '');

// 4. Remove refreshWorkspaceSettings and refreshSimilarityReport
content = content.replace(/async function refreshWorkspaceSettings\(\) \{[\s\S]*?^\}\s*/m, '');
content = content.replace(/async function refreshSimilarityReport\(\) \{[\s\S]*?^\}\s*/m, '');

// Remove calls from useEffect
content = content.replace(/void refreshWorkspaceSettings\(\);\n/g, '');
content = content.replace(/if \(currentUser\.role === "admin"\) \{\n\s*void refreshSimilarityReport\(\);\n\s*\}/, '');

// 5. Update Sidebar Links
const sidebarOld = /<nav className="sidebar-nav">[\s\S]*?<\/nav>/;
const sidebarNew = `<nav className="sidebar-nav">
          <button className={view === "overview" ? "nav-item active" : "nav-item"} onClick={() => setView("overview")}>
            <LayoutDashboard size={18} /> Overview
          </button>
          {currentUser.role === "student" && (
            <button className={view === "submit" ? "nav-item active" : "nav-item"} onClick={() => setView("submit")}>
              <FileUp size={18} /> Submit Project
            </button>
          )}
          {currentUser.role === "admin" && (
            <button className={view === "users" ? "nav-item active" : "nav-item"} onClick={() => setView("users")}>
              <Users size={18} /> User Management
            </button>
          )}
        </nav>`;
content = content.replace(sidebarOld, sidebarNew);

// 6. Remove the giant UI chunks for analytics, similarity, review, settings
content = content.replace(/\{view === "review" && \([\s\S]*?<\/section>\n\s*\)\}\n/g, '');
content = content.replace(/\{view === "analytics" && \([\s\S]*?<\/section>\n\s*\)\}\n/g, '');
content = content.replace(/\{view === "similarity" && \([\s\S]*?<\/section>\n\s*\)\}\n/g, '');
content = content.replace(/\{view === "settings" && \([\s\S]*?<\/section>\n\s*\)\}\n/g, '');

// 7. Replace Student Stats Grid with Tracking Stats
// Actually it's easier to just let the stats grid exist but filter visibleProposals to their own for students.
const myProposalLogic = `
  const visibleProposals = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    const isStudent = currentUser?.role === "student";
    return proposals
      .filter(p => !isStudent || p.student === currentUser.name)
      .filter((proposal) => (statusFilter === "All" ? true : proposal.status === statusFilter))
      .filter((proposal) =>
        lowered ? [proposal.title, proposal.domain, proposal.student].join(" ").toLowerCase().includes(lowered) : true
      );
  }, [proposals, query, statusFilter, currentUser]);
`;
content = content.replace(/const visibleProposals = useMemo\(\(\) => \{[\s\S]*?\}, \[proposals, query, statusFilter\]\);/, myProposalLogic);


// Add user management view
const usersView = `
{view === "users" && currentUser.role === "admin" && (
  <section className="panel glass-panel">
    <div className="panel-title-row">
      <h3>User Directory</h3>
      <UserPlus size={18} />
    </div>
    <div className="action-row" style={{marginBottom: "1rem"}}>
      <button className="primary-button" onClick={() => {
        const email = prompt('Email:');
        const name = prompt('Name:');
        const password = prompt('Password:');
        const role = prompt('Role (student/admin):');
        if (email && name && password && role) {
          createUser({email, name, password, role: role as any}).then(() => alert('User Created'));
        }
      }}>Add New User</button>
    </div>
    <div className="table-like-list">
      {proposals.length === 0 ? <p>Check backend for users list (simplified for UI preservation)</p> : <p>Use API to fetch actual users</p>}
    </div>
  </section>
)}
`;

content = content.replace(/<\/div>\n\s*<\/main>/, usersView + '\n        </div>\n      </main>');

// 8. Add Student status updater logic in Overview
const statusUpdaterUI = `
{currentUser.role === 'student' && p.student === currentUser.name && (
  <div className="action-row" style={{marginTop: "1rem"}}>
    <span style={{fontSize: "0.85rem", opacity: 0.7}}>Update Status:</span>
    <button className="ghost-button" onClick={() => updateProposalStatus(p.id, "Pending").then(refreshProposals)}>Pending</button>
    <button className="ghost-button" onClick={() => updateProposalStatus(p.id, "In Review").then(refreshProposals)}>In Review</button>
    <button className="ghost-button success-text" onClick={() => updateProposalStatus(p.id, "Approved").then(refreshProposals)}>Approved</button>
    <button className="ghost-button danger-text" onClick={() => updateProposalStatus(p.id, "Rejected").then(refreshProposals)}>Rejected</button>
  </div>
)}
`;

content = content.replace(/<span className=\{\`status-chip \$\{p\.status\.toLowerCase\(\)\.replace\(" ", "-"\)\}\`\}>\s*\{p\.status\}\s*<\/span>/g, `<span className={\`status-chip \${p.status.toLowerCase().replace(" ", "-")}\`}>{p.status}</span>\n${statusUpdaterUI}`);

fs.writeFileSync(file, content);
console.log('App.tsx adapted safely');
