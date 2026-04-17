import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Bell,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileText,
  LayoutDashboard,
  Menu,
  Moon,
  LogOut,
  Search,
  Settings,
  SunMedium,
  Trash2,
  Upload,
  Users,
  X,
  XCircle,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  API_BASE,
  createProposal,
  deleteProposal,
  downloadProposalDocument,
  getWorkspaceSettings,
  getSimilarityReport,
  listProposals,
  listUsers,
  login,
  register,
  saveProposalEvaluation,
  uploadProposalDocument,
  updateWorkspaceSettings,
  type AuthUser,
  type EvaluationRecommendation,
  type ProposalDocument,
  type ProposalEvaluation,
  type ProposalListItem,
  type ProposalStatus,
  type SimilarityReport,
  type UserDirectoryItem,
  type WorkspaceSettings,
} from "./api/client";
import {
  calculateOverallScore,
  createEmptyScores,
  evaluationCriteria,
  type EvaluationScores,
} from "./evaluationModel";
import { ProjectLogoMark } from "./components/BrandLogo";

type Role = "student" | "admin" | "coadmin";
type View = "overview" | "submit" | "review" | "analytics" | "similarity" | "notifications" | "users" | "settings";
type AuthMode = "login" | "register";
type ThemeMode = "light" | "dark";
type Toast = { kind: "success" | "error"; text: string } | null;

type ProposalRecord = {
  id: string;
  title: string;
  domain: string;
  status: ProposalStatus;
  updated_at: string;
  student: string;
  reviewer: string | null;
  abstract: string;
  problem: string;
  objectives: string[];
  methodology: string;
  techStack: string[];
  team: { name: string; role: string }[];
  document: ProposalDocument | null;
  evaluation: ProposalEvaluation | null;
};

type EvaluationDraft = {
  criteria: EvaluationScores;
  recommendation: EvaluationRecommendation;
  strengths: string;
  risks: string;
  summary: string;
};

type ProposalUploadDraft = {
  file: File;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
};

type DeadlineTone = "neutral" | "safe" | "soon" | "late";

type DeadlineState = {
  label: string;
  timestampLabel: string;
  countdownLabel: string;
  tone: DeadlineTone;
  isPassed: boolean;
  isConfigured: boolean;
};

const STORAGE_KEYS = {
  currentUser: "proposal-checker-current-user",
  theme: "proposal-checker-theme",
  token: "proposal-checker-token",
};

const chartColors = ["#4f46e5", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6"];

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatFileSize(value: number) {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${value} B`;
}

function normalizeDomainName(value: string | null | undefined) {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");
  return normalized || "Unspecified";
}

function abbreviateChartLabel(value: string, maxLength = 12) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}

function formatCountdown(distanceMs: number) {
  const absolute = Math.abs(distanceMs);
  const days = Math.floor(absolute / (1000 * 60 * 60 * 24));
  const hours = Math.floor((absolute / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((absolute / (1000 * 60)) % 60);

  const segments = [];
  if (days > 0) segments.push(`${days}d`);
  if (hours > 0 || days > 0) segments.push(`${hours}h`);
  segments.push(`${minutes}m`);
  return segments.slice(0, 3).join(" ");
}

function getDeadlineState(deadline: string | null, now: number): DeadlineState {
  if (!deadline) {
    return {
      label: "Not scheduled",
      timestampLabel: "No deadline has been set yet.",
      countdownLabel: "Waiting for schedule",
      tone: "neutral",
      isPassed: false,
      isConfigured: false,
    };
  }

  const timestamp = new Date(deadline).getTime();
  const distance = timestamp - now;
  const isPassed = distance < 0;
  const remaining = Math.abs(distance);
  const tone: DeadlineTone = isPassed
    ? "late"
    : remaining <= 1000 * 60 * 60 * 24
      ? "soon"
      : "safe";

  return {
    label: isPassed ? "Closed" : "Open",
    timestampLabel: formatDateTime(deadline),
    countdownLabel: isPassed
      ? `${formatCountdown(distance)} overdue`
      : `${formatCountdown(distance)} left`,
    tone,
    isPassed,
    isConfigured: true,
  };
}

function toDateTimeInputValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeInputValue(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function getStatusTone(status: ProposalStatus) {
  if (status === "Approved") return "approved";
  if (status === "In Review") return "review";
  if (status === "Revision Requested") return "revision";
  if (status === "Rejected") return "rejected";
  return "pending";
}

function getSimilarityTone(score: number) {
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function normalizeProposal(item: ProposalListItem): ProposalRecord {
  return {
    id: item.id,
    title: item.title,
    domain: normalizeDomainName(item.domain),
    status: item.status,
    updated_at: item.updated_at,
    student: item.student,
    reviewer: item.reviewer,
    abstract: "",
    problem: "",
    objectives: [],
    methodology: "",
    techStack: [],
    team: [{ name: item.student, role: "Student" }],
    document: item.document,
    evaluation: item.evaluation,
  };
}

function createEmptyEvaluationDraft(existing?: ProposalEvaluation | null): EvaluationDraft {
  return {
    criteria: existing?.criteria ?? createEmptyScores(),
    recommendation: existing?.recommendation ?? "Revise",
    strengths: existing?.strengths ?? "",
    risks: existing?.risks ?? "",
    summary: existing?.summary ?? "",
  };
}

async function detectApiAvailability() {
  try {
    const response = await fetch(`${API_BASE}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(STORAGE_KEYS.theme);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function App() {
  const [isBooting, setIsBooting] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [apiAvailable, setApiAvailable] = useState(false);
  const [apiChecked, setApiChecked] = useState(false);
  const [mode, setMode] = useState<AuthMode>("login");
  const [view, setView] = useState<View>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [busy, setBusy] = useState(false);
  const [deletingProposalId, setDeletingProposalId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ProposalStatus | "All">("All");
  const [query, setQuery] = useState("");
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [authForm, setAuthForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "student" as Role,
  });
  const [proposalForm, setProposalForm] = useState({
    title: "",
    domain: "",
    abstract: "",
    problem: "",
    objectives: "",
    methodology: "",
    techStack: "",
    team: "",
  });
  const [proposalDocumentDraft, setProposalDocumentDraft] = useState<ProposalUploadDraft | null>(null);
  const [evaluationDraft, setEvaluationDraft] = useState<EvaluationDraft>(
    createEmptyEvaluationDraft(),
  );
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettings>({
    submissionDeadline: null,
    reviewDeadline: null,
  });
  const [deadlineForm, setDeadlineForm] = useState({
    submissionDeadline: "",
    reviewDeadline: "",
  });
  const [now, setNow] = useState(() => Date.now());
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() =>
    readJson<AuthUser | null>(STORAGE_KEYS.currentUser, null),
  );
  const [proposals, setProposals] = useState<ProposalRecord[]>([]);
  const [userDirectory, setUserDirectory] = useState<UserDirectoryItem[]>([]);
  const [similarityReport, setSimilarityReport] = useState<SimilarityReport | null>(null);

  useEffect(() => {
    localStorage.removeItem("proposal-checker-users");
    localStorage.removeItem("proposal-checker-proposals");
    void detectApiAvailability().then((available) => {
      setApiAvailable(available);
      setApiChecked(true);
    });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const id = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const id = window.setTimeout(() => setIsBooting(false), 1400);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEYS.theme, theme);
  }, [theme]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);

  useEffect(() => {
    if (!currentUser) return;
    sessionStorage.setItem("auth", "true");
    sessionStorage.setItem("role", currentUser.role);
    const token = localStorage.getItem(STORAGE_KEYS.token);
    if (token) {
      sessionStorage.setItem("token", token);
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    if (apiAvailable) {
      void refreshProposals();
      void refreshWorkspaceSettings();
      if (currentUser.role !== "student") {
        void refreshUsers();
        void refreshSimilarityReport();
      }
    } else {
      setProposals([]);
      setUserDirectory([]);
      setSimilarityReport(null);
    }
  }, [apiAvailable, currentUser]);

  useEffect(() => {
    setDeadlineForm({
      submissionDeadline: toDateTimeInputValue(workspaceSettings.submissionDeadline),
      reviewDeadline: toDateTimeInputValue(workspaceSettings.reviewDeadline),
    });
  }, [workspaceSettings]);

  const visibleProposals = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    return proposals
      .filter((proposal) =>
        currentUser?.role === "student" ? proposal.student === currentUser.name : true,
      )
      .filter((proposal) =>
        statusFilter === "All" ? true : proposal.status === statusFilter,
      )
      .filter((proposal) =>
        lowered
          ? [proposal.title, proposal.domain, proposal.student, proposal.reviewer ?? ""]
              .join(" ")
              .toLowerCase()
              .includes(lowered)
          : true,
      )
      .sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
  }, [currentUser, proposals, query, statusFilter]);

  const selectedProposal =
    visibleProposals.find((proposal) => proposal.id === selectedProposalId) ?? null;

  const selectedProposalDocument = selectedProposal?.document ?? null;
  const submissionDeadlineState = useMemo(
    () => getDeadlineState(workspaceSettings.submissionDeadline, now),
    [now, workspaceSettings.submissionDeadline],
  );
  const reviewDeadlineState = useMemo(
    () => getDeadlineState(workspaceSettings.reviewDeadline, now),
    [now, workspaceSettings.reviewDeadline],
  );
  const reviewOpenItems = useMemo(
    () =>
      proposals.filter((proposal) => proposal.status === "Pending" || proposal.status === "In Review").length,
    [proposals],
  );

  useEffect(() => {
    if (view !== "review") return;
    if (!visibleProposals.length) {
      setSelectedProposalId(null);
      return;
    }
    if (!selectedProposalId || !visibleProposals.some((item) => item.id === selectedProposalId)) {
      setSelectedProposalId(visibleProposals[0].id);
    }
  }, [selectedProposalId, view, visibleProposals]);

  useEffect(() => {
    if (!selectedProposal) {
      setEvaluationDraft(createEmptyEvaluationDraft());
      return;
    }
    setEvaluationDraft(createEmptyEvaluationDraft(selectedProposal.evaluation));
  }, [selectedProposal]);

  const stats = useMemo(() => {
    const total = visibleProposals.length;
    const approved = visibleProposals.filter((item) => item.status === "Approved").length;
    const revision = visibleProposals.filter((item) => item.status === "Revision Requested").length;
    const rejected = visibleProposals.filter((item) => item.status === "Rejected").length;
    const scored = visibleProposals.filter((item) => item.evaluation);
    const averageScore = scored.length
      ? (scored.reduce((sum, item) => sum + (item.evaluation?.overallScore ?? 0), 0) / scored.length).toFixed(1)
      : "0.0";
    return { total, approved, revision, rejected, averageScore };
  }, [visibleProposals]);

  const notifications = useMemo(() => {
    const proposalNotifications = proposals
      .map((proposal) => {
        if (proposal.evaluation) {
          return {
            id: `evaluation-${proposal.id}`,
            title: `${proposal.title} was ${proposal.status.toLowerCase()}`,
            message: `${proposal.evaluation.evaluatorName} left an evaluation with score ${proposal.evaluation.overallScore}.`,
            time: proposal.updated_at,
            unread: proposal.status === "Revision Requested" || proposal.status === "Rejected",
          };
        }
        return {
          id: `proposal-${proposal.id}`,
          title: `${proposal.title} is awaiting review`,
          message: `Submitted by ${proposal.student}${proposal.reviewer ? ` and assigned to ${proposal.reviewer}` : ""}.`,
          time: proposal.updated_at,
          unread: proposal.status === "Pending" || proposal.status === "In Review",
        };
      })
    const deadlineNotifications = [
      workspaceSettings.submissionDeadline
        ? {
            id: "deadline-submission",
            title: submissionDeadlineState.isPassed ? "Submission window closed" : "Submission deadline is active",
            message: submissionDeadlineState.isPassed
              ? `Students can no longer submit new proposals. Deadline was ${submissionDeadlineState.timestampLabel}.`
              : `Proposal submission closes in ${submissionDeadlineState.countdownLabel.replace(" left", "")}.`,
            time: workspaceSettings.submissionDeadline,
            unread: submissionDeadlineState.tone === "soon" || submissionDeadlineState.tone === "late",
          }
        : null,
      workspaceSettings.reviewDeadline
        ? {
            id: "deadline-review",
            title: reviewDeadlineState.isPassed ? "Review deadline passed" : "Review countdown is running",
            message: reviewDeadlineState.isPassed
              ? `Outstanding reviews are overdue. Deadline was ${reviewDeadlineState.timestampLabel}.`
              : `${reviewOpenItems} review item${reviewOpenItems === 1 ? "" : "s"} remain with ${reviewDeadlineState.countdownLabel}.`,
            time: workspaceSettings.reviewDeadline,
            unread: reviewDeadlineState.tone === "soon" || reviewDeadlineState.tone === "late",
          }
        : null,
    ].filter(Boolean);

    return [...proposalNotifications, ...deadlineNotifications]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 10);
  }, [
    proposals,
    reviewDeadlineState.countdownLabel,
    reviewDeadlineState.isPassed,
    reviewDeadlineState.timestampLabel,
    reviewDeadlineState.tone,
    reviewOpenItems,
    submissionDeadlineState.countdownLabel,
    submissionDeadlineState.isPassed,
    submissionDeadlineState.timestampLabel,
    submissionDeadlineState.tone,
    workspaceSettings.reviewDeadline,
    workspaceSettings.submissionDeadline,
  ]);

  const adminMetrics = useMemo(() => {
    const total = proposals.length;
    const approved = proposals.filter((item) => item.status === "Approved").length;
    const pending = proposals.filter((item) => item.status === "Pending" || item.status === "In Review").length;
    const activeReviewers = new Set(proposals.map((item) => item.reviewer).filter(Boolean)).size;
    const approvalRate = total ? Math.round((approved / total) * 100) : 0;
    const byDomain = proposals.reduce<
      Record<string, { name: string; count: number; totalScore: number; reviewed: number }>
    >((accumulator, proposal) => {
      const domainName = normalizeDomainName(proposal.domain);
      const domainKey = domainName.toLowerCase();
      if (!accumulator[domainKey]) {
        accumulator[domainKey] = { name: domainName, count: 0, totalScore: 0, reviewed: 0 };
      }
      accumulator[domainKey].count += 1;
      if (proposal.evaluation) {
        accumulator[domainKey].totalScore += proposal.evaluation.overallScore;
        accumulator[domainKey].reviewed += 1;
      }
      return accumulator;
    }, {});
    const domains = Object.values(byDomain)
      .map((domain) => ({
        name: domain.name,
        count: domain.count,
        averageScore: domain.reviewed ? Number((domain.totalScore / domain.reviewed).toFixed(1)) : 0,
        reviewed: domain.reviewed,
      }))
      .sort((a, b) => b.count - a.count || b.averageScore - a.averageScore)
      .slice(0, 6);
    return { total, approved, pending, activeReviewers, approvalRate, domains };
  }, [proposals]);

  const myReviewQueue = useMemo(() => {
    if (!currentUser || currentUser.role === "student") return [];
    return proposals.filter(
      (proposal) =>
        proposal.reviewer === currentUser.name ||
        !proposal.reviewer ||
        proposal.status === "Pending" ||
        proposal.status === "In Review",
    );
  }, [currentUser, proposals]);

  const userSummary = useMemo(() => {
    return userDirectory.map((user) => ({
      ...user,
      proposals: proposals.filter((proposal) => proposal.student === user.name).length,
      reviews: proposals.filter((proposal) => proposal.reviewer === user.name).length,
    }));
  }, [proposals, userDirectory]);

  const evaluationBarData = useMemo(
    () =>
      evaluationCriteria.map((criterion) => ({
        label: criterion.label,
        shortLabel: criterion.label
          .split(" ")
          .map((word) => word.slice(0, 4))
          .join(" "),
        score: evaluationDraft.criteria[criterion.id],
        contribution: Number((evaluationDraft.criteria[criterion.id] * criterion.weight).toFixed(1)),
        signal: evaluationDraft.criteria[criterion.id],
      })),
    [evaluationDraft.criteria],
  );

  const evaluationPieData = useMemo(
    () =>
      evaluationCriteria.map((criterion, index) => ({
        name: criterion.label,
        value: Number((evaluationDraft.criteria[criterion.id] * criterion.weight).toFixed(1)),
        fill: chartColors[index % chartColors.length],
      })),
    [evaluationDraft.criteria],
  );

  const evaluationHighlights = useMemo(() => {
    const ranked = [...evaluationBarData].sort((left, right) => right.score - left.score);
    const average =
      evaluationBarData.reduce((sum, item) => sum + item.score, 0) / evaluationBarData.length;
    return {
      strongest: ranked[0],
      weakest: ranked[ranked.length - 1],
      average: average.toFixed(1),
    };
  }, [evaluationBarData]);

  const adminStatusChartData = useMemo(
    () => [
      { name: "Approved", value: proposals.filter((item) => item.status === "Approved").length, fill: "#22c55e", tone: "approved" },
      { name: "Revision Requested", value: proposals.filter((item) => item.status === "Revision Requested").length, fill: "#f59e0b", tone: "revision" },
      { name: "Rejected", value: proposals.filter((item) => item.status === "Rejected").length, fill: "#ef4444", tone: "rejected" },
      { name: "Pending", value: proposals.filter((item) => item.status === "Pending" || item.status === "In Review").length, fill: "#4f46e5", tone: "review" },
    ],
    [proposals],
  );

  const adminDomainChartData = useMemo(
    () =>
      adminMetrics.domains.map((domain, index) => ({
        ...domain,
        shortLabel: abbreviateChartLabel(domain.name),
        fill: chartColors[index % chartColors.length],
      })),
    [adminMetrics.domains],
  );

  const coadminStatusChartData = useMemo(() => {
    const groups = ["Pending", "In Review", "Revision Requested", "Approved", "Rejected"] as ProposalStatus[];
    return groups.map((status, index) => ({
      name: status,
      value: myReviewQueue.filter((proposal) => proposal.status === status).length,
      fill: chartColors[index % chartColors.length],
      signal: myReviewQueue.filter((proposal) => proposal.status === status).length,
    }));
  }, [myReviewQueue]);

  const coadminDocumentChartData = useMemo(() => {
    const withPdf = myReviewQueue.filter((proposal) => proposal.document).length;
    const withoutPdf = Math.max(myReviewQueue.length - withPdf, 0);
    return [
      { name: "PDF attached", value: withPdf, fill: "#4f46e5" },
      { name: "No PDF", value: withoutPdf, fill: "#cbd5e1" },
    ];
  }, [myReviewQueue]);

  async function refreshProposals() {
    if (!apiAvailable) return;
    try {
      const response = await listProposals();
      setProposals(response.items.map(normalizeProposal));
    } catch {
      setToast({ kind: "error", text: "Backend proposal sync failed." });
      setProposals([]);
    }
  }

  async function refreshUsers() {
    if (!apiAvailable) return;
    try {
      const response = await listUsers();
      setUserDirectory(response.items);
    } catch {
      setUserDirectory([]);
    }
  }

  async function refreshWorkspaceSettings() {
    if (!apiAvailable) return;
    try {
      const response = await getWorkspaceSettings();
      setWorkspaceSettings(response.item);
    } catch {
      setWorkspaceSettings({ submissionDeadline: null, reviewDeadline: null });
    }
  }

  async function refreshSimilarityReport() {
    if (!apiAvailable || currentUser?.role === "student") return;
    try {
      const response = await getSimilarityReport();
      setSimilarityReport(response.item);
    } catch {
      setSimilarityReport(null);
    }
  }

  async function handleAuthSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      if (!apiAvailable) throw new Error("Backend is not reachable. Start the API and try again.");
      const result =
        mode === "login"
          ? await login(authForm.email, authForm.password)
          : await register({
              name: authForm.name,
              email: authForm.email,
              password: authForm.password,
              role: authForm.role,
            });
      sessionStorage.setItem("auth", "true");
      sessionStorage.setItem("role", result.user.role);
      sessionStorage.setItem("token", result.token);
      localStorage.setItem(STORAGE_KEYS.token, result.token);
      writeJson(STORAGE_KEYS.currentUser, result.user);
      setCurrentUser(result.user);
      setAuthForm({ name: "", email: "", password: "", role: "student" });
      setToast({
        kind: "success",
        text: mode === "login" ? "Signed in successfully." : "Account created successfully.",
      });
    } catch (error) {
      setToast({
        kind: "error",
        text: error instanceof Error ? error.message : "Authentication failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleProposalSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser) return;
    if (submissionDeadlineState.isPassed) {
      setToast({ kind: "error", text: "The submission deadline has passed." });
      return;
    }

    const objectives = proposalForm.objectives.split("\n").map((item) => item.trim()).filter(Boolean);
    const techStack = proposalForm.techStack.split(",").map((item) => item.trim()).filter(Boolean);
    const team = proposalForm.team
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [name, role] = entry.split("-").map((item) => item.trim());
        return { name: name || currentUser.name, role: role || "Contributor" };
      });

    setBusy(true);
    try {
      if (!apiAvailable) throw new Error("Backend is not reachable. Start the API and try again.");
      const result = await createProposal({
        title: proposalForm.title,
        domain: proposalForm.domain,
        abstract: proposalForm.abstract,
        problem: proposalForm.problem,
        objectives,
        methodology: proposalForm.methodology,
        techStack,
        team,
      });
      if (proposalDocumentDraft) {
        await uploadProposalDocument(result.id, proposalDocumentDraft.file);
      }
      await refreshProposals();
      await refreshSimilarityReport();
      setProposalForm({
        title: "",
        domain: "",
        abstract: "",
        problem: "",
        objectives: "",
        methodology: "",
        techStack: "",
        team: "",
      });
      setProposalDocumentDraft(null);
      setView("overview");
      setToast({ kind: "success", text: "Proposal submitted successfully." });
    } catch (error) {
      setToast({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not submit proposal.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEvaluation() {
    if (!currentUser || !selectedProposal) return;
    setBusy(true);
    try {
      if (!apiAvailable) throw new Error("Backend is not reachable. Start the API and try again.");
      const response = await saveProposalEvaluation(selectedProposal.id, {
        criteria: evaluationDraft.criteria,
        recommendation: evaluationDraft.recommendation,
        strengths: evaluationDraft.strengths,
        risks: evaluationDraft.risks,
        summary: evaluationDraft.summary,
      });
      await refreshProposals();
      setToast({
        kind: "success",
        text: `Evaluation saved with score ${response.item.overallScore}.`,
      });
    } catch (error) {
      setToast({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not save evaluation.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteProposal(proposal: ProposalRecord) {
    if (currentUser?.role !== "admin") {
      setToast({ kind: "error", text: "Only admins can delete proposals." });
      return;
    }

    const shouldDelete = window.confirm(
      `Delete "${proposal.title}"? This will also remove its evaluation and uploaded PDF.`,
    );
    if (!shouldDelete) return;

    setDeletingProposalId(proposal.id);
    try {
      const response = await deleteProposal(proposal.id);
      if (selectedProposalId === proposal.id) {
        setSelectedProposalId(null);
      }
      await refreshProposals();
      await refreshWorkspaceSettings();
      await refreshSimilarityReport();
      setToast({
        kind: "success",
        text: `"${response.title}" was deleted successfully.`,
      });
    } catch (error) {
      setToast({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not delete the proposal.",
      });
    } finally {
      setDeletingProposalId(null);
    }
  }

  async function handleWorkspaceSettingsSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser || currentUser.role === "student") return;

    setBusy(true);
    try {
      const nextSettings = {
        submissionDeadline: fromDateTimeInputValue(deadlineForm.submissionDeadline),
        reviewDeadline: fromDateTimeInputValue(deadlineForm.reviewDeadline),
      };

      if (
        nextSettings.submissionDeadline &&
        nextSettings.reviewDeadline &&
        new Date(nextSettings.reviewDeadline).getTime() < new Date(nextSettings.submissionDeadline).getTime()
      ) {
        throw new Error("Review deadline should be after the submission deadline.");
      }

      const response = await updateWorkspaceSettings(nextSettings);
      setWorkspaceSettings(response.item);
      setToast({ kind: "success", text: "Workspace deadlines updated." });
    } catch (error) {
      setToast({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not save workspace deadlines.",
      });
    } finally {
      setBusy(false);
    }
  }

  function handleLogout() {
    sessionStorage.clear();
    localStorage.removeItem(STORAGE_KEYS.currentUser);
    localStorage.removeItem(STORAGE_KEYS.token);
    setCurrentUser(null);
    setView("overview");
    setSidebarOpen(false);
    setMode("login");
    setSelectedProposalId(null);
  }

  function handleNavigate(nextView: View) {
    setView(nextView);
    setSidebarOpen(false);
  }

  function openProposalForReview(proposalId: string) {
    setQuery("");
    setStatusFilter("All");
    setSelectedProposalId(proposalId);
    handleNavigate("review");
  }

  if (isBooting) {
    return <AppLoadingScreen />;
  }

  function handleProposalDocumentChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setToast({ kind: "error", text: "Please upload a PDF file only." });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setToast({ kind: "error", text: "Please keep the PDF under 10 MB." });
      return;
    }

    setProposalDocumentDraft({
      file,
      fileName: file.name,
      fileSize: file.size,
      uploadedAt: new Date().toISOString(),
    });
  }

  async function handleDownloadProposalDocument(proposalId: string) {
    try {
      const { blob, fileName } = await downloadProposalDocument(proposalId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setToast({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not download the PDF.",
      });
    }
  }

  if (!currentUser) {
    return (
      <div className="app-shell auth-shell">
        <section className="hero-panel">
          <div className="hero-logo-wrap">
            <div className="hero-logo" aria-hidden="true">
              <div className="hero-logo-square hero-logo-square-one" />
              <div className="hero-logo-square hero-logo-square-two" />
              <div className="hero-logo-square hero-logo-square-three" />
              <div className="hero-logo-core">
                <ProjectLogoMark className="hero-logo-mark" />
              </div>
            </div>
            <div className="hero-branding">
              <h1>
                Project <span>Proposal Checker</span>
              </h1>
            </div>
          </div>
        </section>

        <section className="auth-panel">
          <div className="auth-header">
            <div className="brand-mark">
              <ProjectLogoMark className="brand-logo-mark" />
            </div>
            <div>
              <h2>{mode === "login" ? "Welcome back" : "Create your account"}</h2>
              <p>{apiChecked && !apiAvailable ? "Backend connection required." : "Connect and continue."}</p>
            </div>
          </div>

          <form className="auth-form" onSubmit={handleAuthSubmit}>
            {mode === "register" && (
              <label>
                Full name
                <input
                  value={authForm.name}
                  onChange={(event) =>
                    setAuthForm((current) => ({ ...current, name: event.target.value }))
                  }
                  required
                />
              </label>
            )}

            <label>
              {mode === "login" ? "Login as" : "Register as"}
              <select
                value={authForm.role}
                onChange={(event) =>
                  setAuthForm((current) => ({
                    ...current,
                    role: event.target.value as Role,
                  }))
                }
              >
                <option value="student">Student</option>
                <option value="admin">Admin</option>
                <option value="coadmin">Co-admin</option>
              </select>
            </label>

            <label>
              Email
              <input
                type="email"
                value={authForm.email}
                onChange={(event) =>
                  setAuthForm((current) => ({ ...current, email: event.target.value }))
                }
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={authForm.password}
                onChange={(event) =>
                  setAuthForm((current) => ({ ...current, password: event.target.value }))
                }
                required
              />
            </label>

            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>

          <div className="auth-footer">
            <button
              className="text-button"
              type="button"
              onClick={() => setMode((current) => (current === "login" ? "register" : "login"))}
            >
              {mode === "login"
                ? "Need an account? Register"
                : "Already have an account? Sign in"}
            </button>
          </div>
        </section>

        {toast && <ToastView toast={toast} />}
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <button
        type="button"
        className="mobile-menu-button"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open navigation menu"
      >
        <Menu size={20} />
      </button>

      <div className="corner-status-dot" aria-label="System status online" title="Online" />

      <button
        type="button"
        className={sidebarOpen ? "sidebar-backdrop visible" : "sidebar-backdrop"}
        onClick={() => setSidebarOpen(false)}
        aria-label="Close navigation menu"
      />

      <aside className={sidebarOpen ? "sidebar open" : "sidebar"}>
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <div className="brand-mark">
              <ProjectLogoMark className="brand-logo-mark" />
            </div>
            <div>
              <strong>Project <span>Proposal Checker</span></strong>
            </div>
          </div>
          <button
            type="button"
            className="sidebar-close-button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          <button className={view === "overview" ? "nav-item active" : "nav-item"} onClick={() => handleNavigate("overview")}>
            <LayoutDashboard size={18} />
            Overview
          </button>
          {currentUser.role === "student" && (
            <button className={view === "submit" ? "nav-item active" : "nav-item"} onClick={() => handleNavigate("submit")}>
              <FileText size={18} />
              Submit Proposal
            </button>
          )}
          {(currentUser.role === "admin" || currentUser.role === "coadmin") && (
            <>
              <button className={view === "review" ? "nav-item active" : "nav-item"} onClick={() => handleNavigate("review")}>
                <ClipboardCheck size={18} />
                Evaluation Board
              </button>
              <button className={view === "analytics" ? "nav-item active" : "nav-item"} onClick={() => handleNavigate("analytics")}>
                <BarChart3 size={18} />
                Analytics
              </button>
              <button className={view === "similarity" ? "nav-item active" : "nav-item"} onClick={() => handleNavigate("similarity")}>
                <Search size={18} />
                Similarity Check
              </button>
              <button className={view === "notifications" ? "nav-item active" : "nav-item"} onClick={() => handleNavigate("notifications")}>
                <Bell size={18} />
                Notifications
              </button>
            </>
          )}
          {currentUser.role === "admin" && (
            <button className={view === "users" ? "nav-item active" : "nav-item"} onClick={() => handleNavigate("users")}>
              <Users size={18} />
              User Management
            </button>
          )}
          <button className={view === "settings" ? "nav-item active" : "nav-item"} onClick={() => handleNavigate("settings")}>
            <Settings size={18} />
            Settings
          </button>
        </nav>

        <div className="sidebar-user">
          <div>
            <strong>{currentUser.name}</strong>
            <span>{currentUser.role}</span>
          </div>
          <button className="ghost-button" onClick={handleLogout}>
            <LogOut size={16} />
            Log out
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="main-header">
          <div className="main-header-copy">
            <div className="header-brand-line">
              <div className="brand-mark compact">
                <ProjectLogoMark className="brand-logo-mark compact-mark" />
              </div>
              <strong>
                Project <span>Proposal Checker</span>
              </strong>
            </div>
            <h1>
              {view === "overview" && "Proposal overview"}
              {view === "submit" && "Submit a new proposal"}
              {view === "review" && "Evaluate submissions"}
              {view === "analytics" && "System analytics"}
              {view === "similarity" && "Plagiarism and similarity"}
              {view === "notifications" && "Notifications"}
              {view === "users" && "User management"}
              {view === "settings" && "Workspace settings"}
            </h1>
            <p>
              {currentUser.role === "student"
                ? "Track your submissions and the evaluation outcome of each proposal."
                : view === "similarity"
                  ? "Compare proposal text overlap and review suspicious matches in one place."
                : view === "analytics"
                  ? "Follow proposal volume, approval rate, and reviewer activity."
                  : view === "users"
                    ? "Keep your user directory and review ownership visible."
                    : "Use the rubric to produce consistent, reviewable proposal decisions."}
            </p>
          </div>
          <div className="main-header-actions">
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
              aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
              title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            >
              <span className="theme-toggle-icon">
                {theme === "light" ? <Moon size={16} /> : <SunMedium size={16} />}
              </span>
              <span>{theme === "light" ? "Dark mode" : "Light mode"}</span>
            </button>

            {currentUser.role === "student" && (
              <aside className="deadline-corner" aria-label="Workspace deadlines">
                <DeadlineCard
                  title="Submit"
                  description="Proposal intake"
                  state={submissionDeadlineState}
                />
                <DeadlineCard
                  title="Review"
                  description="Evaluation schedule"
                  state={reviewDeadlineState}
                />
              </aside>
            )}
          </div>
        </header>

        <div key={view} className="page-transition-shell">
        {view === "overview" && (
          <>
            {currentUser.role === "student" ? (
              <section className="stats-grid">
                <StatCard icon={<FileText size={18} />} label="Visible proposals" value={String(stats.total)} />
                <StatCard icon={<CheckCircle2 size={18} />} label="Approved" value={String(stats.approved)} />
                <StatCard icon={<AlertTriangle size={18} />} label="Needs revision" value={String(stats.revision)} />
                <StatCard icon={<XCircle size={18} />} label="Rejected" value={String(stats.rejected)} />
                <StatCard icon={<ClipboardCheck size={18} />} label="Average score" value={stats.averageScore} />
              </section>
            ) : currentUser.role === "admin" ? (
              <>
                <section className="stats-grid">
                  <StatCard icon={<FileText size={18} />} label="Total proposals" value={String(adminMetrics.total)} />
                  <StatCard icon={<CheckCircle2 size={18} />} label="Approval rate" value={`${adminMetrics.approvalRate}%`} />
                  <StatCard icon={<Users size={18} />} label="Active reviewers" value={String(adminMetrics.activeReviewers)} />
                  <StatCard icon={<Clock3 size={18} />} label="Pending reviews" value={String(adminMetrics.pending)} />
                </section>
                <section className="admin-grid">
                  <FuturisticDonutChart
                    title="Proposal status mix"
                    data={adminStatusChartData}
                    centerLabel="Tracked"
                    centerValue={String(adminMetrics.total)}
                    valueFormatter={(value) => String(value)}
                  />
                  <FuturisticHistogramChart
                    title="Top domains"
                    data={adminDomainChartData}
                    xKey="shortLabel"
                    barKey="count"
                    lineKey="averageScore"
                    labelKey="name"
                    barLabel="Proposal count"
                    lineLabel="Average score"
                    valueFormatter={(value, key) => (key === "averageScore" ? `${value.toFixed(1)}/10` : String(value))}
                    lineDomain={[0, 10]}
                    emptyMessage="Add proposals with domain names to unlock this chart."
                  />
                </section>
              </>
            ) : (
              <>
                <section className="stats-grid compact">
                  <StatCard icon={<FileText size={18} />} label="Assigned to me" value={String(myReviewQueue.length)} />
                  <StatCard icon={<CheckCircle2 size={18} />} label="Reviewed" value={String(proposals.filter((proposal) => proposal.evaluation?.evaluatorName === currentUser.name).length)} />
                  <StatCard icon={<Clock3 size={18} />} label="Pending action" value={String(myReviewQueue.filter((proposal) => proposal.status === "Pending" || proposal.status === "In Review").length)} />
                </section>
                <section className="panel">
                  <div className="panel-title-row">
                    <h3>My assigned reviews</h3>
                    <span>Co-admin dashboard view</span>
                  </div>
                  <div className="table-like-list">
                    {myReviewQueue.map((proposal) => (
                      <div key={proposal.id} className="table-like-row">
                        <div>
                          <strong>{proposal.title}</strong>
                          <span>{proposal.student} - {proposal.domain}</span>
                        </div>
                        <div className="table-like-meta">
                          <span className={`status-chip ${getStatusTone(proposal.status)}`}>{proposal.status}</span>
                          <button className="ghost-button" onClick={() => { setView("review"); setSelectedProposalId(proposal.id); }}>
                            Evaluate
                          </button>
                        </div>
                      </div>
                    ))}
                    {!myReviewQueue.length && (
                      <div className="empty-state">
                        <Clock3 size={18} />
                        <span>No assigned reviews yet.</span>
                      </div>
                    )}
                  </div>
                </section>
                <section className="admin-grid">
                  <FuturisticHistogramChart
                    title="Queue by status"
                    data={coadminStatusChartData}
                    xKey="name"
                    barKey="value"
                    lineKey="signal"
                    labelKey="name"
                    barLabel="Queue count"
                    lineLabel="Trend graph"
                    valueFormatter={(value) => String(value)}
                  />
                  <FuturisticDonutChart
                    title="Document coverage"
                    data={coadminDocumentChartData}
                    centerLabel="Assigned"
                    centerValue={String(myReviewQueue.length)}
                    valueFormatter={(value) => String(value)}
                  />
                </section>
              </>
            )}

            <section className="panel">
              <div className="panel-toolbar">
                <label className="search-field">
                  <Search size={16} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search by title, domain, student, or reviewer"
                  />
                </label>

                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as ProposalStatus | "All")
                  }
                >
                  <option value="All">All statuses</option>
                  <option value="Pending">Pending</option>
                  <option value="In Review">In Review</option>
                  <option value="Approved">Approved</option>
                  <option value="Revision Requested">Revision Requested</option>
                  <option value="Rejected">Rejected</option>
                </select>
              </div>

              <div className="proposal-list">
                {visibleProposals.map((proposal) => (
                  <article key={proposal.id} className="proposal-card">
                    <div className="proposal-head">
                      <div>
                        <h3>{proposal.title}</h3>
                        <p>{proposal.domain}</p>
                      </div>
                      <span className={`status-chip ${getStatusTone(proposal.status)}`}>
                        {proposal.status}
                      </span>
                    </div>

                    <p className="proposal-copy">
                      {proposal.abstract || "No abstract is available in the current listing view."}
                    </p>

                    <div className="proposal-meta">
                      <span>Student: {proposal.student}</span>
                      <span>Reviewer: {proposal.reviewer ?? "Unassigned"}</span>
                      <span>Updated: {formatDate(proposal.updated_at)}</span>
                    </div>

                    <div className="tag-row">
                      {proposal.document && (
                        <span className="tag">PDF attached</span>
                      )}
                      {proposal.evaluation ? (
                        <>
                          <span className="tag">Score: {proposal.evaluation.overallScore}</span>
                          <span className="tag">
                            Recommendation: {proposal.evaluation.recommendation}
                          </span>
                        </>
                      ) : (
                        <span className="tag">Awaiting evaluation</span>
                      )}
                    </div>

                    <div className="action-row proposal-actions">
                      {(currentUser.role === "admin" || currentUser.role === "coadmin") && (
                        <button
                          className="ghost-button"
                          onClick={() => {
                            setView("review");
                            setSelectedProposalId(proposal.id);
                          }}
                        >
                          Evaluate
                        </button>
                      )}
                      {currentUser.role === "admin" && (
                        <button
                          className="ghost-button danger-ghost"
                          disabled={deletingProposalId === proposal.id}
                          onClick={() => void handleDeleteProposal(proposal)}
                        >
                          <Trash2 size={16} />
                          {deletingProposalId === proposal.id ? "Deleting..." : "Delete"}
                        </button>
                      )}
                    </div>
                  </article>
                ))}

                {!visibleProposals.length && (
                  <div className="empty-state">
                    <AlertTriangle size={18} />
                    <span>No proposals match the current filters yet.</span>
                  </div>
                )}
              </div>
            </section>
          </>
        )}

        {view === "submit" && (
          <section className="panel form-panel">
            <div className={submissionDeadlineState.isPassed ? "deadline-banner late" : "deadline-banner"}>
              <div>
                <strong>
                  {submissionDeadlineState.isPassed
                    ? "Submission window is closed"
                    : submissionDeadlineState.isConfigured
                      ? `Submission closes in ${submissionDeadlineState.countdownLabel.replace(" left", "")}`
                      : "Submission deadline has not been set yet"}
                </strong>
                <span>
                  {submissionDeadlineState.isConfigured
                    ? `Deadline: ${submissionDeadlineState.timestampLabel}`
                    : "Admins can add a submission deadline from workspace settings."}
                </span>
              </div>
            </div>
            <form className="proposal-form" onSubmit={handleProposalSubmit}>
              <label>
                Proposal title
                <input
                  value={proposalForm.title}
                  onChange={(event) =>
                    setProposalForm((current) => ({ ...current, title: event.target.value }))
                  }
                  required
                />
              </label>

              <label>
                Domain
                <input
                  value={proposalForm.domain}
                  onChange={(event) =>
                    setProposalForm((current) => ({ ...current, domain: event.target.value }))
                  }
                  required
                />
              </label>

              <label className="full-width">
                Abstract
                <textarea
                  rows={4}
                  value={proposalForm.abstract}
                  onChange={(event) =>
                    setProposalForm((current) => ({ ...current, abstract: event.target.value }))
                  }
                  required
                />
              </label>

              <label className="full-width">
                Problem statement
                <textarea
                  rows={4}
                  value={proposalForm.problem}
                  onChange={(event) =>
                    setProposalForm((current) => ({ ...current, problem: event.target.value }))
                  }
                  required
                />
              </label>

              <label className="full-width">
                Objectives
                <textarea
                  rows={4}
                  value={proposalForm.objectives}
                  onChange={(event) =>
                    setProposalForm((current) => ({ ...current, objectives: event.target.value }))
                  }
                  placeholder="One objective per line"
                  required
                />
              </label>

              <label className="full-width">
                Methodology
                <textarea
                  rows={4}
                  value={proposalForm.methodology}
                  onChange={(event) =>
                    setProposalForm((current) => ({ ...current, methodology: event.target.value }))
                  }
                  required
                />
              </label>

              <div className="full-width upload-field">
                <div className="upload-dropzone">
                  <div className="upload-copy">
                    <div className="upload-icon">
                      <Upload size={18} />
                    </div>
                    <div>
                      <strong>Project model PDF</strong>
                      <p>Attach the project PDF so reviewers can use it during evaluation.</p>
                    </div>
                  </div>

                  <label className="ghost-button upload-trigger">
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      onChange={handleProposalDocumentChange}
                    />
                    {proposalDocumentDraft ? "Replace PDF" : "Choose PDF"}
                  </label>
                </div>

                {proposalDocumentDraft ? (
                  <div className="uploaded-file-card">
                    <div>
                      <strong>{proposalDocumentDraft.fileName}</strong>
                      <span>
                        {formatFileSize(proposalDocumentDraft.fileSize)} • Added{" "}
                        {formatDate(proposalDocumentDraft.uploadedAt)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setProposalDocumentDraft(null)}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <p className="upload-note">PDF only, up to 10 MB.</p>
                )}
              </div>

              <label>
                Tech stack
                <input
                  value={proposalForm.techStack}
                  onChange={(event) =>
                    setProposalForm((current) => ({ ...current, techStack: event.target.value }))
                  }
                  placeholder="React, Node.js, PostgreSQL"
                />
              </label>

              <label>
                Team
                <textarea
                  rows={4}
                  value={proposalForm.team}
                  onChange={(event) =>
                    setProposalForm((current) => ({ ...current, team: event.target.value }))
                  }
                  placeholder="SupraX - Research Lead"
                />
              </label>

              <div className="full-width form-actions">
                <button type="submit" className="primary-button" disabled={busy || submissionDeadlineState.isPassed}>
                  {busy ? "Submitting..." : submissionDeadlineState.isPassed ? "Submission closed" : "Submit proposal"}
                </button>
              </div>
            </form>
          </section>
        )}

        {view === "review" && (
          <section className="evaluation-layout">
            <article className="panel review-queue-panel">
              <div className="review-panel-header">
                <h3>Proposal queue</h3>
                <span>{visibleProposals.length} items</span>
              </div>

              <div className={reviewDeadlineState.isPassed ? "deadline-banner late compact" : "deadline-banner compact"}>
                <div>
                  <strong>
                    {reviewDeadlineState.isConfigured
                      ? reviewDeadlineState.isPassed
                        ? "Review deadline has passed"
                        : `Review time remaining: ${reviewDeadlineState.countdownLabel}`
                      : "Review deadline has not been scheduled yet"}
                  </strong>
                  <span>
                    {reviewDeadlineState.isConfigured
                      ? `${reviewDeadlineState.timestampLabel} • ${reviewOpenItems} proposal${reviewOpenItems === 1 ? "" : "s"} awaiting action`
                      : "Admins can add the review deadline in workspace settings."}
                  </span>
                </div>
              </div>

              <div className="review-list">
                {visibleProposals.map((proposal) => (
                  <button
                    key={proposal.id}
                    className={
                      proposal.id === selectedProposalId
                        ? "review-list-item active"
                        : "review-list-item"
                    }
                    onClick={() => setSelectedProposalId(proposal.id)}
                  >
                    <div>
                      <strong>{proposal.title}</strong>
                      <span>{proposal.student}</span>
                    </div>
                    <span className={`status-chip ${getStatusTone(proposal.status)}`}>
                      {proposal.status}
                    </span>
                  </button>
                ))}
                {!visibleProposals.length && (
                  <div className="empty-state">
                    <Clock3 size={18} />
                    <span>No proposals are available for evaluation yet.</span>
                  </div>
                )}
              </div>
            </article>

            <article className="panel evaluation-panel">
              {selectedProposal ? (
                <>
                  <div className="review-panel-header">
                    <div>
                      <h3>{selectedProposal.title}</h3>
                      <p>{selectedProposal.student} - {selectedProposal.domain}</p>
                    </div>
                    <span className="score-pill">
                      Weighted score: {calculateOverallScore(evaluationDraft.criteria)}
                    </span>
                  </div>

                  <div className="evaluation-summary-grid">
                    <article className="summary-card">
                      <span>Attached PDF</span>
                      <strong>
                        {selectedProposalDocument ? selectedProposalDocument.fileName : "Not uploaded"}
                      </strong>
                      <p>
                        {selectedProposalDocument
                          ? `${formatFileSize(selectedProposalDocument.fileSize)} • ${formatDate(selectedProposalDocument.uploadedAt)}`
                          : "Students can attach a project model PDF during submission."}
                      </p>
                      {selectedProposalDocument && (
                        <button
                          type="button"
                          className="ghost-button summary-action"
                          onClick={() => handleDownloadProposalDocument(selectedProposal.id)}
                        >
                          Download PDF
                        </button>
                      )}
                    </article>
                    <article className="summary-card">
                      <span>Strongest criterion</span>
                      <strong>{evaluationHighlights.strongest.label}</strong>
                      <p>{evaluationHighlights.strongest.score}/10 in the current draft</p>
                    </article>
                    <article className="summary-card">
                      <span>Needs more work</span>
                      <strong>{evaluationHighlights.weakest.label}</strong>
                      <p>{evaluationHighlights.weakest.score}/10 in the current draft</p>
                    </article>
                    <article className="summary-card">
                      <span>Average rubric score</span>
                      <strong>{evaluationHighlights.average}/10</strong>
                      <p>Live average across all evaluation criteria</p>
                    </article>
                  </div>

                  <div className="criteria-grid">
                    {evaluationCriteria.map((criterion) => (
                      <label key={criterion.id} className="criterion-card">
                        <div className="criterion-copy">
                          <strong>{criterion.label}</strong>
                          <span>{criterion.description}</span>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={10}
                          value={evaluationDraft.criteria[criterion.id]}
                          onChange={(event) =>
                            setEvaluationDraft((current) => ({
                              ...current,
                              criteria: {
                                ...current.criteria,
                                [criterion.id]: Number(event.target.value),
                              },
                            }))
                          }
                        />
                        <div className="criterion-footer">
                          <span>Weight {Math.round(criterion.weight * 100)}%</span>
                          <strong>{evaluationDraft.criteria[criterion.id]}/10</strong>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="evaluation-chart-grid">
                    <FuturisticHistogramChart
                      title="Score by criterion"
                      data={evaluationBarData}
                      xKey="shortLabel"
                      barKey="score"
                      lineKey="signal"
                      labelKey="label"
                      barLabel="Criterion score"
                      lineLabel="Signal line"
                      valueFormatter={(value, key) =>
                        key === "signal" || key === "score" ? `${value}/10` : value.toFixed(1)
                      }
                      yDomain={[0, 10]}
                    />

                    <FuturisticDonutChart
                      title="Weighted contribution"
                      data={evaluationPieData}
                      centerLabel="Weighted score"
                      centerValue={String(calculateOverallScore(evaluationDraft.criteria))}
                      valueFormatter={(value) => value.toFixed(1)}
                    />
                  </div>

                  <div className="evaluation-fields">
                    <label>
                      Recommendation
                      <select
                        value={evaluationDraft.recommendation}
                        onChange={(event) =>
                          setEvaluationDraft((current) => ({
                            ...current,
                            recommendation: event.target.value as EvaluationRecommendation,
                          }))
                        }
                      >
                        <option value="Approve">Approve</option>
                        <option value="Revise">Revise</option>
                        <option value="Reject">Reject</option>
                      </select>
                    </label>

                    <label className="full-width">
                      Key strengths
                      <textarea
                        rows={3}
                        value={evaluationDraft.strengths}
                        onChange={(event) =>
                          setEvaluationDraft((current) => ({
                            ...current,
                            strengths: event.target.value,
                          }))
                        }
                        required
                      />
                    </label>

                    <label className="full-width">
                      Risks or required changes
                      <textarea
                        rows={3}
                        value={evaluationDraft.risks}
                        onChange={(event) =>
                          setEvaluationDraft((current) => ({
                            ...current,
                            risks: event.target.value,
                          }))
                        }
                        required
                      />
                    </label>

                    <label className="full-width">
                      Evaluation summary
                      <textarea
                        rows={4}
                        value={evaluationDraft.summary}
                        onChange={(event) =>
                          setEvaluationDraft((current) => ({
                            ...current,
                            summary: event.target.value,
                          }))
                        }
                        required
                      />
                    </label>
                  </div>

                  <div className="evaluation-footer">
                    {selectedProposal.evaluation && (
                      <div className="evaluation-history">
                        Last evaluated by {selectedProposal.evaluation.evaluatorName} on{" "}
                        {formatDate(selectedProposal.evaluation.evaluatedAt)}
                      </div>
                    )}
                    <button className="primary-button" onClick={handleSaveEvaluation} disabled={busy}>
                      {busy ? "Saving..." : "Save evaluation"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <Users size={18} />
                  <span>Select a proposal to start evaluating it.</span>
                </div>
              )}
            </article>
          </section>
        )}

        {view === "analytics" && (
          <>
            <section className="admin-grid">
              <article className="panel">
                <div className="panel-title-row">
                  <h3>Platform summary</h3>
                  <span>Admin analytics</span>
                </div>
                <div className="analytics-metrics">
                  <div className="metric-tile">
                    <strong>{adminMetrics.total}</strong>
                    <span>Total proposals</span>
                  </div>
                  <div className="metric-tile">
                    <strong>{adminMetrics.approvalRate}%</strong>
                    <span>Approval rate</span>
                  </div>
                  <div className="metric-tile">
                    <strong>{adminMetrics.activeReviewers}</strong>
                    <span>Active reviewers</span>
                  </div>
                  <div className="metric-tile">
                    <strong>{proposals.filter((item) => item.document).length}</strong>
                    <span>PDF-backed proposals</span>
                  </div>
                </div>
              </article>
              <article className="panel">
                <div className="panel-title-row">
                  <h3>Evaluation outcomes</h3>
                  <span>Current status mix</span>
                </div>
                <div className="status-breakdown">
                  {adminStatusChartData.map((item) => (
                    <div key={item.name} className="status-breakdown-row">
                      <span className={`status-chip ${item.tone}`}>{item.name}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              </article>
            </section>
            <section className="admin-grid">
              <FuturisticHistogramChart
                title="Domain performance"
                data={adminDomainChartData}
                xKey="shortLabel"
                barKey="count"
                lineKey="averageScore"
                labelKey="name"
                barLabel="Proposal count"
                lineLabel="Average score"
                valueFormatter={(value, key) => (key === "averageScore" ? `${value.toFixed(1)}/10` : String(value))}
                lineDomain={[0, 10]}
                emptyMessage="Domain performance appears here after proposals are submitted."
              />
              <FuturisticDonutChart
                title="Proposal status distribution"
                data={adminStatusChartData}
                centerLabel="Tracked"
                centerValue={String(adminMetrics.total)}
                valueFormatter={(value) => String(value)}
              />
            </section>
          </>
        )}

        {view === "similarity" && (
          <>
            <section className="stats-grid compact">
              <StatCard
                icon={<FileText size={18} />}
                label="Proposals scanned"
                value={String(similarityReport?.totalProposals ?? 0)}
              />
              <StatCard
                icon={<Search size={18} />}
                label="Compared pairs"
                value={String(similarityReport?.comparedPairs ?? 0)}
              />
              <StatCard
                icon={<AlertTriangle size={18} />}
                label="Flagged pairs"
                value={String(similarityReport?.flaggedPairs ?? 0)}
              />
              <StatCard
                icon={<ClipboardCheck size={18} />}
                label="Average similarity"
                value={`${similarityReport?.averageSimilarity ?? 0}%`}
              />
            </section>

            <section className="panel">
              <div className="panel-title-row">
                <h3>Similarity alerts</h3>
                <span>
                  {similarityReport?.generatedAt
                    ? `Generated ${formatDateTime(similarityReport.generatedAt)}`
                    : "Waiting for report"}
                </span>
              </div>

              <div className="similarity-list">
                {similarityReport?.pairs.length ? (
                  similarityReport.pairs.map((pair) => (
                    <article key={pair.id} className="similarity-card">
                      <div className="similarity-card-header">
                        <div>
                          <h4>{pair.similarityScore}% overlap</h4>
                          <p>{pair.riskLevel} similarity risk</p>
                        </div>
                        <span className={`tag similarity-chip ${getSimilarityTone(pair.similarityScore)}`}>
                          {pair.riskLevel}
                        </span>
                      </div>

                      <div className="similarity-grid">
                        <div className="similarity-proposal-block">
                          <strong>{pair.left.title}</strong>
                          <span>{pair.left.student} - {pair.left.domain}</span>
                          <span className={`status-chip ${getStatusTone(pair.left.status)}`}>{pair.left.status}</span>
                          <button className="ghost-button" onClick={() => openProposalForReview(pair.left.id)}>
                            Review left proposal
                          </button>
                        </div>
                        <div className="similarity-proposal-block">
                          <strong>{pair.right.title}</strong>
                          <span>{pair.right.student} - {pair.right.domain}</span>
                          <span className={`status-chip ${getStatusTone(pair.right.status)}`}>{pair.right.status}</span>
                          <button className="ghost-button" onClick={() => openProposalForReview(pair.right.id)}>
                            Review right proposal
                          </button>
                        </div>
                      </div>

                      <div className="similarity-sections">
                        {pair.sections.slice(0, 4).map((section) => (
                          <div key={section.name} className="similarity-section-row">
                            <span>{section.name}</span>
                            <strong>{section.score}%</strong>
                          </div>
                        ))}
                      </div>

                      <div className="tag-row">
                        {pair.overlappingTerms.length ? (
                          pair.overlappingTerms.map((term) => (
                            <span key={term} className="tag similarity-term">{term}</span>
                          ))
                        ) : (
                          <span className="tag">No strong shared keywords</span>
                        )}
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">
                    <Search size={18} />
                    <span>No high-similarity proposal pairs were flagged yet.</span>
                  </div>
                )}
              </div>
            </section>
          </>
        )}

        {view === "notifications" && (
          <section className="panel">
            <div className="panel-title-row">
              <h3>Activity feed</h3>
              <span>{notifications.length} recent updates</span>
            </div>
            <div className="notification-list">
              {notifications.map((notification) => (
                <article key={notification.id} className={notification.unread ? "notification-item unread" : "notification-item"}>
                  <div className="notification-icon">
                    <Bell size={16} />
                  </div>
                  <div className="notification-copy">
                    <strong>{notification.title}</strong>
                    <p>{notification.message}</p>
                  </div>
                  <span className="notification-time">{formatDate(notification.time)}</span>
                </article>
              ))}
            </div>
          </section>
        )}

        {view === "users" && (
          <section className="panel">
            <div className="panel-title-row">
              <h3>User directory</h3>
              <span>{userSummary.length} users</span>
            </div>
            <div className="table-like-list">
              {userSummary.map((user) => (
                <div key={user.id} className="table-like-row">
                  <div>
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                  </div>
                  <div className="table-like-meta multi">
                    <span className="tag role-tag">{user.role}</span>
                    <span>{user.proposals} proposals</span>
                    <span>{user.reviews} reviews</span>
                  </div>
                </div>
              ))}
              {!userSummary.length && (
                <div className="empty-state">
                  <Users size={18} />
                  <span>No users are available yet.</span>
                </div>
              )}
            </div>
          </section>
        )}

        {view === "settings" && (
          <section className="settings-grid">
            <article className="panel">
              <h3>Workspace profile</h3>
              <dl className="settings-list">
                <div>
                  <dt>Name</dt>
                  <dd>{currentUser.name}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{currentUser.email}</dd>
                </div>
                <div>
                  <dt>Role</dt>
                  <dd>{currentUser.role}</dd>
                </div>
              </dl>
            </article>

            <article className="panel">
              <h3>Deadlines</h3>
              {currentUser.role !== "student" ? (
                <form className="deadline-settings-form" onSubmit={handleWorkspaceSettingsSave}>
                  <label>
                    Submission deadline
                    <input
                      type="datetime-local"
                      value={deadlineForm.submissionDeadline}
                      onChange={(event) =>
                        setDeadlineForm((current) => ({ ...current, submissionDeadline: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Review deadline
                    <input
                      type="datetime-local"
                      value={deadlineForm.reviewDeadline}
                      onChange={(event) =>
                        setDeadlineForm((current) => ({ ...current, reviewDeadline: event.target.value }))
                      }
                    />
                  </label>
                  <div className="action-row deadline-settings-actions">
                    <button className="primary-button" type="submit" disabled={busy}>
                      {busy ? "Saving..." : "Save deadlines"}
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => setDeadlineForm({ submissionDeadline: "", reviewDeadline: "" })}
                    >
                      Clear form
                    </button>
                  </div>
                </form>
              ) : (
                <ul className="settings-notes">
                  <li>Submission deadline: {submissionDeadlineState.timestampLabel}</li>
                  <li>Review deadline: {reviewDeadlineState.timestampLabel}</li>
                </ul>
              )}
            </article>

            <article className="panel">
              <h3>Evaluation model</h3>
              <ul className="settings-notes">
                <li>Scores six rubric criteria on a 1-10 scale with fixed weights.</li>
                <li>Calculates one weighted score and ties the recommendation to proposal status.</li>
                <li>Stores strengths, risks, and summary so reviewers leave structured feedback.</li>
              </ul>
            </article>
          </section>
        )}
        </div>
      </main>

      {toast && <ToastView toast={toast} />}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <article className="stat-card">
      <div className="stat-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function DeadlineCard({
  title,
  description,
  state,
}: {
  title: string;
  description: string;
  state: DeadlineState;
}) {
  return (
    <article
      className={`deadline-card ${state.tone}`}
      title={`${title}: ${state.timestampLabel} • ${description}`}
    >
      <span className="deadline-card-label">{title}</span>
      <strong>{state.countdownLabel}</strong>
    </article>
  );
}

function AppLoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-orb" aria-hidden="true">
        <div className="loading-orb-ring loading-orb-ring-one" />
        <div className="loading-orb-ring loading-orb-ring-two" />
        <div className="loading-orb-core">
          <ProjectLogoMark className="loading-logo-mark" />
        </div>
      </div>
      <div className="loading-copy">
        <div className="loading-badge">Project Proposal Checker</div>
        <h1>Preparing your workspace</h1>
        <p>Loading dashboards, proposal tools, and evaluation flow.</p>
      </div>
      <div className="loading-progress" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}

function FuturisticHistogramChart({
  title,
  data,
  xKey,
  barKey,
  lineKey,
  labelKey,
  barLabel,
  lineLabel,
  valueFormatter,
  yDomain,
  lineDomain,
  emptyMessage,
}: {
  title: string;
  data: Array<Record<string, string | number>>;
  xKey: string;
  barKey: string;
  lineKey: string;
  labelKey: string;
  barLabel: string;
  lineLabel: string;
  valueFormatter: (value: number, key: string) => string;
  yDomain?: [number, number] | [number, "auto"];
  lineDomain?: [number, number] | [number, "auto"];
  emptyMessage?: string;
}) {
  const chartId = `histogram-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const hasChartData = data.some((item) => Number(item[barKey] ?? 0) > 0 || Number(item[lineKey] ?? 0) > 0);

  if (!data.length || !hasChartData) {
    return (
      <article className="chart-card futuristic-chart-card">
        <div className="panel-title-row">
          <h3>{title}</h3>
        </div>
        <div className="dashboard-chart-frame futuristic-chart-shell">
          <div className="empty-state chart-empty-state">
            <BarChart3 size={18} />
            <span>{emptyMessage ?? "Not enough data to draw this chart yet."}</span>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="chart-card futuristic-chart-card">
      <div className="panel-title-row">
        <h3>{title}</h3>
      </div>
      <div className="dashboard-chart-frame futuristic-chart-shell">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 16, right: 10, left: -10, bottom: 4 }}>
            <defs>
              <linearGradient id={`${chartId}-bars`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.95} />
                <stop offset="50%" stopColor="#38bdf8" stopOpacity={0.8} />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.16} />
              </linearGradient>
              <linearGradient id={`${chartId}-line`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#22d3ee" />
                <stop offset="100%" stopColor="#c084fc" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 8" vertical={false} stroke="rgba(125, 211, 252, 0.15)" />
            <XAxis
              dataKey={xKey}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#64748b", fontSize: 12 }}
            />
            <YAxis
              yAxisId="bars"
              domain={yDomain}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#64748b", fontSize: 12 }}
            />
            {lineDomain && (
              <YAxis
                yAxisId="line"
                orientation="right"
                domain={lineDomain}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "#94a3b8", fontSize: 12 }}
              />
            )}
            <RechartsTooltip
              labelFormatter={(_label, payload) =>
                payload?.[0]?.payload?.[labelKey] ?? payload?.[0]?.payload?.[xKey] ?? ""
              }
              formatter={(value: number, name: string) => [
                valueFormatter(Number(value), name),
                name === lineKey ? lineLabel : barLabel,
              ]}
              contentStyle={{
                borderRadius: "18px",
                border: "1px solid rgba(99, 102, 241, 0.12)",
                background: "rgba(255, 255, 255, 0.96)",
                color: "#0f172a",
                boxShadow: "0 24px 60px rgba(99, 102, 241, 0.12)",
                backdropFilter: "blur(14px)",
              }}
              itemStyle={{ color: "#0f172a" }}
              labelStyle={{ color: "#0f172a", fontWeight: 700 }}
            />
            <Bar
              yAxisId="bars"
              dataKey={barKey}
              name={barKey}
              radius={[14, 14, 2, 2]}
              fill={`url(#${chartId}-bars)`}
              stroke="rgba(99, 102, 241, 0.5)"
              strokeWidth={1.2}
              background={{ fill: "rgba(148, 163, 184, 0.12)", radius: [14, 14, 2, 2] }}
              barSize={28}
            />
            <Line
              yAxisId={lineDomain ? "line" : "bars"}
              type="monotone"
              dataKey={lineKey}
              name={lineKey}
              stroke={`url(#${chartId}-line)`}
              strokeWidth={3}
              dot={{ r: 4, strokeWidth: 2, fill: "#ffffff", stroke: "#0ea5e9" }}
              activeDot={{ r: 6, strokeWidth: 2, fill: "#ffffff", stroke: "#8b5cf6" }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

function FuturisticDonutChart({
  title,
  data,
  centerLabel,
  centerValue,
  valueFormatter,
}: {
  title: string;
  data: Array<{ name: string; value: number; fill: string }>;
  centerLabel: string;
  centerValue: string;
  valueFormatter: (value: number) => string;
}) {
  const hasChartData = data.some((item) => item.value > 0);

  return (
    <article className="chart-card futuristic-chart-card">
      <div className="panel-title-row">
        <h3>{title}</h3>
      </div>
      <div className="dashboard-chart-frame futuristic-chart-shell futuristic-donut-shell">
        {hasChartData ? (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.map((item) => ({ ...item, value: 1 }))}
                  dataKey="value"
                  innerRadius={92}
                  outerRadius={104}
                  fill="rgba(56, 189, 248, 0.08)"
                  stroke="none"
                  isAnimationActive={false}
                />
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={88}
                  paddingAngle={3}
                  cornerRadius={10}
                  stroke="rgba(255, 255, 255, 0.18)"
                  strokeWidth={2}
                >
                  {data.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Pie>
                <RechartsTooltip
                  formatter={(value: number, _name, item) => [valueFormatter(Number(value)), item.payload.name]}
                  contentStyle={{
                    borderRadius: "18px",
                    border: "1px solid rgba(99, 102, 241, 0.12)",
                    background: "rgba(255, 255, 255, 0.96)",
                    color: "#0f172a",
                    boxShadow: "0 24px 60px rgba(99, 102, 241, 0.12)",
                    backdropFilter: "blur(14px)",
                  }}
                  itemStyle={{ color: "#0f172a" }}
                  labelStyle={{ color: "#0f172a", fontWeight: 700 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="futuristic-center-readout">
              <strong>{centerValue}</strong>
              <span>{centerLabel}</span>
            </div>
          </>
        ) : (
          <div className="empty-state chart-empty-state">
            <BarChart3 size={18} />
            <span>Not enough data to draw this chart yet.</span>
          </div>
        )}
      </div>
      <div className="chart-legend-list">
        {data.map((item) => (
          <div key={item.name} className="chart-legend-item">
            <span className="chart-dot" style={{ backgroundColor: item.fill }} aria-hidden="true" />
            <span>{item.name}</span>
            <strong>{valueFormatter(item.value)}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}

function ToastView({ toast }: { toast: NonNullable<Toast> }) {
  return <div className={toast.kind === "success" ? "toast success" : "toast error"}>{toast.text}</div>;
}

export default App;
