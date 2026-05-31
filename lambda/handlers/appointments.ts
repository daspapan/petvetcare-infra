import { createDomainHandler, jsonResponse, parseBody } from '../shared/router';

export const handler = createDomainHandler([
  {
    method: 'POST',
    pathPattern: /\/appointments$/,
    handler: async (event, client, sub) => {
      const body = parseBody<Record<string, unknown>>(event);
      const user = await client.query('SELECT id FROM users WHERE cognito_sub = $1', [sub]);
      const result = await client.query(
        `INSERT INTO appointments (pet_id, owner_id, doctor_id, clinic_id, appointment_date, notes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [body.pet_id, user.rows[0].id, body.doctor_id, body.clinic_id, body.appointment_date, body.notes],
      );
      return jsonResponse(201, { appointment: result.rows[0] });
    },
  },
  {
    method: 'GET',
    pathPattern: /\/appointments$/,
    handler: async (event, client, sub) => {
      const user = await client.query('SELECT id FROM users WHERE cognito_sub = $1', [sub]);
      const result = await client.query(
        'SELECT * FROM appointments WHERE owner_id = $1 ORDER BY appointment_date DESC',
        [user.rows[0].id],
      );
      return jsonResponse(200, { items: result.rows });
    },
  },
  {
    method: 'GET',
    pathPattern: /\/appointments\/[^/]+$/,
    handler: async (event, client) => {
      const result = await client.query('SELECT * FROM appointments WHERE id = $1', [event.pathParameters?.appointmentId]);
      return jsonResponse(200, { appointment: result.rows[0] ?? null });
    },
  },
  {
    method: 'PUT',
    pathPattern: /\/appointments\/[^/]+$/,
    handler: async (event, client) => {
      const body = parseBody<Record<string, unknown>>(event);
      const result = await client.query(
        `UPDATE appointments SET appointment_date = COALESCE($2, appointment_date),
         status = COALESCE($3, status), notes = COALESCE($4, notes) WHERE id = $1 RETURNING *`,
        [event.pathParameters?.appointmentId, body.appointment_date, body.status, body.notes],
      );
      return jsonResponse(200, { appointment: result.rows[0] });
    },
  },
  {
    method: 'DELETE',
    pathPattern: /\/appointments\/[^/]+$/,
    handler: async (event, client) => {
      await client.query('DELETE FROM appointments WHERE id = $1', [event.pathParameters?.appointmentId]);
      return jsonResponse(204, '');
    },
  },
]);
