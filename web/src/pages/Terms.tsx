import { Link } from "@tanstack/react-router";
import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";
import { DownloadPdfButton } from "../components/DownloadPdfButton";
import { useSeo } from "../hooks/useSeo";

const LAST_UPDATED = "July 1, 2026";

export function Terms() {
  useSeo({
    title: "Terms of Service | Keating",
    description:
      "Terms of Service for Keating, the open-source hyperteacher and learning workspace at keating.help.",
    canonical: "https://keating.help/terms",
  });

  return (
    <div className="retro-layout retro-page legal-layout">
      <Nav />
      <main className="legal-page">
        <article className="wrap legal-doc paper-fold distressed-border">
          <div className="eyebrow prompt">cat TERMS_OF_SERVICE.txt</div>
          <h1>Terms of Service</h1>
          <p className="legal-updated">Last updated: {LAST_UPDATED}</p>
          <DownloadPdfButton label="Terms of Service" />

          <section>
            <h2>1. Agreement to these terms</h2>
            <p>
              These Terms of Service (the “Terms”) govern your access to and use of Keating — the
              website at keating.help, the browser app, the command-line interface, and the desktop
              app (together, the “Service”). By using any part of the Service you agree to these
              Terms. If you do not agree, do not use the Service. If you use the Service on behalf
              of an organization, you represent that you have authority to bind that organization,
              and “you” includes it.
            </p>
          </section>

          <section>
            <h2>2. What Keating is</h2>
            <p>
              Keating is an open-source teaching tool and learning workspace. It is local-first:
              most of your data lives in your own browser storage or on your own device, and the
              Service connects to AI providers, runtimes, and sync mechanisms that you configure.
              Parts of the Service are hosted (the website, shared-session publishing, downloads);
              parts run entirely on your hardware.
            </p>
          </section>

          <section>
            <h2>3. Eligibility</h2>
            <p>
              You must be old enough to form a binding contract in your jurisdiction, or use the
              Service under the supervision of a parent, guardian, or educational institution that
              accepts these Terms on your behalf. The hosted Service is not directed at children
              under 13 (or the higher minimum age your jurisdiction requires for services like this
              one).
            </p>
          </section>

          <section>
            <h2>4. Your account-free workspace, keys, and providers</h2>
            <p>
              Keating does not require a central account. Instead, you may configure third-party AI
              providers, local runtimes, proxies, and peer-to-peer sync. Those third parties have
              their own terms, pricing, data-handling rules, and rate limits, and your use of them
              through Keating is governed by those agreements, not these Terms.
            </p>
            <p>
              You are responsible for the API keys and credentials you enter. Keep them secure: do
              not paste keys into chat messages, shared sessions, exported artifacts, screenshots,
              or public issue reports. You are responsible for charges a provider bills against your
              keys, including charges resulting from requests Keating sends at your direction.
            </p>
          </section>

          <section>
            <h2>5. Your content</h2>
            <p>
              You retain all rights to the prompts, files, notes, study artifacts, quiz answers, and
              other material you create with or bring into Keating (“User Content”). We do not claim
              ownership of User Content. You are responsible for having the rights to the material
              you use, and for ensuring it does not violate law or the rights of others.
            </p>
            <p>
              When you use a hosted feature that transmits User Content — for example publishing a
              shared session — you grant us the limited license needed to store, transmit, and
              display that content for the purpose of operating the feature, and to anyone you share
              the link with, until the content is removed.
            </p>
          </section>

          <section>
            <h2>6. Shared sessions and public links</h2>
            <p>
              Share links are effectively public: anyone who obtains a link may be able to read the
              shared conversation or artifact, and copies may be cached by browsers, intermediaries,
              or recipients even after removal. Review content before sharing, and do not share
              material containing personal data, credentials, or anything you lack the right to
              publish. We may remove shared content that violates these Terms or applicable law.
            </p>
          </section>

          <section>
            <h2>7. Acceptable use</h2>
            <p>You agree not to use the Service to:</p>
            <ul>
              <li>violate any law or regulation, or infringe intellectual-property, privacy, or other rights;</li>
              <li>harm, harass, defraud, or deceive others, or generate content intended to do so;</li>
              <li>develop, distribute, or deploy malware, or bypass security or access controls of any system;</li>
              <li>probe, disrupt, or overload the hosted Service or third-party services reached through it, including evading provider rate limits or terms;</li>
              <li>misrepresent AI-generated output as human-authored where that matters (e.g., academic submissions governed by an integrity policy);</li>
              <li>scrape, resell, or white-label the hosted Service in a way that suggests it is your own offering.</li>
            </ul>
            <p>
              We may limit, suspend, or disable hosted features — including removing shared content
              — where use threatens reliability, safety, other users, or legal compliance.
            </p>
          </section>

          <section>
            <h2>8. Educational content, not professional advice</h2>
            <p>
              Keating supports study and reasoning. Output produced with Keating — including output
              from AI providers — may be inaccurate, incomplete, or outdated, and does not
              constitute legal, medical, financial, tax, or other professional advice. Verify
              important information with appropriate sources and qualified professionals before
              acting on it.
            </p>
          </section>

          <section>
            <h2>9. Open-source software and licenses</h2>
            <p>
              Keating’s source code is distributed under the license terms published in its public
              repository, which also carries notices for open-source dependencies. These Terms
              govern the hosted Service; the repository license governs the source code. If the two
              conflict with respect to source code, the repository license controls. Nothing in
              these Terms restricts rights granted to you by that license.
            </p>
          </section>

          <section>
            <h2>10. Fees</h2>
            <p>
              The hosted Service is currently provided without charge. Third-party providers you
              configure may charge you directly. If we introduce paid features, we will present
              their terms and pricing before you use them.
            </p>
          </section>

          <section>
            <h2>11. Privacy</h2>
            <p>
              Our <Link to="/privacy">Privacy Policy</Link> explains what data the Service stores
              locally, what is transmitted to providers and hosted components, and the choices you
              have. It is part of these Terms.
            </p>
          </section>

          <section>
            <h2>12. Disclaimer of warranties</h2>
            <p>
              THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE”, WITHOUT WARRANTIES OF ANY KIND,
              EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
              PURPOSE, NON-INFRINGEMENT, ACCURACY, OR UNINTERRUPTED AVAILABILITY. LOCAL-FIRST DATA
              LIVES IN YOUR BROWSER OR ON YOUR DEVICE; CLEARING BROWSER DATA, UNINSTALLING, OR
              DEVICE FAILURE MAY ERASE IT. KEEP YOUR OWN BACKUPS OF MATERIAL YOU CANNOT AFFORD TO
              LOSE.
            </p>
          </section>

          <section>
            <h2>13. Limitation of liability</h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE KEATING MAINTAINERS AND CONTRIBUTORS WILL
              NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR EXEMPLARY
              DAMAGES — INCLUDING LOST DATA, LOST PROFITS, OR PROVIDER CHARGES — ARISING FROM OR
              RELATED TO YOUR USE OF THE SERVICE. TO THE SAME EXTENT, AGGREGATE LIABILITY FOR ALL
              CLAIMS RELATING TO THE SERVICE IS LIMITED TO THE GREATER OF THE AMOUNT YOU PAID US FOR
              THE SERVICE IN THE TWELVE MONTHS BEFORE THE CLAIM AROSE OR FIFTY US DOLLARS. Some
              jurisdictions do not allow certain limitations, so parts of this section may not apply
              to you.
            </p>
          </section>

          <section>
            <h2>14. Indemnification</h2>
            <p>
              You will defend and hold harmless the Keating maintainers and contributors from claims
              and costs (including reasonable legal fees) arising from your User Content, your use
              of the Service in violation of these Terms, or your violation of law or third-party
              rights.
            </p>
          </section>

          <section>
            <h2>15. Termination</h2>
            <p>
              You may stop using the Service at any time; local data remains under your control. We
              may suspend or terminate access to hosted features at any time for conduct that
              violates these Terms or threatens the Service. Sections that by their nature should
              survive (including 5, 9, and 12–14) survive termination.
            </p>
          </section>

          <section>
            <h2>16. Changes to the Service and these Terms</h2>
            <p>
              The Service evolves: hosted pages, demos, downloads, experiments, and provider
              integrations may be updated, paused, or removed. We may revise these Terms; when we
              do, we will update the “Last updated” date above, and for material changes we will
              take reasonable steps to give notice (such as a notice on the site or in release
              notes). Continued use after changes take effect constitutes acceptance.
            </p>
          </section>

          <section>
            <h2>17. General</h2>
            <p>
              These Terms are the entire agreement between you and the Keating maintainers regarding
              the hosted Service. If any provision is found unenforceable, the remainder stays in
              effect. Failure to enforce a provision is not a waiver. You may not assign these Terms
              without consent; we may assign them in connection with a reorganization of the
              project.
            </p>
          </section>

          <section>
            <h2>18. Contact</h2>
            <p>
              For questions about these Terms, open an issue in the Keating repository or use the
              contact channel listed on the project site.
            </p>
          </section>
        </article>
      </main>
      <Footer />
    </div>
  );
}
