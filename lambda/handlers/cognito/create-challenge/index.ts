/**
 * Create Auth Challenge Trigger
 * - Generates a cryptographically secure 6-digit OTP
 * - Rate-limits via DynamoDB (max 5 sends per phone/email per hour)
 * - Sends OTP via Amazon SNS (SMS) or Amazon SES (email)
 * - Stores hashed OTP in challenge private parameters (Cognito manages this)
 */
import { CreateAuthChallengeTriggerEvent, CreateAuthChallengeTriggerHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { createHash, randomInt } from 'crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const snsClient = new SNSClient({});
const sesClient = new SESClient({});

const TABLE  = process.env.OTP_TABLE_NAME!;
const STAGE  = process.env.STAGE ?? 'prod';
const OTP_TTL = parseInt(process.env.OTP_TTL_SECONDS ?? '300');
const MAX_RESENDS = 5;

function generateOtp(): string {
  return randomInt(100000, 999999).toString();
}

function hashOtp(otp: string, salt: string): string {
  return createHash('sha256').update(`${otp}:${salt}`).digest('hex');
}

async function checkAndIncrementRateLimit(username: string): Promise<void> {
  const hourKey = `RATELIMIT#${username}#${Math.floor(Date.now() / 3_600_000)}`;
  const now = Math.floor(Date.now() / 1000);
  const ttl = now + 3600;

  const existing = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: hourKey } }));

  if (existing.Item) {
    if ((existing.Item.count ?? 0) >= MAX_RESENDS) {
      throw new Error(`RATE_LIMIT_EXCEEDED: too many OTP requests for ${username}`);
    }
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { pk: hourKey },
      UpdateExpression: 'SET #c = #c + :inc',
      ExpressionAttributeNames: { '#c': 'count' },
      ExpressionAttributeValues: { ':inc': 1 },
    }));
  } else {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: { pk: hourKey, count: 1, ttl },
    }));
  }
}

async function sendSms(phone: string, otp: string): Promise<void> {
  await snsClient.send(new PublishCommand({
    PhoneNumber: phone,
    Message: `[${STAGE === 'prod' ? 'AuthApp' : 'TEST'}] Your login code: ${otp}. Valid for 5 minutes. Do not share this code.`,
    MessageAttributes: {
      'AWS.SNS.SMS.SMSType': {
        DataType: 'String',
        StringValue: 'Transactional',
      },
      'AWS.SNS.SMS.SenderID': {
        DataType: 'String',
        StringValue: 'AuthApp',
      },
    },
  }));
}

async function sendEmail(email: string, otp: string): Promise<void> {
  const fromEmail = process.env.SES_FROM_EMAIL ?? 'noreply@example.com';
  await sesClient.send(new SendEmailCommand({
    Source: fromEmail,
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Data: 'Your login code', Charset: 'UTF-8' },
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
              <h2 style="color:#1a1a2e">Your login code</h2>
              <p style="font-size:14px;color:#444">Use the code below to sign in. It expires in <strong>5 minutes</strong>.</p>
              <div style="background:#f4f4f4;border-radius:8px;padding:24px;text-align:center;margin:24px 0;">
                <span style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#1a1a2e">${otp}</span>
              </div>
              <p style="font-size:12px;color:#888">If you didn't request this code, you can safely ignore this email.</p>
            </div>
          `,
        },
        Text: {
          Charset: 'UTF-8',
          Data: `Your login code: ${otp}\nValid for 5 minutes. Do not share this code.`,
        },
      },
    },
  }));
}

export const handler: CreateAuthChallengeTriggerHandler = async (
  event: CreateAuthChallengeTriggerEvent
) => {
  console.log("[CreateAuthChallengeTriggerEvent]", JSON.stringify(event));
  const username = event.userName;
  const attrs    = event.request.userAttributes;
  const channel  = (attrs['custom:channel'] ?? 'SMS') as 'SMS' | 'EMAIL';

  console.log('CreateChallenge', JSON.stringify({ username, channel, session: event.request.session.length }));

  // Only send a fresh OTP on the first attempt or if explicitly retrying
  // (Cognito re-calls this trigger each challenge round)
  const isFirstAttempt = event.request.session.length === 0;
  const shouldSendNew  = isFirstAttempt ||
    event.request.session[event.request.session.length - 1]?.challengeMetadata === 'RESEND';

  const otp = shouldSendNew ? generateOtp() : '------'; // placeholder for retry without resend

  if (shouldSendNew) {
    // Rate limit check
    await checkAndIncrementRateLimit(username);

    // Dispatch
    if (channel === 'EMAIL' && attrs.email) {
      await sendEmail(attrs.email, otp);
      console.log('OTP sent via EMAIL to', attrs.email.replace(/(.{2}).+(@.+)/, '$1***$2'));
    } else if (attrs.phone_number) {
      await sendSms(attrs.phone_number, otp);
      console.log('OTP sent via SMS to', attrs.phone_number.slice(0, 4) + '****');
    } else {
      throw new Error('No delivery target found for user');
    }
  }

  // Salt = session length (changes each round → replay protection)
  const salt    = String(event.request.session.length);
  const hashedOtp = hashOtp(otp, salt);

  // Store hashed OTP in private parameters — Cognito passes this to VerifyChallenge
  event.response.privateChallengeParameters = {
    hashedOtp,
    salt,
    channel,
    otpSentAt: Date.now().toString(),
  };

  event.response.publicChallengeParameters = {
    channel,
    hint: channel === 'EMAIL'
      ? `Code sent to ${attrs.email?.replace(/(.{2}).+(@.+)/, '$1***$2') ?? 'your email'}`
      : `Code sent to ${attrs.phone_number?.slice(0, 4) ?? ''}****`,
    expiresInSeconds: OTP_TTL.toString(),
  };

  event.response.challengeMetadata = 'OTP_CHALLENGE';

  return event;
};
