export const metadata = { title: "1health SSO test app (Supabase)" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 520, margin: "48px auto", padding: "0 16px", lineHeight: 1.5 }}>
        {children}
      </body>
    </html>
  );
}
