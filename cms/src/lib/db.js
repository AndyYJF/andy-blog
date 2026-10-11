import mysql from 'mysql2/promise';
import { assertLocalDbHost, ensureCmsSchema } from './content-store.js';

let pool;

export function cmsDbConfig() {
  const host = process.env.CMS_DB_HOST || '127.0.0.1';
  assertLocalDbHost(host);
  return {
    host,
    port: Number(process.env.CMS_DB_PORT || 3307),
    user: process.env.CMS_DB_USER || 'cms',
    password: process.env.CMS_DB_PASSWORD || 'cms-dev',
    database: process.env.CMS_DB_NAME || 'cms',
    charset: 'utf8mb4',
    connectTimeout: 2000,
    connectionLimit: 4,
  };
}

export async function cmsDb() {
  if (!pool) {
    const next = mysql.createPool(cmsDbConfig());
    let connection;
    try {
      connection = await next.getConnection();
      await ensureCmsSchema(connection);
    } catch (error) {
      if (connection) connection.release();
      await next.end();
      throw error;
    }
    connection.release();
    pool = next;
  }
  return pool;
}

export async function withCmsDb(fn) {
  const current = await cmsDb();
  const db = await current.getConnection();
  try {
    return await fn(db);
  } finally {
    db.release();
  }
}

export async function closeCmsDb() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
