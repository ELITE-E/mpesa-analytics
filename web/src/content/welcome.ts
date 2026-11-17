// Static copy for the Welcome screen, taken from the Stitch HTML
// (stitch-export/welcome/welcome.html). Statements are read in this browser and
// never leave the device (CP8b).

export type Capability = {
  icon: string;
  /** Tile colours for the icon badge. */
  tone: string;
  title: string;
  description: string;
};

export const hero = {
  engineLabel: "Financial Translation Engine",
  privacyLabel: "Private on this device",
  headline: "Turn your M-Pesa statement into a clear picture of your money.",
  description:
    "Raw M-Pesa statements are dense and exhausting. Upload your official statement PDF to uncover where your money actually went, what you preserved in investments, and the true economic cost of tariffs.",
};

export const uploadCallToAction = {
  label: "Upload M-Pesa Statement",
  reassurance: "Encrypted PDFs supported. The PDF itself is never stored.",
};

export const capabilitiesSection = {
  title: "What you'll uncover",
  badge: "From Your Statement",
};

export const capabilities: Capability[] = [
  {
    icon: "swap_vert",
    tone: "bg-primary-fixed text-on-primary-fixed",
    title: "Cash Flow & True Inflow",
    description:
      "Clean separation of true earnings from circular transfers and deposits.",
  },
  {
    icon: "storefront",
    tone: "bg-secondary-container text-on-secondary-container",
    title: "Spending & Merchant Outlays",
    description:
      "Automatic categorization across Paybill utilities, Till, and direct merchants.",
  },
  {
    icon: "savings",
    tone: "bg-primary-container text-on-primary-container",
    title: "Wealth & Savings",
    description:
      "Isolate Mali, Money Market Fund reserves, and lock savings from daily expenses.",
  },
  {
    icon: "price_change",
    tone: "bg-tertiary-fixed text-on-tertiary-fixed",
    title: "Tariffs & Hidden Charges",
    description:
      "Accurate breakdown of carrier withdrawal fees, excise duty, and access charges.",
  },
];

export const returningSession = {
  title: "Returning Analyst?",
  badge: "Your Latest Import",
  resumeLabel: "Open Latest Analysis",
  newPeriodLabel: "Upload New Period",
};
