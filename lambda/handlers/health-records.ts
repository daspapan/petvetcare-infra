import { createDomainHandler, jsonResponse, parseBody } from '../shared/router';

export const handler = createDomainHandler([
  {
    method: 'POST',
    pathPattern: /\/pets\/[^/]+\/health-records$/,
    handler: async (event, client) => {
      const petId = event.pathParameters?.petId;
      const body = parseBody<Record<string, unknown>>(event);
      const result = await client.query(
        `INSERT INTO pet_health_records (pet_id, record_type, title, description, record_date, attachments)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [petId, body.record_type, body.title, body.description, body.record_date, JSON.stringify(body.attachments ?? [])],
      );
      return jsonResponse(201, { record: result.rows[0] });
    },
  },
  {
    method: 'GET',
    pathPattern: /\/pets\/[^/]+\/health-records$/,
    handler: async (event, client) => {
      const petId = event.pathParameters?.petId;
      const result = await client.query(
        'SELECT * FROM pet_health_records WHERE pet_id = $1 ORDER BY record_date DESC',
        [petId],
      );
      return jsonResponse(200, { items: result.rows });
    },
  },
  {
    method: 'PUT',
    pathPattern: /\/pets\/[^/]+\/health-records\/[^/]+$/,
    handler: async (event, client) => {
      const recordId = event.pathParameters?.recordId;
      const body = parseBody<Record<string, unknown>>(event);
      const result = await client.query(
        `UPDATE pet_health_records SET title = COALESCE($2, title), description = COALESCE($3, description),
         record_date = COALESCE($4, record_date) WHERE id = $1 RETURNING *`,
        [recordId, body.title, body.description, body.record_date],
      );
      return jsonResponse(200, { record: result.rows[0] });
    },
  },
  {
    method: 'DELETE',
    pathPattern: /\/pets\/[^/]+\/health-records\/[^/]+$/,
    handler: async (event, client) => {
      const recordId = event.pathParameters?.recordId;
      await client.query('DELETE FROM pet_health_records WHERE id = $1', [recordId]);
      return jsonResponse(204, '');
    },
  },
]);
