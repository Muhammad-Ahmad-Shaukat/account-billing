import {
  Page,
  Layout,
  Card,
  Text,
  TextContainer,
  Stack,
  Badge,
  List,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

export default function HomePage() {
  return (
    <Page>
      <TitleBar title="Account Billing" />
      <Layout>
        <Layout.Section>
          <Card sectioned>
            <Stack distribution="equalSpacing" alignment="center">
              <TextContainer>
                <Text as="h1" variant="headingLg">
                  Custom Invoice Module
                </Text>
                <p>
                  ERP invoices are stored by this app and shown to signed-in
                  customers on the storefront account page. No product setup is
                  required here.
                </p>
              </TextContainer>
              <Badge status="success">Active</Badge>
            </Stack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card title="Customer access" sectioned>
            <List type="number">
              <List.Item>Customer signs in on the storefront</List.Item>
              <List.Item>
                Opens <strong>/pages/my-account</strong> → Invoices
              </List.Item>
              <List.Item>
                Views and downloads invoices via the app proxy
              </List.Item>
            </List>
            <br />
            <Text as="p" variant="bodySm" color="subdued">
              Storefront proxy path:{" "}
              <strong>/apps/account-billing/customer/invoices</strong>
            </Text>
          </Card>
        </Layout.Section>

        <Layout.Section oneHalf>
          <Card title="Invoice ingest" sectioned>
            <Text as="p" variant="bodyMd">
              <strong>POST</strong> /api/invoices/ingest
            </Text>
            <Divider />
            <br />
            <Text as="p" variant="bodySm" color="subdued">
              Headers: X-Invoice-Secret, X-Shopify-Shop-Domain
            </Text>
            <Text as="p" variant="bodySm" color="subdued">
              Body: one invoice JSON record (Section 5 payload)
            </Text>
          </Card>
        </Layout.Section>

        <Layout.Section oneHalf>
          <Card title="Outstanding balance ingest" sectioned>
            <Text as="p" variant="bodyMd">
              <strong>POST</strong> /api/outstanding/ingest
            </Text>
            <Divider />
            <br />
            <Text as="p" variant="bodySm" color="subdued">
              Same auth headers as invoice ingest
            </Text>
            <Text as="p" variant="bodySm" color="subdued">
              Body: shopify_customer_id + outstanding_balance (one per customer)
            </Text>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card title="Invoice exists check" sectioned>
            <Text as="p" variant="bodyMd">
              <strong>GET</strong> /api/invoices/exists
            </Text>
            <br />
            <Text as="p" variant="bodySm" color="subdued">
              Same auth headers. Body: shopify_customer_id + invoice_number
            </Text>
            <Text as="p" variant="bodySm" color="subdued">
              Returns exists: true/false
            </Text>
          </Card>
        </Layout.Section>

        <Layout.Section oneHalf>
          <Card title="Get outstanding" sectioned>
            <Text as="p" variant="bodyMd">
              <strong>GET</strong> /api/outstanding
            </Text>
            <br />
            <Text as="p" variant="bodySm" color="subdued">
              Body/query: shopify_customer_id
            </Text>
          </Card>
        </Layout.Section>

        <Layout.Section oneHalf>
          <Card title="Health" sectioned>
            <Text as="p" variant="bodyMd">
              <strong>GET</strong> /api/health
            </Text>
            <Text as="p" variant="bodyMd">
              <strong>GET</strong> /api/health/db
            </Text>
            <br />
            <Text as="p" variant="bodySm" color="subdued">
              No auth required
            </Text>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card title="Notes" sectioned>
            <List>
              <List.Item>
                Printed money values are never recalculated — only values
                supplied by the ERP are shown.
              </List.Item>
              <List.Item>
                Multiple invoices can belong to one order; each revision is
                stored, customers see the highest revision.
              </List.Item>
              <List.Item>
                Configure DATABASE_URL, INVOICE_INGEST_SECRET, and
                INVOICE_SHOP_DOMAIN on the host environment.
              </List.Item>
            </List>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
