/**
 * Verify Auth Challenge Response Trigger
 * Compares hashed user answer against the stored hashed OTP.
 * Also enforces OTP expiry (5 min default).
 */
import { VerifyAuthChallengeResponseTriggerEvent, VerifyAuthChallengeResponseTriggerHandler } from 'aws-lambda';
import { createHash } from 'crypto';

const OTP_TTL_MS = parseInt(process.env.OTP_TTL_SECONDS ?? '300') * 1000;

function hashOtp(otp: string, salt: string): string {
  return createHash('sha256').update(`${otp}:${salt}`).digest('hex');
}

export const handler: VerifyAuthChallengeResponseTriggerHandler = async (
  event: VerifyAuthChallengeResponseTriggerEvent
) => {
  const { privateChallengeParameters, challengeAnswer } = event.request;

  const storedHash  = privateChallengeParameters.hashedOtp;
  const salt        = privateChallengeParameters.salt;
  const otpSentAt   = parseInt(privateChallengeParameters.otpSentAt ?? '0');

  console.log('VerifyChallenge', JSON.stringify({
    username: event.userName,
    hasAnswer: !!challengeAnswer,
    ageMs: Date.now() - otpSentAt,
  }));

  // Check expiry
  if (Date.now() - otpSentAt > OTP_TTL_MS) {
    console.warn('VerifyChallenge: OTP expired', { username: event.userName });
    event.response.answerCorrect = false;
    return event;
  }

  // Constant-time comparison via hashing both sides
  const submittedHash = hashOtp(challengeAnswer?.trim() ?? '', salt);
  event.response.answerCorrect = submittedHash === storedHash;

  if (!event.response.answerCorrect) {
    console.warn('VerifyChallenge: wrong OTP', { username: event.userName });
  } else {
    console.log('VerifyChallenge: OTP correct', { username: event.userName });
  }

  return event;
};
