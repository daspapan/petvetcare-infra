import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createDbClient } from '../shared/db';
import {
  getDbConfig,
  getUserSub,
  handleError,
  jsonResponse,
  parseBody,
  requireAuth,
} from '../shared/api';

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  try {
    const sub = requireAuth(event);
    const { httpMethod, path, pathParameters } = event;
    const dbConfig = getDbConfig();
    const client = await createDbClient(dbConfig);

    try {
      await client.connect();

      const userResult = await client.query(
        'SELECT id FROM users WHERE cognito_sub = $1',
        [sub],
      );
      const ownerId = userResult.rows[0]?.id;

      if (!ownerId) {
        return jsonResponse(404, { error: 'User not found' });
      }

      // GET /pets
      if (httpMethod === 'GET' && path.endsWith('/pets') && !pathParameters?.petId) {
        const result = await client.query(
          'SELECT * FROM pets WHERE owner_id = $1 ORDER BY created_at DESC',
          [ownerId],
        );
        return jsonResponse(200, { items: result.rows });
      }

      // POST /pets
      if (httpMethod === 'POST' && path.endsWith('/pets')) {
        const body = parseBody<Record<string, unknown>>(event);
        const result = await client.query(
          `INSERT INTO pets (owner_id, name, species, breed, gender, dob, weight, microchip_number, photo_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [
            ownerId,
            body.name,
            body.species ?? 'Dog',
            body.breed,
            body.gender,
            body.dob,
            body.weight,
            body.microchip_number,
            body.photo_url,
          ],
        );
        return jsonResponse(201, { pet: result.rows[0] });
      }

      const petId = pathParameters?.petId;

      // GET /pets/{petId}
      if (httpMethod === 'GET' && petId) {
        const result = await client.query(
          'SELECT * FROM pets WHERE id = $1 AND owner_id = $2',
          [petId, ownerId],
        );
        if (result.rows.length === 0) {
          return jsonResponse(404, { error: 'Pet not found' });
        }
        return jsonResponse(200, { pet: result.rows[0] });
      }

      // PUT /pets/{petId}
      if (httpMethod === 'PUT' && petId) {
        const body = parseBody<Record<string, unknown>>(event);
        const result = await client.query(
          `UPDATE pets SET name = COALESCE($3, name), species = COALESCE($4, species),
           breed = COALESCE($5, breed), gender = COALESCE($6, gender), dob = COALESCE($7, dob),
           weight = COALESCE($8, weight), photo_url = COALESCE($9, photo_url)
           WHERE id = $1 AND owner_id = $2 RETURNING *`,
          [petId, ownerId, body.name, body.species, body.breed, body.gender, body.dob, body.weight, body.photo_url],
        );
        if (result.rows.length === 0) {
          return jsonResponse(404, { error: 'Pet not found' });
        }
        return jsonResponse(200, { pet: result.rows[0] });
      }

      // DELETE /pets/{petId}
      if (httpMethod === 'DELETE' && petId) {
        const result = await client.query(
          'DELETE FROM pets WHERE id = $1 AND owner_id = $2 RETURNING id',
          [petId, ownerId],
        );
        if (result.rows.length === 0) {
          return jsonResponse(404, { error: 'Pet not found' });
        }
        return jsonResponse(204, '');
      }

      return jsonResponse(404, { error: 'Not found' });
    } finally {
      await client.end();
    }
  } catch (error) {
    return handleError(error);
  }
}
