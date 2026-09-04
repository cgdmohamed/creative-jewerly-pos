import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool(config.db);

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q: Queryable = {
      query: async (text: string, params?: any[]) => {
        const res = await client.query(text, params);
        return res.rows;
      },
      queryOne: async (text: string, params?: any[]) => {
        const res = await client.query(text, params);
        return res.rows[0] ?? null;
      },
    };
    const result = await fn(q);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface Queryable {
  query: <T = any>(text: string, params?: any[]) => Promise<T[]>;
  queryOne: <T = any>(text: string, params?: any[]) => Promise<T | null>;
}
