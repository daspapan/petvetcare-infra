import { createDomainHandler, jsonResponse, parseBody } from '../shared/router';

/** Dummy payment provider abstraction — swap for Razorpay/Stripe later */
async function initiateDummyPayment(
  client: Awaited<ReturnType<typeof import('../shared/db').createDbClient>>,
  userId: string,
  amount: number,
  orderId?: string,
) {
  const result = await client.query(
    `INSERT INTO payments (user_id, order_id, amount, provider, status, provider_payment_id)
     VALUES ($1, $2, $3, 'DUMMY', 'INITIATED', $4) RETURNING *`,
    [userId, orderId, amount, `dummy_${Date.now()}`],
  );
  return result.rows[0];
}

export const handler = createDomainHandler([
  {
    method: 'POST',
    pathPattern: /\/payments\/initiate$/,
    handler: async (event, client, sub) => {
      const body = parseBody<{ amount: number; order_id?: string }>(event);
      const user = await client.query('SELECT id FROM users WHERE cognito_sub = $1', [sub]);
      const payment = await initiateDummyPayment(client, user.rows[0].id, body.amount, body.order_id);
      return jsonResponse(200, {
        payment,
        checkoutUrl: `https://pay.dummy.petvetcare.app/${payment.id}`,
      });
    },
  },
  {
    method: 'POST',
    pathPattern: /\/payments\/success$/,
    handler: async (event, client) => {
      const body = parseBody<{ payment_id: string }>(event);
      const result = await client.query(
        "UPDATE payments SET status = 'SUCCESS' WHERE id = $1 RETURNING *",
        [body.payment_id],
      );
      return jsonResponse(200, { payment: result.rows[0] });
    },
  },
  {
    method: 'POST',
    pathPattern: /\/payments\/failure$/,
    handler: async (event, client) => {
      const body = parseBody<{ payment_id: string; reason?: string }>(event);
      const result = await client.query(
        "UPDATE payments SET status = 'FAILED', metadata = $2 WHERE id = $1 RETURNING *",
        [body.payment_id, JSON.stringify({ reason: body.reason })],
      );
      return jsonResponse(200, { payment: result.rows[0] });
    },
  },
  {
    method: 'GET',
    pathPattern: /\/payments\/[^/]+$/,
    handler: async (event, client) => {
      const result = await client.query('SELECT * FROM payments WHERE id = $1', [event.pathParameters?.paymentId]);
      return jsonResponse(200, { payment: result.rows[0] ?? null });
    },
  },
]);
