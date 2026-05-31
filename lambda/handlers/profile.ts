import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createDomainHandler, jsonResponse, parseBody } from '../shared/router';

export const handler = createDomainHandler([
  {
    method: 'GET',
    pathPattern: /\/profile$/,
    handler: async (event, client, sub) => {
      const result = await client.query(
        'SELECT id, email, first_name, last_name, profile_image_url, group_type FROM users WHERE cognito_sub = $1',
        [sub],
      );
      return jsonResponse(200, { profile: result.rows[0] ?? null });
    },
  },
  {
    method: 'PUT',
    pathPattern: /\/profile$/,
    handler: async (event, client, sub) => {
      const body = parseBody<Record<string, string>>(event);
      const result = await client.query(
        `UPDATE users SET first_name = COALESCE($2, first_name), last_name = COALESCE($3, last_name),
         phone_number = COALESCE($4, phone_number) WHERE cognito_sub = $1 RETURNING *`,
        [sub, body.first_name, body.last_name, body.phone_number],
      );
      return jsonResponse(200, { profile: result.rows[0] });
    },
  },
  {
    method: 'POST',
    pathPattern: /\/profile\/avatar$/,
    handler: async (event, client, sub) => {
      const body = parseBody<{ image_url: string }>(event);
      const result = await client.query(
        'UPDATE users SET profile_image_url = $2 WHERE cognito_sub = $1 RETURNING *',
        [sub, body.image_url],
      );
      return jsonResponse(200, { profile: result.rows[0] });
    },
  },
  {
    method: 'DELETE',
    pathPattern: /\/profile\/avatar$/,
    handler: async (event, client, sub) => {
      await client.query(
        'UPDATE users SET profile_image_url = NULL WHERE cognito_sub = $1',
        [sub],
      );
      return jsonResponse(200, { message: 'Avatar removed' });
    },
  },
]);
