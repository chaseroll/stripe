require("dotenv").config();
const express = require("express");
const Stripe = require("stripe");

// Log environment variables for debugging
console.log("STRIPE_API_KEY:", process.env.STRIPE_API_KEY ? "Set" : "Not set");
console.log(
  "STRIPE_WEBHOOK_SECRET:",
  process.env.STRIPE_WEBHOOK_SECRET ? "Set" : "Not set"
);
// Production configuration for Stripe
const stripeConfig = {
  apiVersion: "2023-10-16",
  timeout: 20000,
  maxNetworkRetries: 2,
  // appInfo: {
  //   name: "Your App Name",
  //   version: "1.0.0",
  // },
};

const stripe = Stripe(process.env.STRIPE_API_KEY, stripeConfig);

const app = express();

// Middleware to capture raw body for webhook verification
app.use(express.raw({ type: "application/json" }), (req, res, next) => {
  try {
    req.rawBody = req.body;
    console.log("Webhook request received:", req.headers["stripe-signature"]);
    console.log("Request body:", req.rawBody);
    next();
  } catch (err) {
    console.error("Error in middleware:", err.message);
    console.error("Full middleware error:", err);
    res.status(500).send("Middleware Error");
  }
});

app.use(express.json());

// Webhook secret from environment variable
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

app.post("/webhook", async (req, res) => {
  try {
    const sig = req.headers["stripe-signature"];

    let event;
    try {
      const webhookConfig = {
        throwOnUnknownEvent: true,
        tolerance: 600,
      };

      // Verify the webhook signature
      console.log("Attempting to verify webhook signature...");
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        sig,
        endpointSecret,
        webhookConfig
      );
      console.log("Event verified, type:", event.type);
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      console.error("Full signature error:", err);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle checkout.session.completed event
    if (event.type === "checkout.session.completed") {
      console.log("Processing checkout.session.completed event");
      const session = event.data.object;
      const subscriptionId = session.subscription;
      console.log("Subscription ID:", subscriptionId);

      if (!subscriptionId) {
        console.error("No subscription ID in session");
        return res.status(400).send("No subscription ID");
      }

      // Extract custom fields
      const customFields = session.custom_fields || [];
      console.log("Custom fields:", JSON.stringify(customFields, null, 2));

      // Find each field by key
      const buildingField = customFields.find((f) => f.key === "buildingname");
      const roomField = customFields.find((f) => f.key === "roomnumber");
      const pickupField = customFields.find((f) => f.key === "pickuptime");
      const idempotencyKey = `subscription_${session.id}`;

      // More robust field processing
      const getDropdownLabel = (field) => {
        if (!field?.dropdown?.value || !field?.dropdown?.options) return "N/A";
        return (
          field.dropdown.options.find(
            (opt) => opt.value === field.dropdown.value
          )?.label || "N/A"
        );
      };

      const buildingName = getDropdownLabel(buildingField);
      const pickupTime = getDropdownLabel(pickupField);
      const roomNumber = roomField?.text?.value || "N/A";

      // Define metadata with Room Number before Pickup Time
      const metadata = {
        "Building Name": buildingName,
        "Room Number": roomNumber,
        "Pickup Time": pickupTime,
      };

      try {
        // Update subscription with idempotency key
        console.log("Updating subscription metadata...");
        await stripe.subscriptions.update(
          subscriptionId,
          { metadata },
          { idempotencyKey }
        );
        console.log(
          `Updated subscription ${subscriptionId} with metadata:`,
          metadata
        );
      } catch (error) {
        console.error("Error updating metadata:", error.message);
        console.error("Full metadata error:", error);
        return res.status(500).send(`Update Error: ${error.message}`);
      }
    } else {
      console.log("Received event type:", event.type, "- not handling");
    }

    // Acknowledge the event
    res.status(200).json({ received: true });
  } catch (err) {
    console.error("Unexpected error in webhook handler:", err.message);
    console.error("Full webhook error:", err);
    res.status(500).send(`Webhook Handler Error: ${err.message}`);
  }
});

// Catch unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

app.listen(3000, () =>
  console.log("Webhook server running on http://localhost:3000")
);