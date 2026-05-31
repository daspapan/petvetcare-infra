import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createDbClient } from '../shared/db';
import {
  getDbConfig,
  getUserGroup,
  getUserSub,
  handleError,
  jsonResponse,
  parseBody,
  requireAuth,
  requireRole,
} from '../shared/api';

type HandlerFn = (
  event: APIGatewayProxyEvent,
  client: Awaited<ReturnType<typeof createDbClient>>,
  sub: string,
) => Promise<APIGatewayProxyResult>;

export function createDomainHandler(
  routes: Array<{
    method: string;
    pathPattern: RegExp;
    roles?: string[];
    handler: HandlerFn;
  }>,
): (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult> {
  return async (event: APIGatewayProxyEvent) => {
    try {
      const sub = event.httpMethod === 'OPTIONS' ? '' : requireAuth(event);
      const group = getUserGroup(event);

      for (const route of routes) {
        if (
          event.httpMethod === route.method &&
          route.pathPattern.test(event.path)
        ) {
          if (route.roles && !route.roles.includes(group)) {
            return jsonResponse(403, { error: 'Insufficient permissions' });
          }
          const dbConfig = getDbConfig();
          const client = await createDbClient(dbConfig);
          try {
            await client.connect();
            return await route.handler(event, client, sub);
          } finally {
            await client.end();
          }
        }
      }

      return jsonResponse(404, { error: 'Not found' });
    } catch (error) {
      return handleError(error);
    }
  };
}

export { parseBody, jsonResponse, requireRole, getUserSub, getUserGroup };
