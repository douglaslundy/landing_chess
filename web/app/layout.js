export const metadata = {
  title: 'Xadrez Essencial',
  description: 'Fase 1 — infraestrutura VPS'
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
