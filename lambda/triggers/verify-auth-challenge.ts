import type { VerifyAuthChallengeResponseTriggerEvent } from 'aws-lambda';
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { createHash } from 'crypto';

const dynamo = new DynamoDBClient({});

const OTP_TABLE = process.env.OTP_TABLE_NAME!;
const OTP_SALT = process.env.OTP_SALT ?? 'petvetcare-otp-salt';
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_SECONDS = 900; // 15 min

function hashOtp(otp: string): string {
  return createHash('sha256').update(`${OTP_SALT}:${otp}`).digest('hex');
}

export async function handler(
  event: VerifyAuthChallengeResponseTriggerEvent,
): Promise<VerifyAuthChallengeResponseTriggerEvent> {
  const email = event.request.userAttributes?.email;
  const providedOtp = event.request.challengeAnswer;

  // If there is no email (user not found / dummy challenge path), reject silently.
  if (!email) {
    event.response.answerCorrect = false;
    return event;
  }
  const now = Math.floor(Date.now() / 1000);

  const getResult = await dynamo.send(
    new GetItemCommand({
      TableName: OTP_TABLE,
      Key: { email: { S: email } },
    }),
  );

  const item = getResult.Item;

  if (!item) {
    event.response.answerCorrect = false;
    return event;
  }

  const expiresAt = Number(item.expires_at?.N ?? '0');
  const lockedUntil = Number(item.locked_until?.N ?? '0');
  const attempts = Number(item.attempts?.N ?? '0');
  const storedHash = item.otp_hash?.S ?? '';

  // Check if expired
  if (now > expiresAt) {
    event.response.answerCorrect = false;
    return event;
  }

  // Check if locked
  if (lockedUntil > now) {
    event.response.answerCorrect = false;
    return event;
  }

  const providedHash = hashOtp(providedOtp);
  const isCorrect = providedHash === storedHash;

  if (isCorrect) {
    event.response.answerCorrect = true;
    return event;
  }

  const newAttempts = attempts + 1;

  if (newAttempts >= MAX_ATTEMPTS) {
    // Lock the account
    await dynamo.send(
      new UpdateItemCommand({
        TableName: OTP_TABLE,
        Key: { email: { S: email } },
        UpdateExpression: 'SET attempts = :a, locked_until = :l',
        ExpressionAttributeValues: {
          ':a': { N: newAttempts.toString() },
          ':l': { N: (now + LOCK_DURATION_SECONDS).toString() },
        },
      }),
    );
  } else {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: OTP_TABLE,
        Key: { email: { S: email } },
        UpdateExpression: 'SET attempts = :a',
        ExpressionAttributeValues: {
          ':a': { N: newAttempts.toString() },
        },
      }),
    );
  }

  event.response.answerCorrect = false;
  return event;
}
