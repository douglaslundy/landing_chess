import { getSession } from './session.js';

export async function resolveSession(token, subjectType) {
  if (!token) return null;
  const session = await getSession(token);
  if (!session || session.subject_type !== subjectType) return null;
  return session;
}
