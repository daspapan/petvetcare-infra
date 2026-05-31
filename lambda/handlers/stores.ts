import { createDomainHandler, jsonResponse, parseBody } from '../shared/router';

export const handler = createDomainHandler([
  {
    method: 'POST',
    pathPattern: /\/stores\/register$/,
    handler: async (event, client, sub) => {
      const body = parseBody<Record<string, unknown>>(event);
      const user = await client.query('SELECT id FROM users WHERE cognito_sub = $1', [sub]);
      const result = await client.query(
        `INSERT INTO medicine_stores (user_id, store_name, business_license, gst_number)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [user.rows[0].id, body.store_name, body.business_license, body.gst_number],
      );
      return jsonResponse(201, { store: result.rows[0] });
    },
  },
  {
    method: 'POST',
    pathPattern: /\/stores\/[^/]+\/approve$/,
    roles: ['ADMIN', 'SUPERVISOR'],
    handler: async (event, client) => {
      const result = await client.query(
        `UPDATE medicine_stores SET verification_status = 'APPROVED' WHERE id = $1 RETURNING *`,
        [event.pathParameters?.storeId],
      );
      return jsonResponse(200, { store: result.rows[0] });
    },
  },
  {
    method: 'POST',
    pathPattern: /\/stores\/[^/]+\/reject$/,
    roles: ['ADMIN', 'SUPERVISOR'],
    handler: async (event, client) => {
      const body = parseBody<{ reason?: string }>(event);
      const result = await client.query(
        `UPDATE medicine_stores SET verification_status = 'REJECTED', rejection_reason = $2 WHERE id = $1 RETURNING *`,
        [event.pathParameters?.storeId, body.reason],
      );
      return jsonResponse(200, { store: result.rows[0] });
    },
  },
  {
    method: 'GET',
    pathPattern: /\/stores$/,
    handler: async (_event, client) => {
      const result = await client.query('SELECT * FROM medicine_stores ORDER BY created_at DESC');
      return jsonResponse(200, { items: result.rows });
    },
  },
  {
    method: 'GET',
    pathPattern: /\/stores\/[^/]+$/,
    handler: async (event, client) => {
      const result = await client.query('SELECT * FROM medicine_stores WHERE id = $1', [event.pathParameters?.storeId]);
      return jsonResponse(200, { store: result.rows[0] ?? null });
    },
  },
  {
    method: 'PUT',
    pathPattern: /\/stores\/[^/]+$/,
    handler: async (event, client) => {
      const body = parseBody<Record<string, unknown>>(event);
      const result = await client.query(
        `UPDATE medicine_stores SET store_name = COALESCE($2, store_name) WHERE id = $1 RETURNING *`,
        [event.pathParameters?.storeId, body.store_name],
      );
      return jsonResponse(200, { store: result.rows[0] });
    },
  },
  {
    method: 'DELETE',
    pathPattern: /\/stores\/[^/]+$/,
    roles: ['ADMIN'],
    handler: async (event, client) => {
      await client.query('DELETE FROM medicine_stores WHERE id = $1', [event.pathParameters?.storeId]);
      return jsonResponse(204, '');
    },
  },
]);
