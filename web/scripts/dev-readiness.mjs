/** Only a live API validation response counts as ready, never Nitro's 503 shell. */
export async function isApiValidationResponse(response, expectedStatus = 400) {
  if (response.status !== expectedStatus || !response.headers.get("content-type")?.includes("application/json")) return false;
  try {
    const body = await response.json();
    return Boolean(body && typeof body === "object" && !Array.isArray(body));
  } catch {
    return false;
  }
}

export const emptyApiProbe = {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: "{}",
};
