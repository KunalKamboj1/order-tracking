import { AppProvider } from '@shopify/polaris';
import { Provider as AppBridgeProvider, useAppBridge } from '@shopify/app-bridge-react';
import { getSessionToken } from '@shopify/app-bridge-utils';
import '@shopify/polaris/build/esm/styles.css';
import '../styles/globals.css';
import Script from 'next/script';

// Global API helper function for authenticated requests
const createApiCall = (app) => {
  return async (url, options = {}) => {
    try {
      const attempt = async () => {
        const sessionToken = await getSessionToken(app);
        return fetch(url, {
          ...options,
          headers: {
            'Authorization': `Bearer ${sessionToken}`,
            'Content-Type': 'application/json',
            ...options.headers
          }
        });
      };
      // First attempt with token
      let response = await attempt();
      // If 401, retry ONCE with a fresh token
      if (response.status === 401) {
        console.warn('Session token rejected (401). Retrying with a fresh token...');
        response = await attempt();
      }
      return response;
    } catch (error) {
      console.error('API call failed; returning error response:', error);
      // Return a synthetic 500 response rather than silently stripping token
      return new Response(JSON.stringify({ error: 'Network or token error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  };
};

function MyApp({ Component, pageProps }) {
  const host = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('host');
  
  const config = {
    apiKey: process.env.NEXT_PUBLIC_SHOPIFY_API_KEY,
    host: host || '',
    forceRedirect: true,
  };

  const AppContent = (
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
  );

  // Only use AppBridge when host is available (inside Shopify admin)
  if (host) {
    return (
      <>
        <Script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" strategy="beforeInteractive" />
        <AppBridgeProvider config={config}>
          <ApiSetup />
          {AppContent}
        </AppBridgeProvider>
      </>
    );
  }

  // Standalone mode (outside Shopify admin)
  return AppContent;
}

export default MyApp;