import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';

const SECRET = process.env.ADMIN_JWT_SECRET || 'fallback-dev-secret';

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 12);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

export function generateToken(admin) {
  return jwt.sign(
    { id: admin.id, email: admin.email, role: admin.role },
    SECRET,
    { expiresIn: '24h' }
  );
}

export async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(header.slice(7), SECRET);
    const admin = await db.prepare('SELECT id, email, name, role FROM admins WHERE id = ?').get(payload.id);
    if (!admin) return res.status(401).json({ error: 'Account not found' });
    req.admin = admin;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.admin.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
