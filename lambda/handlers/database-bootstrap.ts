import type { CloudFormationCustomResourceEvent, Context } from 'aws-lambda';
import {
  runPendingMigrations,
  type DbConfig,
} from '../shared/db';

/**
 * DatabaseBootstrapLambda
 * Invoked by CDK Custom Resource on first deploy after Aurora is ready.
 */
export async function handler(
  event: CloudFormationCustomResourceEvent,
  _context: Context,
): Promise<Record<string, unknown>> {
  console.log('Bootstrap event:', JSON.stringify(event));

  const dbConfig: DbConfig = {
    host: process.env.DATABASE_PROXY_ENDPOINT ?? process.env.DATABASE_HOST!,
    port: Number(process.env.DATABASE_PORT ?? '5432'),
    database: process.env.DATABASE_NAME!,
    secretArn: process.env.DATABASE_SECRET_ARN!,
  };

  if (event.RequestType === 'Delete') {
    return { PhysicalResourceId: event.PhysicalResourceId ?? 'db-bootstrap' };
  }

  const maxRetries = 10;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await runPendingMigrations(dbConfig, 'DatabaseBootstrapLambda');
      console.log('Migration result:', JSON.stringify(result));
      return {
        PhysicalResourceId: 'petvetcare-db-bootstrap',
        Data: result,
      };
    } catch (error) {
      lastError = error;
      console.warn(`Bootstrap attempt ${attempt}/${maxRetries} failed`, error);
      await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  }

  throw lastError;
}
