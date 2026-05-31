import type { EventBridgeEvent } from 'aws-lambda';

/** EventBridge consumer — routes domain events to downstream handlers */
export async function handler(
  event: EventBridgeEvent<string, Record<string, unknown>>,
): Promise<void> {
  console.log(JSON.stringify({
    source: event.source,
    detailType: event['detail-type'],
    detail: event.detail,
  }));

  switch (event['detail-type']) {
    case 'UserRegistered':
      // TODO: send welcome email via SES
      break;
    case 'PetCreated':
      // TODO: update analytics
      break;
    case 'VaccinationCreated':
      // TODO: schedule reminder
      break;
    case 'AppointmentBooked':
      // TODO: sync Google Calendar, SNS notify
      break;
    case 'StoreApproved':
      // TODO: notify store owner
      break;
    case 'OrderCreated':
      // TODO: decrement inventory
      break;
    case 'TicketCreated':
      // TODO: assign to support queue
      break;
    case 'TicketResolved':
      // TODO: CSAT survey
      break;
    default:
      console.warn('Unhandled event type', event['detail-type']);
  }
}
