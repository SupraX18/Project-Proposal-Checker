import fs from 'fs';
import path from 'path';

const file = 'src/index.js';
let content = fs.readFileSync(file, 'utf8');

// 1. Remove evaluation and workspace schemas
content = content.replace(/const evaluationUpsertSchema = z\.object\(\{[\s\S]*?\}\);\s*/g, '');
content = content.replace(/const workspaceDeadlineValueSchema = z\.union\(\[[\s\S]*?\]\);\s*/g, '');
content = content.replace(/const workspaceSettingsSchema = z\.object\(\{[\s\S]*?\}\);\s*/g, '');

// 2. Remove helper functions
content = content.replace(/function mapEvaluation\(row\) \{[\s\S]*?^\}\s*/m, '');
content = content.replace(/function scoreSimilarityPair\(left, right\) \{[\s\S]*?^\}\s*/m, '');

// 3. Fix GET /api/proposals query
content = content.replace(/u\.name as student,[\s\S]*?from proposals p/m, 'u.name as student\n     from proposals p');
content = content.replace(/left join users r on r\.id = p\.reviewer_id\s*left join proposal_evaluations pe on pe\.proposal_id = p\.id/g, '');
content = content.replace(/reviewer: row\.reviewer,\s*evaluation: mapEvaluation\(row\),/g, '');

// 4. Fix GET /api/proposals/:id query
content = content.replace(/u\.id as student_id, u\.name as student,[\s\S]*?pe\.updated_at as evaluation_updated_at[\s\S]*?from proposals p[\s\S]*?left join proposal_evaluations pe on pe\.proposal_id = p\.id/m, `u.id as student_id, u.name as student
     from proposals p
     join users u on u.id = p.student_id`);
content = content.replace(/reviewer: row\.reviewer,\s*evaluation: mapEvaluation\(row\),/g, '');

// 5. Remove similarity-report route completely
content = content.replace(/app\.get\('\/api\/proposals\/similarity-report',[\s\S]*?\}\)\);\s*/g, '');

// 6. Remove workspace-settings routes completely
content = content.replace(/app\.get\('\/api\/workspace-settings',[\s\S]*?\}\)\);\s*/g, '');
content = content.replace(/app\.put\('\/api\/workspace-settings',[\s\S]*?\}\)\);\s*/g, '');

// 7. Remove evaluation route completely
content = content.replace(/app\.put\('\/api\/proposals\/:id\/evaluation',[\s\S]*?\}\)\);\s*/g, '');

// 8. Update PATCH /api/proposals/:id/status
const patchStatusOld = /app\.patch\('\/api\/proposals\/:id\/status', requireAuth, requireRole\(\['admin'\]\), asyncRoute\(async \(req, res\) => \{[\s\S]*?\}\)\);/g;
const patchStatusNew = `app.patch('/api/proposals/:id/status', requireAuth, asyncRoute(async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'Status is required' });

  // Verify ownership or admin role
  const check = await query('select student_id from proposals where id = $1', [id]);
  if (!check.rowCount) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'student' && check.rows[0].student_id !== req.user.sub) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  await query(\`update proposals set status = $2, updated_at = now() where id = $1\`, [id, status]);
  await logActivity(req.user.sub, 'UPDATE_STATUS', 'proposal', id, { status });
  return res.json({ success: true, status });
}));`;
content = content.replace(patchStatusOld, patchStatusNew);

// 9. Add User Management routes
const usersRoutes = `
app.post('/api/users', requireAuth, requireRole(['admin']), asyncRoute(async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'Missing fields' });
  const hash = await bcrypt.hash(password, 10);
  const result = await query(
    \`insert into users (name, email, password_hash, role) values ($1, $2, $3, $4) returning id\`,
    [name, email, hash, role]
  );
  return res.json({ id: result.rows[0].id });
}));

app.delete('/api/users/:id', requireAuth, requireRole(['admin']), asyncRoute(async (req, res) => {
  await query('delete from users where id = $1', [req.params.id]);
  return res.json({ success: true });
}));
`;
content = content.replace(/app\.get\('\/api\/users',/, usersRoutes + "\napp.get('/api/users',");

// 10. Fix Folders API to support color
content = content.replace(/const \{ name, parent_id \} = parsed\.data;/g, 'const { name, parent_id, color } = parsed.data;');
content = content.replace(/values \(\$1, \$2, \$3\) returning id`,[\s\S]*?\[name, parent_id, req\.user\.sub\]/g, "values ($1, $2, $3, $4) returning id`,\n    [name, parent_id, req.user.sub, color || '#64748b']");
content = content.replace(/insert into folders \(name, parent_id, student_id\) values/g, 'insert into folders (name, parent_id, student_id, color) values');
content = content.replace(/select id, name, parent_id, created_at, updated_at/g, 'select id, name, parent_id, color, created_at, updated_at');


fs.writeFileSync(file, content);
console.log('Refactoring complete');
