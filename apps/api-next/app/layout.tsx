export const metadata = {
  title: 'Auto Timesheet API',
  description: 'Next.js serverless API for auto-timesheet',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
