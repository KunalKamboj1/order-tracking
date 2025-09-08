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
  const [loading, setLoading] = useState({ free: false, monthly: false, lifetime: false });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
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
  const [appBridge, setAppBridge] = useState(null);
  
  const isEmbedded = isClient && (!!appBridge || !!app) && typeof window !== 'undefined' && !!window.apiCall;

  useEffect(() => {
    setIsClient(true);
    setAppBridge(app);
    
    // Get shop from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const shopParam = urlParams.get('shop');
    if (shopParam) {
      setShop(shopParam);
    }
    // Preserve host param for embedded context
    const hostParam = urlParams.get('host');
    if (hostParam) {
      // Store for reuse during redirects
      window.__HOST_PARAM__ = hostParam;
    }

    // Check for billing status from URL
    const billingStatus = urlParams.get('billing');
    const planType = urlParams.get('plan');
    if (billingStatus === 'success') {
      if (planType === 'free') {
        setSuccess('Free plan activated! You can now use basic features.');
      } else {
        setSuccess('Payment successful! You can now use all features.');
      }
    } else if (billingStatus === 'declined') {
      setError('Payment was declined. Please try again.');
    } else if (billingStatus === 'error') {
      setError('There was an error processing your payment. Please try again.');
    }
  }, []);

  const handleSubscribe = async (planType) => {
    if (!shop) {
      setError('Shop parameter is missing. Please try again.');
      return;
    }

    setLoading(prev => ({ ...prev, [planType]: true }));
    setError('');
    setSuccess('');

    try {
      let endpoint;
      if (planType === 'free') {
        endpoint = 'free';
      } else if (planType === 'monthly') {
        endpoint = 'subscribe';
      } else {
        endpoint = 'lifetime';
      }
      
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://order-tracking-pro.onrender.com';
      const host = window.__HOST_PARAM__ || new URLSearchParams(window.location.search).get('host');
      
      // First check if shop is installed
      try {
        const statusResponse = await fetch(`${backendUrl}/shop/status?shop=${shop}`);
        const statusData = await statusResponse.json();
        
        if (!statusData.installed) {
          // Shop not installed, redirect to auth
          const authUrl = new URL(`${backendUrl}${statusData.authUrl}`);
          if (host) authUrl.searchParams.set('host', host);
          authUrl.searchParams.set('returnUrl', window.location.href);
          
          console.log('🔄 [PRICING] OAuth required, redirecting:', {
            authUrl: authUrl.toString(),
            isEmbedded,
            hasAppBridge: !!app
          });
          
          // Use App Bridge redirect for embedded apps, fallback to window.location for standalone
          if (isEmbedded && app) {
            console.log('🔗 [PRICING] Using App Bridge redirect for embedded OAuth');
            const redirect = Redirect.create(app);
            redirect.dispatch(Redirect.Action.REMOTE, {
              url: authUrl.toString(),
              newContext: true
            });
          } else {
            console.log('🌐 [PRICING] Using window.location redirect for standalone OAuth');
            window.location.href = authUrl.toString();
          }
          return;
        }
      } catch (statusError) {
        console.warn('Shop status check failed, proceeding with billing:', statusError);
      }
      
      // Proceed with billing
      const billingUrl = new URL(`${backendUrl}/billing/${endpoint}`);
      billingUrl.searchParams.set('shop', shop);
      if (host) billingUrl.searchParams.set('host', host);
      
      console.log('💳 [PRICING] Proceeding with billing:', {
        billingUrl: billingUrl.toString(),
        planType,
        isEmbedded,
        hasAppBridge: !!app
      });
      
      // Use App Bridge redirect for embedded apps, fallback to window.location for standalone
      if (isEmbedded && app) {
        console.log('🔗 [PRICING] Using App Bridge redirect for embedded billing');
        const redirect = Redirect.create(app);
        redirect.dispatch(Redirect.Action.REMOTE, {
          url: billingUrl.toString(),
          newContext: true
        });
      } else {
        console.log('🌐 [PRICING] Using window.location redirect for standalone billing');
        window.location.href = billingUrl.toString();
      }
    } catch (err) {
      setError('Failed to initiate billing process. Please try again.');
      setLoading(prev => ({ ...prev, [planType]: false }));
    }
  };

  return (
    <Page
      title="Choose Your Plan"
      subtitle="Select the perfect plan for your order tracking needs"
    >
      <div className="max-w-6xl mx-auto">
        {error && (
          <div className="mb-6">
            <Banner status="critical" onDismiss={() => setError('')}>
              {error}
            </Banner>
          </div>
        )}
        
        {success && (
          <div className="mb-6">
            <Banner status="success" onDismiss={() => setSuccess('')}>
              {success}
            </Banner>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-8 mt-8">
          {/* Free Plan */}
          <div className="pricing-card">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-500 rounded-full mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Free Plan</h3>
              <div className="text-4xl font-bold text-gray-600 mb-2">
                $0<span className="text-lg text-gray-600">/forever</span>
              </div>
              <p className="text-gray-600">Perfect for development stores</p>
            </div>

            <div className="space-y-4 mb-8">
              <div className="flex items-center">
                <svg className="w-5 h-5 text-green-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">Basic order tracking</span>
              </div>
              <div className="flex items-center">
                <svg className="w-5 h-5 text-green-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">Up to 10 orders/month</span>
              </div>
              <div className="flex items-center">
                <svg className="w-5 h-5 text-green-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">Development store friendly</span>
              </div>
              <div className="flex items-center">
                <svg className="w-5 h-5 text-green-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">No billing required</span>
              </div>
              <div className="flex items-center">
                <svg className="w-5 h-5 text-green-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">Community support</span>
              </div>
            </div>

            <Button
              size="large"
              fullWidth
              loading={loading.free}
              onClick={() => handleSubscribe('free')}
              disabled={loading.monthly || loading.lifetime}
            >
              Get Started Free
            </Button>
          </div>

          {/* Monthly Plan */}
          <div className="pricing-card">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-shopify-green rounded-full mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Monthly Plan</h3>
              <div className="text-4xl font-bold text-shopify-green mb-2">
                $15<span className="text-lg text-gray-600">/month</span>
              </div>
              <p className="text-gray-600">Perfect for growing businesses</p>
            </div>

            <div className="space-y-4 mb-8">
              <div className="flex items-center">
                <svg className="w-5 h-5 text-shopify-green mr-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">3-day free trial</span>
              </div>
              <div className="flex items-center">
                <svg className="w-5 h-5 text-shopify-green mr-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">Unlimited order tracking</span>
              </div>
              <div className="flex items-center">
                <svg className="w-5 h-5 text-shopify-green mr-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">Real-time updates</span>
              </div>
              <div className="flex items-center">
                <svg className="w-5 h-5 text-shopify-green mr-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">Email support</span>
              </div>
              <div className="flex items-center">
                <svg className="w-5 h-5 text-shopify-green mr-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">Cancel anytime</span>
              </div>
            </div>

            <Button
              primary
              size="large"
              fullWidth
              loading={loading.monthly}
              onClick={() => handleSubscribe('monthly')}
              disabled={loading.lifetime}
            >
              {loading.monthly ? 'Processing...' : 'Start Free Trial'}
            </Button>
          </div>

          {/* Lifetime Plan */}
          <div className="pricing-card featured">
            <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
              <span className="bg-shopify-purple text-white px-4 py-1 rounded-full text-sm font-semibold">
                Best Value
              </span>
            </div>
            
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-shopify-purple rounded-full mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Lifetime Plan</h3>
              <div className="text-4xl font-bold text-shopify-purple mb-2">
                $150<span className="text-lg text-gray-600">/once</span>
              </div>
              <p className="text-gray-600">One-time payment, lifetime access</p>
              <p className="text-sm text-shopify-purple font-semibold mt-1">Save $30+ per year!</p>
            </div>

            <div className="space-y-4 mb-8">
              <div className="flex items-center">
                <svg className="w-5 h-5 text-shopify-purple mr-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">3-day free trial</span>
              </div>
              <div className="flex items-center">
                <svg className="w-5 h-5 text-shopify-purple mr-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">Everything in Monthly</span>
              </div>
              <div className="flex items-center">
                <svg className="w-5 h-5 text-shopify-purple mr-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">Lifetime updates</span>
              </div>
              <div className="flex items-center">
                <svg className="w-5 h-5 text-shopify-purple mr-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">Priority support</span>
              </div>
              <div className="flex items-center">
                <svg className="w-5 h-5 text-shopify-purple mr-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">No recurring fees</span>
              </div>
            </div>

            <Button
              primary
              size="large"
              fullWidth
              loading={loading.lifetime}
              onClick={() => handleSubscribe('lifetime')}
              disabled={loading.monthly}
            >
              {loading.lifetime ? 'Processing...' : 'Get Lifetime Access'}
            </Button>
          </div>
        </div>

        {/* Additional Information */}
        <div className="mt-12 text-center">
          <Card>
            <div className="p-6">
              <h4 className="text-lg font-semibold text-gray-900 mb-4">Why Choose Order Tracking Pro?</h4>
              <div className="grid md:grid-cols-3 gap-6 text-sm text-gray-600">
                <div>
                  <h5 className="font-semibold text-gray-900 mb-2">Easy Setup</h5>
                  <p>Install in minutes with our simple theme integration</p>
                </div>
                <div>
                  <h5 className="font-semibold text-gray-900 mb-2">Real-time Updates</h5>
                  <p>Customers get instant tracking information</p>
                </div>
                <div>
                  <h5 className="font-semibold text-gray-900 mb-2">Reduce Support</h5>
                  <p>Fewer "Where is my order?" inquiries</p>
                </div>
              </div>
              <div className="mt-6 pt-6 border-t border-gray-200">
                <p className="text-xs text-gray-500">
                  All plans include a 3-day free trial. Test mode is enabled for safe testing. 
                  Cancel anytime during the trial period with no charges.
                </p>
              </div>
            </div>
          </Card>
        </div>
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