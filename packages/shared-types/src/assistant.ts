import type { Role } from "./index.js";

type AssistantProfile = {
  label: string;
  title: string;
  capabilities: readonly string[];
  suggestions: readonly string[];
};

const profiles: Record<Role, AssistantProfile> = {
  ADMIN: {
    label: "Admin",
    title: "Your admin guide.",
    capabilities: [
      "Summarize workspace revenue and billing reports.",
      "Look up companies, subscriptions, invoices, and payments.",
      "Explain billing workflows and workspace settings.",
    ],
    suggestions: [
      "Summarize last month's revenue.",
      "Which companies do we currently serve?",
      "Which subscriptions have billing due in the next 7 days?",
    ],
  },
  SALES: {
    label: "Sales",
    title: "Your sales guide.",
    capabilities: [
      "Create and send quotations.",
      "Explain plans, pricing, and discounts.",
      "Turn accepted quotations into active subscriptions.",
    ],
    suggestions: [
      "How do I create and send a quotation?",
      "How do discounts work on a quotation?",
      "How do I activate a subscription?",
    ],
  },
  FINANCE: {
    label: "Finance",
    title: "Your finance guide.",
    capabilities: [
      "Review and confirm draft invoices.",
      "Record payments and allocate receipts.",
      "Understand credits, refunds, reports, and ProofBill.",
    ],
    suggestions: [
      "How do I confirm a draft invoice?",
      "How do I allocate a payment to an invoice?",
      "How are credits and refunds reviewed?",
    ],
  },
  SUPPORT: {
    label: "Support",
    title: "Your support guide.",
    capabilities: [
      "Explain subscription statuses and renewals.",
      "Guide customers through invoice and payment questions.",
      "Know when to involve Sales, Finance, or an Admin.",
    ],
    suggestions: [
      "What do the subscription statuses mean?",
      "How can I explain an invoice to a customer?",
      "When should I involve the Finance team?",
    ],
  },
  CUSTOMER: {
    label: "Customer",
    title: "Your subscription guide.",
    capabilities: [
      "Summarize your invoices, payments, and outstanding balance.",
      "Check your subscriptions, billing dates, and usage allowance.",
      "Explain your invoice line items and account details.",
    ],
    suggestions: [
      "What is my outstanding balance?",
      "Show my active subscriptions.",
      "What payments have I made?",
    ],
  },
};

const fallback: AssistantProfile = {
  label: "Workspace",
  title: "Your Brightloop guide.",
  capabilities: ["Find your way around the workspace.", "Understand subscription and billing terminology."],
  suggestions: ["What can I do in Brightloop?", "How does recurring billing work?"],
};

export function getAssistantProfile(role: string): AssistantProfile {
  return Object.hasOwn(profiles, role) ? profiles[role as Role] : fallback;
}
