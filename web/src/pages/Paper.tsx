import { Nav } from "../components/Nav";
import { SimpleFooter } from "../components/Footer";
import { Download, FileText } from "lucide-react";
import { Pretext } from "../components/Pretext";

export function Paper() {
  return (
    <div className="retro-layout retro-page">
      <Nav />

      <main className="pt-28 pb-16 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="paper-fold distressed-border p-8 mb-8">
            <h1 className="text-3xl md:text-4xl font-bold mb-4">
              Keating: A Metaharness for Agency-Preserving AI Instruction
            </h1>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="text-[#64748b] font-terminal">
                <span className="text-[#d44a3d]">AUTHOR:</span> Dio the Debugger <br />
                <span className="text-[#d44a3d] leading-7">DATE:</span> April 3, 2026
              </div>
              <a
                href="/study.pdf"
                download
                className="inline-flex items-center justify-center gap-2 bg-[#d44a3d] text-[#f4f1ea] px-6 py-3 font-bold hover:bg-[#b33e33] transition-colors"
              >
                <Download size={20} />
                DOWNLOAD PDF
              </a>
            </div>
          </div>

          <article className="paper-fold distressed-border p-8 md:p-12 leading-relaxed">
            <div className="flex items-center gap-2 mb-8 text-[#64748b] font-terminal text-sm border-b border-[#64748b]/20 pb-4">
              <FileText size={16} />
              ABSTRACT
            </div>
            
            <div className="text-lg md:text-xl font-serif italic text-[#2c3e50] mb-8">
              <Pretext 
                text="AI tutors can scale explanation, but scaling explanation is not the same as scaling learning. A tutoring system that answers fluently may still weaken the learner's own reconstruction of a concept."
                font="italic 20px 'Georgia', serif"
                lineHeight={32}
              />
            </div>

            <div className="space-y-8 text-[#1a1a1a] font-serif">
              <Pretext 
                text="Keating is designed around that distinction. It is not a single tutoring chatbot; it is a metaharness for teaching, a control layer that organizes planning, prompting, retrieval, transfer, verification, and evaluation around the live teaching exchange."
                font="18px 'Georgia', serif"
                lineHeight={28}
              />

              <Pretext
                text="The live system now also records session cadence and topic revisit urgency through an engagement timeline derived from lesson logs and retention decay estimates, although that spaced-review mechanism is not separately evaluated in the present paper."
                font="18px 'Georgia', serif"
                lineHeight={28}
              />
              
              <Pretext 
                text="We analyze two evidence layers: an archival trace set of 22 raw sessions curated to 16 topic x learner pairs, and a synthetic benchmark implemented directly in the repository. The archival set yields a normalized overall score of 0.61 (95% bootstrap interval 0.515-0.705), with strong topic heterogeneity: Special Relativity is highest at 0.75 and Stoicism lowest at 0.425."
                font="18px 'Georgia', serif"
                lineHeight={28}
              />

              <Pretext 
                text="The synthetic layer shows that the current Keating policy, although evolved on Derivative alone, improves the full 14-topic harness by 6.703 points over the default policy across 200/200 seeds, with derivative-only evolution improving in 29/30 reruns."
                font="18px 'Georgia', serif"
                lineHeight={28}
              />

              <Pretext 
                text="The contribution of this paper is therefore twofold: a formal account of a teaching metaharness and a reproducible benchmark-and-analysis stack for studying agency-preserving instruction. The present evidence supports systems and methodology claims; a human randomized trial remains the necessary next step for causal pedagogical claims."
                font="18px 'Georgia', serif"
                lineHeight={28}
              />
            </div>

            <div className="mt-12 pt-8 border-t border-[#64748b]/20">
              <p className="text-sm text-[#64748b] font-terminal uppercase tracking-widest text-center">
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
