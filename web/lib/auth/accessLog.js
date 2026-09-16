import { randomUUID } from 'node:crypto';
import { query } from '../db.js';

export async function logAccess({ subjectType, subjectId = null, event, detail = null, ip = null }) {
  await query(
    `insert into access_log (id, subject_type, subject_id, event, detail, ip)
     values ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), subjectType, subjectId, event, detail, ip]
  );
}

export async function logAdminAction(subjectId, action, detail, ip) {
  const fullDetail = detail ? `${action}: ${detail}` : action;
  await logAccess({ subjectType: 'admin', subjectId, event: 'admin_action', detail: fullDetail, ip });
}
