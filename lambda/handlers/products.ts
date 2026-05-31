import { createDomainHandler, jsonResponse, parseBody } from '../shared/router';

export const handler = createDomainHandler([
  {
    method: 'POST',
    pathPattern: /\/products$/,
    roles: ['MEDICINE_STORE', 'ADMIN'],
    handler: async (event, client) => {
      const body = parseBody<Record<string, unknown>>(event);
      const result = await client.query(
        `INSERT INTO products (store_id, category_id, name, description, price, stock_quantity, sku, image_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [body.store_id, body.category_id, body.name, body.description, body.price, body.stock_quantity, body.sku, body.image_url],
      );
      return jsonResponse(201, { product: result.rows[0] });
    },
  },
  {
    method: 'GET',
    pathPattern: /\/products$/,
    handler: async (_event, client) => {
      const result = await client.query("SELECT * FROM products WHERE status = 'ACTIVE' ORDER BY created_at DESC");
      return jsonResponse(200, { items: result.rows });
    },
  },
  {
    method: 'GET',
    pathPattern: /\/products\/[^/]+$/,
    handler: async (event, client) => {
      const result = await client.query('SELECT * FROM products WHERE id = $1', [event.pathParameters?.productId]);
      return jsonResponse(200, { product: result.rows[0] ?? null });
    },
  },
  {
    method: 'PUT',
    pathPattern: /\/products\/[^/]+$/,
    roles: ['MEDICINE_STORE', 'ADMIN'],
    handler: async (event, client) => {
      const body = parseBody<Record<string, unknown>>(event);
      const result = await client.query(
        `UPDATE products SET name = COALESCE($2, name), price = COALESCE($3, price),
         stock_quantity = COALESCE($4, stock_quantity) WHERE id = $1 RETURNING *`,
        [event.pathParameters?.productId, body.name, body.price, body.stock_quantity],
      );
      return jsonResponse(200, { product: result.rows[0] });
    },
  },
  {
    method: 'DELETE',
    pathPattern: /\/products\/[^/]+$/,
    roles: ['MEDICINE_STORE', 'ADMIN'],
    handler: async (event, client) => {
      await client.query('DELETE FROM products WHERE id = $1', [event.pathParameters?.productId]);
      return jsonResponse(204, '');
    },
  },
]);
