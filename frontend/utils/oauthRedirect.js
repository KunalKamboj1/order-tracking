/**
 * Safe OAuth redirect utility that handles iframe breakout
 * Ensures OAuth flows work properly in both embedded and standalone contexts
 */

/**
 * Safely redirect to OAuth URL, breaking out of iframe if necessary
 * @param {string} authUrl - The OAuth URL to redirect to
 * @param {boolean} isEmbedded - Whether the app is in embedded context
 * @param {object} appBridge - App Bridge instance (if available)
 */
export const safeOAuthRedirect = (authUrl, isEmbedded = false, appBridge = null) => {
  console.log('🚀 [OAUTH] Safe OAuth redirect initiated:', {
    authUrl,
    isEmbedded,
    hasAppBridge: !!appBridge,
    inIframe: window.top !== window.self
  });

  // Check if we're in an iframe
  const inIframe = window.top !== window.self;
  
  if (inIframe) {
    // We're in an iframe - need to break out to top level
    console.log('🖼️ [OAUTH] In iframe - breaking out to top level for OAuth');
    
    try {
      // Try to access window.top (will throw if cross-origin)
      window.top.location.href = authUrl;
    } catch (e) {
      console.warn('⚠️ [OAUTH] Cross-origin iframe detected, using postMessage fallback');
      
      // Fallback: post message to parent to handle redirect
      window.parent.postMessage({
        type: 'OAUTH_REDIRECT',
        url: authUrl
      }, '*');
      
      // Also try direct navigation as last resort
      setTimeout(() => {
        window.location.href = authUrl;
      }, 100);
    }
  } else if (isEmbedded && appBridge) {
    // Embedded context with App Bridge - use App Bridge redirect
    console.log('🔗 [OAUTH] Using App Bridge redirect for embedded OAuth');
    
    try {
      const { Redirect } = require('@shopify/app-bridge/actions');
      const redirect = Redirect.create(appBridge);
      redirect.dispatch(Redirect.Action.REMOTE, {
        url: authUrl,
        newContext: true
      });
    } catch (e) {
      console.warn('⚠️ [OAUTH] App Bridge redirect failed, falling back to window.location:', e);
      window.location.href = authUrl;
    }
  } else {
    // Normal redirect for standalone context
    console.log('🌐 [OAUTH] Using normal redirect for standalone OAuth');
    window.location.href = authUrl;
  }
};

/**
 * Check if current context is in an iframe
 * @returns {boolean} True if in iframe
 */
export const isInIframe = () => {
  try {
    return window.top !== window.self;
  } catch (e) {
    // Cross-origin iframe will throw error
    return true;
  }
};

/**
 * Add message listener for OAuth redirect requests from child frames
 * Call this in your main app to handle OAuth redirects from embedded contexts
 */
export const setupOAuthMessageListener = () => {
  const handleMessage = (event) => {
    if (event.data && event.data.type === 'OAUTH_REDIRECT') {
      console.log('📨 [OAUTH] Received OAuth redirect message:', event.data.url);
      window.location.href = event.data.url;
    }
  };
  
  window.addEventListener('message', handleMessage);
  
  // Return cleanup function
  return () => {
    window.removeEventListener('message', handleMessage);
  };
};