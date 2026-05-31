import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  CognitoIdentityProviderClient,
  GlobalSignOutCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { createDbClient } from '../shared/db';
import {
  getDbConfig,
  getJwtClaims,
  getUserSub,
  handleError,
  jsonResponse,
  parseBody,
  requireAuth,
} from '../shared/api';

const ses = new SESClient({});
const cognito = new CognitoIdentityProviderClient({});

interface SendOtpRequest {
  email: string;
}

interface VerifyOtpRequest {
  email: string;
  otp: string;
  session?: string;
}

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/** SendOtpLambda */
async function sendOtp(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { email } = parseBody<SendOtpRequest>(event);
  if (!email?.includes('@')) {
    return jsonResponse(400, { error: 'Valid email is required' });
  }

  const otp = generateOtp();
  const fromEmail = process.env.SES_FROM_EMAIL ?? 'noreply@petvetcare.app';

  await ses.send(
    new SendEmailCommand({
      Source: fromEmail,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: 'PetVetCare Login OTP' },
        Body: {
          Text: { Data: `Your PetVetCare login code is: ${otp}. Valid for 5 minutes.` },
        },
      },
    }),
  );

  // In production: store OTP hash in DynamoDB/ElastiCache with TTL
  console.log(JSON.stringify({ action: 'OTP_SENT', email, otpHash: 'redacted' }));

  return jsonResponse(200, {
    message: 'OTP sent successfully',
    expiresInSeconds: 300,
  });
}

/** VerifyOtpLambda */
async function verifyOtp(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { email, otp } = parseBody<VerifyOtpRequest>(event);

  // Placeholder: validate OTP from cache, then initiate Cognito custom auth
  const userPoolId = process.env.COGNITO_USER_POOL_ID!;
  const clientId = process.env.COGNITO_CLIENT_ID!;

  try {
    const authResult = await cognito.send(
      new AdminInitiateAuthCommand({
        UserPoolId: userPoolId,
        ClientId: clientId,
        AuthFlow: 'CUSTOM_AUTH',
        AuthParameters: { USERNAME: email },
      }),
    );

    const challenge = await cognito.send(
      new AdminRespondToAuthChallengeCommand({
        UserPoolId: userPoolId,
        ClientId: clientId,
        ChallengeName: 'CUSTOM_CHALLENGE',
        Session: authResult.Session,
        ChallengeResponses: {
          USERNAME: email,
          ANSWER: otp,
        },
      }),
    );

    return jsonResponse(200, {
      message: 'Authentication successful',
      tokens: challenge.AuthenticationResult,
    });
  } catch (error) {
    console.error('Verify OTP error', error);
    return jsonResponse(401, { error: 'Invalid or expired OTP' });
  }
}

/** LogoutLambda */
async function logout(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  requireAuth(event);
  const token = event.headers.Authorization?.replace('Bearer ', '') ?? '';

  await cognito.send(
    new GlobalSignOutCommand({ AccessToken: token }),
  );

  return jsonResponse(200, { message: 'Logged out successfully' });
}

/** GetCurrentUserLambda */
async function getCurrentUser(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub = requireAuth(event);
  const claims = getJwtClaims(event);
  const dbConfig = getDbConfig();
  const client = await createDbClient(dbConfig);

  try {
    await client.connect();
    const result = await client.query(
      `SELECT id, email, first_name, last_name, profile_image_url, group_type, status
       FROM users WHERE cognito_sub = $1 OR email = $2 LIMIT 1`,
      [sub, claims.email],
    );

    if (result.rows.length === 0) {
      return jsonResponse(404, { error: 'User profile not found' });
    }

    return jsonResponse(200, { user: result.rows[0] });
  } finally {
    await client.end();
  }
}

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  try {
    const { httpMethod, path } = event;

    if (httpMethod === 'POST' && path.endsWith('/auth/send-otp')) {
      return sendOtp(event);
    }
    if (httpMethod === 'POST' && path.endsWith('/auth/verify-otp')) {
      return verifyOtp(event);
    }
    if (httpMethod === 'POST' && path.endsWith('/auth/logout')) {
      return logout(event);
    }
    if (httpMethod === 'GET' && path.endsWith('/auth/me')) {
      return getCurrentUser(event);
    }

    return jsonResponse(404, { error: 'Not found' });
  } catch (error) {
    return handleError(error);
  }
}
