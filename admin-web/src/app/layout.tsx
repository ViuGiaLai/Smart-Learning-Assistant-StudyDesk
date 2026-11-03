import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SmartStudy Admin",
    template: "%s · SmartStudy Admin",
  },
  description:
    "Bảng điều khiển quản trị Smart Learning Assistant: người dùng, thiết bị IoT, dữ liệu cảm biến, thông báo và hệ thống.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
