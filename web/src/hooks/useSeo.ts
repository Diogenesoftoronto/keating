import { useEffect } from "react";

interface SeoOptions {
  title: string;
  description: string;
  canonical?: string;
  standardSiteDocument?: string;
}

export function useSeo({ title, description, canonical, standardSiteDocument }: SeoOptions) {
  useEffect(() => {
    const originalTitle = document.title;
    document.title = title;

    let descMeta = document.querySelector('meta[name="description"]');
    const originalDesc = descMeta?.getAttribute("content") || "";
    if (!descMeta) {
      descMeta = document.createElement("meta");
      descMeta.setAttribute("name", "description");
      document.head.appendChild(descMeta);
    }
    descMeta.setAttribute("content", description);

    let ogTitle = document.querySelector('meta[property="og:title"]');
    const originalOgTitle = ogTitle?.getAttribute("content") || "";
    if (ogTitle) ogTitle.setAttribute("content", title);

    let ogDesc = document.querySelector('meta[property="og:description"]');
    const originalOgDesc = ogDesc?.getAttribute("content") || "";
    if (ogDesc) ogDesc.setAttribute("content", description);

    let twitterTitle = document.querySelector('meta[name="twitter:title"]');
    const originalTwitterTitle = twitterTitle?.getAttribute("content") || "";
    if (twitterTitle) twitterTitle.setAttribute("content", title);

    let twitterDesc = document.querySelector('meta[name="twitter:description"]');
    const originalTwitterDesc = twitterDesc?.getAttribute("content") || "";
    if (twitterDesc) twitterDesc.setAttribute("content", description);

    let canonicalLink = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      if (!canonicalLink) {
        canonicalLink = document.createElement("link");
        canonicalLink.setAttribute("rel", "canonical");
        document.head.appendChild(canonicalLink);
      }
      canonicalLink.setAttribute("href", canonical);
    }

    let standardSiteLink = document.querySelector('link[rel="site.standard.document"]');
    if (standardSiteDocument) {
      if (!standardSiteLink) {
        standardSiteLink = document.createElement("link");
        standardSiteLink.setAttribute("rel", "site.standard.document");
        document.head.appendChild(standardSiteLink);
      }
      standardSiteLink.setAttribute("href", standardSiteDocument);
    }

    return () => {
      document.title = originalTitle;
      if (descMeta) descMeta.setAttribute("content", originalDesc);
      if (ogTitle) ogTitle.setAttribute("content", originalOgTitle);
      if (ogDesc) ogDesc.setAttribute("content", originalOgDesc);
      if (twitterTitle) twitterTitle.setAttribute("content", originalTwitterTitle);
      if (twitterDesc) twitterDesc.setAttribute("content", originalTwitterDesc);
      if (canonicalLink) {
        const href = canonicalLink.getAttribute("href");
        if (href === canonical) canonicalLink.remove();
      }
			// Optional chaining alone is insufficient here: when both values are
			// undefined, the comparison is true and `null.remove()` would throw.
			if (
				standardSiteLink &&
				standardSiteDocument &&
				standardSiteLink.getAttribute("href") === standardSiteDocument
			) {
				standardSiteLink.remove();
			}
    };
  }, [title, description, canonical, standardSiteDocument]);
}
