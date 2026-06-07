/**
 * Define Auth Challenge Trigger
 * Orchestrates the CUSTOM_AUTH challenge loop.
 *
 * Session array:
 *   []           → first call → issue CUSTOM_CHALLENGE
 *   [pass=true]  → OTP correct → issue tokens
 *   [pass=false] → OTP wrong, retry until maxAttempts
 *   [3x fail]    → fail auth
 */
import { DefineAuthChallengeTriggerEvent, DefineAuthChallengeTriggerHandler } from 'aws-lambda';

const MAX_ATTEMPTS = 3;

export const handler: DefineAuthChallengeTriggerHandler = async (
  event: DefineAuthChallengeTriggerEvent
) => {
  const { session } = event.request;

  console.log('DefineAuth', JSON.stringify({
    username: event.userName,
    sessionLength: session.length,
  }));

  if (session.length === 0) {
    // Brand-new auth — issue first OTP challenge
    event.response.issueTokens = false;
    event.response.failAuthentication = false;
    event.response.challengeName = 'CUSTOM_CHALLENGE';
    return event;
  }

  const lastChallenge = session[session.length - 1];

  if (lastChallenge.challengeResult === true) {
    // Correct OTP — issue tokens
    event.response.issueTokens = true;
    event.response.failAuthentication = false;
    return event;
  }

  // Wrong OTP
  if (session.length >= MAX_ATTEMPTS) {
    // Too many wrong attempts — fail auth
    console.warn('DefineAuth: max attempts exceeded', { username: event.userName });
    event.response.issueTokens = false;
    event.response.failAuthentication = true;
    return event;
  }

  // Still within retry window — issue another challenge
  event.response.issueTokens = false;
  event.response.failAuthentication = false;
  event.response.challengeName = 'CUSTOM_CHALLENGE';

  return event;
};
