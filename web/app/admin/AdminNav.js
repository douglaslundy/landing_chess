import Link from 'next/link';
import LogoutButton from '../components/LogoutButton.js';

const LINKS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/aulas', label: 'Aulas' },
  { href: '/admin/config', label: 'Configurações' }
];

export default function AdminNav({ current }) {
  return (
    <nav className="admin-nav">
      <div className="admin-brand">
        Xadrez <span>Essencial</span> — Admin
      </div>
      <div className="admin-nav-links">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`admin-nav-link${current === link.href ? ' active' : ''}`}
          >
            {link.label}
          </Link>
        ))}
        <LogoutButton
          endpoint="/api/admin/logout"
          redirectTo="/admin/login"
          className="admin-btn admin-btn-ghost admin-btn-small"
        />
      </div>
    </nav>
  );
}
