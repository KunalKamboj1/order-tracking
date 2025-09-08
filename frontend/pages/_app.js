import { AppProvider } from '@shopify/polaris';
import { Provider as AppBridgeProvider } from '@shopify/app-bridge-react';
import Script from 'next/script';
import { useEffect } from 'react';
import '@shopify/polaris/build/esm/styles.css';
import '../styles/globals.css';

function MyApp({ Component, pageProps }) {
  const host = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('host');
  
  const config = {
    apiKey: process.env.NEXT_PUBLIC_SHOPIFY_API_KEY,
    host: host || '',
    forceRedirect: true,
  };

  // Temporary debug log for host/shop & decoded host
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const hostParam = params.get('host');
    const shop = params.get('shop');
    let decoded = null;
    try {
      decoded = hostParam ? atob(hostParam) : null;
    } catch (e) {
      console.warn('[Shopify Embed] Failed to decode host:', hostParam, e);
    }
    console.log('[Shopify Embed] host:', hostParam, 'decoded:', decoded, 'shop:', shop);
  }, []);

  const AppContent = (
    <>
      <Script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" strategy="afterInteractive" />
      <AppProvider
          i18n={{
            Polaris: {
              Avatar: {
                label: 'Avatar',
                labelWithInitials: 'Avatar with initials {initials}',
              },
              ContextualSaveBar: {
                save: 'Save',
                discard: 'Discard',
              },
              TextField: {
                characterCount: '{count} characters',
              },
              TopBar: {
                toggleMenuLabel: 'Toggle menu',
                SearchField: {
                  clearButtonLabel: 'Clear',
                  search: 'Search',
                },
              },
              Modal: {
                iFrameTitle: 'body markup',
              },
              Frame: {
                skipToContent: 'Skip to content',
                navigationLabel: 'Navigation',
                Navigation: {
                  closeMobileNavigationLabel: 'Close navigation',
                },
              },
            },
          }}
        >
          <Component {...pageProps} />
        </AppProvider>
    </>
  );

  // Only use AppBridge when host is available (inside Shopify admin)
  if (host) {
    return (
      <AppBridgeProvider config={config}>
        {AppContent}
      </AppBridgeProvider>
    );
  }

  // Standalone mode (outside Shopify admin)
  return AppContent;
}

export default MyApp;