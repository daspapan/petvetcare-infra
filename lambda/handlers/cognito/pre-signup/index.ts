/**
 * Pre-SignUp Lambda Trigger
 * Auto-confirms users so they don't need email/phone verification separately.
 * Validation and abuse prevention handled at API layer.
 */
import { PreSignUpTriggerEvent, PreSignUpTriggerHandler } from 'aws-lambda';

export const handler1: PreSignUpTriggerHandler = async (event: PreSignUpTriggerEvent) => {
  console.log('[PreSignUp trigger]', JSON.stringify({ username: event.userName, triggerSource: event.triggerSource }));

  // Auto-confirm the user — verification happens via OTP in CUSTOM_AUTH
  event.response.autoConfirmUser = true;

  // Auto-verify whichever attribute was provided
  if (event.request.userAttributes.email) {
    event.response.autoVerifyEmail = true;
  }
  if (event.request.userAttributes.phone_number) {
    event.response.autoVerifyPhone = true;
  }

  return event;
};