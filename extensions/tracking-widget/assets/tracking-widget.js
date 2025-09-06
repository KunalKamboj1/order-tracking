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
        const apiUrl = `${backendUrl}/tracking?order_id=${encodeURIComponent(orderNumber)}&shop=${encodeURIComponent(shopDomain)}`;
    
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
      
      // Handle tracking_number null (no tracking info available)
      if (data.tracking_number === null) {
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
    html += '<h3>Tracking Information</h3>';
    
    if (data.tracking_number) {
      html += `<p><strong>Tracking Number:</strong> ${escapeHtml(data.tracking_number)}</p>`;
    }
    
    if (data.tracking_company) {
      html += `<p><strong>Carrier:</strong> ${escapeHtml(data.tracking_company)}</p>`;
    }
    
    if (data.tracking_url) {
      html += `<p><a href="${escapeHtml(data.tracking_url)}" target="_blank" rel="noopener noreferrer" class="tracking-widget__link">View Detailed Tracking</a></p>`;
    }
    
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