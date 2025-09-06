import { AppProvider } from '@shopify/polaris';
import { Provider as AppBridgeProvider, useAppBridge } from '@shopify/app-bridge-react';
import { getSessionToken } from '@shopify/app-bridge-utils';
import '@shopify/polaris/build/esm/styles.css';
import '../styles/globals.css';

// Global API helper function for authenticated requests
const createApiCall = (app) => {
  return async (url, options = {}) => {
    try {
      const sessionToken = await getSessionToken(app);
      return fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
          ...options.headers
        }
      });
    } catch (error) {
      console.error('API call failed:', error);
      // Fallback to regular fetch without session token
      return fetch(url, options);
    }
  };
};

// Component to set up global API helper
function ApiSetup() {
  const app = useAppBridge();
  
  // Make apiCall available globally when inside Shopify admin
  if (typeof window !== 'undefined' && app) {
    window.apiCall = createApiCall(app);
  }
  
  return null;
}

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
      <AppBridgeProvider config={config}>
        <ApiSetup />
        {AppContent}
      </AppBridgeProvider>
    );
  }

  // Standalone mode (outside Shopify admin)
  return AppContent;
}

export default MyApp;