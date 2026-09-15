import { query } from './db.js';

export async function rateLimit({ key, limit, windowSeconds }) {
  const result = await query(
    `
    insert into request_limits (key, window_start, count)
    values ($1, now(), 1)
    on conflict (key) do update set
      count = case
        when request_limits.window_start < now() - ($2::int * interval '1 second') then 1
        else request_limits.count + 1
      end,
      window_start = case
        when request_limits.window_start < now() - ($2::int * interval '1 second') then now()
        else request_limits.window_start
      end
    returning count
    `,
    [key, windowSeconds]
  );
  return Number(result.rows[0].count) <= limit;
}
