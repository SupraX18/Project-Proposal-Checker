import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { promises as fs, createReadStream, existsSync, readFileSync } from 'fs';
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
const schemaFile = path.resolve(__dirname, '..', 'sql', 'schema.sql');
const frontendDistDir = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
const frontendEntryFile = path.join(frontendDistDir, 'index.html');
const hasFrontendBuild = existsSync(frontendEntryFile);
const maxUploadSize = 20 * 1024 * 1024;
const documentStorageMode =
  String(process.env.DOCUMENT_STORAGE || 'database').trim().toLowerCase() === 'filesystem'
    ? 'filesystem'
    : 'database';
const statusAliasMap = new Map([
  ['draft', 'Draft'],
  ['pending', 'Submitted'],
  ['submitted', 'Submitted'],
  ['in review', 'Under Review'],
  ['under review', 'Under Review'],
  ['revision requested', 'Changes Requested'],
  ['changes requested', 'Changes Requested'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
]);
const allowedUploadExtensions = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.png',
  '.jpg',
  '.jpeg',
  '.txt',
  '.zip',
]);
const allowedUploadMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
]);

if (!process.env.DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.error('Missing DATABASE_URL. Set it as an environment variable.');
}
if (!process.env.JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.error('Missing JWT_SECRET. Set it as an environment variable.');
}

function buildAllowedOrigins() {
  return new Set(
    String(process.env.CLIENT_ORIGIN || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

const allowedOrigins = buildAllowedOrigins();

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (!allowedOrigins.size) return true;
  if (allowedOrigins.has(origin)) return true;

  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeProposalStatus(value) {
  const normalized = statusAliasMap.get(String(value || '').trim().toLowerCase());
  return normalized || null;
}

function sanitizeFileName(value) {
  const cleanName = String(value || 'document')
    .trim()
    .replace(/[^a-zA-Z0-9._ -]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-');
  return cleanName || 'document';
}

function parseTeam(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
  };
}

function mapProposal(row) {
  return {
    id: row.id,
    title: row.title,
    domain: row.domain,
    scheme: row.scheme || '',
    status: normalizeProposalStatus(row.status) || 'Submitted',
    abstract: row.abstract,
    problem: row.problem,
    objectives: Array.isArray(row.objectives) ? row.objectives : [],
    methodology: row.methodology,
    techStack: Array.isArray(row.tech_stack) ? row.tech_stack : [],
    team: parseTeam(row.team),
    reviewNotes: row.review_notes || '',
    studentId: row.student_id,
    studentName: row.student_name,
    reviewerId: row.reviewer_id || null,
    reviewerName: row.reviewer_name || null,
    documentCount: Number(row.document_count || 0),
    folderCount: Number(row.folder_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    lastStatusChangedAt: row.last_status_changed_at,
  };
}

function mapFolder(row) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    proposalId: row.proposal_id,
    studentId: row.student_id,
    scheme: row.scheme || '',
    color: row.color || '#0f766e',
    documentCount: Number(row.document_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDocument(row) {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    folderId: row.folder_id,
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by_name || null,
    folderName: row.folder_name || null,
    name: row.name,
    mimeType: row.mime_type || 'application/octet-stream',
    size: Number(row.size || 0),
    category: row.category || 'supporting-document',
    description: row.description || '',
    uploadedAt: row.uploaded_at,
    downloadUrl: `/api/documents/${row.id}/download`,
  };
}

function mapStatusHistory(row) {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    changedBy: row.changed_by,
    changedByName: row.changed_by_name || null,
    fromStatus: row.from_status ? normalizeProposalStatus(row.from_status) : null,
    toStatus: normalizeProposalStatus(row.to_status) || row.to_status,
    note: row.note || '',
    createdAt: row.created_at,
  };
}

function mapActivity(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name || null,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    details: row.details || {},
    createdAt: row.created_at,
  };
}

function signToken(user) {
  const secret = process.env.JWT_SECRET || 'proposal_checker_default_secret_key_2024_xyz';
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name, email: user.email },
    secret,
    { expiresIn: '7d' },
  );
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
  const extension = path.extname(file.originalname).toLowerCase() || '.bin';
  const storedFileName = `${randomUUID()}${extension}`;
  const storedFilePath = path.join(uploadsDir, storedFileName);
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.writeFile(storedFilePath, file.buffer);
  return storedFilePath;
}

async function logActivity(userId, action, entityType, entityId, details = {}) {
  try {
    await query(
      `insert into activity_logs (user_id, action, entity_type, entity_id, details)
       values ($1, $2, $3, $4, $5)`,
      [userId || null, action, entityType, entityId || null, JSON.stringify(details)],
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save activity log:', error);
  }
}

let initializationPromise = null;
let initialized = false;

async function ensureDb() {
  if (initialized) return;
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    await query('select 1');
    const schemaSql = readFileSync(schemaFile, 'utf8');
    await query(schemaSql);
    initialized = true;
  })().catch((error) => {
    initializationPromise = null;
    throw error;
  });

  return initializationPromise;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadSize },
  fileFilter(_req, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase();
    const mimeType = String(file.mimetype || '').toLowerCase();
    const allowed = allowedUploadExtensions.has(extension) || allowedUploadMimeTypes.has(mimeType);
    if (!allowed) {
      callback(
        new Error(
          'Supported files: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, PNG, JPG, TXT, and ZIP',
        ),
      );
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
        res.status(400).json({ error: 'File must be 20 MB or smaller' });
        return;
      }
      res.status(400).json({ error: error.message || 'Upload failed' });
    });
  };
}

async function getProposalAccessRow(proposalId) {
  const result = await query(
    `select
       p.id,
       p.student_id,
       p.status,
       p.title,
       p.review_notes
     from proposals p
     where p.id = $1`,
    [proposalId],
  );
  return result.rows[0] || null;
}

function canAccessProposal(user, proposalRow) {
  return user.role === 'admin' || user.role === 'reviewer' || proposalRow.student_id === user.sub;
}

function canEditProposal(user, proposalRow) {
  return user.role === 'admin' || proposalRow.student_id === user.sub;
}

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin not allowed by CORS: ${origin || 'unknown'}`));
    },
    credentials: false,
  }),
);
app.use(express.json({ limit: '4mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api', (_req, res) => {
  res.json({ service: 'project-proposal-checker-api', ok: true, health: '/api/health' });
});

app.use('/api', (req, res, next) => {
  ensureDb()
    .then(() => next())
    .catch((error) => {
      res
        .status(503)
        .json({ error: `Service unavailable: ${error?.message || 'database initialization failed'}` });
    });
});

const registerSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: z.string().min(6),
});

const createUserSchema = registerSchema.extend({
  role: z.enum(['student', 'reviewer', 'admin']).default('student'),
});

const proposalPayloadSchema = z.object({
  title: z.string().trim().min(1),
  domain: z.string().trim().min(1),
  scheme: z.string().trim().max(120).optional().default(''),
  abstract: z.string().trim().min(1),
  problem: z.string().trim().min(1),
  objectives: z.array(z.string().trim().min(1)).default([]),
  methodology: z.string().trim().min(1),
  techStack: z.array(z.string().trim().min(1)).default([]),
  team: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        role: z.string().trim().min(1),
      }),
    )
    .default([]),
});

const proposalStatusSchema = z.object({
  status: z.string().trim().min(1),
  note: z.string().max(2000).optional().default(''),
});

const folderSchema = z.object({
  name: z.string().trim().min(1),
  proposalId: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  scheme: z.string().trim().max(120).optional().default(''),
  color: z.string().trim().max(24).optional().default('#0f766e'),
});

const listFilterSchema = z.object({
  proposalId: z.string().uuid().optional(),
  folderId: z.string().uuid().optional(),
});

const logFilterSchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).optional().default(100),
});

app.post(
  '/api/auth/register',
  asyncRoute(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid registration payload' });
    }

    const { name, email, password } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 10);

    try {
      const result = await query(
        `insert into users (name, email, password_hash, role)
         values ($1, $2, $3, 'student')
         returning id, name, email, role, created_at`,
        [name, normalizeEmail(email), passwordHash],
      );

      const user = mapUser(result.rows[0]);
      const token = signToken(user);
      await logActivity(user.id, 'REGISTER', 'user', user.id, { email: user.email });
      return res.status(201).json({ token, user });
    } catch (error) {
      if (String(error?.message || '').includes('users_email_key')) {
        return res.status(409).json({ error: 'Email already exists' });
      }
      throw error;
    }
  }),
);

app.post(
  '/api/auth/login',
  asyncRoute(async (req, res) => {
    const parsed = z
      .object({
        email: z.string().trim().email(),
        password: z.string().min(1),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid login payload' });
    }

    const { email, password } = parsed.data;
    const result = await query(
      `select id, name, email, role, password_hash, created_at
       from users
       where email = $1`,
      [normalizeEmail(email)],
    );
    const row = result.rows[0];
    if (!row) return res.status(401).json({ error: 'Invalid credentials' });

    const passwordMatches = await bcrypt.compare(password, row.password_hash);
    if (!passwordMatches) return res.status(401).json({ error: 'Invalid credentials' });

    const user = mapUser(row);
    const token = signToken(user);
    await logActivity(user.id, 'LOGIN', 'user', user.id, {});
    return res.json({ token, user });
  }),
);

app.get(
  '/api/auth/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    const result = await query(
      `select id, name, email, role, created_at
       from users
       where id = $1`,
      [req.user.sub],
    );
    const row = result.rows[0];
    if (!row) return res.status(401).json({ error: 'Unauthorized' });
    return res.json({ user: mapUser(row) });
  }),
);

app.get(
  '/api/proposals',
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = [];
    let whereClause = '';

    if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
      params.push(req.user.sub);
      whereClause = `where p.student_id = $${params.length}`;
    }

    const result = await query(
      `select
         p.id,
         p.title,
         p.domain,
         p.scheme,
         p.status,
         p.abstract,
         p.problem,
         p.objectives,
         p.methodology,
         p.tech_stack,
         p.team,
         p.review_notes,
         p.student_id,
         p.reviewer_id,
         p.created_at,
         p.updated_at,
         p.submitted_at,
         p.last_status_changed_at,
         u.name as student_name,
         r.name as reviewer_name,
         coalesce(dc.document_count, 0) as document_count,
         coalesce(fc.folder_count, 0) as folder_count
       from proposals p
       join users u on u.id = p.student_id
       left join users r on r.id = p.reviewer_id
       left join (
         select proposal_id, count(*)::int as document_count
         from documents
         group by proposal_id
       ) dc on dc.proposal_id = p.id
       left join (
         select proposal_id, count(*)::int as folder_count
         from folders
         group by proposal_id
       ) fc on fc.proposal_id = p.id
       ${whereClause}
       order by p.updated_at desc`,
      params,
    );

    return res.json({ items: result.rows.map(mapProposal) });
  }),
);

app.get(
  '/api/proposals/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const proposalRow = await getProposalAccessRow(req.params.id);
    if (!proposalRow) return res.status(404).json({ error: 'Project not found' });
    if (!canAccessProposal(req.user, proposalRow)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const summaryResult = await query(
      `select
         p.id,
         p.title,
         p.domain,
         p.scheme,
         p.status,
         p.abstract,
         p.problem,
         p.objectives,
         p.methodology,
         p.tech_stack,
         p.team,
         p.review_notes,
         p.student_id,
         p.reviewer_id,
         p.created_at,
         p.updated_at,
         p.submitted_at,
         p.last_status_changed_at,
         u.name as student_name,
         r.name as reviewer_name,
         coalesce(dc.document_count, 0) as document_count,
         coalesce(fc.folder_count, 0) as folder_count
       from proposals p
       join users u on u.id = p.student_id
       left join users r on r.id = p.reviewer_id
       left join (
         select proposal_id, count(*)::int as document_count
         from documents
         group by proposal_id
       ) dc on dc.proposal_id = p.id
       left join (
         select proposal_id, count(*)::int as folder_count
         from folders
         group by proposal_id
       ) fc on fc.proposal_id = p.id
       where p.id = $1`,
      [req.params.id],
    );

    const foldersResult = await query(
      `select
         f.*,
         coalesce(count(d.id), 0)::int as document_count
       from folders f
       left join documents d on d.folder_id = f.id
       where f.proposal_id = $1
       group by f.id
       order by f.parent_id nulls first, f.created_at asc, f.name asc`,
      [req.params.id],
    );

    const documentsResult = await query(
      `select
         d.*,
         u.name as uploaded_by_name,
         f.name as folder_name
       from documents d
       left join users u on u.id = d.uploaded_by
       left join folders f on f.id = d.folder_id
       where d.proposal_id = $1
       order by d.uploaded_at desc`,
      [req.params.id],
    );

    const historyResult = await query(
      `select
         h.*,
         u.name as changed_by_name
       from proposal_status_history h
       left join users u on u.id = h.changed_by
       where h.proposal_id = $1
       order by h.created_at desc`,
      [req.params.id],
    );

    return res.json({
      item: mapProposal(summaryResult.rows[0]),
      folders: foldersResult.rows.map(mapFolder),
      documents: documentsResult.rows.map(mapDocument),
      history: historyResult.rows.map(mapStatusHistory),
    });
  }),
);

app.post(
  '/api/proposals',
  requireAuth,
  requireRole(['student']),
  asyncRoute(async (req, res) => {
    const parsed = proposalPayloadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid project payload' });

    const existing = await query(`select id from proposals where student_id = $1`, [req.user.sub]);
    if (existing.rows.length > 0) {
      return res.status(403).json({ error: 'Each user can create only one project proposal.' });
    }

    const payload = parsed.data;
    const insertResult = await query(
      `insert into proposals
        (title, domain, scheme, status, student_id, abstract, problem, objectives, methodology, tech_stack, team, review_notes)
       values
        ($1, $2, $3, 'Submitted', $4, $5, $6, $7, $8, $9, $10, '')
       returning id`,
      [
        payload.title,
        payload.domain,
        payload.scheme,
        req.user.sub,
        payload.abstract,
        payload.problem,
        payload.objectives,
        payload.methodology,
        payload.techStack,
        JSON.stringify(payload.team),
      ],
    );

    const proposalId = insertResult.rows[0].id;

    await query(
      `insert into proposal_status_history (proposal_id, changed_by, from_status, to_status, note)
       values ($1, $2, null, 'Submitted', 'Project created')`,
      [proposalId, req.user.sub],
    );
    await logActivity(req.user.sub, 'CREATE_PROPOSAL', 'proposal', proposalId, {
      title: payload.title,
      domain: payload.domain,
      scheme: payload.scheme,
    });

    return res.status(201).json({ id: proposalId });
  }),
);

app.put(
  '/api/proposals/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const parsed = proposalPayloadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid project payload' });

    const proposalRow = await getProposalAccessRow(req.params.id);
    if (!proposalRow) return res.status(404).json({ error: 'Project not found' });
    if (!canEditProposal(req.user, proposalRow)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const payload = parsed.data;
    await query(
      `update proposals
       set title = $2,
           domain = $3,
           scheme = $4,
           abstract = $5,
           problem = $6,
           objectives = $7,
           methodology = $8,
           tech_stack = $9,
           team = $10
       where id = $1`,
      [
        req.params.id,
        payload.title,
        payload.domain,
        payload.scheme,
        payload.abstract,
        payload.problem,
        payload.objectives,
        payload.methodology,
        payload.techStack,
        JSON.stringify(payload.team),
      ],
    );

    await logActivity(req.user.sub, 'UPDATE_PROPOSAL', 'proposal', req.params.id, {
      title: payload.title,
      domain: payload.domain,
    });

    return res.json({ ok: true });
  }),
);

app.patch(
  '/api/proposals/:id/status',
  requireAuth,
  asyncRoute(async (req, res) => {
    const parsed = proposalStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid status payload' });

    const nextStatus = normalizeProposalStatus(parsed.data.status);
    if (!nextStatus || nextStatus === 'Draft') {
      return res.status(400).json({ error: 'Unsupported status value' });
    }

    const proposalRow = await getProposalAccessRow(req.params.id);
    if (!proposalRow) return res.status(404).json({ error: 'Project not found' });
    if (!canAccessProposal(req.user, proposalRow)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const previousStatus = normalizeProposalStatus(proposalRow.status) || proposalRow.status;
    const reviewerId = (req.user.role === 'admin' || req.user.role === 'reviewer') ? req.user.sub : null;
    await query(
      `update proposals
       set status = $2,
           review_notes = $3,
           reviewer_id = coalesce($4, reviewer_id),
           last_status_changed_at = now()
       where id = $1`,
      [req.params.id, nextStatus, parsed.data.note, reviewerId],
    );

    await query(
      `insert into proposal_status_history (proposal_id, changed_by, from_status, to_status, note)
       values ($1, $2, $3, $4, $5)`,
      [req.params.id, req.user.sub, previousStatus, nextStatus, parsed.data.note],
    );
    await logActivity(req.user.sub, 'UPDATE_PROPOSAL_STATUS', 'proposal', req.params.id, {
      fromStatus: previousStatus,
      toStatus: nextStatus,
      note: parsed.data.note,
    });

    return res.json({ ok: true, status: nextStatus });
  }),
);

app.delete(
  '/api/proposals/:id',
  requireAuth,
  requireRole(['admin']),
  asyncRoute(async (req, res) => {
    const proposalResult = await query(
      `select id, title
       from proposals
       where id = $1`,
      [req.params.id],
    );
    const proposal = proposalResult.rows[0];
    if (!proposal) return res.status(404).json({ error: 'Project not found' });

    const documentsResult = await query(
      `select path
       from documents
       where proposal_id = $1`,
      [req.params.id],
    );

    await query(`delete from proposals where id = $1`, [req.params.id]);

    await Promise.all(
      documentsResult.rows.map((row) => deleteStoredFile(row.path)),
    );
    await logActivity(req.user.sub, 'DELETE_PROPOSAL', 'proposal', req.params.id, {
      title: proposal.title,
    });

    return res.json({ ok: true });
  }),
);

app.get(
  '/api/folders',
  requireAuth,
  asyncRoute(async (req, res) => {
    const parsed = listFilterSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid folder filter' });

    const params = [];
    const filters = [];

    if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
      params.push(req.user.sub);
      filters.push(`p.student_id = $${params.length}`);
    }
    if (parsed.data.proposalId) {
      params.push(parsed.data.proposalId);
      filters.push(`f.proposal_id = $${params.length}`);
    }

    const whereClause = filters.length ? `where ${filters.join(' and ')}` : '';
    const result = await query(
      `select
         f.*,
         coalesce(count(d.id), 0)::int as document_count
       from folders f
       join proposals p on p.id = f.proposal_id
       left join documents d on d.folder_id = f.id
       ${whereClause}
       group by f.id
       order by f.parent_id nulls first, f.created_at asc, f.name asc`,
      params,
    );

    return res.json({ items: result.rows.map(mapFolder) });
  }),
);

app.post(
  '/api/folders',
  requireAuth,
  asyncRoute(async (req, res) => {
    const parsed = folderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid folder payload' });

    const proposalRow = await getProposalAccessRow(parsed.data.proposalId);
    if (!proposalRow) return res.status(404).json({ error: 'Project not found' });
    if (!canEditProposal(req.user, proposalRow)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (parsed.data.parentId) {
      const parentResult = await query(
        `select id, proposal_id
         from folders
         where id = $1`,
        [parsed.data.parentId],
      );
      const parent = parentResult.rows[0];
      if (!parent || parent.proposal_id !== parsed.data.proposalId) {
        return res.status(400).json({ error: 'Parent folder does not belong to this project' });
      }
    }

    const insertResult = await query(
      `insert into folders (name, parent_id, proposal_id, student_id, scheme, color)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [
        parsed.data.name,
        parsed.data.parentId || null,
        parsed.data.proposalId,
        proposalRow.student_id,
        parsed.data.scheme,
        parsed.data.color,
      ],
    );

    await logActivity(req.user.sub, 'CREATE_FOLDER', 'folder', insertResult.rows[0].id, {
      proposalId: parsed.data.proposalId,
      name: parsed.data.name,
      parentId: parsed.data.parentId || null,
    });

    return res.status(201).json({ item: mapFolder(insertResult.rows[0]) });
  }),
);

app.delete(
  '/api/folders/:id',
  requireAuth,
  requireRole(['admin']),
  asyncRoute(async (req, res) => {
    const folderResult = await query(
      `select id, name, proposal_id
       from folders
       where id = $1`,
      [req.params.id],
    );
    const folder = folderResult.rows[0];
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    await query(`delete from folders where id = $1`, [req.params.id]);
    await logActivity(req.user.sub, 'DELETE_FOLDER', 'folder', req.params.id, {
      proposalId: folder.proposal_id,
      name: folder.name,
    });

    return res.json({ ok: true });
  }),
);

app.get(
  '/api/documents',
  requireAuth,
  asyncRoute(async (req, res) => {
    const parsed = listFilterSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid document filter' });

    const params = [];
    const filters = [];

    if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
      params.push(req.user.sub);
      filters.push(`p.student_id = $${params.length}`);
    }
    if (parsed.data.proposalId) {
      params.push(parsed.data.proposalId);
      filters.push(`d.proposal_id = $${params.length}`);
    }
    if (parsed.data.folderId) {
      params.push(parsed.data.folderId);
      filters.push(`d.folder_id = $${params.length}`);
    }

    const whereClause = filters.length ? `where ${filters.join(' and ')}` : '';
    const result = await query(
      `select
         d.*,
         u.name as uploaded_by_name,
         f.name as folder_name
       from documents d
       join proposals p on p.id = d.proposal_id
       left join users u on u.id = d.uploaded_by
       left join folders f on f.id = d.folder_id
       ${whereClause}
       order by d.uploaded_at desc`,
      params,
    );

    return res.json({ items: result.rows.map(mapDocument) });
  }),
);

app.post(
  '/api/documents',
  requireAuth,
  handleUpload('document'),
  asyncRoute(async (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'File is required' });

    const proposalId = String(req.body.proposalId || '').trim();
    const folderId = String(req.body.folderId || '').trim() || null;
    const category = String(req.body.category || 'supporting-document').trim() || 'supporting-document';
    const description = String(req.body.description || '').trim();

    if (!proposalId) return res.status(400).json({ error: 'proposalId is required' });

    const proposalRow = await getProposalAccessRow(proposalId);
    if (!proposalRow) return res.status(404).json({ error: 'Project not found' });
    if (!canEditProposal(req.user, proposalRow)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (folderId) {
      const folderResult = await query(
        `select id
         from folders
         where id = $1 and proposal_id = $2`,
        [folderId, proposalId],
      );
      if (!folderResult.rows[0]) {
        return res.status(400).json({ error: 'Folder does not belong to this project' });
      }
    }

    const documentName = sanitizeFileName(file.originalname);
    const mimeType = file.mimetype || 'application/octet-stream';

    let insertResult;
    if (documentStorageMode === 'filesystem') {
      const storedFilePath = await writeDocumentToFilesystem(file);
      insertResult = await query(
        `insert into documents
          (proposal_id, folder_id, uploaded_by, name, path, storage_mode, mime_type, size, category, description)
         values
          ($1, $2, $3, $4, $5, 'filesystem', $6, $7, $8, $9)
         returning *`,
        [
          proposalId,
          folderId,
          req.user.sub,
          documentName,
          storedFilePath,
          mimeType,
          file.size,
          category,
          description,
        ],
      );
    } else {
      insertResult = await query(
        `insert into documents
          (proposal_id, folder_id, uploaded_by, name, path, storage_mode, data, mime_type, size, category, description)
         values
          ($1, $2, $3, $4, 'db', 'database', $5, $6, $7, $8, $9)
         returning *`,
        [
          proposalId,
          folderId,
          req.user.sub,
          documentName,
          file.buffer,
          mimeType,
          file.size,
          category,
          description,
        ],
      );
    }

    await logActivity(req.user.sub, 'UPLOAD_DOCUMENT', 'document', insertResult.rows[0].id, {
      proposalId,
      folderId,
      name: documentName,
      category,
    });

    return res.status(201).json({ document: mapDocument(insertResult.rows[0]) });
  }),
);

app.delete(
  '/api/documents/:id',
  requireAuth,
  requireRole(['admin']),
  asyncRoute(async (req, res) => {
    const result = await query(
      `select id, name, path, proposal_id
       from documents
       where id = $1`,
      [req.params.id],
    );
    const document = result.rows[0];
    if (!document) return res.status(404).json({ error: 'Document not found' });

    await query(`delete from documents where id = $1`, [req.params.id]);
    await deleteStoredFile(document.path);
    await logActivity(req.user.sub, 'DELETE_DOCUMENT', 'document', req.params.id, {
      proposalId: document.proposal_id,
      name: document.name,
    });

    return res.json({ ok: true });
  }),
);

app.get(
  '/api/documents/:id/download',
  requireAuth,
  asyncRoute(async (req, res) => {
    const result = await query(
      `select
         d.*,
         p.student_id
       from documents d
       join proposals p on p.id = d.proposal_id
       where d.id = $1`,
      [req.params.id],
    );
    const document = result.rows[0];
    if (!document) return res.status(404).json({ error: 'Document not found' });
    if (req.user.role !== 'admin' && req.user.role !== 'reviewer' && document.student_id !== req.user.sub) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.setHeader('Content-Type', document.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', Number(document.size || 0));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${sanitizeFileName(document.name)}"`,
    );

    if (document.path && document.path !== 'db') {
      const filePath = path.resolve(document.path);
      if (!existsSync(filePath)) {
        return res.status(404).json({ error: 'Document file missing on disk' });
      }
      createReadStream(filePath).pipe(res);
      return;
    }

    if (!document.data) {
      return res.status(404).json({ error: 'Document data missing' });
    }

    res.send(document.data);
  }),
);

app.get(
  '/api/users',
  requireAuth,
  requireRole(['admin']),
  asyncRoute(async (_req, res) => {
    const result = await query(
      `select
         u.id,
         u.name,
         u.email,
         u.role,
         u.created_at,
         coalesce(count(p.id), 0)::int as proposal_count
       from users u
       left join proposals p on p.student_id = u.id
       group by u.id
       order by u.created_at desc, u.name asc`,
    );

    return res.json({
      items: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        createdAt: row.created_at,
        proposalCount: Number(row.proposal_count || 0),
      })),
    });
  }),
);

app.post(
  '/api/users',
  requireAuth,
  requireRole(['admin']),
  asyncRoute(async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid user payload' });

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    try {
      const result = await query(
        `insert into users (name, email, password_hash, role)
         values ($1, $2, $3, $4)
         returning id`,
        [
          parsed.data.name,
          normalizeEmail(parsed.data.email),
          passwordHash,
          parsed.data.role,
        ],
      );

      await logActivity(req.user.sub, 'CREATE_USER', 'user', result.rows[0].id, {
        email: normalizeEmail(parsed.data.email),
        role: parsed.data.role,
      });

      return res.status(201).json({ id: result.rows[0].id });
    } catch (error) {
      if (String(error?.message || '').includes('users_email_key')) {
        return res.status(409).json({ error: 'Email already exists' });
      }
      throw error;
    }
  }),
);

app.delete(
  '/api/users/:id',
  requireAuth,
  requireRole(['admin']),
  asyncRoute(async (req, res) => {
    if (req.params.id === req.user.sub) {
      return res.status(400).json({ error: 'You cannot delete your own admin account.' });
    }

    const userResult = await query(
      `select id, name, email
       from users
       where id = $1`,
      [req.params.id],
    );
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const documentPathsResult = await query(
      `select d.path
       from documents d
       join proposals p on p.id = d.proposal_id
       where p.student_id = $1`,
      [req.params.id],
    );

    await query(`delete from users where id = $1`, [req.params.id]);
    await Promise.all(documentPathsResult.rows.map((row) => deleteStoredFile(row.path)));
    await logActivity(req.user.sub, 'DELETE_USER', 'user', req.params.id, {
      email: user.email,
      name: user.name,
    });

    return res.json({ ok: true });
  }),
);

app.get(
  '/api/logs',
  requireAuth,
  requireRole(['admin']),
  asyncRoute(async (req, res) => {
    const parsed = logFilterSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid log filter' });

    const result = await query(
      `select
         l.*,
         u.name as user_name
       from activity_logs l
       left join users u on u.id = l.user_id
       order by l.created_at desc
       limit $1`,
      [parsed.data.limit],
    );

    return res.json({ items: result.rows.map(mapActivity) });
  }),
);

app.get('/', (_req, res) => {
  if (hasFrontendBuild) {
    res.sendFile(frontendEntryFile);
    return;
  }

  res.json({
    service: 'project-proposal-checker-api',
    ok: true,
    health: '/api/health',
  });
});

if (hasFrontendBuild) {
  app.use(express.static(frontendDistDir));
  app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(frontendEntryFile);
  });
}

app.use((error, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled error:', error);
  res.status(500).json({ error: error?.message || 'Server error' });
});

if (isDirectRun) {
  const port = Number(process.env.PORT || 43121);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on port ${port}`);
  });
}

export default app;
