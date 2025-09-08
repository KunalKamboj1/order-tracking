import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Provide Shopify API key for CDN App Bridge */}
        <meta name="shopify-api-key" content={process.env.NEXT_PUBLIC_SHOPIFY_API_KEY} />
        {/* Load Shopify App Bridge from Shopify CDN */}
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}