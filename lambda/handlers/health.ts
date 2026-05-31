import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({
      status: 'ok',
      service: 'petvetcare-api',
      environment: process.env.APP_ENV ?? 'unknown',
      timestamp: new Date().toISOString(),
      path: event.path,
    }),
  };
}
