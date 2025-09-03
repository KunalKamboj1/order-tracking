import { useState, useEffect } from 'react';
import axios from 'axios';

export default function Widget() {
  const [orderId, setOrderId] = useState('');
  const [loading, setLoading] = useState(false);
  const [trackingData, setTrackingData] = useState(null);
  const [error, setError] = useState('');
  const [shop, setShop] = useState('');

  useEffect(() => {
    // Get shop from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const shopParam = urlParams.get('shop');
    if (shopParam) {
      setShop(shopParam);
    }
  }, []);

  const handleCheckTracking = async () => {
    if (!orderId.trim()) {
      setError('Please enter an Order ID');
      return;
    }

    if (!shop) {
      setError('Shop information is missing');
      return;
    }

    setLoading(true);
    setError('');
    setTrackingData(null);

    try {
      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/tracking?shop=${shop}&order_id=${orderId}`
      );

      setTrackingData(response.data);
    } catch (err) {
      console.error('Error fetching tracking:', err);
      if (err.response?.status === 404) {
        setError('No tracking found for this order');
      } else {
        setError('Failed to fetch tracking information. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (event) => {
    if (event.key === 'Enter') {
      handleCheckTracking();
    }
  };

  const renderTrackingResults = () => {
    if (!trackingData) return null;

    const { tracking_number, tracking_company, tracking_url } = trackingData;

    if (!tracking_number && !tracking_company && !tracking_url) {
      return (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-4">
          <p className="text-yellow-800">No tracking found for this order.</p>
        </div>
      );
    }

    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 mt-4">
        <h3 className="text-lg font-semibold text-green-800 mb-3">Tracking Information</h3>
        
        {tracking_company && (
          <div className="mb-2">
            <span className="font-medium text-gray-700">Shipping Company:</span>
            <span className="ml-2 text-gray-900">{tracking_company}</span>
          </div>
        )}
        
        {tracking_number && (
          <div className="mb-2">
            <span className="font-medium text-gray-700">Tracking Number:</span>
            <span className="ml-2 text-gray-900 font-mono">{tracking_number}</span>
          </div>
        )}
        
        {tracking_url && (
          <div className="mt-3">
            <a
              href={tracking_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
            >
              Track Package →
            </a>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">
          Track Your Order
        </h1>
        
        <div className="space-y-4">
          <div>
            <label htmlFor="orderId" className="block text-sm font-medium text-gray-700 mb-2">
              Order ID
            </label>
            <input
              type="text"
              id="orderId"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Enter your order ID"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          
          <button
            onClick={handleCheckTracking}
            disabled={loading || !orderId.trim()}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Checking...
              </span>
            ) : (
              'Check Tracking'
            )}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mt-4">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {renderTrackingResults()}
      </div>
    </div>
  );
}