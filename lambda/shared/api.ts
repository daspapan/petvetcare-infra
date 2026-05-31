import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';

export interface ApiResponse {
  statusCode: number;
  body: unknown;
}

export function jsonResponse(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN ?? '*',
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

export function getJwtClaims(
  event: APIGatewayProxyEvent,
): Record<string, string> {
  const claims =
    event.requestContext.authorizer?.claims ??
    event.requestContext.authorizer?.jwt?.claims ??
    {};
  return claims as Record<string, string>;
}

export function getUserSub(event: APIGatewayProxyEvent): string | undefined {
  return getJwtClaims(event).sub;
}

export function getUserGroup(event: APIGatewayProxyEvent): string {
  return (
    getJwtClaims(event)['custom:group_type'] ??
    getJwtClaims(event)['cognito:groups']?.split(',')[0] ??
    'PET_OWNER'
  );
}

export function requireAuth(event: APIGatewayProxyEvent): string {
  const sub = getUserSub(event);
  if (!sub) {
    throw new AuthError('Unauthorized', 401);
  }
  return sub;
}

export function requireRole(
  event: APIGatewayProxyEvent,
  allowedRoles: string[],
): string {
  const sub = requireAuth(event);
  const group = getUserGroup(event);
  if (!allowedRoles.includes(group)) {
    throw new AuthError('Forbidden', 403);
  }
  return sub;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export function parseBody<T>(event: APIGatewayProxyEvent): T {
  if (!event.body) {
    throw new ValidationError('Request body is required');
  }
  try {
    return JSON.parse(event.body) as T;
  } catch {
    throw new ValidationError('Invalid JSON body');
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function handleError(error: unknown): APIGatewayProxyResult {
  if (error instanceof AuthError) {
    return jsonResponse(error.statusCode, { error: error.message });
  }
  if (error instanceof ValidationError) {
    return jsonResponse(400, { error: error.message });
  }
  console.error('Unhandled error', error);
  return jsonResponse(500, { error: 'Internal server error' });
}

export function getDbConfig() {
  return {
    host: process.env.DATABASE_PROXY_ENDPOINT ?? process.env.DATABASE_HOST!,
    port: Number(process.env.DATABASE_PORT ?? '5432'),
    database: process.env.DATABASE_NAME!,
    secretArn: process.env.DATABASE_SECRET_ARN!,
  };
}
