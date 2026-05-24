import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'OmniStock | Multi-Warehouse Inventory Hold & Reservation System',
  description: 'Enterprise-grade real-time inventory hold and atomic checkout locking system. Engineered using PostgreSQL SELECT FOR UPDATE locks to prevent overselling under high concurrency.',
  keywords: ['inventory', 'reservation', 'eCommerce', 'concurrency locking', 'multi-warehouse', 'Next.js', 'PostgreSQL', 'Prisma'],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.className} h-full antialiased dark`}>
      <body className="min-h-full flex flex-col bg-background text-foreground selection:bg-indigo-500 selection:text-white">
        {children}
        
        {/* Decorative background glows */}
        <div className="fixed inset-0 -z-50 overflow-hidden pointer-events-none">
          <div className="absolute -top-1/2 -left-1/4 w-[1000px] h-[1000px] rounded-full bg-indigo-500/5 dark:bg-indigo-500/10 blur-[120px] animate-pulse-slow"></div>
          <div className="absolute -bottom-1/2 -right-1/4 w-[1000px] h-[1000px] rounded-full bg-violet-500/5 dark:bg-violet-500/10 blur-[120px] animate-pulse-slow" style={{ animationDelay: '-4s' }}></div>
        </div>
      </body>
    </html>
  );
}
