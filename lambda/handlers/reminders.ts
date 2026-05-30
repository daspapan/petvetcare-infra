import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import type { EventBridgeEvent } from 'aws-lambda';

interface ReminderJobDetail {
  jobType: 'vaccination' | 'deworming';
  dryRun?: boolean;
}

const secretsClient = new SecretsManagerClient({});

export async function handler(
  event: EventBridgeEvent<'Scheduled Event', ReminderJobDetail>,
): Promise<void> {
  const secretArn = process.env.DATABASE_SECRET_ARN;
  if (!secretArn) {
    throw new Error('DATABASE_SECRET_ARN is not configured');
  }

  await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );

  console.log(
    JSON.stringify({
      message: 'Reminder job executed',
      environment: process.env.APP_ENV,
      source: event.source,
      detailType: event['detail-type'],
      time: event.time,
      detail: event.detail ?? {},
    }),
  );

  // Placeholder: query due vaccinations/deworming schedules and enqueue notifications.
}
