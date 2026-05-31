import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  getMigrationHistory,
  rollbackLastMigration,
  runPendingMigrations,
} from '../shared/db';
import {
  getDbConfig,
  getUserGroup,
  handleError,
  jsonResponse,
  requireAuth,
} from '../shared/api';

/**
 * DatabaseMigrationLambda
 * Admin endpoints for migration management.
 */
export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  try {
    const sub = requireAuth(event);
    const group = getUserGroup(event);

    if (group !== 'ADMIN') {
      return jsonResponse(403, { error: 'Admin access required' });
    }

    const dbConfig = getDbConfig();
    const method = event.httpMethod;
    const path = event.path;

    if (method === 'POST' && path.endsWith('/admin/database/migrate')) {
      const result = await runPendingMigrations(dbConfig, sub);
      return jsonResponse(200, {
        message: 'Migrations applied',
        ...result,
      });
    }

    if (method === 'POST' && path.endsWith('/admin/database/rollback')) {
      const rolledBack = await rollbackLastMigration(dbConfig, sub);
      if (!rolledBack) {
        return jsonResponse(404, { error: 'No migrations to rollback' });
      }
      return jsonResponse(200, {
        message: 'Migration rolled back',
        migration: rolledBack,
      });
    }

    if (method === 'GET' && path.endsWith('/admin/database/migrations')) {
      const history = await getMigrationHistory(dbConfig);
      return jsonResponse(200, { migrations: history });
    }

    return jsonResponse(404, { error: 'Not found' });
  } catch (error) {
    return handleError(error);
  }
}
