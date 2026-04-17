import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { promises as fs, createReadStream, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { query } from './db.js';
import { requireAuth, requireRole } from './auth.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;
dotenv.config({ path: path.resolve(__dirname, '..', 'config', '.env') });
const uploadsDir = path.resolve(__dirname, '..', 'uploads');
const frontendDistDir = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
const frontendEntryFile = path.join(frontendDistDir, 'index.html');
const maxPdfSize = 10 * 1024 * 1024;
const documentStorageMode =
  String(process.env.DOCUMENT_STORAGE || 'database').trim().toLowerCase() === 'filesystem'
    ? 'filesystem'
    : 'database';
const hasFrontendBuild = existsSync(frontendEntryFile);

if (!process.env.DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.error('Missing DATABASE_URL. Set it as an environment variable.');
}
if (!process.env.JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.error('Missing JWT_SECRET. Set it as an environment variable.');
}

function buildAllowedOrigins() {
  const configured = String(process.env.CLIENT_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set(configured);
}

const allowedOrigins = buildAllowedOrigins();

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (!allowedOrigins.size) return true;
  if (allowedOrigins.has(origin)) return true;
  try {
    const url = new URL(origin);
    const isLocalHost =
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      /^:\d+$/.test(url.port ? `:${url.port}` : ':');
    return isLocalHost;
  } catch {
    return false;
  }
}

app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin not allowed by CORS: ${origin || 'unknown'}`));
  },
  credentials: false,
}));
app.use(express.json({ limit: '2mb' }));

// Health check — must be BEFORE DB init middleware so it always responds
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/debug-env', (_req, res) => {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL || '';
  res.json({
    hasDbUrl: !!dbUrl,
    dbUrlPreview: dbUrl ? dbUrl.replace(/:([^:@]+)@/, ':***@').slice(0, 60) + '...' : 'NOT SET',
    hasJwtSecret: !!process.env.JWT_SECRET,
    nodeEnv: process.env.NODE_ENV || 'not set',
  });
});
app.get('/api', (_req, res) => {
  res.json({ service: 'proposal-checker-api', ok: true, health: '/api/health' });
});

// Lazy DB initialization middleware — runs before every request that needs DB
let _initialized = false;
let _initError = null;
async function initializeApp() {
  if (_initialized) return;
  if (_initError) throw _initError;
  try {
    await ensureDb();
    await ensureDocumentColumns();
    await ensureWorkspaceSettingsTable();
    _initialized = true;
  } catch (e) {
    _initError = e;
    throw e;
  }
}
app.use((req, res, next) => {
  initializeApp().then(() => next()).catch((e) => {
    res.status(503).json({ error: 'Service unavailable: ' + (e?.message || 'DB init failed') });
  });
});

app.get('/', (_req, res) => {
  if (hasFrontendBuild) {
    res.sendFile(frontendEntryFile);
    return;
  }
  res.json({
    service: 'proposal-checker-api',
    ok: true,
    health: '/api/health',
  });
});

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function mapEvaluation(row) {
  if (!row || !row.evaluation_recommendation) return null;
  return {
    criteria: row.evaluation_criteria,
    overallScore: Number(row.evaluation_overall_score),
    recommendation: row.evaluation_recommendation,
    strengths: row.evaluation_strengths,
    risks: row.evaluation_risks,
    summary: row.evaluation_summary,
    evaluatorName: row.evaluator_name,
    evaluatedAt: row.evaluation_updated_at,
  };
}

function mapDocument(row) {
  if (!row || !row.document_name || !row.document_uploaded_at) return null;
  return {
    fileName: row.document_name,
    fileSize: Number(row.document_size || 0),
    mimeType: row.document_mime_type || 'application/pdf',
    uploadedAt: row.document_uploaded_at,
  };
}

function sanitizeFileName(value) {
  return String(value || 'proposal-document.pdf')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'proposal-document.pdf';
}

const similarityStopWords = new Set([
  'about', 'after', 'again', 'against', 'also', 'among', 'and', 'are', 'because', 'before',
  'being', 'between', 'both', 'can', 'could', 'does', 'each', 'from', 'have', 'into',
  'more', 'most', 'other', 'over', 'same', 'should', 'some', 'such', 'than', 'that',
  'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'under',
  'using', 'very', 'what', 'when', 'where', 'which', 'while', 'with', 'would', 'your',
  'will', 'project', 'proposal', 'system', 'application', 'study', 'based',
]);

function normalizeSimilarityText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSimilarityDomain(value) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  return normalized || 'Unspecified';
}

function tokenizeSimilarityText(value) {
  return normalizeSimilarityText(value)
    .split(' ')
    .filter((token) => token.length > 2 && !similarityStopWords.has(token));
}

function tokenSet(value) {
  return new Set(tokenizeSimilarityText(value));
}

function jaccardSimilarity(leftSet, rightSet) {
  if (!leftSet.size && !rightSet.size) return 0;
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) intersection += 1;
  }
  const union = leftSet.size + rightSet.size - intersection;
  return union ? intersection / union : 0;
}

function getCommonTerms(leftSet, rightSet, limit = 8) {
  const terms = [];
  for (const token of leftSet) {
    if (rightSet.has(token)) terms.push(token);
  }
  return terms
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .slice(0, limit);
}

function scoreSimilarityPair(left, right) {
  const sections = [
    { name: 'Title', weight: 0.24, left: left.title, right: right.title },
    { name: 'Abstract', weight: 0.22, left: left.abstract, right: right.abstract },
    { name: 'Problem statement', weight: 0.24, left: left.problem, right: right.problem },
    { name: 'Objectives', weight: 0.12, left: (left.objectives || []).join(' '), right: (right.objectives || []).join(' ') },
    { name: 'Methodology', weight: 0.14, left: left.methodology, right: right.methodology },
    { name: 'Tech stack', weight: 0.04, left: (left.tech_stack || []).join(' '), right: (right.tech_stack || []).join(' ') },
  ];

  let weightedScore = 0;
  let totalWeight = 0;
  const sectionScores = sections.map((section) => {
    const score = jaccardSimilarity(tokenSet(section.left), tokenSet(section.right));
    weightedScore += score * section.weight;
    totalWeight += section.weight;
    return {
      name: section.name,
      score: Number((score * 100).toFixed(1)),
    };
  });

  const leftDomain = normalizeSimilarityDomain(left.domain).toLowerCase();
  const rightDomain = normalizeSimilarityDomain(right.domain).toLowerCase();
  let score = totalWeight ? weightedScore / totalWeight : 0;
  if (leftDomain !== 'unspecified' && leftDomain === rightDomain) {
    score = Math.min(score + 0.05, 1);
  }

  const combinedLeft = tokenSet([
    left.title,
    left.abstract,
    left.problem,
    (left.objectives || []).join(' '),
    left.methodology,
    (left.tech_stack || []).join(' '),
  ].join(' '));
  const combinedRight = tokenSet([
    right.title,
    right.abstract,
    right.problem,
    (right.objectives || []).join(' '),
    right.methodology,
    (right.tech_stack || []).join(' '),
  ].join(' '));

  const scorePercent = Number((score * 100).toFixed(1));
  const riskLevel =
    scorePercent >= 70 ? 'High'
      : scorePercent >= 45 ? 'Medium'
        : 'Low';

  return {
    scorePercent,
    riskLevel,
    overlappingTerms: getCommonTerms(combinedLeft, combinedRight),
    sections: sectionScores.sort((leftSection, rightSection) => rightSection.score - leftSection.score),
  };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxPdfSize },
  fileFilter(_req, file, callback) {
    const isPdf =
      file.mimetype === 'application/pdf' ||
      file.originalname.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      callback(new Error('Only PDF files are allowed'));
      return;
    }
    callback(null, true);
  },
});

function handleUpload(fieldName) {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (error) => {
      if (!error) {
        next();
        return;
      }
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'PDF must be 10 MB or smaller' });
        return;
      }
      res.status(400).json({ error: error.message || 'Upload failed' });
    });
  };
}

function isManagedUploadPath(documentPath) {
  if (!documentPath) return false;
  const resolvedPath = path.resolve(documentPath);
  return resolvedPath.startsWith(`${uploadsDir}${path.sep}`);
}

async function deleteStoredFile(documentPath) {
  if (!isManagedUploadPath(documentPath)) return;
  await fs.unlink(path.resolve(documentPath)).catch(() => {});
}

async function writeDocumentToFilesystem(file) {
  const extension = path.extname(file.originalname).toLowerCase() || '.pdf';
  const storedFileName = `${randomUUID()}${extension === '.pdf' ? extension : '.pdf'}`;
  const storedFilePath = path.join(uploadsDir, storedFileName);
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.writeFile(storedFilePath, file.buffer);
  return storedFilePath;
}

async function ensureDb() {
  try {
    await query('select 1');
    // Auto-migrate if tables are missing
    const tableCheck = await query("SELECT to_regclass('public.proposals')");
    if (!tableCheck.rows[0].to_regclass) {
      // eslint-disable-next-line no-console
      console.log('Tables missing, automatically running schema.sql...');
      await query(`
        create extension if not exists "uuid-ossp";

        create table if not exists users (
          id uuid primary key default uuid_generate_v4(),
          name text not null,
          email text not null unique,
          password_hash text not null,
          role text not null check (role in ('student', 'admin', 'coadmin')),
          created_at timestamptz not null default now()
        );

        create table if not exists proposals (
          id uuid primary key default uuid_generate_v4(),
          title text not null,
          domain text not null,
          status text not null check (status in ('Pending', 'In Review', 'Approved', 'Revision Requested', 'Rejected')),
          student_id uuid not null references users(id) on delete cascade,
          reviewer_id uuid references users(id) on delete set null,
          abstract text not null,
          problem text not null,
          objectives text[] not null default '{}',
          methodology text not null,
          tech_stack text[] not null default '{}',
          team jsonb not null default '[]'::jsonb,
          document_name text,
          document_path text,
          document_data bytea,
          document_mime_type text,
          document_size integer,
          document_uploaded_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );

        create index if not exists proposals_student_id_idx on proposals(student_id);
        create index if not exists proposals_status_idx on proposals(status);

        create table if not exists proposal_evaluations (
          id uuid primary key default uuid_generate_v4(),
          proposal_id uuid not null unique references proposals(id) on delete cascade,
          evaluator_id uuid not null references users(id) on delete cascade,
          criteria jsonb not null,
          overall_score numeric(4,1) not null,
          recommendation text not null check (recommendation in ('Approve', 'Revise', 'Reject')),
          strengths text not null,
          risks text not null,
          summary text not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );

        create index if not exists proposal_evaluations_evaluator_id_idx on proposal_evaluations(evaluator_id);

        create table if not exists workspace_settings (
          id text primary key,
          submission_deadline timestamptz,
          review_deadline timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );

        insert into workspace_settings (id)
        values ('default')
        on conflict (id) do nothing;

        create or replace function set_updated_at()
        returns trigger as $$
        begin
          new.updated_at = now();
          return new;
        end;
        $$ language plpgsql;

        drop trigger if exists proposals_set_updated_at on proposals;
        create trigger proposals_set_updated_at
        before update on proposals
        for each row
        execute function set_updated_at();

        drop trigger if exists proposal_evaluations_set_updated_at on proposal_evaluations;
        create trigger proposal_evaluations_set_updated_at
        before update on proposal_evaluations
        for each row
        execute function set_updated_at();

        drop trigger if exists workspace_settings_set_updated_at on workspace_settings;
        create trigger workspace_settings_set_updated_at
        before update on workspace_settings
        for each row
        execute function set_updated_at();
      `);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Database connection failed. Check Postgres + DATABASE_URL. Error:', e?.message || e);
    throw e;
  }
}

async function ensureDocumentColumns() {
  await query(`alter table proposals add column if not exists document_name text`);
  await query(`alter table proposals add column if not exists document_path text`);
  await query(`alter table proposals add column if not exists document_data bytea`);
  await query(`alter table proposals add column if not exists document_mime_type text`);
  await query(`alter table proposals add column if not exists document_size integer`);
  await query(`alter table proposals add column if not exists document_uploaded_at timestamptz`);
}

async function ensureWorkspaceSettingsTable() {
  await query(`
    create table if not exists workspace_settings (
      id text primary key,
      submission_deadline timestamptz,
      review_deadline timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await query(`
    insert into workspace_settings (id)
    values ('default')
    on conflict (id) do nothing
  `);
}

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['student', 'admin', 'coadmin']).default('student'),
});

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });
  const { name, email, password, role } = parsed.data;

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const result = await query(
      `insert into users (name, email, password_hash, role)
       values ($1, $2, $3, $4)
       returning id, name, email, role`,
      [name, email.toLowerCase(), passwordHash, role]
    );
    const user = result.rows[0];
    const token = jwt.sign({ sub: user.id, role: user.role, name: user.name, email: user.email }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });
    return res.json({ token, user });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Register failed:', e);
    if (String(e?.message || '').includes('users_email_key')) {
      return res.status(409).json({ error: 'Email already exists' });
    }
    return res.status(500).json({ error: 'Server error' });
  }
}));

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });
  const { email, password } = parsed.data;

  const result = await query(`select id, name, email, role, password_hash from users where email = $1`, [email.toLowerCase()]);
  const row = result.rows[0];
  if (!row) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const user = { id: row.id, name: row.name, email: row.email, role: row.role };
  const token = jwt.sign({ sub: user.id, role: user.role, name: user.name, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
  return res.json({ token, user });
}));

const proposalCreateSchema = z.object({
  title: z.string().min(1),
  domain: z.string().min(1),
  abstract: z.string().min(1),
  problem: z.string().min(1),
  objectives: z.array(z.string().min(1)).default([]),
  methodology: z.string().min(1),
  techStack: z.array(z.string().min(1)).default([]),
  team: z.array(z.object({ name: z.string().min(1), role: z.string().min(1) })).default([]),
});

app.get('/api/proposals', requireAuth, asyncRoute(async (req, res) => {
  const role = req.user.role;
  const userId = req.user.sub;

  if (role === 'student') {
    const result = await query(
      `select
         p.id, p.title, p.domain, p.status, p.updated_at, u.name as student, r.name as reviewer,
         p.document_name, p.document_mime_type, p.document_size, p.document_uploaded_at,
         pe.criteria as evaluation_criteria,
         pe.overall_score as evaluation_overall_score,
         pe.recommendation as evaluation_recommendation,
         pe.strengths as evaluation_strengths,
         pe.risks as evaluation_risks,
         pe.summary as evaluation_summary,
         ev.name as evaluator_name,
         pe.updated_at as evaluation_updated_at
       from proposals p
       join users u on u.id = p.student_id
       left join users r on r.id = p.reviewer_id
       left join proposal_evaluations pe on pe.proposal_id = p.id
       left join users ev on ev.id = pe.evaluator_id
       where p.student_id = $1
       order by p.updated_at desc`,
      [userId]
    );
    return res.json({
      items: result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        domain: row.domain,
        status: row.status,
        updated_at: row.updated_at,
        student: row.student,
        reviewer: row.reviewer,
        document: mapDocument(row),
        evaluation: mapEvaluation(row),
      })),
    });
  }

  const result = await query(
    `select
       p.id, p.title, p.domain, p.status, p.updated_at, u.name as student, r.name as reviewer,
       p.document_name, p.document_mime_type, p.document_size, p.document_uploaded_at,
       pe.criteria as evaluation_criteria,
       pe.overall_score as evaluation_overall_score,
       pe.recommendation as evaluation_recommendation,
       pe.strengths as evaluation_strengths,
       pe.risks as evaluation_risks,
       pe.summary as evaluation_summary,
       ev.name as evaluator_name,
       pe.updated_at as evaluation_updated_at
     from proposals p
     join users u on u.id = p.student_id
     left join users r on r.id = p.reviewer_id
     left join proposal_evaluations pe on pe.proposal_id = p.id
     left join users ev on ev.id = pe.evaluator_id
     order by p.updated_at desc
     limit 200`
  );
  return res.json({
    items: result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      domain: row.domain,
      status: row.status,
      updated_at: row.updated_at,
      student: row.student,
      reviewer: row.reviewer,
      document: mapDocument(row),
      evaluation: mapEvaluation(row),
    })),
  });
}));

app.get('/api/proposals/similarity-report', requireAuth, requireRole(['admin', 'coadmin']), asyncRoute(async (_req, res) => {
  const result = await query(
    `select
       p.id, p.title, p.domain, p.status, p.abstract, p.problem, p.objectives, p.methodology, p.tech_stack,
       u.name as student
     from proposals p
     join users u on u.id = p.student_id
     order by p.updated_at desc
     limit 200`
  );

  const proposals = result.rows;
  const allPairs = [];

  for (let index = 0; index < proposals.length; index += 1) {
    for (let offset = index + 1; offset < proposals.length; offset += 1) {
      const left = proposals[index];
      const right = proposals[offset];
      const pairScore = scoreSimilarityPair(left, right);
      allPairs.push({
        id: `${left.id}:${right.id}`,
        similarityScore: pairScore.scorePercent,
        riskLevel: pairScore.riskLevel,
        overlappingTerms: pairScore.overlappingTerms,
        sections: pairScore.sections,
        left: {
          id: left.id,
          title: left.title,
          student: left.student,
          domain: left.domain,
          status: left.status,
        },
        right: {
          id: right.id,
          title: right.title,
          student: right.student,
          domain: right.domain,
          status: right.status,
        },
      });
    }
  }

  const flaggedPairs = allPairs
    .filter((pair) => pair.similarityScore >= 18)
    .sort((left, right) => right.similarityScore - left.similarityScore)
    .slice(0, 20);

  const averageSimilarity = allPairs.length
    ? Number((allPairs.reduce((sum, pair) => sum + pair.similarityScore, 0) / allPairs.length).toFixed(1))
    : 0;

  return res.json({
    item: {
      generatedAt: new Date().toISOString(),
      totalProposals: proposals.length,
      comparedPairs: allPairs.length,
      flaggedPairs: flaggedPairs.length,
      averageSimilarity,
      pairs: flaggedPairs,
    },
  });
}));

app.get('/api/proposals/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = req.params.id;
  const role = req.user.role;
  const userId = req.user.sub;

  const result = await query(
    `select
       p.id, p.title, p.domain, p.status, p.abstract, p.problem, p.objectives, p.methodology, p.tech_stack,
       p.team, p.created_at, p.updated_at,
       p.document_name, p.document_mime_type, p.document_size, p.document_uploaded_at,
       u.id as student_id, u.name as student,
       r.id as reviewer_id, r.name as reviewer,
       pe.criteria as evaluation_criteria,
       pe.overall_score as evaluation_overall_score,
       pe.recommendation as evaluation_recommendation,
       pe.strengths as evaluation_strengths,
       pe.risks as evaluation_risks,
       pe.summary as evaluation_summary,
       ev.name as evaluator_name,
       pe.updated_at as evaluation_updated_at
     from proposals p
     join users u on u.id = p.student_id
     left join users r on r.id = p.reviewer_id
     left join proposal_evaluations pe on pe.proposal_id = p.id
     left join users ev on ev.id = pe.evaluator_id
     where p.id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (role === 'student' && row.student_id !== userId) return res.status(403).json({ error: 'Forbidden' });
  return res.json({
    item: {
      ...row,
      document: mapDocument(row),
      evaluation: mapEvaluation(row),
    },
  });
}));

app.post('/api/proposals', requireAuth, requireRole(['student']), asyncRoute(async (req, res) => {
  const parsed = proposalCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });
  const userId = req.user.sub;
  const data = parsed.data;

  const settingsResult = await query(
    `select submission_deadline
     from workspace_settings
     where id = 'default'`
  );
  const submissionDeadline = settingsResult.rows[0]?.submission_deadline;
  if (submissionDeadline && new Date(submissionDeadline).getTime() < Date.now()) {
    return res.status(403).json({ error: 'The submission deadline has passed.' });
  }

  const result = await query(
    `insert into proposals
      (title, domain, status, student_id, abstract, problem, objectives, methodology, tech_stack, team)
     values
      ($1, $2, 'Pending', $3, $4, $5, $6, $7, $8, $9)
     returning id`,
    [
      data.title,
      data.domain,
      userId,
      data.abstract,
      data.problem,
      data.objectives,
      data.methodology,
      data.techStack,
      JSON.stringify(data.team),
    ]
  );
  return res.status(201).json({ id: result.rows[0].id });
}));

app.post(
  '/api/proposals/:id/document',
  requireAuth,
  requireRole(['student']),
  handleUpload('document'),
  asyncRoute(async (req, res) => {
    const id = req.params.id;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'PDF file is required' });

    const proposalResult = await query(
      `select id, student_id, document_path
       from proposals
       where id = $1 and student_id = $2`,
      [id, req.user.sub]
    );
    const proposal = proposalResult.rows[0];
    if (!proposal) {
      return res.status(404).json({ error: 'Proposal not found' });
    }

    const previousDocumentPath = proposal.document_path;
    const documentName = sanitizeFileName(file.originalname);
    const documentMimeType = file.mimetype || 'application/pdf';

    let updateResult;

    if (documentStorageMode === 'filesystem') {
      const storedFilePath = await writeDocumentToFilesystem(file);
      try {
        updateResult = await query(
          `update proposals
           set document_name = $2,
               document_path = $3,
               document_data = null,
               document_mime_type = $4,
               document_size = $5,
               document_uploaded_at = now()
           where id = $1
           returning document_name, document_mime_type, document_size, document_uploaded_at`,
          [id, documentName, storedFilePath, documentMimeType, file.size]
        );
      } catch (error) {
        await deleteStoredFile(storedFilePath);
        throw error;
      }

      if (previousDocumentPath && previousDocumentPath !== storedFilePath) {
        await deleteStoredFile(previousDocumentPath);
      }
    } else {
      updateResult = await query(
        `update proposals
         set document_name = $2,
             document_path = null,
             document_data = $3,
             document_mime_type = $4,
             document_size = $5,
             document_uploaded_at = now()
         where id = $1
         returning document_name, document_mime_type, document_size, document_uploaded_at`,
        [id, documentName, file.buffer, documentMimeType, file.size]
      );

      await deleteStoredFile(previousDocumentPath);
    }

    return res.status(201).json({ document: mapDocument(updateResult.rows[0]) });
  })
);

app.get('/api/proposals/:id/document', requireAuth, asyncRoute(async (req, res) => {
  const id = req.params.id;
  const role = req.user.role;
  const userId = req.user.sub;

  const result = await query(
    `select student_id, document_name, document_path, document_data, document_mime_type, document_size, document_uploaded_at
     from proposals
     where id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'Proposal not found' });
  if (role === 'student' && row.student_id !== userId) return res.status(403).json({ error: 'Forbidden' });
  if (!row.document_name) return res.status(404).json({ error: 'No PDF uploaded for this proposal' });

  const documentBuffer = Buffer.isBuffer(row.document_data) ? row.document_data : null;
  if (!documentBuffer && !row.document_path) {
    return res.status(404).json({ error: 'No PDF uploaded for this proposal' });
  }

  res.setHeader('Content-Type', row.document_mime_type || 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFileName(row.document_name)}"`);

  if (documentBuffer) {
    res.setHeader('Content-Length', String(row.document_size || documentBuffer.length));
    res.end(documentBuffer);
    return;
  }

  try {
    await fs.access(row.document_path);
  } catch {
    return res.status(404).json({ error: 'Document file is missing on the server' });
  }

  res.setHeader('Content-Length', String(row.document_size || 0));
  createReadStream(row.document_path).pipe(res);
}));

app.delete('/api/proposals/:id', requireAuth, requireRole(['admin']), asyncRoute(async (req, res) => {
  const id = req.params.id;

  const result = await query(
    `select id, title, student_id, document_path
     from proposals
     where id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'Proposal not found' });

  await query(`delete from proposals where id = $1`, [id]);

  const remainingProposals = await query(`select count(*)::int as count from proposals`);
  if ((remainingProposals.rows[0]?.count ?? 0) === 0) {
    await query(
      `update workspace_settings
       set submission_deadline = null,
           review_deadline = null
       where id = 'default'`
    );
  }

  await deleteStoredFile(row.document_path);

  return res.json({ ok: true, id: row.id, title: row.title });
}));

const proposalUpdateStatusSchema = z.object({
  status: z.enum(['Pending', 'In Review', 'Approved', 'Revision Requested', 'Rejected']),
  reviewerId: z.string().uuid().optional().nullable(),
});

app.patch('/api/proposals/:id/status', requireAuth, requireRole(['admin', 'coadmin']), asyncRoute(async (req, res) => {
  const id = req.params.id;
  const parsed = proposalUpdateStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });
  const { status, reviewerId } = parsed.data;

  const result = await query(
    `update proposals
     set status = $2,
         reviewer_id = coalesce($3, reviewer_id)
     where id = $1
     returning id`,
    [id, status, reviewerId ?? null]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Not found' });
  return res.json({ ok: true });
}));

const evaluationCriteriaSchema = z.object({
  problemClarity: z.number().min(1).max(10),
  technicalFeasibility: z.number().min(1).max(10),
  methodologyStrength: z.number().min(1).max(10),
  innovation: z.number().min(1).max(10),
  impact: z.number().min(1).max(10),
  documentationReadiness: z.number().min(1).max(10),
});

const evaluationUpsertSchema = z.object({
  criteria: evaluationCriteriaSchema,
  recommendation: z.enum(['Approve', 'Revise', 'Reject']),
  strengths: z.string().min(1),
  risks: z.string().min(1),
  summary: z.string().min(1),
});

const workspaceDeadlineValueSchema = z.union([
  z.string().datetime({ offset: true }),
  z.string().datetime(),
  z.null(),
]);

const workspaceSettingsSchema = z.object({
  submissionDeadline: workspaceDeadlineValueSchema.optional(),
  reviewDeadline: workspaceDeadlineValueSchema.optional(),
});

app.get('/api/workspace-settings', requireAuth, asyncRoute(async (_req, res) => {
  const result = await query(
    `select submission_deadline, review_deadline
     from workspace_settings
     where id = 'default'`
  );
  const row = result.rows[0] || {};
  return res.json({
    item: {
      submissionDeadline: row.submission_deadline || null,
      reviewDeadline: row.review_deadline || null,
    },
  });
}));

app.put('/api/workspace-settings', requireAuth, requireRole(['admin', 'coadmin']), asyncRoute(async (req, res) => {
  const parsed = workspaceSettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  const submissionDeadline = parsed.data.submissionDeadline ?? null;
  const reviewDeadline = parsed.data.reviewDeadline ?? null;

  await query(
    `update workspace_settings
     set submission_deadline = $1,
         review_deadline = $2
     where id = 'default'`,
    [submissionDeadline, reviewDeadline]
  );

  return res.json({
    item: {
      submissionDeadline,
      reviewDeadline,
    },
  });
}));

app.put('/api/proposals/:id/evaluation', requireAuth, requireRole(['admin', 'coadmin']), asyncRoute(async (req, res) => {
  const id = req.params.id;
  const parsed = evaluationUpsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  const proposalCheck = await query(
    `select p.id
     from proposals p
     where p.id = $1`,
    [id]
  );
  if (!proposalCheck.rowCount) return res.status(404).json({ error: 'Not found' });

  const { criteria, recommendation, strengths, risks, summary } = parsed.data;
  const overallScore = Number((
    criteria.problemClarity * 0.18 +
    criteria.technicalFeasibility * 0.22 +
    criteria.methodologyStrength * 0.22 +
    criteria.innovation * 0.16 +
    criteria.impact * 0.12 +
    criteria.documentationReadiness * 0.1
  ).toFixed(1));
  const nextStatus =
    recommendation === 'Approve'
      ? 'Approved'
      : recommendation === 'Reject'
        ? 'Rejected'
        : 'Revision Requested';

  await query(
    `insert into proposal_evaluations
      (proposal_id, evaluator_id, criteria, overall_score, recommendation, strengths, risks, summary)
     values ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)
     on conflict (proposal_id)
     do update set
       evaluator_id = excluded.evaluator_id,
       criteria = excluded.criteria,
       overall_score = excluded.overall_score,
       recommendation = excluded.recommendation,
       strengths = excluded.strengths,
       risks = excluded.risks,
       summary = excluded.summary`,
    [id, req.user.sub, JSON.stringify(criteria), overallScore, recommendation, strengths, risks, summary]
  );

  await query(
    `update proposals
     set status = $2,
         reviewer_id = $3
     where id = $1`,
    [id, nextStatus, req.user.sub]
  );

  const result = await query(
    `select
       pe.criteria as evaluation_criteria,
       pe.overall_score as evaluation_overall_score,
       pe.recommendation as evaluation_recommendation,
       pe.strengths as evaluation_strengths,
       pe.risks as evaluation_risks,
       pe.summary as evaluation_summary,
       ev.name as evaluator_name,
       pe.updated_at as evaluation_updated_at
     from proposal_evaluations pe
     join users ev on ev.id = pe.evaluator_id
     where pe.proposal_id = $1`,
    [id]
  );

  return res.json({ item: mapEvaluation(result.rows[0]), status: nextStatus });
}));

app.get('/api/users', requireAuth, requireRole(['admin', 'coadmin']), asyncRoute(async (_req, res) => {
  const result = await query(
    `select id, name, email, role, created_at
     from users
     order by created_at desc
     limit 200`
  );
  return res.json({ items: result.rows });
}));

if (hasFrontendBuild) {
  app.use(express.static(frontendDistDir));
  app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(frontendEntryFile);
  });
}

app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Server error' });
});


if (isDirectRun) {
  const port = Number(process.env.PORT || 43121);
  initializeApp().then(() => {
    app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`API listening on port ${port}`);
    });
  }).catch((e) => {
    // eslint-disable-next-line no-console
    console.error('Failed to initialize app:', e);
    process.exit(1);
  });
}

export default app;

