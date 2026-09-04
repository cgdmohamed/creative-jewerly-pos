import path from 'node:path';
import dotenv from 'dotenv';

// Load server/.env relative to this file so the compiled server works from any cwd.
dotenv.config({ path: path.resolve(import.meta.dirname, '../.env'), quiet: true });

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env var ${name} — set it in server/.env (see server/.env.example)`);
  }
  return v;
}

export const config = {
  port: Number(process.env.PORT || 4001),
  jwtSecret: required('JWT_SECRET'),
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5174')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  db: {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5433),
    user: process.env.PGUSER || 'jewelry',
    password: required('PGPASSWORD'),
    database: process.env.PGDATABASE || 'jewelry',
  },
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
};
