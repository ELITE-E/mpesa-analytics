// Copy for the browser capability check (CP10a item 2). The app is verified on desktop Chrome
// only; the copy says so rather than claiming more.

/** Where the app has been verified. */
export const verifiedOn = "Verified on desktop Chrome; other browsers untested.";

/** Each capability the app needs, in plain words. */
export const capabilityNames = {
  moduleWorker: "background workers that load modules (module workers)",
  webAssembly: "WebAssembly, which runs the statement reader",
  cryptoSubtle: "the browser's built-in encryption (WebCrypto)",
  randomValues: "secure random numbers (crypto.getRandomValues)",
};

export const capabilities = {
  title: "This browser can't run the app",
  body: "It is missing:",
  advice: "Try an up-to-date desktop Chrome.",
  memoryOnly:
    "This browser does not allow saving on this device, so statements are kept only until you close the page.",
};
