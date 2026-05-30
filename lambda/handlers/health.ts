import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
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
      path: event.rawPath,
    }),
  };
}
