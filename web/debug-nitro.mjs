// Load the real server but intercept the response
const originalWriteHead = require("http").ServerResponse.prototype.writeHead;

require("http").ServerResponse.prototype.writeHead = function(statusCode, statusText, headers) {
  console.log("[writeHead] statusCode:", statusCode);
  console.log("[writeHead] statusText:", statusText);
  console.log("[writeHead] headers type:", typeof headers, Array.isArray(headers) ? "array" : "");
  if (headers) {
    if (Array.isArray(headers)) {
      for (let i = 0; i < headers.length; i += 2) {
        console.log("[writeHead]  ", headers[i], ":", headers[i+1]);
      }
    } else if (typeof headers === "object") {
      for (const [k, v] of Object.entries(headers)) {
        console.log("[writeHead]  ", k, ":", v);
      }
    }
  }
  return originalWriteHead.call(this, statusCode, statusText, headers);
};

// Now import and run the real server
import("./.output/server/index.mjs");
