import { createDomainHandler, jsonResponse, parseBody } from '../shared/router';

export const handler = createDomainHandler([
  {
    method: 'POST',
    pathPattern: /\/doctors$/,
    roles: ['ADMIN', 'SUPERVISOR'],
    handler: async (event, client) => {
      const body = parseBody<Record<string, unknown>>(event);
      const result = await client.query(
        `INSERT INTO veterinary_doctors (user_id, license_number, specialization, years_of_experience, clinic_name)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [body.user_id, body.license_number, body.specialization, body.years_of_experience, body.clinic_name],
      );
      return jsonResponse(201, { doctor: result.rows[0] });
    },
  },
  {
    method: 'PUT',
    pathPattern: /\/doctors\/[^/]+$/,
    roles: ['ADMIN', 'SUPERVISOR'],
    handler: async (event, client) => {
      const body = parseBody<Record<string, unknown>>(event);
      const result = await client.query(
        `UPDATE veterinary_doctors SET specialization = COALESCE($2, specialization),
         clinic_name = COALESCE($3, clinic_name) WHERE id = $1 RETURNING *`,
        [event.pathParameters?.doctorId, body.specialization, body.clinic_name],
      );
      return jsonResponse(200, { doctor: result.rows[0] });
    },
  },
  {
    method: 'GET',
    pathPattern: /\/doctors$/,
    handler: async (_event, client) => {
      const result = await client.query('SELECT * FROM veterinary_doctors ORDER BY created_at DESC');
      return jsonResponse(200, { items: result.rows });
    },
  },
  {
    method: 'GET',
    pathPattern: /\/doctors\/[^/]+$/,
    handler: async (event, client) => {
      const result = await client.query('SELECT * FROM veterinary_doctors WHERE id = $1', [event.pathParameters?.doctorId]);
      return jsonResponse(200, { doctor: result.rows[0] ?? null });
    },
  },
  {
    method: 'DELETE',
    pathPattern: /\/doctors\/[^/]+$/,
    roles: ['ADMIN'],
    handler: async (event, client) => {
      await client.query('DELETE FROM veterinary_doctors WHERE id = $1', [event.pathParameters?.doctorId]);
      return jsonResponse(204, '');
    },
  },
]);
