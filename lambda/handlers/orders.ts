import { createDomainHandler, jsonResponse, parseBody } from '../shared/router';

export const handler = createDomainHandler([
  {
    method: 'POST',
    pathPattern: /\/orders$/,
    handler: async (event, client, sub) => {
      const body = parseBody<{ items: Array<{ product_id: string; quantity: number; price: number }> }>(event);
      const user = await client.query('SELECT id FROM users WHERE cognito_sub = $1', [sub]);
      const total = body.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
      const order = await client.query(
        'INSERT INTO orders (user_id, order_total) VALUES ($1, $2) RETURNING *',
        [user.rows[0].id, total],
      );
      for (const item of body.items) {
        await client.query(
          'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
          [order.rows[0].id, item.product_id, item.quantity, item.price],
        );
      }
      return jsonResponse(201, { order: order.rows[0] });
    },
  },
  {
    method: 'GET',
    pathPattern: /\/orders$/,
    handler: async (_event, client, sub) => {
      const user = await client.query('SELECT id FROM users WHERE cognito_sub = $1', [sub]);
      const result = await client.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [user.rows[0].id]);
      return jsonResponse(200, { items: result.rows });
    },
  },
  {
    method: 'GET',
    pathPattern: /\/orders\/[^/]+$/,
    handler: async (event, client) => {
      const result = await client.query('SELECT * FROM orders WHERE id = $1', [event.pathParameters?.orderId]);
      return jsonResponse(200, { order: result.rows[0] ?? null });
    },
  },
  {
    method: 'PUT',
    pathPattern: /\/orders\/[^/]+$/,
    handler: async (event, client) => {
      const body = parseBody<Record<string, unknown>>(event);
      const result = await client.query(
        'UPDATE orders SET order_status = COALESCE($2, order_status) WHERE id = $1 RETURNING *',
        [event.pathParameters?.orderId, body.order_status],
      );
      return jsonResponse(200, { order: result.rows[0] });
    },
  },
]);
