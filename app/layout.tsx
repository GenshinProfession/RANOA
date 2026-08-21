import type { Metadata, Viewport } from "next";
import { homedir } from "node:os";
import { join } from "node:path";
import { Noto_Sans_Mono } from "next/font/google";
import { PwaRegistration } from "@/components/PwaRegistration";
import { PRODUCT_NAME } from "@/lib/branding";
import "@fontsource/cinzel-decorative/700.css";
import "@fontsource/zcool-xiaowei/chinese-simplified-400.css";
import "katex/dist/katex.min.css";
import "./globals.css";
import "./magic-polish.css";

// Keep packaged and dev launches on the same user-owned data root.
if (typeof process !== "undefined" && process.env.NEXT_RUNTIME === "nodejs" && !process.env.PI_CODING_AGENT_DIR) {
  process.env.PI_CODING_AGENT_DIR = join(homedir(), ".ranoa", "pi", "agent");
}

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: "RANOA interface for the pi coding agent",
  applicationName: PRODUCT_NAME,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: PRODUCT_NAME,
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#0b1714",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" translate="no" className={`${notoSansMono.variable} notranslate dark`} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        {process.env.NODE_ENV !== "production" && (
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){try{if(!("serviceWorker" in navigator)||!navigator.serviceWorker.controller)return;var marker="ranoa-dev-sw-clean-v2";if(sessionStorage.getItem(marker)==="done")return;sessionStorage.setItem(marker,"done");document.documentElement.style.visibility="hidden";window.stop();Promise.all([navigator.serviceWorker.getRegistrations().then(function(items){return Promise.all(items.map(function(item){return item.unregister()}))}),typeof caches!=="undefined"?caches.keys().then(function(keys){return Promise.all(keys.filter(function(key){return key.indexOf("pi-web-")===0}).map(function(key){return caches.delete(key)}))}):Promise.resolve()]).finally(function(){location.replace(location.href)})}catch(e){document.documentElement.style.visibility=""}})();`,
            }}
          />
        )}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{document.documentElement.classList.add("dark");localStorage.setItem("pi-theme","dark");var w=localStorage.getItem("nova-wallpaper");document.documentElement.dataset.wallpaper=w==="sylphiette"||w==="eris"?w:"roxy"}catch(e){document.documentElement.classList.add("dark");document.documentElement.dataset.wallpaper="roxy"}})();`,
          }}
        />
      </head>
      <body translate="no" className="notranslate" suppressHydrationWarning>
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
