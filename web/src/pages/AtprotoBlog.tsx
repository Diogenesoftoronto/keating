import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, ArrowUpRight, BookOpen, RefreshCw, Search } from "lucide-react";
import { Nav } from "../components/Nav";
import { SimpleFooter } from "../components/Footer";
import { MarkdownBlock } from "../components/MarkdownBlock";
import { useSeo } from "../hooks/useSeo";
import { BlogApiError, clearBlogFeedCache, loadBlogFeed } from "../lib/blog-api";
import { blueskyPostUrl, type AtprotoBlogFeed, type AtprotoBlogPost } from "../keating/standard-site";
import { css, cx } from "../../styled-system/css";
import { paperCard } from "../../styled-system/recipes";

const styles = {
	page: cx("retro-layout", "retro-page"),
	main: css({ paddingInline: "1.25rem", paddingTop: "2rem", paddingBottom: "4rem", md: { paddingInline: "2rem" } }),
	index: css({ maxWidth: "68rem", marginInline: "auto" }),
	articleWrap: css({ maxWidth: "52rem", marginInline: "auto" }),
	hero: css({ marginBottom: "2rem", paddingBottom: "1.5rem", borderBottom: "1px solid var(--border)" }),
	heroTop: css({ display: "flex", flexDirection: "column", gap: "1.25rem", md: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" } }),
	title: css({ maxWidth: "42rem", fontSize: "2rem", lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.025em", md: { fontSize: "2.75rem" } }),
	intro: css({ marginTop: "0.75rem", maxWidth: "43rem", fontSize: "1rem", lineHeight: 1.65, color: "var(--muted-foreground)" }),
	protocol: cx("font-terminal", css({ marginTop: "1rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })),
	protocolMark: css({ display: "inline-flex", alignItems: "center", gap: "0.375rem", color: "#d5604b" }),
	count: cx("font-terminal", css({ flexShrink: 0, fontSize: "0.875rem", color: "var(--muted-foreground)" })),
	filters: css({ marginBottom: "1.5rem", display: "flex", flexDirection: "column", gap: "0.75rem" }),
	searchWrap: css({ position: "relative" }),
	searchIcon: css({ pointerEvents: "none", position: "absolute", top: "50%", left: "0.875rem", transform: "translateY(-50%)", color: "var(--muted-foreground)" }),
	search: css({ width: "100%", borderRadius: "0.375rem", border: "1px solid var(--border)", background: "var(--background)", paddingBlock: "0.75rem", paddingLeft: "2.75rem", paddingRight: "0.875rem", color: "var(--foreground)", outline: "none", _placeholder: { color: "var(--muted-foreground)" }, _focus: { borderColor: "var(--ring)", boxShadow: "0 0 0 2px color-mix(in srgb, var(--ring) 20%, transparent)" } }),
	tags: css({ display: "flex", flexWrap: "wrap", gap: "0.5rem" }),
	tagButton: css({ borderRadius: "9999px", border: "1px solid var(--border)", paddingInline: "0.75rem", paddingBlock: "0.375rem", fontSize: "0.75rem", transitionProperty: "background-color, color, border-color", transitionDuration: "150ms", _hover: { borderColor: "var(--primary)", color: "var(--primary)" } }),
	tagActive: css({ borderColor: "var(--primary)", background: "var(--primary)", color: "var(--primary-foreground)", _hover: { color: "var(--primary-foreground)" } }),
	postList: css({ borderTop: "1px solid var(--border)" }),
	postLink: css({ display: "grid", gridTemplateColumns: "1fr", gap: "1rem", paddingBlock: "1.5rem", borderBottom: "1px solid var(--border)", transitionProperty: "background-color", transitionDuration: "180ms", md: { gridTemplateColumns: "9rem minmax(0, 1fr) auto", alignItems: "start", gap: "1.5rem" }, _hover: { background: "color-mix(in srgb, var(--muted) 35%, transparent)" }, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } }),
	date: cx("font-terminal", css({ paddingTop: "0.125rem", fontSize: "0.75rem", color: "#d5604b" })),
	postTitle: css({ fontSize: "1.25rem", lineHeight: 1.3, fontWeight: 700, letterSpacing: "-0.015em" }),
	description: css({ marginTop: "0.5rem", maxWidth: "68ch", fontSize: "0.875rem", lineHeight: 1.6, color: "var(--muted-foreground)" }),
	postTags: css({ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.375rem" }),
	postTag: cx("font-terminal", css({ borderRadius: "0.25rem", background: "var(--muted)", paddingInline: "0.5rem", paddingBlock: "0.1875rem", fontSize: "0.6875rem", color: "var(--muted-foreground)" })),
	arrow: css({ marginTop: "0.125rem", color: "var(--muted-foreground)", transitionProperty: "color, transform", transitionDuration: "180ms", _groupHover: { color: "var(--primary)", transform: "translate(2px, -2px)" } }),
	state: cx(paperCard(), css({ padding: "2rem", textAlign: "center" })),
	stateTitle: css({ fontSize: "1.125rem", fontWeight: 700 }),
	stateText: css({ marginTop: "0.5rem", marginInline: "auto", maxWidth: "42rem", fontSize: "0.875rem", lineHeight: 1.6, color: "var(--muted-foreground)" }),
	retry: cx("font-terminal", css({ marginTop: "1rem", display: "inline-flex", alignItems: "center", gap: "0.5rem", borderRadius: "0.375rem", background: "var(--primary)", paddingInline: "1rem", paddingBlock: "0.625rem", fontSize: "0.75rem", color: "var(--primary-foreground)", _hover: { background: "color-mix(in srgb, var(--primary) 90%, black)" } })),
	skeleton: css({ height: "7.5rem", borderBottom: "1px solid var(--border)", background: "linear-gradient(90deg, transparent, color-mix(in srgb, var(--muted) 55%, transparent), transparent)", backgroundSize: "200% 100%", animation: "blogSkeleton 1.4s ease-in-out infinite" }),
	back: cx("font-terminal", css({ marginBottom: "1.25rem", display: "inline-flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)", _hover: { color: "var(--foreground)" } })),
	articleHeader: css({ marginBottom: "1.5rem" }),
	articleTitle: css({ marginTop: "0.75rem", fontSize: "2rem", lineHeight: 1.12, fontWeight: 700, letterSpacing: "-0.03em", md: { fontSize: "3rem" } }),
	articleDescription: css({ marginTop: "1rem", maxWidth: "65ch", fontSize: "1.05rem", lineHeight: 1.65, color: "var(--muted-foreground)" }),
	articleMeta: cx("font-terminal", css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })),
	cover: css({ marginBottom: "1.5rem", width: "100%", maxHeight: "28rem", objectFit: "cover", borderRadius: "0.5rem" }),
	article: cx(paperCard(), css({ padding: "1.5rem", md: { padding: "2.5rem" } })),
	body: css({ maxWidth: "72ch", marginInline: "auto", fontFamily: "serif", fontSize: "1.0625rem", lineHeight: 1.8, "& h1": { marginTop: "2rem", marginBottom: "1rem", fontFamily: "var(--font-ui)", fontSize: "1.875rem", lineHeight: 1.2, fontWeight: 700 }, "& h2": { marginTop: "2rem", marginBottom: "0.75rem", fontFamily: "var(--font-ui)", fontSize: "1.5rem", lineHeight: 1.25, fontWeight: 700 }, "& h3": { marginTop: "1.5rem", marginBottom: "0.5rem", fontFamily: "var(--font-ui)", fontSize: "1.2rem", lineHeight: 1.3, fontWeight: 700 }, "& blockquote": { marginBlock: "1.5rem", border: "1px solid var(--border)", background: "color-mix(in srgb, var(--muted) 30%, transparent)", padding: "1rem", fontStyle: "italic" }, "& a": { color: "#b84a3c", textDecoration: "underline", textUnderlineOffset: "3px" }, "& img": { marginBlock: "1.5rem", maxWidth: "100%", borderRadius: "0.375rem" } }),
	articleFooter: css({ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "0.75rem", sm: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" } }),
	record: cx("font-terminal", css({ minWidth: 0, overflowWrap: "anywhere", fontSize: "0.6875rem", color: "var(--muted-foreground)" })),
	discuss: cx("font-terminal", css({ display: "inline-flex", flexShrink: 0, alignItems: "center", gap: "0.375rem", fontSize: "0.75rem", color: "#d5604b", _hover: { textDecoration: "underline", textUnderlineOffset: "3px" } })),
};

function formatDate(value: string): string {
	return new Intl.DateTimeFormat("en-CA", {
		year: "numeric",
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	}).format(new Date(value));
}

function useAtprotoBlog() {
	const [feed, setFeed] = useState<AtprotoBlogFeed | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		let active = true;
		setError(null);
		loadBlogFeed({ force: attempt > 0 })
			.then((nextFeed) => {
				if (active) setFeed(nextFeed);
			})
			.catch((reason) => {
				if (!active) return;
				setError(reason instanceof BlogApiError ? reason.message : "The AT Protocol blog is unavailable.");
			});
		return () => {
			active = false;
		};
	}, [attempt]);

	const retry = () => {
		clearBlogFeedCache();
		setFeed(null);
		setAttempt((value) => value + 1);
	};
	return { feed, error, retry };
}

function BlogState({ error, onRetry }: { error?: string | null; onRetry?: () => void }) {
	if (!error) {
		return (
		<div aria-label="Loading posts" className={styles.postList}>
			{[0, 1, 2].map((value) => <div key={value} className={styles.skeleton} />)}
		</div>
		);
	}
	return (
		<div role="alert" className={styles.state}>
			<h2 className={styles.stateTitle}>Posts are not available</h2>
			<p className={styles.stateText}>{error}</p>
			{onRetry && (
				<button type="button" onClick={onRetry} className={styles.retry}>
					<RefreshCw size={14} /> Retry loading posts
				</button>
			)}
		</div>
	);
}

function visibleTags(posts: AtprotoBlogPost[]): string[] {
	const counts = new Map<string, number>();
	for (const post of posts) {
		for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
		.slice(0, 8)
		.map(([tag]) => tag);
}

export function AtprotoBlog() {
	useSeo({
		title: "Keating Blog",
		description: "Release notes, engineering essays, and teaching-system field notes from Keating.",
		canonical: "https://keating.help/blog",
	});
	const { feed, error, retry } = useAtprotoBlog();
	const [query, setQuery] = useState("");
	const [tag, setTag] = useState("all");
	const tags = useMemo(() => visibleTags(feed?.posts ?? []), [feed]);
	const posts = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		return (feed?.posts ?? []).filter((post) => {
			if (tag !== "all" && !post.tags.includes(tag)) return false;
			if (!normalized) return true;
			return [post.title, post.description, ...post.tags].join(" ").toLowerCase().includes(normalized);
		});
	}, [feed, query, tag]);

	return (
		<div className={styles.page}>
			<Nav />
			<main className={styles.main}>
				<div className={styles.index}>
					<header className={styles.hero}>
						<div className={styles.heroTop}>
							<div>
								<h1 className={styles.title}>{feed?.publication.name ?? "Keating Blog"}</h1>
								<p className={styles.intro}>{feed?.publication.description ?? "Release notes, engineering essays, and field notes from a tutor built to make learning inspectable."}</p>
							</div>
							{feed && <span className={styles.count}>{feed.posts.length} {feed.posts.length === 1 ? "post" : "posts"}</span>}
						</div>
						<div className={styles.protocol}>
							<span className={styles.protocolMark}><BookOpen size={14} /> STANDARD.SITE</span>
							<span>Published from {feed?.source.repo ?? "Keating's AT Protocol repository"}</span>
						</div>
					</header>

					{feed ? (
						<>
							<div className={styles.filters}>
								<label className={styles.searchWrap}>
									<span className={css({ srOnly: true })}>Search posts</span>
									<Search size={17} className={styles.searchIcon} />
									<input value={query} onChange={(event) => setQuery(event.target.value)} className={styles.search} placeholder="Search posts" />
								</label>
								{tags.length > 0 && (
									<div className={styles.tags} aria-label="Filter by tag">
										{["all", ...tags].map((value) => (
											<button key={value} type="button" aria-pressed={tag === value} onClick={() => setTag(value)} className={cx(styles.tagButton, tag === value && styles.tagActive)}>
												{value === "all" ? "All posts" : value}
											</button>
										))}
									</div>
								)}
							</div>

							{posts.length > 0 ? (
								<div className={styles.postList}>
									{posts.map((post) => (
										<Link key={post.uri} to="/blog/$slug" params={{ slug: post.slug }} className={cx("group", styles.postLink)}>
											<time dateTime={post.publishedAt} className={styles.date}>{formatDate(post.publishedAt)}</time>
											<div>
												<h2 className={styles.postTitle}>{post.title}</h2>
												{post.description && <p className={styles.description}>{post.description}</p>}
												{post.tags.length > 0 && <div className={styles.postTags}>{post.tags.slice(0, 4).map((value) => <span key={value} className={styles.postTag}>{value}</span>)}</div>}
											</div>
											<ArrowUpRight size={18} className={styles.arrow} aria-hidden="true" />
										</Link>
									))}
								</div>
							) : (
								<div className={styles.state}>
									<h2 className={styles.stateTitle}>No matching posts</h2>
									<p className={styles.stateText}>Try a different search or choose another tag.</p>
								</div>
							)}
						</>
					) : <BlogState error={error} onRetry={retry} />}
				</div>
			</main>
			<SimpleFooter />
		</div>
	);
}

export function AtprotoBlogPost() {
	const params = useParams({ strict: false }) as { slug?: string };
	const { feed, error, retry } = useAtprotoBlog();
	const post = feed?.posts.find((entry) => entry.slug === params.slug);
	useSeo({
		title: post ? `${post.title} · Keating` : "Keating Blog",
		description: post?.description ?? "A post from Keating's AT Protocol publication.",
		canonical: post ? `https://keating.help${post.path}` : undefined,
		standardSiteDocument: post?.uri,
	});
	const discussionUrl = blueskyPostUrl(post?.bskyPostUri);

	return (
		<div className={styles.page}>
			<Nav />
			<main className={styles.main}>
				<div className={styles.articleWrap}>
					<Link to="/blog" className={styles.back}><ArrowLeft size={14} /> All posts</Link>
					{!feed ? <BlogState error={error} onRetry={retry} /> : !post ? (
						<div className={styles.state} role="alert">
							<h1 className={styles.stateTitle}>Post not found</h1>
							<p className={styles.stateText}>This document is not present in Keating&apos;s Standard.site publication.</p>
						</div>
					) : (
						<>
							<header className={styles.articleHeader}>
								<div className={styles.articleMeta}>
									<time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
									<span aria-hidden="true">/</span>
									<span className={styles.protocolMark}>STANDARD.SITE</span>
									{post.updatedAt && <span>Updated {formatDate(post.updatedAt)}</span>}
								</div>
								<h1 className={styles.articleTitle}>{post.title}</h1>
								{post.description && <p className={styles.articleDescription}>{post.description}</p>}
								{post.tags.length > 0 && <div className={styles.postTags}>{post.tags.map((value) => <span key={value} className={styles.postTag}>{value}</span>)}</div>}
							</header>
							{post.coverImageUrl && <img src={post.coverImageUrl} alt="" className={styles.cover} />}
							<article className={styles.article}>
								<div className={styles.body}><MarkdownBlock content={post.body} /></div>
								<footer className={styles.articleFooter}>
									<span className={styles.record}>Source: {post.uri}</span>
									{discussionUrl && <a href={discussionUrl} target="_blank" rel="noreferrer" className={styles.discuss}>Discuss on Bluesky <ArrowUpRight size={13} /></a>}
								</footer>
							</article>
						</>
					)}
				</div>
			</main>
			<SimpleFooter />
		</div>
	);
}
