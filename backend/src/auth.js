import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const secret = process.env.JWT_SECRET || 'proposal_checker_default_secret_key_2024_xyz';
    const payload = jwt.verify(token, secret);
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

export function requireRole(roles) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role || !roles.includes(role)) return res.status(403).json({ error: 'Forbidden' });
    return next();
  };
}

