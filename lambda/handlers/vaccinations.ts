import { createDomainHandler, jsonResponse, parseBody } from '../shared/router';

export const handler = createDomainHandler([
  {
    method: 'POST',
    pathPattern: /\/pets\/[^/]+\/vaccinations$/,
    handler: async (event, client) => {
      const petId = event.pathParameters?.petId;
      const body = parseBody<Record<string, unknown>>(event);
      const result = await client.query(
        `INSERT INTO pet_vaccinations (pet_id, vaccine_name, administered_by, administered_date, due_date, notes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [petId, body.vaccine_name, body.administered_by, body.administered_date, body.due_date, body.notes],
      );
      return jsonResponse(201, { vaccination: result.rows[0] });
    },
  },
  {
    method: 'GET',
    pathPattern: /\/pets\/[^/]+\/vaccinations$/,
    handler: async (event, client) => {
      const petId = event.pathParameters?.petId;
      const result = await client.query(
        'SELECT * FROM pet_vaccinations WHERE pet_id = $1 ORDER BY due_date ASC',
        [petId],
      );
      return jsonResponse(200, { items: result.rows });
    },
  },
  {
    method: 'PUT',
    pathPattern: /\/vaccinations\/[^/]+$/,
    handler: async (event, client) => {
      const id = event.pathParameters?.vaccinationId;
      const body = parseBody<Record<string, unknown>>(event);
      const result = await client.query(
        `UPDATE pet_vaccinations SET vaccine_name = COALESCE($2, vaccine_name),
         due_date = COALESCE($3, due_date), status = COALESCE($4, status) WHERE id = $1 RETURNING *`,
        [id, body.vaccine_name, body.due_date, body.status],
      );
      return jsonResponse(200, { vaccination: result.rows[0] });
    },
  },
  {
    method: 'DELETE',
    pathPattern: /\/vaccinations\/[^/]+$/,
    handler: async (event, client) => {
      await client.query('DELETE FROM pet_vaccinations WHERE id = $1', [event.pathParameters?.vaccinationId]);
      return jsonResponse(204, '');
    },
  },
]);
