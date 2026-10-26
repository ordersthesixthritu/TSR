import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'tsr.db');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const SQL = await initSqlJs();

let rawDb;
if (fs.existsSync(dbPath)) {
  const buf = fs.readFileSync(dbPath);
  rawDb = new SQL.Database(buf);
} else {
  rawDb = new SQL.Database();
}

rawDb.run('PRAGMA foreign_keys = ON');

let inTransaction = false;

function saveToFile() {
  if (inTransaction) return;
  const data = rawDb.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

const db = {
  prepare(sql) {
    return {
      run(...params) {
        rawDb.run(sql, params);
        saveToFile();
        const r = rawDb.exec('SELECT last_insert_rowid() as id');
        const lastId = r.length ? r[0].values[0][0] : 0;
        const changes = rawDb.getRowsModified();
        return { lastInsertRowid: lastId, changes };
      },
      get(...params) {
        const stmt = rawDb.prepare(sql);
        if (params.length) stmt.bind(params);
        let row;
        if (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          row = {};
          cols.forEach((c, i) => row[c] = vals[i]);
        }
        stmt.free();
        return row;
      },
      all(...params) {
        const rows = [];
        const stmt = rawDb.prepare(sql);
        if (params.length) stmt.bind(params);
        while (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          const row = {};
          cols.forEach((c, i) => row[c] = vals[i]);
          rows.push(row);
        }
        stmt.free();
        return rows;
      },
    };
  },
  exec(sql) {
    rawDb.run(sql);
    saveToFile();
  },
  transaction(fn) {
    return (...args) => {
      inTransaction = true;
      rawDb.run('BEGIN');
      try {
        const result = fn(...args);
        rawDb.run('COMMIT');
        inTransaction = false;
        saveToFile();
        return result;
      } catch (err) {
        rawDb.run('ROLLBACK');
        inTransaction = false;
        throw err;
      }
    };
  },
};

export default db;
