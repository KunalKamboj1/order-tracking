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
  
  const isEmbedded = isClient && !!appBridge;
  
  useEffect(() => {
    setIsClient(true);
    setAppBridge(app);
    
    // Check for billing status parameters in URL
    const urlParams = new URLSearchParams(window.location.search);
    const billingStatus = urlParams.get('billing');
    
    if (billingStatus === 'success') {
      setError('');
      setSuccess('Billing successful! Your subscription is now active.');
      console.log('Billing successful!');
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
      const response = await axios.get(`${backendUrl}/billing/status?shop=${encodeURIComponent(shopParam)}`);
      
      if (!response.data.hasActiveBilling) {
        // Redirect to pricing page if no active billing
        window.location.href = `/pricing?shop=${encodeURIComponent(shopParam)}`;
      }
    } catch (error) {
       console.error('Error checking billing status:', error);
       // Continue without redirect on error to avoid breaking the app
     }
   };

  const handleFetchTracking = async () => {
    console.log('Order ID entered:', orderId);
    console.log('Backend URL:', process.env.NEXT_PUBLIC_BACKEND_URL);
    console.log('Is embedded in Shopify Admin:', isEmbedded);
    
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
      console.log('Making request to:', requestUrl);
      
      let response;
      
      if (isEmbedded && appBridge) {
        // When embedded in Shopify Admin, use fetch with proper headers
        console.log('Using fetch for embedded app');
        const fetchResponse = await fetch(requestUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        const data = await fetchResponse.json();
        response = {
          data: data,
          status: fetchResponse.status,
          headers: fetchResponse.headers
        };
      } else {
        // Use regular axios when running standalone
        console.log('Using axios for standalone app');
        response = await axios.get(requestUrl);
      }
      
      console.log('Full response:', response);
      console.log('Response status:', response.status);
      console.log('Response data:', JSON.stringify(response.data, null, 2));
      console.log('Response headers:', response.headers);

      setTrackingData(response.data);
    } catch (err) {
      console.error('Error fetching tracking:', err);
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
    if (!trackingData) return null;

    const { tracking_number, tracking_company, tracking_url } = trackingData;

    if (!tracking_number && !tracking_company && !tracking_url) {
      return (
        <Banner status="info">
          <p>No tracking info found for this order.</p>
        </Banner>
      );
    }

    return (
      <Card sectioned>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Tracking Information</Text>
          
          {tracking_company && (
            <TextContainer>
              <p><strong>Shipping Company:</strong> {tracking_company}</p>
            </TextContainer>
          )}
          
          {tracking_number && (
            <TextContainer>
              <p><strong>Tracking Number:</strong> {tracking_number}</p>
            </TextContainer>
          )}
          
          {tracking_url && (
            <TextContainer>
              <p>
                <strong>Track Package:</strong>{' '}
                <a href={tracking_url} target="_blank" rel="noopener noreferrer">
                  View Tracking Details
                </a>
              </p>
            </TextContainer>
          )}
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

// Wrap the Home component with ErrorBoundary
function HomeWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <Home />
    </ErrorBoundary>
  );
}

export { HomeWithErrorBoundary as default };