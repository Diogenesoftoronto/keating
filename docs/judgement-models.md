# Set up a judgement model

The judgement model reviews work independently of the tutor model. Changing your chat model does not configure the reviewer. Open **Settings → Providers & Models → Judgement**, or follow **Set up judgement model** on an unavailable response review.

## Jev (recommended)

1. Choose **Jev · Not Organic · Recommended** in the judgement model picker.
2. Choose **Connect Not Organic**, or **Authorize judgement access** if your account is already connected.
3. Complete sign-in and authorization. When you return, the settings should show **Not Organic judgement access is connected**.
4. Retry the review. Selecting a model alone does not authorize account access.

[Jev by TypeSafe](https://typesafe.ai/) answers focused, typed questions. Read its [official documentation](https://docs.typesafe.ai/introduction) to learn about choices, scores, and yes/no probabilities. Keating connects through Not Organic; you do not paste a TypeSafe API key into the app. Hosted reviews send relevant work through Not Organic and may incur account charges.

If account access is unavailable in this app configuration, model selection cannot enable it. Use a build configured for Not Organic or the desktop local option. If authorization expires, reconnect. If a review still fails, check account access and available funds before retrying.

## Your TypeSafe API key

Choose **Jev · your TypeSafe API key** in **Settings → Providers & Models → Judgement**. Enter your TypeSafe model ID (default `jev-latest`), paste your API key, and choose **Save API key**. You can replace or remove it there later. This reviewer is independent of your tutor and does not require Not Organic authorization or credit.

The key is saved in this device's provider credential store, separately from the model settings. Reviews pass through Keating's same-origin relay to TypeSafe's fixed API endpoint; the server uses your key only for the request. TypeSafe bills your account directly. Model estimates still require matching verified calibration before automatic grading can use them.

## On this device

In the desktop app, download **MiniCPM5 2B** from **Offline tutor**, then select it in the judgement picker. This option requires a build that provides local scoring. The settings show download and runtime availability; choosing a model does not download it automatically. Hosted mode also lets you choose a separate local fallback.

The browser picker lists MiniCPM5, LFM 2.5, and Gemma alternatives, but marks them unavailable for judgement scoring. Those models currently support tutoring, not local judgement scoring. An existing saved selection remains visible.

## Options

- **Off** keeps built-in checks and disables model reviews.
- **Advanced review options** lets you set request-token and state-plus-longest-question limits. Hosted Jev defaults to 64,000 and 32,000 tokens respectively. Local model metadata caps limits during fallback.
- **Calibration** accepts a separately supplied verified calibration file. Installing a model does not establish calibration. Automatic grading remains with existing checks until calibration and validation are complete.

Model reviews can be unavailable or uncertain. Connecting a reviewer does not guarantee that a draft passes review or that a model estimate is accurate.
