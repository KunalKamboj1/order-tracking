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
import ErrorBoundary from '../components/ErrorBoundary';

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
  
  useEffect(() => {
    setIsClient(true);
    setAppBridge(app);
    
    // Check shop installation status when app loads
    const checkShopStatus = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const shop = urlParams.get('shop');
      
      if (shop) {
        try {
          const response = await axios.get(`${process.env.NEXT_PUBLIC_BACKEND_URL}/shop/status?shop=${shop}`);
          const { status, needsAuth, authUrl } = response.data;
          
          if (needsAuth && (status === 'not_installed' || status === 'pending_oauth')) {
            // Redirect to complete OAuth flow with preserved host and returnUrl
            const host = urlParams.get('host');
            const backend = process.env.NEXT_PUBLIC_BACKEND_URL;
            try {
              const redirectUrl = new URL(`${backend}${authUrl}`);
              if (host) redirectUrl.searchParams.set('host', host);
              redirectUrl.searchParams.set('returnUrl', window.location.href);
              window.location.href = redirectUrl.toString();
            } catch (e) {
              // Fallback if URL constructor fails due to invalid base
              const params = [];
              if (host) params.push(`host=${encodeURIComponent(host)}`);
              params.push(`returnUrl=${encodeURIComponent(window.location.href)}`);
              const sep = authUrl.includes('?') ? '&' : '?';
              window.location.href = `${backend}${authUrl}${sep}${params.join('&')}`;
            }
            return;
          }
        } catch (error) {
          // Continue loading the app even if status check fails
        }
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
      const shopParam = urlParams.get('shop');
      
      if (!shopParam) return; // Skip if no shop parameter
      
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000';
      const requestUrl = `${backendUrl}/billing/status?shop=${encodeURIComponent(shopParam)}`;
      
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
      
      if (!response.data.hasActiveBilling) {
        // Redirect to pricing page if no active billing (preserve host)
        const host = urlParams.get('host');
        const params = new URLSearchParams({ shop: shopParam });
        if (host) params.set('host', host);
        window.location.href = `/pricing?${params.toString()}`;
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

  const handleKeyPress = (event) => {
    if (event.key === 'Enter') {
      handleFetchTracking();
    }
  };



  const renderTrackingResults = () => {
    if (!trackingData) {
      return null;
    }

    // Handle error response
    if (trackingData.error) {
      return (
        <Banner status="critical">
          <p>Error: {trackingData.error}</p>
        </Banner>
      );
    }

    // Handle tracking response
    if (trackingData.tracking_number === null) {
      return (
        <Banner status="info">
          <p>No tracking information available for this order</p>
        </Banner>
      );
    }

    // Display tracking information
    if (trackingData.tracking_number) {
      
      return (
        <Card sectioned>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">Tracking Information</Text>
            <TextContainer>
              <p><strong>Tracking Number:</strong> {trackingData.tracking_number}</p>
              {trackingData.tracking_company && (
                <p><strong>Shipping Company:</strong> {trackingData.tracking_company}</p>
              )}
              {trackingData.tracking_url && (
                <p><strong>Track Package:</strong> <a href={trackingData.tracking_url} target="_blank" rel="noopener noreferrer">Click here to track</a></p>
              )}
            </TextContainer>
          </BlockStack>
        </Card>
      );
    }

    return (
      <Banner status="warning">
        <p>Unable to display tracking information</p>
      </Banner>
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

// Wrap the Home component with ErrorBoundary
function HomeWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <Home />
    </ErrorBoundary>
  );
}

export { HomeWithErrorBoundary as default };