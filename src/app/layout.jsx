import "@/styles/global.css";
import { Providers } from "@/components/providers";
import { themeBootstrap } from "@/lib/theme-bootstrap";
export const metadata = {
  title: "SAA-C03 학습 자료",
  description: "AWS SAA-C03 개념 위키와 문제집",
  icons: { icon: "/favicon.svg" },
};
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: "#182b44",
};
export default function RootLayout({ children }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
