import React from 'react';
import { Card, Text, Button, BlockStack } from '@shopify/polaris';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log error details
    console.error('Error caught by boundary:', error, errorInfo);
    
    this.setState({
      error: error,
      errorInfo: errorInfo
    });

    // You can also log the error to an error reporting service here
    // Example: Sentry.captureException(error);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2" tone="critical">
              Something went wrong
            </Text>
            <Text as="p">
              We're sorry, but something unexpected happened. Please try refreshing the page or contact support if the problem persists.
            </Text>
            
            {process.env.NODE_ENV === 'development' && (
              <details style={{ whiteSpace: 'pre-wrap', marginTop: '1rem' }}>
                <summary>Error Details (Development Only)</summary>
                <Text as="pre" tone="subdued">
                  {this.state.error && this.state.error.toString()}
                  <br />
                  {this.state.errorInfo.componentStack}
                </Text>
              </details>
            )}
            
            <div>
              <Button onClick={this.handleRetry} primary>
                Try Again
              </Button>
              <Button 
                onClick={() => window.location.reload()} 
                outline
                style={{ marginLeft: '1rem' }}
              >
                Refresh Page
              </Button>
            </div>
          </BlockStack>
        </Card>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;