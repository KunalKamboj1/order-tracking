import { Html, Head, Main, NextScript } from 'next/document';
import { useRouter } from 'next/router';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Add Tailwind CSS via CDN for widget page */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (window.location.pathname === '/widget') {
                const link = document.createElement('link');
                link.href = 'https://cdn.tailwindcss.com';
                link.rel = 'stylesheet';
                document.head.appendChild(link);
              }
            `,
          }}
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}