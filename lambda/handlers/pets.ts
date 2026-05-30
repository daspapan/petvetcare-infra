import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';

interface DatabaseCredentials {
  username: string;
  password: string;
}

const secretsClient = new SecretsManagerClient({});

async function getDatabaseCredentials(): Promise<DatabaseCredentials> {
  const secretArn = process.env.DATABASE_SECRET_ARN;
  if (!secretArn) {
    throw new Error('DATABASE_SECRET_ARN is not configured');
  }

  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );

  if (!response.SecretString) {
    throw new Error('Database secret is empty');
  }

  return JSON.parse(response.SecretString) as DatabaseCredentials;
}

function jsonResponse(
  statusCode: number,
  body: unknown,
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

function getTenantId(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): string | undefined {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  return claims?.['custom:tenantId'] as string | undefined;
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const tenantId = getTenantId(event);
  const method = event.requestContext.http.method;
  const petId = event.pathParameters?.petId;

  try {
    if (method === 'GET' && !petId) {
      return jsonResponse(200, {
        items: [],
        tenantId,
        message: 'Pet listing placeholder — connect Aurora in application layer',
      });
    }

    if (method === 'POST' && !petId) {
      const payload = event.body ? JSON.parse(event.body) : {};
      await getDatabaseCredentials();

      return jsonResponse(201, {
        id: crypto.randomUUID(),
        tenantId,
        ...payload,
        message: 'Pet record created (placeholder)',
      });
    }

    if (method === 'GET' && petId) {
      return jsonResponse(200, {
        id: petId,
        tenantId,
        message: 'Pet detail placeholder',
      });
    }

    if (method === 'PUT' && petId) {
      const payload = event.body ? JSON.parse(event.body) : {};
      return jsonResponse(200, {
        id: petId,
        tenantId,
        ...payload,
        message: 'Pet record updated (placeholder)',
      });
    }

    if (method === 'DELETE' && petId) {
      return jsonResponse(204, '');
    }

    return jsonResponse(405, { message: 'Method not allowed' });
  } catch (error) {
    console.error('Pets handler error', error);
    return jsonResponse(500, { message: 'Internal server error' });
  }
}
