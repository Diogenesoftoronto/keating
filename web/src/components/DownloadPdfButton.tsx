import { FileDown } from "lucide-react";

/**
 * "Download PDF" for legal pages: opens the browser print dialog, where
 * the document prints via the `@media print` rules in retro.css (nav,
 * footer, and chrome hidden; the legal article formatted for paper).
 * Every modern browser offers "Save as PDF" as a print destination, so
 * this stays dependency-free.
 */
export function DownloadPdfButton({ label }: { label: string }) {
	return (
		<button
			type="button"
			className="legal-download print-hidden"
			onClick={() => window.print()}
			aria-label={`Download ${label} as PDF`}
		>
			<FileDown size={14} aria-hidden="true" />
			Download PDF
		</button>
	);
}
