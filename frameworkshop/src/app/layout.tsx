import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FrameWorkshop ERP',
  description: 'Система управления багетной мастерской: заказы, расчёт, склад, производство.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
