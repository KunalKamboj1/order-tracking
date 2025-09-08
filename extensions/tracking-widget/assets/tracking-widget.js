document.addEventListener('DOMContentLoaded', function() {
  // Find all tracking widgets on the page
  const trackingButtons = document.querySelectorAll('[id^="tracking-order-btn-"]');
  
  trackingButtons.forEach(function(button) {
    const blockId = button.id.replace('tracking-order-btn-', '');
    const input = document.getElementById('tracking-order-input-' + blockId);
    const resultsContainer = document.getElementById('tracking-results-' + blockId);
    const settings = window.trackingWidgetSettings[blockId];
    
    if (!input || !resultsContainer || !settings) return;
    
    button.addEventListener('click', function() {
      const orderNumber = input.value.trim();
      
      if (!orderNumber) {
        showError(resultsContainer, 'Please enter an order number.');
        return;
      }
      
      trackOrder(orderNumber, settings.shopDomain, resultsContainer, button);
    });
    
    // Allow Enter key to submit
    input.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        button.click();
      }
    });
  });
  
  function trackOrder(orderNumber, shopDomain, resultsContainer, button) {
    const originalButtonText = button.textContent;
    
    // Show loading state
    button.textContent = 'Tracking...';
    button.disabled = true;
    resultsContainer.innerHTML = '<div class="tracking-widget__loading">Searching for your order...</div>';
    
    // API endpoint - using the deployed backend on Render
    const backendUrl = window.TRACKING_BACKEND_URL || 'https://order-tracking-pro.onrender.com';
        const apiUrl = `${backendUrl}/tracking?order_id=${encodeURIComponent(orderNumber)}&shop=${encodeURIComponent(shopDomain)}&public=true`;
    
    fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    })
    .then(response => {
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Order not found');
        }
        throw new Error('Failed to fetch tracking information');
      }
      return response.json();
    })
    .then(data => {
      // Handle error response from new API format
      if (data.error) {
        showError(resultsContainer, data.error);
        return;
      }
      
      // Handle new API response format
      if (!data.found || !data.tracking_data || data.tracking_data.length === 0) {
        showError(resultsContainer, 'No tracking information available for this order.');
        return;
      }
      
      displayTrackingResults(resultsContainer, data);
    })
    .catch(error => {
      console.error('Tracking error:', error);
      showError(resultsContainer, 'Unable to retrieve tracking information. Please try again later.');
    })
    .finally(() => {
      // Reset button state
      button.textContent = originalButtonText;
      button.disabled = false;
    });
  }
  
  function displayTrackingResults(container, data) {
    // Show the container
    container.hidden = false;
    container.style.display = 'block';
    
    let html = '<div class="tracking-widget__success">';
    
    // Handle new API response format with tracking_data array
    data.tracking_data.forEach((order, index) => {
      html += `<h3>Order ${escapeHtml(order.order_name)}</h3>`;
      html += `<p><strong>Order Date:</strong> ${new Date(order.order_date).toLocaleDateString()}</p>`;
      html += `<p><strong>Total:</strong> ${escapeHtml(order.currency)} ${escapeHtml(order.total_price)}</p>`;
      html += `<p><strong>Status:</strong> ${escapeHtml(order.financial_status)} / ${escapeHtml(order.fulfillment_status)}</p>`;
      
      if (order.fulfillments && order.fulfillments.length > 0) {
        html += '<h4>Tracking Information</h4>';
        order.fulfillments.forEach((fulfillment) => {
          html += '<div style="margin-bottom: 15px; padding: 10px; border: 1px solid #e5e7eb; border-radius: 5px;">';
          
          if (fulfillment.tracking_number) {
            html += `<p><strong>Tracking Number:</strong> ${escapeHtml(fulfillment.tracking_number)}</p>`;
          }
          
          if (fulfillment.tracking_company) {
            html += `<p><strong>Carrier:</strong> ${escapeHtml(fulfillment.tracking_company)}</p>`;
          }
          
          html += `<p><strong>Status:</strong> ${escapeHtml(fulfillment.status)}</p>`;
          
          if (fulfillment.shipped_date) {
            html += `<p><strong>Shipped:</strong> ${new Date(fulfillment.shipped_date).toLocaleDateString()}</p>`;
          }
          
          if (fulfillment.line_items && fulfillment.line_items.length > 0) {
            html += '<p><strong>Items:</strong></p><ul>';
            fulfillment.line_items.forEach((item) => {
              html += `<li>${escapeHtml(item.name)} (Qty: ${item.quantity})</li>`;
            });
            html += '</ul>';
          }
          
          if (fulfillment.tracking_url) {
            html += `<p><a href="${escapeHtml(fulfillment.tracking_url)}" target="_blank" rel="noopener noreferrer" class="tracking-widget__link">View Detailed Tracking</a></p>`;
          }
          
          html += '</div>';
        });
      } else {
        html += '<p>No tracking information available for this order.</p>';
      }
      
      if (index < data.tracking_data.length - 1) {
        html += '<hr style="margin: 20px 0;">';
      }
    });
    
    html += '</div>';
    container.innerHTML = html;
  }
  
  function showError(container, message) {
    // Show the container
    container.hidden = false;
    container.style.display = 'block';
    container.innerHTML = `<div class="tracking-widget__error">${escapeHtml(message)}</div>`;
  }
  
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});