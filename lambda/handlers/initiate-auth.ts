import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { jsonResponse, handleError } from '../shared/api';

const cognito = new CognitoIdentityProviderClient({});

interface InitiateAuthRequest {
  email: string;
  method: 'otp' | 'google';
}

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  try {
    console.log("[InitiateAuth] Event", JSON.stringify(event));
    let body: InitiateAuthRequest;
    try {
      body = JSON.parse(event.body ?? '{}') as InitiateAuthRequest;
    } catch {
      return jsonResponse(400, { error: 'Invalid JSON body' });
    }
    console.log("[InitiateAuth] 1");

    const { email, method } = body;
    console.log("[InitiateAuth] Parsed body", { email, method });

    if (!email?.includes('@')) {
      return jsonResponse(400, { error: 'Valid email is required' });
    }
    console.log("[InitiateAuth] 2");
    if (method === 'google') {
      const clientId = process.env.COGNITO_WEB_CLIENT_ID!;
      const hostedUiDomain = process.env.COGNITO_HOSTED_UI_DOMAIN!;
      const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/auth/callback';
      const state = Buffer.from(JSON.stringify({ email, ts: Date.now() })).toString('base64url');

      const authUrl =
        `${hostedUiDomain}/oauth2/authorize` +
        `?response_type=code` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=openid%20email%20profile` +
        `&identity_provider=Google` +
        `&state=${state}`;

      return jsonResponse(200, { authUrl });
    }
    console.log("[InitiateAuth] 3");
    // Default: OTP flow
    const clientId = process.env.COGNITO_WEB_CLIENT_ID!;
    console.log("[InitiateAuth] CLIENT ID", clientId, email);

    const result = await cognito.send(
      new InitiateAuthCommand({
        AuthFlow: 'CUSTOM_AUTH',
        ClientId: clientId,
        AuthParameters: { USERNAME: email },
      }),
    );
    console.log("[InitiateAuth] result: ", result);

    return jsonResponse(200, {
      message: 'OTP sent to your email',
      session: result.Session,
      challengeName: result.ChallengeName,
    });
  } catch (error) {
    console.log("[InitiateAuth] Error: ", error);
    return handleError(error);
  }
}
