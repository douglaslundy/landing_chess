import crypto from 'node:crypto';
import { query } from './db.js';

function uuid() {
  return crypto.randomUUID();
}

export async function listLessons({ onlyPublished = false } = {}) {
  const result = onlyPublished
    ? await query('select * from lessons where published = true order by position asc', [])
    : await query('select * from lessons order by position asc', []);
  return result.rows;
}

export async function getLessonById(id) {
  const result = await query('select * from lessons where id = $1', [id]);
  return result.rows[0] || null;
}

export async function createLesson({ title, description, contentType, url, position, published }) {
  const result = await query(
    `insert into lessons (id, title, description, content_type, url, position, published)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [uuid(), title, description || null, contentType, url, position, published ?? true]
  );
  return result.rows[0];
}

export async function updateLesson(id, { title, description, contentType, url, position, published }) {
  const result = await query(
    `update lessons set
       title = $2,
       description = $3,
       content_type = $4,
       url = $5,
       position = $6,
       published = $7,
       updated_at = now()
     where id = $1
     returning *`,
    [id, title, description || null, contentType, url, position, published ?? true]
  );
  return result.rows[0] || null;
}

export async function deleteLesson(id) {
  const result = await query('delete from lessons where id = $1', [id]);
  return result.rowCount > 0;
}
