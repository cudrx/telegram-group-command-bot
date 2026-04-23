import { DatabaseClient } from '../src/database/index.js';

const sqlitePath = process.env.SQLITE_PATH ?? 'data/bot.sqlite';
const db = DatabaseClient.open(sqlitePath);

db.close();

console.info(`SQLite schema ready at ${sqlitePath}`);
