import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";
import { DownloadPdfButton } from "../components/DownloadPdfButton";
import { useSeo } from "../hooks/useSeo";

const LAST_UPDATED = "July 1, 2026";

export function Privacy() {
  useSeo({
    title: "Privacy Policy | Keating",
    description:
      "Privacy Policy for Keating, including local-first storage, provider keys, analytics, shared sessions, and P2P sync.",
    canonical: "https://keating.help/privacy",
  });

  return (
    <div className="retro-layout retro-page legal-layout">
      <Nav />
      <main className="legal-page">
        <article className="wrap legal-doc paper-fold distressed-border">
          <div className="eyebrow prompt">cat PRIVACY_POLICY.txt</div>
          <h1>Privacy Policy</h1>
          <p className="legal-updated">Last updated: {LAST_UPDATED}</p>
          <DownloadPdfButton label="Privacy Policy" />

          <section>
            <h2>1. The short version</h2>
            <p>
              Keating is local-first. Your conversations, study artifacts, settings, and provider
              keys are stored in your browser or on your device — not on a Keating account server,
              because there are no accounts. Data leaves your device only when a feature you invoke
              requires it: sending prompts to an AI provider you configured, publishing a share
              link, syncing between your own devices over P2P, or the product analytics described
              below.
            </p>
          </section>

          <section>
            <h2>2. Data stored on your device</h2>
            <p>The app keeps its working data in browser storage (localStorage and IndexedDB) or, in the desktop app, in its local data directory. This includes:</p>
            <ul>
              <li>chat sessions, their titles, previews, and fork history;</li>
              <li>study artifacts: plans, maps, quizzes, quiz answers and grades, goals, animations;</li>
              <li>settings: interface preferences, teacher persona text, speech configuration, model visibility, proxy configuration;</li>
              <li>provider API keys you enter;</li>
              <li>cached copies of shared sessions you have opened.</li>
            </ul>
            <p>
              We cannot see this data. It is also not backed up by us: clearing site data,
              uninstalling the app, or losing the device can erase it. Export or back up anything
              you cannot afford to lose.
            </p>
          </section>

          <section>
            <h2>3. Provider keys and AI requests</h2>
            <p>
              When you chat, the prompts, attached files, relevant session context, and your
              persona/system configuration are sent directly to the AI provider you selected (for
              example Anthropic, OpenAI, or Google), using your API key, under that provider’s
              privacy policy and data-retention rules. Keating does not proxy these requests through
              our servers unless you explicitly enable a proxy — and if you configure your own proxy
              URL, traffic goes to the proxy you chose.
            </p>
            <p>
              Your keys stay in local settings storage. Do not paste keys or other secrets into
              chat messages, shared sessions, or exported artifacts; content in those places is
              handled as ordinary content, not as credentials.
            </p>
          </section>

          <section>
            <h2>4. Speech features</h2>
            <p>
              If you enable speech, audio for text-to-speech or transcription is sent to the speech
              provider you configured (or a custom endpoint you supply). Microphone access is
              requested from the browser only when you use voice input, and the browser controls
              that permission.
            </p>
          </section>

          <section>
            <h2>5. Shared sessions and public links</h2>
            <p>
              Creating a share link publishes the selected conversation or artifact. Depending on
              the share mode in your settings, content is encoded into the link itself and/or
              stored by the sharing backend so the link can resolve. Treat share links as public:
              anyone with the link can read the content, links can be forwarded, and copies may
              persist in caches even after deletion. Do not share content containing personal data
              you are not permitted to disclose.
            </p>
          </section>

          <section>
            <h2>6. Peer-to-peer sync (desktop)</h2>
            <p>
              The desktop app can replicate your data between your own devices using peer-to-peer
              components (encrypted topics and local writer identities). Data replicates to peers
              that hold your sync credentials; guard those like passwords. P2P sync is
              device-to-device and does not deposit your learning data on Keating servers.
            </p>
          </section>

          <section>
            <h2>7. Analytics and diagnostics</h2>
            <p>
              Hosted web pages use product analytics (currently PostHog) to understand feature
              usage, reliability, and release health — for example page views and events like “a
              session was shared”. We aim to collect product-level signals, not the content of your
              learning material: analytics events do not include your prompts, session content, or
              keys. Browser privacy settings, content blockers, and Do-Not-Track/consent tooling
              can limit or block this collection, and the app continues to work with analytics
              blocked.
            </p>
          </section>

          <section>
            <h2>8. Hosted infrastructure logs</h2>
            <p>
              Like any website, the hosted pages and share-link backend produce short-lived
              operational logs (IP address, user agent, requested URL, timestamps) used for
              security, abuse prevention, and debugging. These are retained only as long as needed
              for those purposes.
            </p>
          </section>

          <section>
            <h2>9. Cookies and similar technologies</h2>
            <p>
              Keating does not use advertising cookies. Browser storage is used for the app data
              described above, and the analytics tooling may set its own identifiers on hosted
              pages. There is no cross-site tracking by us.
            </p>
          </section>

          <section>
            <h2>10. Third-party services</h2>
            <p>
              Keating links to and integrates with third parties — AI providers, model hosts,
              GitHub, speech services, payment or credit systems where offered. Each is governed by
              its own privacy policy. Review a provider’s terms before sending it sensitive
              material; your configuration decides which third parties receive your data.
            </p>
          </section>

          <section>
            <h2>11. Your choices and rights</h2>
            <ul>
              <li>Delete local data at any time via browser site-data controls or by removing the desktop app’s data directory.</li>
              <li>Remove saved provider keys in Settings.</li>
              <li>Avoid share links, or remove shared content (cached copies held by recipients may persist).</li>
              <li>Use local models to keep prompts entirely on your machine.</li>
              <li>Block analytics with standard browser tooling.</li>
            </ul>
            <p>
              Because we do not hold your learning data, most access/deletion rights are exercised
              directly on your own device. For questions about data we do hold (shared content,
              operational logs), contact us via the channel below and we will respond consistent
              with applicable data-protection law (such as the GDPR or CCPA where they apply).
            </p>
          </section>

          <section>
            <h2>12. Children</h2>
            <p>
              The hosted Service is not directed at children under 13 (or the higher minimum age
              your jurisdiction requires), and we do not knowingly collect personal information
              from them. Classroom deployments should be supervised by an educator or guardian who
              manages provider access.
            </p>
          </section>

          <section>
            <h2>13. Changes to this policy</h2>
            <p>
              We may update this policy as the Service evolves. We will update the “Last updated”
              date above and, for material changes, take reasonable steps to give notice on the
              site or in release notes.
            </p>
          </section>

          <section>
            <h2>14. Contact</h2>
            <p>
              For privacy questions about the repository or hosted site, open an issue in the
              Keating repository or use the contact channel listed on the project site.
            </p>
          </section>
        </article>
      </main>
      <Footer />
    </div>
  );
}
