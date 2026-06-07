import type { DefineAuthChallengeTriggerEvent } from 'aws-lambda';

export async function handler(
  event: DefineAuthChallengeTriggerEvent,
): Promise<DefineAuthChallengeTriggerEvent> {

  // session can theoretically be null from the Cognito event in some edge cases.
  const session = event.request.session ?? [];

  if (session.length === 0) {
    // First call -- issue the custom OTP challenge.
    event.response.issueTokens = false;
    event.response.failAuthentication = false;
    event.response.challengeName = 'CUSTOM_CHALLENGE';
    return event;
  }

  const lastAttempt = session[session.length - 1];

  if (lastAttempt?.challengeResult === true) {
    // Correct OTP -- issue tokens.
    event.response.issueTokens = true;
    event.response.failAuthentication = false;
    return event;
  }

  if (session.length >= 3) {
    // Three failed attempts -- lock out.
    event.response.issueTokens = false;
    event.response.failAuthentication = true;
    return event;
  }

  // Wrong answer but retries remain -- re-issue challenge.
  event.response.issueTokens = false;
  event.response.failAuthentication = false;
  event.response.challengeName = 'CUSTOM_CHALLENGE';
  return event;
}
