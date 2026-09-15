export const metadata = {
  title: 'Xadrez Essencial',
  description: 'Livro digital Xadrez Essencial — 10 volumes em PDF'
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
