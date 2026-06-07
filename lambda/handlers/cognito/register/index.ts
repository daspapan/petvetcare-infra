/**
 * Register Lambda
 * POST /auth/register
 *
 * Creates a Cognito user with a dummy random password (passwordless — never used).
 * Handles duplicate detection gracefully.
 * Returns { message, userId } on success.
 */
import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  ListUsersCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { randomBytes } from 'crypto';

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

interface RegisterBody {
  username: string;
  name: string;
  channel: 'SMS' | 'EMAIL';
}

function response(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isPhone(value: string): boolean {
  return /^\+\d{8,15}$/.test(value);
}

async function userExists(username: string): Promise<boolean> {
  const filter = isEmail(username)
    ? `email = "${username}"`
    : `phone_number = "${username}"`;

  const res = await cognito.send(new ListUsersCommand({
    UserPoolId: USER_POOL_ID,
    Filter: filter,
    Limit: 1,
  }));

  return (res.Users?.length ?? 0) > 0;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const body = JSON.parse(event.body ?? '{}') as RegisterBody;
    const { username, name, channel } = body;

    // Basic validation
    if (!username || !name || !channel) {
      return response(400, { error: 'username, name, and channel are required' });
    }
    if (!['SMS', 'EMAIL'].includes(channel)) {
      return response(400, { error: 'channel must be SMS or EMAIL' });
    }
    if (channel === 'EMAIL' && !isEmail(username)) {
      return response(400, { error: 'Invalid email format' });
    }
    if (channel === 'SMS' && !isPhone(username)) {
      return response(400, { error: 'Phone must be in E.164 format: +1234567890' });
    }

    // Check for existing user
    const exists = await userExists(username);
    if (exists) {
      return response(409, { error: 'User already registered. Please log in.' });
    }

    // Build user attributes
    const userAttributes: { Name: string; Value: string }[] = [
      { Name: 'name', Value: name },
      { Name: 'custom:channel', Value: channel },
    ];

    if (channel === 'EMAIL') {
      userAttributes.push({ Name: 'email', Value: username });
      userAttributes.push({ Name: 'email_verified', Value: 'true' });
    } else {
      userAttributes.push({ Name: 'phone_number', Value: username });
      userAttributes.push({ Name: 'phone_number_verified', Value: 'true' });
    }

    // Create user (auto-confirmed via PreSignUp trigger)
    const createRes = await cognito.send(new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      UserAttributes: userAttributes,
      MessageAction: 'SUPPRESS',   // don't send Cognito welcome email
      TemporaryPassword: `Tmp!${randomBytes(16).toString('hex')}`, // never used
    }));

    const userId = createRes.User?.Username ?? username;

    // Set a permanent dummy password so the user isn't stuck in FORCE_CHANGE_PASSWORD
    const permanentDummyPwd = `Pwd!${randomBytes(24).toString('hex')}`;
    await cognito.send(new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      Password: permanentDummyPwd,
      Permanent: true,
    }));

    console.log('User registered', { userId, channel });

    return response(201, {
      message: 'Registration successful. Use /auth/login to receive your OTP.',
      userId,
      channel,
    });

  } catch (err) {
    if (err instanceof UsernameExistsException) {
      return response(409, { error: 'User already registered. Please log in.' });
    }

    console.error('Register error', err);
    return response(500, { error: 'Registration failed. Please try again.' });
  }
};
