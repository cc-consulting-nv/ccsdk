import { XMLHttpRequest as XhrMock } from "fake-xml-http-request";

// Polyfill global XMLHttpRequest for Node.js
if (typeof globalThis.XMLHttpRequest === "undefined") {
  globalThis.XMLHttpRequest = XhrMock;
}
export { XhrMock };
