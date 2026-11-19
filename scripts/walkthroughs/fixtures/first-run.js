// Run after demo to keep the sample provider discoverable while leaving onboarding fresh.
const { setDefaultChatModel } = await import("/src/keating/model-prefs.ts");
setDefaultChatModel(null);
localStorage.removeItem("keating:onboarding:v1");
localStorage.removeItem("keating:tour:v1");
