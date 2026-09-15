import { checkDatabaseConnection } from '../lib/db.js';

export default async function HomePage() {
  let dbStatus = 'desconhecido';
  try {
    await checkDatabaseConnection();
    dbStatus = 'conectado';
  } catch {
    dbStatus = 'falhou';
  }

  return (
    <main style={{ fontFamily: 'system-ui', padding: '2rem' }}>
      <h1>Xadrez Essencial</h1>
      <p>Fase 1 — esqueleto Next.js rodando na VPS.</p>
      <p>Status do banco: {dbStatus}</p>
    </main>
  );
}
