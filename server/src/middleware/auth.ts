import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { queryOne } from '../db.js';

export interface AuthEmployee {
  id: number;
  employeeNo: string;
  fullName: string;
  role: string;
  roleCode: string;
  locationId: number | null;
  permissions: string[];
}

declare global {
  namespace Express {
    interface Request {
      employee?: AuthEmployee;
    }
  }
}

export function signToken(emp: { id: number; roleCode: string; fullName: string }): string {
  return jwt.sign({ sub: emp.id, role: emp.roleCode, name: emp.fullName }, config.jwtSecret, {
    expiresIn: '12h',
  });
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'auth.required' });
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    const emp = await queryOne<any>(
      `SELECT e.id, e.employee_no, e.full_name, e.location_id,
              r.code AS role_code, r.name_ar AS role_name
         FROM employees e
         JOIN roles r ON r.id = e.role_id
        WHERE e.id = $1 AND e.status = 'active'`,
      [Number(payload.sub)],
    );
    if (!emp) return res.status(401).json({ error: 'auth.inactive' });

    const perms = await queryOne<any>(
      `SELECT COALESCE(array_agg(p.code), '{}') AS perms
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = (SELECT role_id FROM employees WHERE id = $1)`,
      [emp.id],
    );

    req.employee = {
      id: emp.id,
      employeeNo: emp.employee_no,
      fullName: emp.full_name,
      role: emp.role_name,
      roleCode: emp.role_code,
      locationId: emp.location_id,
      permissions: perms?.perms ?? [],
    };
    next();
  } catch {
    return res.status(401).json({ error: 'auth.required' });
  }
}

export function requirePermission(code: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.employee) return res.status(401).json({ error: 'auth.required' });
    if (req.employee.permissions.includes(code)) return next();
    return res.status(403).json({ error: 'forbidden' });
  };
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.employee) return res.status(401).json({ error: 'auth.required' });
    if (roles.includes(req.employee.roleCode)) return next();
    return res.status(403).json({ error: 'forbidden' });
  };
}
