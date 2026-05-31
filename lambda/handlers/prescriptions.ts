import { createDomainHandler, jsonResponse, parseBody } from '../shared/router';

export const handler = createDomainHandler([
  {
    method: 'POST',
    pathPattern: /\/pets\/[^/]+\/prescriptions$/,
    handler: async (event, client) => {
      const petId = event.pathParameters?.petId;
      const body = parseBody<Record<string, unknown>>(event);
      const result = await client.query(
        `INSERT INTO prescriptions (pet_id, doctor_id, file_url, notes) VALUES ($1, $2, $3, $4) RETURNING *`,
        [petId, body.doctor_id, body.file_url, body.notes],
      );
      return jsonResponse(201, { prescription: result.rows[0] });
    },
  },
  {
    method: 'GET',
    pathPattern: /\/pets\/[^/]+\/prescriptions$/,
    handler: async (event, client) => {
      const result = await client.query(
        'SELECT * FROM prescriptions WHERE pet_id = $1 ORDER BY issued_date DESC',
        [event.pathParameters?.petId],
      );
      return jsonResponse(200, { items: result.rows });
    },
  },
  {
    method: 'GET',
    pathPattern: /\/prescriptions\/[^/]+$/,
    handler: async (event, client) => {
      const result = await client.query('SELECT * FROM prescriptions WHERE id = $1', [event.pathParameters?.id]);
      return jsonResponse(200, { prescription: result.rows[0] ?? null });
    },
  },
  {
    method: 'DELETE',
    pathPattern: /\/prescriptions\/[^/]+$/,
    handler: async (event, client) => {
      await client.query('DELETE FROM prescriptions WHERE id = $1', [event.pathParameters?.id]);
      return jsonResponse(204, '');
    },
  },
]);
