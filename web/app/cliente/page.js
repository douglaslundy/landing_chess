import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CLIENT_COOKIE } from '../../lib/auth/cookies.js';
import { resolveSession } from '../../lib/auth/guard.js';
import { listLessons } from '../../lib/lessons.js';
import LogoutButton from '../components/LogoutButton.js';
import SetPasswordForm from '../components/SetPasswordForm.js';

export default async function ClientHomePage() {
  const jar = await cookies();
  const token = jar.get(CLIENT_COOKIE)?.value || null;
  const session = await resolveSession(token, 'client');
  if (!session) redirect('/cliente/entrar');

  const lessons = await listLessons({ onlyPublished: true });

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif' }}>
      <h1>Suas aulas</h1>
      <ul>
        {lessons.map((lesson) => (
          <li key={lesson.id}>
            <a href={lesson.url} target="_blank" rel="noreferrer">{lesson.title}</a>
            {lesson.description && <p>{lesson.description}</p>}
          </li>
        ))}
      </ul>
      <SetPasswordForm />
      <LogoutButton endpoint="/api/client/logout" redirectTo="/cliente/entrar" />
    </main>
  );
}
