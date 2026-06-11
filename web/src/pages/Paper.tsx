import { Nav } from "../components/Nav";
import { SimpleFooter } from "../components/Footer";
import { useSeo } from "../hooks/useSeo";
import { Download, FileText } from "lucide-react";

export function Paper() {
  useSeo({
    title: "Keating Paper — A Metaharness for Agency-Preserving AI Instruction",
    description: "The Keating paper: a metaharness for teaching, a control layer that organizes planning, prompting, retrieval, transfer, verification, and evaluation around the live teaching exchange.",
    canonical: "https://keating.help/paper",
  });
  return (
    <div className="retro-layout retro-page">
      <Nav />

      <main className="pt-6 pb-16 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="paper-fold distressed-border p-8 mb-8">
            <h1 className="text-3xl md:text-4xl font-bold mb-4">
              Keating: A Metaharness for Agency-Preserving AI Instruction
            </h1>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="text-muted-foreground font-terminal">
                <span className="text-[#d5604b]">AUTHOR:</span> Dio the Debugger <br />
                <span className="text-[#d5604b] leading-7">DATE:</span> April 3, 2026
              </div>
              <a
                href="/keating-metaharness.pdf"
                download="keating-metaharness.pdf"
                className="inline-flex items-center justify-center gap-2 bg-[#d5604b] text-[#f1ece0] px-6 py-3 font-bold hover:bg-[#b33e33] transition-colors"
              >
                <Download size={20} />
                DOWNLOAD PDF
              </a>
            </div>
          </div>

          <article className="paper-fold distressed-border p-8 md:p-12 leading-relaxed">
            <div className="flex items-center gap-2 mb-8 text-muted-foreground font-terminal text-sm border-b border-border pb-4">
              <FileText size={16} />
              ABSTRACT
            </div>
            
            <p className="text-lg md:text-xl font-serif italic text-foreground/80 mb-8 leading-8">
              AI tutors can scale explanation, but scaling explanation is not the same as scaling
              learning. A tutoring system that answers fluently may still weaken the learner&apos;s
              own reconstruction of a concept.
            </p>

            <div className="space-y-8 text-foreground font-serif">
              <p className="text-lg leading-7">
                Keating is designed around that distinction. It is not a single tutoring chatbot;
                it is a metaharness for teaching, a control layer that organizes planning,
                prompting, retrieval, transfer, verification, and evaluation around the live
                teaching exchange.
              </p>

              <p className="text-lg leading-7">
                The live system now also records session cadence and topic revisit urgency through
                an engagement timeline derived from lesson logs and retention decay estimates,
                although that spaced-review mechanism is not separately evaluated in the present
                paper.
              </p>
              
              <p className="text-lg leading-7">
                We analyze two evidence layers: an archival trace set of 22 raw sessions curated
                to 16 topic x learner pairs, and a synthetic benchmark implemented directly in the
                repository. The archival set yields a normalized overall score of 0.61 (95%
                bootstrap interval 0.515-0.705), with strong topic heterogeneity: Special
                Relativity is highest at 0.75 and Stoicism lowest at 0.425.
              </p>

              <p className="text-lg leading-7">
                The synthetic layer shows that the current Keating policy, although evolved on
                Derivative alone, improves the full 14-topic harness by 6.703 points over the
                default policy across 200/200 seeds, with derivative-only evolution improving in
                29/30 reruns.
              </p>

              <p className="text-lg leading-7">
                The contribution of this paper is therefore twofold: a formal account of a
                teaching metaharness and a reproducible benchmark-and-analysis stack for studying
                agency-preserving instruction. The present evidence supports systems and
                methodology claims; a human randomized trial remains the necessary next step for
                causal pedagogical claims.
              </p>
            </div>

            <div className="mt-12 pt-8 border-t border-border">
              <p className="text-sm text-muted-foreground font-terminal uppercase tracking-widest text-center">
                &mdash; End of Abstract &mdash;
              </p>
            </div>
          </article>
        </div>
      </main>

      <SimpleFooter />
    </div>
  );
}
