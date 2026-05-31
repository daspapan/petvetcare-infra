import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

export interface DatabaseCredentials {
  username: string;
  password: string;
  host?: string;
  port?: number;
  dbname?: string;
}

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  secretArn: string;
}

let cachedCredentials: DatabaseCredentials | null = null;

export async function getDatabaseCredentials(
  secretArn: string,
): Promise<DatabaseCredentials> {
  if (cachedCredentials) {
    return cachedCredentials;
  }

  const client = new SecretsManagerClient({});
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );

  if (!response.SecretString) {
    throw new Error('Database secret is empty');
  }

  cachedCredentials = JSON.parse(response.SecretString) as DatabaseCredentials;
  return cachedCredentials;
}

export async function createDbClient(config: DbConfig): Promise<Client> {
  const credentials = await getDatabaseCredentials(config.secretArn);

  return new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: credentials.username,
    password: credentials.password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });
}

export function getMigrationsDir(): string {
  const candidates = [
    path.join(__dirname, 'database/migrations'),
    path.join(__dirname, '../database/migrations'),
    path.join(__dirname, '../../database/migrations'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      return dir;
    }
  }
  throw new Error('Migrations directory not found');
}

export function listMigrationFiles(): string[] {
  const dir = getMigrationsDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

export async function getAppliedMigrations(client: Client): Promise<Set<string>> {
  const result = await client.query<{ migration_name: string }>(
    'SELECT migration_name FROM schema_migrations ORDER BY migration_id',
  );
  return new Set(result.rows.map((r) => r.migration_name));
}

export async function applyMigration(
  client: Client,
  fileName: string,
  appliedBy: string,
): Promise<void> {
  const filePath = path.join(getMigrationsDir(), fileName);
  const sql = fs.readFileSync(filePath, 'utf-8');

  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (migration_name, applied_by)
       VALUES ($1, $2)
       ON CONFLICT (migration_name) DO NOTHING`,
      [fileName, appliedBy],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function runPendingMigrations(
  config: DbConfig,
  appliedBy: string,
): Promise<{ applied: string[]; skipped: string[] }> {
  const client = await createDbClient(config);
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.connect();

    // Ensure migration tracking table exists
    const trackingSql = fs.readFileSync(
      path.join(getMigrationsDir(), '000_schema_migrations.sql'),
      'utf-8',
    );
    await client.query(trackingSql);

    const alreadyApplied = await getAppliedMigrations(client);
    const files = listMigrationFiles().filter((f) => f !== '000_schema_migrations.sql');

    for (const file of files) {
      if (alreadyApplied.has(file)) {
        skipped.push(file);
        continue;
      }
      await applyMigration(client, file, appliedBy);
      applied.push(file);
    }

    return { applied, skipped };
  } finally {
    await client.end();
  }
}

export async function getMigrationHistory(config: DbConfig) {
  const client = await createDbClient(config);
  try {
    await client.connect();
    const result = await client.query(
      `SELECT migration_id, migration_name, applied_at, applied_by
       FROM schema_migrations ORDER BY migration_id`,
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

export async function rollbackLastMigration(
  config: DbConfig,
  appliedBy: string,
): Promise<string | null> {
  const client = await createDbClient(config);
  try {
    await client.connect();
    const result = await client.query<{ migration_name: string }>(
      `SELECT migration_name FROM schema_migrations
       ORDER BY migration_id DESC LIMIT 1`,
    );

    if (result.rows.length === 0) {
      return null;
    }

    const migrationName = result.rows[0].migration_name;
    const downFile = path.join(
      getMigrationsDir(),
      migrationName.replace('.sql', '.down.sql'),
    );

    if (!fs.existsSync(downFile)) {
      throw new Error(`Rollback file not found: ${downFile}`);
    }

    const sql = fs.readFileSync(downFile, 'utf-8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'DELETE FROM schema_migrations WHERE migration_name = $1',
        [migrationName],
      );
      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, new_value)
         VALUES ('schema_migrations', gen_random_uuid(), 'ROLLBACK', $1)`,
        [JSON.stringify({ migration_name: migrationName, applied_by: appliedBy })],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    return migrationName;
  } finally {
    await client.end();
  }
}
