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

export default function Home() {
  const [orderId, setOrderId] = useState('');
  const [trackingData, setTrackingData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
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
  }, [app]);

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
      <Card sectioned>
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
      </Card>

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