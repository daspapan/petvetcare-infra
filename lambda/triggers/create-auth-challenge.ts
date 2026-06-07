import type { CreateAuthChallengeTriggerEvent } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { createHash, randomInt } from 'crypto';

const dynamo = new DynamoDBClient({});
const ses = new SESClient({});

const OTP_TABLE = process.env.OTP_TABLE_NAME!;
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'noreply@petvetcare.app';
const OTP_SALT = process.env.OTP_SALT ?? 'petvetcare-otp-salt';

function generateOtp(): string {
  return randomInt(100000, 999999).toString();
}

function hashOtp(otp: string): string {
  return createHash('sha256').update(`${OTP_SALT}:${otp}`).digest('hex');
}

export async function handler(
  event: CreateAuthChallengeTriggerEvent,
): Promise<CreateAuthChallengeTriggerEvent> {

  // Cognito can call CreateAuthChallenge with userNotFound=true when
  // preventUserExistenceErrors is enabled. In that case userAttributes may
  // be empty, so email would be undefined. Return a dummy challenge so
  // Cognito can time-match a real response and not leak user existence.
  const email = event.request.userAttributes?.email;

  if (!email || !email.includes('@')) {
    console.warn('[CreateAuthChallenge] No valid email in userAttributes – issuing dummy challenge');
    event.response.publicChallengeParameters  = { email: '' };
    event.response.privateChallengeParameters = { otpHash: 'invalid' };
    event.response.challengeMetadata = 'OTP_CHALLENGE';
    return event;
  }

  const otp     = generateOtp();
  const otpHash = hashOtp(otp);
  const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 min TTL

  await dynamo.send(
    new PutItemCommand({
      TableName: OTP_TABLE,
      Item: {
        email:      { S: email },
        otp_hash:   { S: otpHash },
        expires_at: { N: expiresAt.toString() },
        attempts:   { N: '0' },
      },
    }),
  );

  await ses.send(
    new SendEmailCommand({
      Source: SES_FROM_EMAIL,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: 'Your PetVetCare Login Code' },
        Body: {
          Text: {
            Data: `Your PetVetCare login code is: ${otp}\n\nThis code expires in 10 minutes. Do not share it with anyone.`,
          },
          Html: {
            Data: `<p>Your PetVetCare login code is: <strong>${otp}</strong></p><p>This code expires in 10 minutes. Do not share it with anyone.</p>`,
          },
        },
      },
    }),
  );

  event.response.publicChallengeParameters  = { email };
  event.response.privateChallengeParameters = { otpHash };
  event.response.challengeMetadata = 'OTP_CHALLENGE';

  return event;
}
