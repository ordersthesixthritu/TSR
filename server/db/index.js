import { neon } from '@neondatabase/serverless';

let _sql;

function getSql() {
  if (!_sql) {
    const dbUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_POOLED;
    if (!dbUrl) {
      throw new Error('DATABASE_URL is required. Create a free Neon database at https://neon.tech');
    }
    const url = new URL(dbUrl);
    url.searchParams.delete('channel_binding');
    _sql = neon(url.toString());
  }
  return _sql;
}

function toPostgres(query) {
  let i = 0;
  let q = query.replace(/\?/g, () => `$${++i}`);
  q = q.replace(/datetime\(\s*'now'\s*\)/gi, 'NOW()');
  return q;
}

const db = {
  prepare(rawQuery) {
    const query = toPostgres(rawQuery);

    return {
      async run(...params) {
        const s = getSql();
        if (/^\s*INSERT/i.test(query) && !/RETURNING/i.test(query)) {
          const withRet = query.trimEnd().replace(/;?\s*$/, '') + ' RETURNING id';
          try {
            const rows = await s(withRet, params);
            return { lastInsertRowid: rows[0]?.id ?? 0, changes: 1 };
          } catch {
            await s(query, params);
            return { lastInsertRowid: 0, changes: 1 };
          }
        }
        const rows = await s(query, params);
        return { lastInsertRowid: rows[0]?.id ?? 0, changes: rows.length || 0 };
      },

      async get(...params) {
        const rows = await getSql()(query, params);
        return rows[0] || undefined;
      },

      async all(...params) {
        return await getSql()(query, params);
      },
    };
  },

  async exec(rawQuery) {
    const query = toPostgres(rawQuery);
    const stmts = query
      .split(/;\s*(?=\n|$)/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && !/^\s*--/.test(s));
    const s = getSql();
    for (const stmt of stmts) {
      await s(stmt);
    }
  },

  transaction(fn) {
    return async (...args) => await fn(...args);
  },
};

export default db;
