/**
 * Auth Handler Lambda
 * Handles multiple auth operations based on route:
 *   POST /auth/login    → initiate CUSTOM_AUTH (triggers OTP send)
 *   POST /auth/verify   → respond to challenge (submit OTP → get tokens)
 *   POST /auth/refresh  → exchange refresh token → new access/id tokens
 *   POST /auth/logout   → revoke all tokens (global sign out)
 *   GET  /auth/me       → return current user profile from ID token claims
 */
import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  AdminUserGlobalSignOutCommand,
  RevokeTokenCommand,
  GetUserCommand,
  NotAuthorizedException,
  UserNotFoundException,
  CodeMismatchException,
  ExpiredCodeException,
  TooManyRequestsException,
} from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient({});

const USER_POOL_ID    = process.env.USER_POOL_ID!;
const WEB_CLIENT_ID   = process.env.WEB_CLIENT_ID!;
const MOBILE_CLIENT_ID = process.env.MOBILE_CLIENT_ID!;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
  };
}

function resp(statusCode: number, body: unknown): APIGatewayProxyResult {
  return { statusCode, headers: headers(), body: JSON.stringify(body) };
}

function getClientId(clientType?: string): string {
  return clientType === 'mobile' ? MOBILE_CLIENT_ID : WEB_CLIENT_ID;
}

function parseBody<T>(raw: string | null): T {
  return JSON.parse(raw ?? '{}') as T;
}

function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * POST /auth/login
 * Triggers CUSTOM_AUTH → Cognito calls Define + Create challenge triggers → OTP sent
 */
async function handleLogin(event: Parameters<APIGatewayProxyHandler>[0]): Promise<APIGatewayProxyResult> {
  const { username, clientType } = parseBody<{ username: string; clientType?: string }>(event.body);

  if (!username) return resp(400, { error: 'username is required' });

  const clientId = getClientId(clientType);

  const res = await cognito.send(new InitiateAuthCommand({
    AuthFlow: 'CUSTOM_AUTH',
    ClientId: clientId,
    AuthParameters: {
      USERNAME: username,
    },
  }));

  if (res.ChallengeName !== 'CUSTOM_CHALLENGE') {
    console.error('Unexpected challenge', res.ChallengeName);
    return resp(500, { error: 'Unexpected auth state' });
  }

  const publicParams = res.ChallengeParameters ?? {};

  return resp(200, {
    message: 'OTP sent',
    session: res.Session,
    username,
    hint:    publicParams['hint'] ?? 'Check your phone or email',
    channel: publicParams['channel'] ?? 'SMS',
    expiresInSeconds: parseInt(publicParams['expiresInSeconds'] ?? '300'),
  });
}

/**
 * POST /auth/verify
 * Submit OTP to Cognito → receive ID, Access, Refresh tokens
 */
async function handleVerify(event: Parameters<APIGatewayProxyHandler>[0]): Promise<APIGatewayProxyResult> {
  const { username, session, otp, clientType } = parseBody<{
    username: string;
    session: string;
    otp: string;
    clientType?: string;
  }>(event.body);

  if (!username || !session || !otp) {
    return resp(400, { error: 'username, session, and otp are required' });
  }
  if (otp.length !== 6 || !/^\d+$/.test(otp)) {
    return resp(400, { error: 'OTP must be a 6-digit number' });
  }

  const clientId = getClientId(clientType);
  const deviceType = event.headers?.['X-Device-Type'] ?? clientType ?? 'web';

  const res = await cognito.send(new RespondToAuthChallengeCommand({
    ClientId: clientId,
    ChallengeName: 'CUSTOM_CHALLENGE',
    Session: session,
    ChallengeResponses: {
      USERNAME: username,
      ANSWER: otp,
    },
    ClientMetadata: { deviceType },
  }));

  if (!res.AuthenticationResult) {
    // OTP was wrong — return new session for retry
    return resp(401, {
      error: 'Invalid or expired OTP. Please try again.',
      session: res.Session,     // client must send this new session on retry
      retriesRemaining: null,   // can infer from attempt count client-side
    });
  }

  const auth = res.AuthenticationResult;

  return resp(200, {
    message: 'Authentication successful',
    tokens: {
      accessToken:  auth.AccessToken,
      idToken:      auth.IdToken,
      refreshToken: auth.RefreshToken,
      expiresIn:    auth.ExpiresIn,
      tokenType:    auth.TokenType,
    },
  });
}

/**
 * POST /auth/refresh
 * Exchange refresh token for new access + id tokens (no OTP required)
 */
async function handleRefresh(event: Parameters<APIGatewayProxyHandler>[0]): Promise<APIGatewayProxyResult> {
  const { refreshToken, clientType } = parseBody<{ refreshToken: string; clientType?: string }>(event.body);

  if (!refreshToken) return resp(400, { error: 'refreshToken is required' });

  const clientId = getClientId(clientType);

  const res = await cognito.send(new InitiateAuthCommand({
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: clientId,
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  }));

  const auth = res.AuthenticationResult;
  if (!auth) return resp(401, { error: 'Token refresh failed. Please log in again.' });

  return resp(200, {
    tokens: {
      accessToken: auth.AccessToken,
      idToken:     auth.IdToken,
      expiresIn:   auth.ExpiresIn,
      tokenType:   auth.TokenType,
      // Cognito doesn't return a new refresh token on REFRESH_TOKEN_AUTH
      refreshToken,
    },
  });
}

/**
 * POST /auth/logout
 * Global sign-out — invalidates all refresh tokens for the user.
 * Also revokes the current refresh token if provided.
 * Requires valid Authorization: Bearer <accessToken> header (enforced by Cognito Authorizer).
 */
async function handleLogout(event: Parameters<APIGatewayProxyHandler>[0]): Promise<APIGatewayProxyResult> {
  const accessToken = extractBearerToken(event.headers?.['Authorization'] ?? event.headers?.['authorization']);
  if (!accessToken) return resp(401, { error: 'Authorization header required' });

  // Get username from access token
  const userRes = await cognito.send(new GetUserCommand({ AccessToken: accessToken }));
  const username = userRes.Username!;

  // Global sign-out (invalidates all sessions)
  await cognito.send(new AdminUserGlobalSignOutCommand({
    UserPoolId: USER_POOL_ID,
    Username: username,
  }));

  // Also revoke refresh token if provided in body
  const body = parseBody<{ refreshToken?: string; clientType?: string }>(event.body);
  if (body.refreshToken) {
    await cognito.send(new RevokeTokenCommand({
      ClientId: getClientId(body.clientType),
      Token: body.refreshToken,
    }));
  }

  console.log('User logged out globally', { username });

  return resp(200, { message: 'Logged out successfully. All sessions invalidated.' });
}

/**
 * GET /auth/me
 * Return current user profile from Cognito using access token.
 */
async function handleMe(event: Parameters<APIGatewayProxyHandler>[0]): Promise<APIGatewayProxyResult> {
  const accessToken = extractBearerToken(event.headers?.['Authorization'] ?? event.headers?.['authorization']);
  if (!accessToken) return resp(401, { error: 'Authorization header required' });

  const userRes = await cognito.send(new GetUserCommand({ AccessToken: accessToken }));

  const attrs: Record<string, string> = {};
  (userRes.UserAttributes ?? []).forEach(a => {
    if (a.Name && a.Value) attrs[a.Name] = a.Value;
  });

  return resp(200, {
    username:    userRes.Username,
    name:        attrs['name'],
    email:       attrs['email'],
    phone:       attrs['phone_number'],
    channel:     attrs['custom:channel'],
    lastLogin:   attrs['custom:lastLogin'],
    mfaOptions:  userRes.MFAOptions,
  });
}

// ─── Main Router ──────────────────────────────────────────────────────────────

export const handler: APIGatewayProxyHandler = async (event) => {
  const path   = event.path;
  const method = event.httpMethod;

  console.log('AuthHandler', JSON.stringify({ path, method, ip: event.requestContext?.identity?.sourceIp }));

  try {
    if (method === 'POST' && path.endsWith('/login'))   return await handleLogin(event);
    if (method === 'POST' && path.endsWith('/verify'))  return await handleVerify(event);
    if (method === 'POST' && path.endsWith('/refresh')) return await handleRefresh(event);
    if (method === 'POST' && path.endsWith('/logout'))  return await handleLogout(event);
    if (method === 'GET'  && path.endsWith('/me'))      return await handleMe(event);

    return resp(404, { error: 'Route not found' });

  } catch (err) {
    // Map Cognito errors to clean HTTP responses
    if (err instanceof NotAuthorizedException)  return resp(401, { error: 'Not authorized. Please log in again.' });
    if (err instanceof UserNotFoundException)   return resp(404, { error: 'User not found.' });
    if (err instanceof CodeMismatchException)   return resp(401, { error: 'Invalid OTP.' });
    if (err instanceof ExpiredCodeException)    return resp(401, { error: 'OTP expired. Please request a new one.' });
    if (err instanceof TooManyRequestsException) return resp(429, { error: 'Too many requests. Please wait and try again.' });

    const msg = (err as Error).message ?? '';
    if (msg.includes('RATE_LIMIT_EXCEEDED')) return resp(429, { error: 'Too many OTP requests. Please wait before requesting again.' });

    console.error('AuthHandler unhandled error', err);
    return resp(500, { error: 'Internal server error' });
  }
};
