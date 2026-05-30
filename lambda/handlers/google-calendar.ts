import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';

interface GoogleCalendarCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const secretsClient = new SecretsManagerClient({});

async function getGoogleCredentials(): Promise<GoogleCalendarCredentials> {
  const secretArn = process.env.GOOGLE_CALENDAR_SECRET_ARN;
  if (!secretArn) {
    throw new Error('GOOGLE_CALENDAR_SECRET_ARN is not configured');
  }

  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );

  if (!response.SecretString) {
    throw new Error('Google Calendar secret is empty');
  }

  return JSON.parse(response.SecretString) as GoogleCalendarCredentials;
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

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const path = event.rawPath.replace(/^\/integrations\/google\/?/, '');
  const method = event.requestContext.http.method;

  try {
    const credentials = await getGoogleCredentials();

    if (method === 'GET' && (path === 'auth' || path === '')) {
      const params = new URLSearchParams({
        client_id: credentials.clientId,
        redirect_uri: credentials.redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/calendar.events',
        access_type: 'offline',
        prompt: 'consent',
      });

      return jsonResponse(200, {
        authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      });
    }

    if (method === 'GET' && path.startsWith('callback')) {
      const code = event.queryStringParameters?.code;
      if (!code) {
        return jsonResponse(400, { message: 'Missing authorization code' });
      }

      return jsonResponse(200, {
        message:
          'OAuth callback received — exchange code for tokens and persist refresh token',
        codeReceived: true,
      });
    }

    if (method === 'POST' && path === 'bookings') {
      const booking = event.body ? JSON.parse(event.body) : {};
      return jsonResponse(202, {
        message: 'Vet visit booking request accepted (placeholder)',
        booking,
      });
    }

    return jsonResponse(404, { message: 'Route not found' });
  } catch (error) {
    console.error('Google Calendar handler error', error);
    return jsonResponse(500, { message: 'Internal server error' });
  }
}
