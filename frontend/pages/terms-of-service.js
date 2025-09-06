import { useState } from 'react';
import {
  Page,
  Card,
  Text,
  BlockStack,
  Divider,
} from '@shopify/polaris';

export default function TermsOfService() {
  return (
    <Page
      title="Terms of Service"
      subtitle="Last updated: December 2024"
    >
      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">
            Acceptance of Terms
          </Text>
          <Text as="p">
            By installing and using the Order Tracking App, you agree to be bound by these Terms of Service. 
            If you do not agree to these terms, please do not use our app.
          </Text>

          <Divider />

          <Text variant="headingMd" as="h2">
            Description of Service
          </Text>
          <Text as="p">
            Our Order Tracking App provides:
          </Text>
          <Text as="ul">
            <li>Order tracking functionality for your Shopify store</li>
            <li>Customer-facing tracking widget</li>
            <li>Admin interface for managing tracking information</li>
            <li>Integration with shipping carriers</li>
          </Text>

          <Divider />

          <Text variant="headingMd" as="h2">
            User Responsibilities
          </Text>
          <Text as="p">
            You agree to:
          </Text>
          <Text as="ul">
            <li>Provide accurate information during setup</li>
            <li>Use the app in compliance with Shopify's terms</li>
            <li>Not attempt to reverse engineer or modify the app</li>
            <li>Pay all applicable fees on time</li>
            <li>Notify us of any security issues</li>
          </Text>

          <Divider />

          <Text variant="headingMd" as="h2">
            Billing and Payments
          </Text>
          <Text as="ul">
            <li>Subscription fees are billed monthly or as one-time payments</li>
            <li>All fees are non-refundable unless required by law</li>
            <li>We may change pricing with 30 days notice</li>
            <li>Failure to pay may result in service suspension</li>
          </Text>

          <Divider />

          <Text variant="headingMd" as="h2">
            Limitation of Liability
          </Text>
          <Text as="p">
            Our liability is limited to the amount paid for the service in the past 12 months. 
            We are not liable for indirect, incidental, or consequential damages.
          </Text>

          <Divider />

          <Text variant="headingMd" as="h2">
            Service Availability
          </Text>
          <Text as="p">
            We strive for 99.9% uptime but cannot guarantee uninterrupted service. 
            Scheduled maintenance will be announced in advance when possible.
          </Text>

          <Divider />

          <Text variant="headingMd" as="h2">
            Termination
          </Text>
          <Text as="p">
            Either party may terminate this agreement at any time. Upon termination:
          </Text>
          <Text as="ul">
            <li>Your access to the app will be discontinued</li>
            <li>Your data will be deleted according to our privacy policy</li>
            <li>No refunds will be provided for unused service periods</li>
          </Text>

          <Divider />

          <Text variant="headingMd" as="h2">
            Contact Information
          </Text>
          <Text as="p">
            For questions about these terms, contact us at:
          </Text>
          <Text as="p">
            Email: support@ordertrackingapp.com<br />
            Address: [Your Business Address]
          </Text>
        </BlockStack>
      </Card>
    </Page>
  );
}