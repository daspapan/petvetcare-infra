import { createDomainHandler, jsonResponse } from '../shared/router';

export const handler = createDomainHandler([
  {
    method: 'GET',
    pathPattern: /\/admin\/dashboard$/,
    roles: ['ADMIN', 'SUPERVISOR'],
    handler: async (_event, client) => {
      const [users, pets, orders, tickets] = await Promise.all([
        client.query('SELECT COUNT(*)::int AS count FROM users'),
        client.query('SELECT COUNT(*)::int AS count FROM pets'),
        client.query('SELECT COUNT(*)::int AS count FROM orders'),
        client.query("SELECT COUNT(*)::int AS count FROM support_tickets WHERE status = 'OPEN'"),
      ]);
      return jsonResponse(200, {
        dashboard: {
          totalUsers: users.rows[0].count,
          totalPets: pets.rows[0].count,
          totalOrders: orders.rows[0].count,
          openTickets: tickets.rows[0].count,
        },
      });
    },
  },
  {
    method: 'GET',
    pathPattern: /\/admin\/users$/,
    roles: ['ADMIN'],
    handler: async (_event, client) => {
      const result = await client.query(
        'SELECT id, email, first_name, last_name, group_type, status, created_at FROM users ORDER BY created_at DESC LIMIT 100',
      );
      return jsonResponse(200, { items: result.rows });
    },
  },
  {
    method: 'GET',
    pathPattern: /\/admin\/audit-logs$/,
    roles: ['ADMIN'],
    handler: async (_event, client) => {
      const result = await client.query(
        'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100',
      );
      return jsonResponse(200, { items: result.rows });
    },
  },
  {
    method: 'GET',
    pathPattern: /\/admin\/analytics$/,
    roles: ['ADMIN', 'SUPERVISOR'],
    handler: async (_event, client) => {
      const result = await client.query(`
        SELECT DATE(created_at) AS date, COUNT(*)::int AS registrations
        FROM users WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at) ORDER BY date DESC
      `);
      return jsonResponse(200, { analytics: { registrations: result.rows } });
    },
  },
]);
