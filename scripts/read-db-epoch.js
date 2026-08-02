/**
 * Read-only MySQL UNIX_TIMESTAMP() for job cutoff capture.
 * Builder container only; SELECT-only credentials.
 */
import mysql from 'mysql2/promise';

const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`${key} is required`);
    process.exit(64);
  }
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: false,
});
try {
  const [rows] = await conn.query('SELECT UNIX_TIMESTAMP() AS epoch');
  const epoch = String(rows[0].epoch);
  if (!/^\d{10}$/.test(epoch)) {
    console.error('unexpected epoch', epoch);
    process.exit(65);
  }
  process.stdout.write(`${epoch}\n`);
} finally {
  await conn.end();
}
