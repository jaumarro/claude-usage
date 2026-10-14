import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'claude usage',
  description: 'Token and quota consumption across every Claude surface',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
