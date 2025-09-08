import { useState, useEffect } from 'react';
import {
  Page,
  Card,
  FormLayout,
  TextField,
  Button,
  Banner,
  TextContainer,
  Text,
  BlockStack,
  InlineStack,
  Spinner,
} from '@shopify/polaris';
import axios from 'axios';
import { useAppBridge } from '@shopify/app-bridge-react';
import { Redirect } from '@shopify/app-bridge/actions';
import ErrorBoundary from '../components/ErrorBoundary';
import { safeOAuthRedirect, setupOAuthMessageListener } from '../utils/oauthRedirect';

function Home() {
  const [orderId, setOrderId] = useState('');
  const [trackingData, setTrackingData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isClient, setIsClient] = useState(false);
  const [appBridge, setAppBridge] = useState(null);
  
  // Always call useAppBridge hook, but handle errors gracefully
  let app = null;
  try {
    app = useAppBridge();
  } catch (e) {
    // App Bridge not available during SSR or standalone mode
  }
  
  const isEmbedded = isClient && (!!appBridge || !!app) && typeof window !== 'undefined' && !!window.apiCall;

  // Derive shop from host when Shopify opens app with only host param
  const deriveShopFromHost = (hostParam) => {
    try {
      if (!hostParam || typeof window === 'undefined') return null;
      let base = hostParam.replace(/-/g, '+').replace(/_/g, '/');
      while (base.length % 4) base += '=';
      const decoded = atob(base);
      // decoded looks like: admin.shopify.com/store/<store>[?...]
      const match = decoded.match(/\/store\/([a-zA-Z0-9-]+)/);
      if (match && match[1]) {
        return match[1]; // use store handle; backend normalizes to .myshopify.com
      }
      return null;
    } catch (_) {
      return null;
    }
  };
  
  useEffect(() => {
    setIsClient(true);
    setAppBridge(app);
    
    // Check shop installation status when app loads
    const checkShopStatus = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const shopFromUrl = urlParams.get('shop');
      const host = urlParams.get('host');
      const allParams = Object.fromEntries(urlParams.entries());

      // Determine effective shop: URL param or derive from host
      let effectiveShop = shopFromUrl;
      if (!effectiveShop && host) {
        const derived = deriveShopFromHost(host);
        if (derived) {
          effectiveShop = derived;
          // Persist derived shop in URL without reloading
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.set('shop', derived);
          window.history.replaceState({}, '', newUrl.toString());
          console.log('🧭 [FRONTEND] Derived shop from host and persisted to URL:', {
            host,
            decodedShop: derived,
            newUrl: newUrl.toString()
          });
        }
      }
      
      console.log('🔍 [FRONTEND] Installation Check Started:', {
        shop: effectiveShop || '',
        host,
        allUrlParams: allParams,
        currentUrl: window.location.href,
        timestamp: new Date().toISOString()
      });
      
      if (effectiveShop) {
        console.log('✅ [FRONTEND] Shop parameter available, checking status:', effectiveShop);
        try {
          const statusUrl = `${process.env.NEXT_PUBLIC_BACKEND_URL}/shop/status?shop=${effectiveShop}`;
          console.log('📡 [FRONTEND] Calling shop status endpoint:', statusUrl);
          
          const response = await axios.get(statusUrl);
          const { status, needsAuth, authUrl } = response.data;
          
          console.log('📋 [FRONTEND] Shop status response:', {
            status,
            needsAuth,
            authUrl,
            fullResponse: response.data
          });
          
          if (needsAuth && (status === 'not_installed' || status === 'pending_oauth')) {
            console.log('🔄 [FRONTEND] OAuth required, preparing redirect:', {
              status,
              needsAuth,
              authUrl,
              host
            });
            
            // Redirect to complete OAuth flow with preserved host and returnUrl
            const backend = process.env.NEXT_PUBLIC_BACKEND_URL;
            try {
              const redirectUrl = new URL(`${backend}${authUrl}`);
              if (host) redirectUrl.searchParams.set('host', host);
              redirectUrl.searchParams.set('returnUrl', window.location.href);
              
              console.log('🚀 [FRONTEND] Redirecting to OAuth:', {
                redirectUrl: redirectUrl.toString(),
                preservedHost: host,
                returnUrl: window.location.href,
                isEmbedded,
                hasAppBridge: !!app
              });
              
              // Use safe OAuth redirect that handles iframe breakout
              safeOAuthRedirect(redirectUrl.toString(), isEmbedded, app);
            } catch (e) {
              console.warn('⚠️ [FRONTEND] URL constructor failed, using fallback:', e.message);
              // Fallback if URL constructor fails due to invalid base
              const params = [];
              if (host) params.push(`host=${encodeURIComponent(host)}`);
              params.push(`returnUrl=${encodeURIComponent(window.location.href)}`);
              const sep = authUrl.includes('?') ? '&' : '?';
              const fallbackUrl = `${backend}${authUrl}${sep}${params.join('&')}`;
              
              console.log('🚀 [FRONTEND] Fallback redirect URL:', fallbackUrl);
              
              // Use safe OAuth redirect that handles iframe breakout
              safeOAuthRedirect(fallbackUrl, isEmbedded, app);
            }
            return;
          } else {
            console.log('✅ [FRONTEND] Shop already authenticated:', {
              status,
              needsAuth
            });
          }
        } catch (error) {
          console.error('❌ [FRONTEND] Shop status check failed:', {
            error: error.message,
            response: error.response?.data,
            status: error.response?.status,
            shop: effectiveShop
          });
          // Continue loading the app even if status check fails
        }
      } else {
        console.log('⚠️ [FRONTEND] No shop parameter found in URL and unable to derive from host:', {
          allParams,
          currentUrl: window.location.href
        });
      }
    };
    
    checkShopStatus();
    
    // Check for billing status parameters in URL
    const urlParams = new URLSearchParams(window.location.search);
    const billingStatus = urlParams.get('billing');
    
    if (billingStatus === 'success') {
      setError('');
      setSuccess('Billing successful! Your subscription is now active.');
    } else if (billingStatus === 'declined') {
      setSuccess('');
      setError('Billing was declined. Please try again or contact support.');
    } else if (billingStatus === 'error') {
      setSuccess('');
      setError('An error occurred during billing. Please try again.');
    }
    
    // Check billing status after component mounts
    checkBillingStatus();
  }, [app]);

  const checkBillingStatus = async () => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const host = urlParams.get('host');
      const shopParam = urlParams.get('shop');

      // Derive shop from host if missing
      let effectiveShop = shopParam;
      if (!effectiveShop && host) {
        const derived = deriveShopFromHost(host);
        if (derived) {
          effectiveShop = derived;
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.set('shop', derived);
          window.history.replaceState({}, '', newUrl.toString());
          console.log('🧭 [FRONTEND] Derived shop from host for billing check and persisted to URL:', {
            host,
            decodedShop: derived,
            newUrl: newUrl.toString()
          });
        }
      }
      
      if (!effectiveShop) return; // Skip if no shop parameter
      
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://order-tracking-pro.onrender.com';
      const requestUrl = `${backendUrl}/billing/status?shop=${encodeURIComponent(effectiveShop)}`;
      
      let response;
      if (isEmbedded && window.apiCall) {
        // Use session token when embedded in Shopify Admin
        const fetchResponse = await window.apiCall(requestUrl);
        const data = await fetchResponse.json();
        response = { data };
      } else {
        // Use regular axios when running standalone
        response = await axios.get(requestUrl);
      }
      
      if (!response.data.hasActivePlan) {
        // Redirect to pricing page if no active billing (preserve host)
        const params = new URLSearchParams({ shop: effectiveShop });
        if (host) params.set('host', host);
        const pricingUrl = `/pricing?${params.toString()}`;
        
        console.log('💳 [FRONTEND] No active billing, redirecting to pricing:', {
          pricingUrl,
          isEmbedded,
          hasAppBridge: !!app,
          billingResponse: response.data
        });
        
        // Use App Bridge redirect for embedded apps, fallback to window.location for standalone
        if (isEmbedded && app) {
          console.log('🔗 [FRONTEND] Using App Bridge redirect for embedded pricing');
          const redirect = Redirect.create(app);
          redirect.dispatch(Redirect.Action.APP, {
            path: pricingUrl
          });
        } else {
          console.log('🌐 [FRONTEND] Using window.location redirect for standalone pricing');
          window.location.href = pricingUrl;
        }
      }
    } catch (error) {
       // Continue without redirect on error to avoid breaking the app
     }
   };

  const handleFetchTracking = async () => {
    if (!orderId.trim()) {
      setError('Please enter an Order ID');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');
    setTrackingData(null);

    try {
      // Get shop domain from URL parameters
      const urlParams = new URLSearchParams(window.location.search);
      const shop = urlParams.get('shop') || window.location.hostname;
      
      const requestUrl = `${process.env.NEXT_PUBLIC_BACKEND_URL}/tracking?shop=${encodeURIComponent(shop)}&order_id=${encodeURIComponent(orderId)}`;
      
      let response;
      
      if (isEmbedded) {
        try {
          const fetchResponse = await window.apiCall(requestUrl);
          if (!fetchResponse.ok) {
            throw new Error(`HTTP ${fetchResponse.status}: ${fetchResponse.statusText}`);
          }
          const data = await fetchResponse.json();
          response = {
            data: data,
            status: fetchResponse.status,
            headers: fetchResponse.headers
          };
        } catch (sessionError) {
          response = await axios.get(requestUrl);
        }
      } else {
        response = await axios.get(requestUrl);
      }
      
      setTrackingData(response.data);
    } catch (err) {
      if (err.response?.status === 404) {
        setError('Order not found or no tracking information available');
      } else {
        setError('Failed to fetch tracking information. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleFetchTracking();
    }
  };

  const renderTrackingResults = () => {
    if (!trackingData) return null;
    
    return (
      <Card sectioned>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Tracking Information</Text>
          <TextContainer>
            <p><strong>Order ID:</strong> {trackingData.order_id}</p>
            <p><strong>Tracking Number:</strong> {trackingData.tracking_number || 'Not available'}</p>
            <p><strong>Carrier:</strong> {trackingData.carrier || 'Not specified'}</p>
            <p><strong>Status:</strong> {trackingData.status || 'Unknown'}</p>
          </TextContainer>
        </BlockStack>
      </Card>
    );
  };

  return (
    <Page 
      title="Order Tracking" 
      subtitle="Look up tracking information for customer orders" 
    > 
      <BlockStack gap="500"> 
        {/* Theme Installation Section */} 
        <Card sectioned> 
          <BlockStack gap="400"> 
            <Text variant="headingMd" as="h2">Theme Installation Instructions</Text> 
            <TextContainer> 
              <p>Follow these steps to add the Order Tracking Widget to your theme:</p> 
            </TextContainer> 
            <div style={{ backgroundColor: '#f6f6f7', padding: '16px', borderRadius: '8px', marginTop: '12px' }}> 
              <ol style={{ margin: 0, paddingLeft: '20px' }}> 
                <li>Go to your Shopify Admin → Online Store → Themes</li> 
                <li>Click "Customize" on your active theme</li> 
                <li>Navigate to the page where you want to add the tracking widget</li> 
                <li>Click "Add section" or "Add block" (depending on your theme)</li> 
                <li>Look for "Order Tracking Widget" in the Apps section</li> 
                <li>Add the widget and customize its settings as needed</li> 
                <li>Click "Save" to publish your changes</li> 
              </ol> 
            </div> 
            <TextContainer> 
              <p style={{ marginTop: '12px', fontSize: '14px', color: '#637381' }}> 
                <strong>Note:</strong> The Order Tracking Widget will appear in the Apps section of your theme editor after the app is installed. 
              </p> 
            </TextContainer> 
          </BlockStack> 
        </Card> 

        {/* Order Tracking Section */} 
        <Card sectioned> 
          <BlockStack gap="400"> 
            <Text variant="headingMd" as="h2">Test Order Tracking</Text> 
            <FormLayout> 
              <TextField 
                label="Order ID" 
                value={orderId} 
                onChange={setOrderId} 
                onKeyPress={handleKeyPress} 
                placeholder="Enter order ID (e.g., 1234567890)" 
                autoComplete="off" 
              /> 
              
              <Button 
                primary 
                onClick={handleFetchTracking} 
                loading={loading} 
                disabled={!orderId.trim()} 
              > 
                {loading ? 'Fetching...' : 'Fetch Tracking'} 
              </Button> 
            </FormLayout> 
          </BlockStack> 
        </Card> 
      </BlockStack> 

      {success && ( 
        <Banner status="success" onDismiss={() => setSuccess('')}> 
          <p>{success}</p> 
        </Banner> 
      )} 

      {error && ( 
        <Banner status="critical" onDismiss={() => setError('')}> 
          <p>{error}</p> 
        </Banner> 
      )} 

      {loading && ( 
        <Card sectioned> 
          <BlockStack align="center"> 
            <Spinner size="small" /> 
            <p>Loading tracking information...</p> 
          </BlockStack> 
        </Card> 
      )} 

      {renderTrackingResults()} 
    </Page> 
  );
}

function HomeWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <Home />
    </ErrorBoundary>
  );
}

export { HomeWithErrorBoundary as default };