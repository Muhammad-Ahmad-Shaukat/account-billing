// @ts-check
import "./load-env.js";
import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import serveStatic from "serve-static";

import shopify from "./shopify.js";
import productCreator from "./product-creator.js";
import PrivacyWebhookHandlers from "./privacy.js";
import { migrate } from "./db.js";
import invoicesIngestRouter from "./routes/invoices-ingest.js";
import outstandingIngestRouter from "./routes/outstanding-ingest.js";
import customerInvoicesProxyRouter from "./routes/customer-invoices-proxy.js";

const PORT = parseInt(
  process.env.BACKEND_PORT || process.env.PORT || "3000",
  10
);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

const app = express();

// JSON body for ingest + APIs (before ingest routes)
app.use(express.json({ limit: "2mb" }));

// Set up Shopify authentication and webhook handling
app.get(shopify.config.auth.path, shopify.auth.begin());
app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  shopify.redirectToShopifyOrAppRoot()
);
app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({ webhookHandlers: PrivacyWebhookHandlers })
);

// ERP ingest — must NOT require Shopify admin session
app.use("/api/invoices", invoicesIngestRouter);
app.use("/api/outstanding", outstandingIngestRouter);

// App proxy (storefront /apps/account-billing/* → /api/proxy/*)
app.use("/api/proxy", customerInvoicesProxyRouter);

// Admin-authenticated API routes
app.use("/api/*", shopify.validateAuthenticatedSession());

app.get("/api/products/count", async (_req, res) => {
  const client = new shopify.api.clients.Graphql({
    session: res.locals.shopify.session,
  });

  const countData = await client.request(`
    query shopifyProductCount {
      productsCount {
        count
      }
    }
  `);

  res.status(200).send({ count: countData.data.productsCount.count });
});

app.post("/api/products", async (_req, res) => {
  let status = 200;
  let error = null;

  try {
    await productCreator(res.locals.shopify.session);
  } catch (e) {
    console.log(`Failed to process products/create: ${e.message}`);
    status = 500;
    error = e.message;
  }
  res.status(status).send({ success: status === 200, error });
});

app.use(shopify.cspHeaders());
app.use(serveStatic(STATIC_PATH, { index: false }));

app.use("/*", shopify.ensureInstalledOnShop(), async (_req, res, _next) => {
  return res
    .status(200)
    .set("Content-Type", "text/html")
    .send(
      readFileSync(join(STATIC_PATH, "index.html"))
        .toString()
        .replace("%VITE_SHOPIFY_API_KEY%", process.env.SHOPIFY_API_KEY || "")
    );
});

async function start() {
  try {
    await migrate();
  } catch (err) {
    console.error("[db] Migration failed — invoice APIs will error until DB is up:", err.message);
  }

  app.listen(PORT, () => {
    console.log(`Invoice app listening on ${PORT}`);
  });
}

start();
