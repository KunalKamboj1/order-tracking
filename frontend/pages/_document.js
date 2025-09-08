import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Load Shopify App Bridge via plain script tag to avoid next/script usage in _document */}
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
        {/* Tailwind is already configured via PostCSS; remove CDN injection to prevent misuse */}
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}