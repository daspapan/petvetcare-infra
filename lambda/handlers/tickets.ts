import { createDomainHandler, jsonResponse, parseBody } from '../shared/router';

function ticketNumber(): string {
  return `TKT-${Date.now().toString(36).toUpperCase()}`;
}

export const handler = createDomainHandler([
  {
    method: 'POST',
    pathPattern: /\/tickets$/,
    handler: async (event, client, sub) => {
      const body = parseBody<{ subject: string; description: string; priority?: string }>(event);
      const user = await client.query('SELECT id FROM users WHERE cognito_sub = $1', [sub]);
      const result = await client.query(
        `INSERT INTO support_tickets (ticket_number, raised_by_user_id, subject, description, priority)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [ticketNumber(), user.rows[0].id, body.subject, body.description, body.priority ?? 'MEDIUM'],
      );
      return jsonResponse(201, { ticket: result.rows[0] });
    },
  },
  {
    method: 'GET',
    pathPattern: /\/tickets$/,
    handler: async (_event, client, sub) => {
      const user = await client.query('SELECT id, group_type FROM users WHERE cognito_sub = $1', [sub]);
      const query = user.rows[0].group_type === 'ADMIN'
        ? 'SELECT * FROM support_tickets ORDER BY created_at DESC'
        : 'SELECT * FROM support_tickets WHERE raised_by_user_id = $1 ORDER BY created_at DESC';
      const result = await client.query(query, user.rows[0].group_type === 'ADMIN' ? [] : [user.rows[0].id]);
      return jsonResponse(200, { items: result.rows });
    },
  },
  {
    method: 'GET',
    pathPattern: /\/tickets\/[^/]+$/,
    handler: async (event, client) => {
      const result = await client.query('SELECT * FROM support_tickets WHERE id = $1', [event.pathParameters?.ticketId]);
      return jsonResponse(200, { ticket: result.rows[0] ?? null });
    },
  },
  {
    method: 'PUT',
    pathPattern: /\/tickets\/[^/]+$/,
    handler: async (event, client) => {
      const body = parseBody<Record<string, unknown>>(event);
      const result = await client.query(
        'UPDATE support_tickets SET priority = COALESCE($2, priority), status = COALESCE($3, status) WHERE id = $1 RETURNING *',
        [event.pathParameters?.ticketId, body.priority, body.status],
      );
      return jsonResponse(200, { ticket: result.rows[0] });
    },
  },
  {
    method: 'POST',
    pathPattern: /\/tickets\/[^/]+\/comment$/,
    handler: async (event, client, sub) => {
      const body = parseBody<{ message: string; is_internal?: boolean }>(event);
      const user = await client.query('SELECT id FROM users WHERE cognito_sub = $1', [sub]);
      const result = await client.query(
        `INSERT INTO ticket_comments (ticket_id, commented_by, message, is_internal) VALUES ($1, $2, $3, $4) RETURNING *`,
        [event.pathParameters?.ticketId, user.rows[0].id, body.message, body.is_internal ?? false],
      );
      return jsonResponse(201, { comment: result.rows[0] });
    },
  },
  {
    method: 'POST',
    pathPattern: /\/tickets\/[^/]+\/assign$/,
    roles: ['ADMIN', 'SUPERVISOR'],
    handler: async (event, client) => {
      const body = parseBody<{ assigned_to_user_id: string }>(event);
      const result = await client.query(
        'UPDATE support_tickets SET assigned_to_user_id = $2, status = $3 WHERE id = $1 RETURNING *',
        [event.pathParameters?.ticketId, body.assigned_to_user_id, 'IN_PROGRESS'],
      );
      return jsonResponse(200, { ticket: result.rows[0] });
    },
  },
  {
    method: 'POST',
    pathPattern: /\/tickets\/[^/]+\/close$/,
    handler: async (event, client) => {
      const result = await client.query(
        "UPDATE support_tickets SET status = 'CLOSED' WHERE id = $1 RETURNING *",
        [event.pathParameters?.ticketId],
      );
      return jsonResponse(200, { ticket: result.rows[0] });
    },
  },
]);
