import { useState } from 'react';
import {
  Page,
  Card,
  Text,
  BlockStack,
  Divider,
} from '@shopify/polaris';

export default function PrivacyPolicy() {
  return (
    <Page
      title="Privacy Policy"
      subtitle="Last updated: December 2024"
    >
      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">
            Information We Collect
          </Text>
          <Text as="p">
            When you install and use our Order Tracking App, we collect the following information:
          </Text>
          <Text as="ul">
            <li>Shop domain and basic store information</li>
            <li>Order data necessary for tracking functionality</li>
            <li>Access tokens for Shopify API authentication</li>
            <li>Billing and subscription information</li>
          </Text>

          <Divider />

          <Text variant="headingMd" as="h2">
            How We Use Your Information
          </Text>
          <Text as="p">
            We use the collected information to:
          </Text>
          <Text as="ul">
            <li>Provide order tracking functionality to your customers</li>
            <li>Process billing and manage subscriptions</li>
            <li>Improve our app's performance and features</li>
            <li>Provide customer support</li>
          </Text>

          <Divider />

          <Text variant="headingMd" as="h2">
            Data Security
          </Text>
          <Text as="p">
            We implement industry-standard security measures to protect your data:
          </Text>
          <Text as="ul">
            <li>All data transmission uses HTTPS encryption</li>
            <li>Access tokens are stored securely in encrypted databases</li>
            <li>We follow Shopify's security best practices</li>
            <li>Regular security audits and updates</li>
          </Text>

          <Divider />

          <Text variant="headingMd" as="h2">
            Data Retention and Deletion
          </Text>
          <Text as="p">
            We retain your data only as long as necessary to provide our services. When you uninstall the app:
          </Text>
          <Text as="ul">
            <li>All stored data is automatically deleted within 30 days</li>
            <li>You can request immediate data deletion by contacting support</li>
            <li>We comply with GDPR and CCPA data deletion requirements</li>
          </Text>

          <Divider />

          <Text variant="headingMd" as="h2">
            Third-Party Services
          </Text>
          <Text as="p">
            Our app integrates with:
          </Text>
          <Text as="ul">
            <li>Shopify APIs for order and fulfillment data</li>
            <li>Hosting services (Render, Netlify) for app infrastructure</li>
            <li>Database services for secure data storage</li>
          </Text>

          <Divider />

          <Text variant="headingMd" as="h2">
            Your Rights
          </Text>
          <Text as="p">
            You have the right to:
          </Text>
          <Text as="ul">
            <li>Access your personal data</li>
            <li>Request data correction or deletion</li>
            <li>Data portability</li>
            <li>Withdraw consent at any time</li>
          </Text>

          <Divider />

          <Text variant="headingMd" as="h2">
            Contact Information
          </Text>
          <Text as="p">
            For privacy-related questions or requests, contact us at:
          </Text>
          <Text as="p">
            Email: kunal.kamboj.52@gmail.com
          </Text>

          <Text variant="bodySm" as="p" tone="subdued">
            This privacy policy may be updated from time to time. We will notify you of any significant changes.
          </Text>
        </BlockStack>
      </Card>
    </Page>
  );
}