import { AppProvider } from '@shopify/polaris';
import { Provider as AppBridgeProvider } from '@shopify/app-bridge-react';
import '@shopify/polaris/build/esm/styles.css';
import '../styles/globals.css';
import { useEffect } from 'react';
import { setupOAuthMessageListener } from '../utils/oauthRedirect';

function MyApp({ Component, pageProps }) {
  const host = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('host');
  const shopParam = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('shop');
  
  // Derive shop from host when missing (for embedded apps)
  const deriveShopFromHost = (hostParam) => {
    try {
      if (!hostParam || typeof window === 'undefined') return null;
      let base = hostParam.replace(/-/g, '+').replace(/_/g, '/');
      while (base.length % 4) base += '=';
      const decoded = atob(base);
      const match = decoded.match(/\/store\/([a-zA-Z0-9-]+)/);
      if (match && match[1]) {
        return match[1]; // use store handle; backend normalizes to .myshopify.com
      }
      return null;
    } catch (_) {
      return null;
    }
  };
  
  // Determine effective shop for App Bridge
  let effectiveShop = shopParam;
  if (!effectiveShop && host) {
    effectiveShop = deriveShopFromHost(host);
  }
  
  // Setup OAuth message listener for cross-origin iframe handling
  useEffect(() => {
    const cleanup = setupOAuthMessageListener();
    return cleanup;
  }, []);
  
  const config = {
    apiKey: process.env.NEXT_PUBLIC_SHOPIFY_API_KEY,
    host: host || '',
    shop: effectiveShop || '',
    forceRedirect: true,
  };
  
  // Log App Bridge configuration for debugging
  if (typeof window !== 'undefined' && host) {
    console.log('🔧 [APP] App Bridge Configuration:', {
      hasApiKey: !!process.env.NEXT_PUBLIC_SHOPIFY_API_KEY,
      host: host || 'missing',
      shop: effectiveShop || 'missing',
      shopParam,
      derivedShop: effectiveShop !== shopParam ? effectiveShop : 'not_derived',
      timestamp: new Date().toISOString()
    });
  }

  const AppContent = (
    <>
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