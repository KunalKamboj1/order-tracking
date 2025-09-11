import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import {
  Page,
  Card,
  Text,
  Button,
  Banner,
  Spinner,
  BlockStack,
  InlineStack,
} from '@shopify/polaris';
import { useAppBridge } from '@shopify/app-bridge-react';
import { Redirect } from '@shopify/app-bridge/actions';
import ErrorBoundary from '../components/ErrorBoundary';

function PricingPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [shop, setShop] = useState('');
  const router = useRouter();
  
  // Always call useAppBridge hook, but handle errors gracefully
  let app = null;
  try {
    app = useAppBridge();
  } catch (e) {
    // App Bridge not available during SSR or standalone mode
  }
  
  const [isClient, setIsClient] = useState(false);
  
  const isEmbedded = isClient && !!app && typeof window !== 'undefined';

  useEffect(() => {
    setIsClient(true);
    
    // Get shop from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const shopParam = urlParams.get('shop');
    
    if (!shopParam) {
      setError('Shop parameter is missing. Please access this page from your Shopify admin.');
      setLoading(false);
      return;
    }
    
    setShop(shopParam);
    
    // Redirect to Shopify's managed pricing page immediately
    redirectToManagedPricing(shopParam);
  }, []);

  const redirectToManagedPricing = (shopParam) => {
    try {
      // Normalize shop domain
      const shopDomain = shopParam.includes('.myshopify.com') ? shopParam : `${shopParam}.myshopify.com`;
      
      // Get client ID from environment or use default
      const clientId = process.env.NEXT_PUBLIC_SHOPIFY_CLIENT_ID || '2d20e8e11bb0f54c316c6394ad8488d1';
      
      console.log('💳 [PRICING] Redirecting to Shopify managed pricing:', {
        shopDomain,
        clientId,
        isEmbedded,
        hasAppBridge: !!app
      });
      
      // Use App Bridge redirect for embedded apps
      if (isEmbedded && app) {
        console.log('🔗 [PRICING] Using App Bridge redirect for embedded billing');
        const redirect = Redirect.create(app);
        
        // Use ADMIN_PATH action to navigate within the Shopify admin
        redirect.dispatch(Redirect.Action.ADMIN_PATH, {
          path: `/apps/${clientId}/pricing`
        });
      } else {
        console.log('🌐 [PRICING] Using window.location redirect for standalone billing');
        // For standalone mode, redirect to the full URL
        const shopifyPricingUrl = `https://${shopDomain}/admin/apps/${clientId}/pricing`;
        window.location.href = shopifyPricingUrl;
      }
    } catch (err) {
      console.error('Failed to redirect to managed pricing:', err);
      setError('Failed to redirect to pricing page. Please try again.');
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Page title="Redirecting to Pricing...">
        <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
          <Spinner size="large" />
          <Text variant="headingMd" as="h2">
            Redirecting to Shopify Pricing Page...
          </Text>
          <Text as="p" color="subdued">
            Please wait while we redirect you to select your plan.
          </Text>
        </div>
      </Page>
    );
  }

  return (
    <Page title="Pricing">
      <div className="max-w-4xl mx-auto">
        {error && (
          <div className="mb-6">
            <Banner status="critical" onDismiss={() => setError('')}>
              {error}
            </Banner>
          </div>
        )}
        
        <Card>
          <div className="p-6 text-center">
            <Text variant="headingLg" as="h2">
              Choose Your Plan
            </Text>
            <div className="mt-4">
              <Text as="p" color="subdued">
                You should have been redirected to the Shopify pricing page. If not, please try refreshing the page or contact support.
              </Text>
            </div>
            <div className="mt-6">
              <Button 
                primary 
                onClick={() => window.location.reload()}
              >
                Refresh Page
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </Page>
  );
}

// Wrap the PricingPage component with ErrorBoundary
function PricingPageWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <PricingPage />
    </ErrorBoundary>
  );
}

export { PricingPageWithErrorBoundary as default };