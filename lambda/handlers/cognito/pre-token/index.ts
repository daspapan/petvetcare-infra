/**
 * Pre-Token Generation Trigger
 * Adds custom claims to Cognito ID token before it's issued.
 * Called on every successful authentication.
 */
import { PreTokenGenerationTriggerEvent, PreTokenGenerationTriggerHandler } from 'aws-lambda';

export const handler: PreTokenGenerationTriggerHandler = async (
  event: PreTokenGenerationTriggerEvent
) => {
  const attrs = event.request.userAttributes;

  console.log('PreToken', JSON.stringify({ username: event.userName, triggerSource: event.triggerSource }));

  // Add custom claims to the ID token
  event.response.claimsOverrideDetails = {
    claimsToAddOrOverride: {
      'custom:authMethod': 'passwordless_otp',
      'custom:channel':    attrs['custom:channel'] ?? 'SMS',
      'custom:lastLogin':  new Date().toISOString(),
    },
    claimsToSuppress: [
      // Suppress internal Cognito fields we don't want in the token
      'cognito:mfa_enabled',
    ],
  };

  return event;
};
