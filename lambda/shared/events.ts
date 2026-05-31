import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';

const eventBridge = new EventBridgeClient({});

export type DomainEventType =
  | 'UserRegistered'
  | 'PetCreated'
  | 'VaccinationCreated'
  | 'AppointmentBooked'
  | 'StoreApproved'
  | 'OrderCreated'
  | 'TicketCreated'
  | 'TicketResolved';

export async function publishEvent(
  detailType: DomainEventType,
  detail: Record<string, unknown>,
): Promise<void> {
  const eventBusName = process.env.EVENT_BUS_NAME;
  if (!eventBusName) {
    console.warn('EVENT_BUS_NAME not configured, skipping event publish');
    return;
  }

  await eventBridge.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'petvetcare.api',
          DetailType: detailType,
          Detail: JSON.stringify({
            ...detail,
            timestamp: new Date().toISOString(),
            environment: process.env.APP_ENV,
          }),
          EventBusName: eventBusName,
        },
      ],
    }),
  );
}
