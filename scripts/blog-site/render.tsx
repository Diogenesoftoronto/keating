import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { blueskyPostUrl, type AtprotoBlogFeed, type AtprotoBlogPost } from "../../web/src/keating/standard-site";

export const BLOG_ORIGIN = "https://blog.keating.help";
export const APP_ORIGIN = "https://keating.help";

export function documentUrl(feed: AtprotoBlogFeed, post: AtprotoBlogPost): string {
  return `${feed.publication.url.replace(/\/$/, "")}${post.path}`;
}

export function indexUrl(feed: AtprotoBlogFeed): string {
  return feed.publication.url === BLOG_ORIGIN ? `${BLOG_ORIGIN}/` : `${feed.publication.url}/blog`;
}

function date(value: string): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function Layout({ title, description, canonical, feed, post, children }: {
  title: string; description: string; canonical?: string; feed?: AtprotoBlogFeed; post?: AtprotoBlogPost; children: ReactNode;
}) {
  return <html lang="en"><head>
    <meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title><meta name="description" content={description} />
    {canonical && <link rel="canonical" href={canonical} />}
    {feed && <link rel="site.standard.publication" href={feed.publication.uri} />}
    {post && <link rel="site.standard.document" href={post.uri} />}
    <meta property="og:type" content={post ? "article" : "website"} />
    <meta property="og:title" content={title} /><meta property="og:description" content={description} />
    {canonical && <meta property="og:url" content={canonical} />}
    {post && <meta property="article:published_time" content={post.publishedAt} />}
    {post?.updatedAt && <meta property="article:modified_time" content={post.updatedAt} />}
    {post?.coverImageUrl && <meta property="og:image" content={post.coverImageUrl} />}
    <meta name="twitter:card" content={post?.coverImageUrl ? "summary_large_image" : "summary"} />
    <meta name="twitter:title" content={title} /><meta name="twitter:description" content={description} />
    {post?.coverImageUrl && <meta name="twitter:image" content={post.coverImageUrl} />}
    {!feed && <meta name="robots" content="noindex" />}
    <link rel="icon" href="/assets/mascot-head-v2.png" />
    <link rel="stylesheet" href="/assets/site.css" /><link rel="stylesheet" href="/assets/katex/katex.min.css" />
    <script src="/assets/site.js" defer />
  </head><body>
    <a className="skip" href="#main">Skip to content</a>
    <header className="site-header"><nav aria-label="Main navigation">
      <a className="brand" href={APP_ORIGIN}><img src="/assets/logo-lockup-compact.avif" alt="Keating" width="144" height="30" /></a>
      <div className="nav-links"><a href="/" aria-current="page">[BLOG]</a><a href="https://docs.keating.help">[DOCS]</a><a href="https://dev.keating.help">[DEVELOPERS]</a><a className="open-app" href={`${APP_ORIGIN}/chat`}>OPEN KEATING ↗</a>
        <button type="button" className="theme-toggle" aria-label="Switch color theme" hidden>◐</button>
      </div>
    </nav></header>
    <main id="main" tabIndex={-1}>{children}</main>
    <footer className="site-footer"><a href={APP_ORIGIN}>Keating</a><span>Carpe diem.</span><a href="https://github.com/Diogenesoftoronto/keating">GitHub ↗</a></footer>
  </body></html>;
}

function Tags({ tags }: { tags: string[] }) {
  return tags.length ? <div className="post-tags">{tags.map(tag => <span className="post-tag" key={tag}>{tag}</span>)}</div> : null;
}

export function renderIndex(feed: AtprotoBlogFeed, query = "", selectedTag = ""): string {
  const normalized = query.trim().toLowerCase();
  const posts = feed.posts.filter(post => (!selectedTag || post.tags.includes(selectedTag)) && (!normalized || [post.title, post.description, ...post.tags].join(" ").toLowerCase().includes(normalized)));
  const counts = new Map<string, number>();
  for (const post of feed.posts) for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const tags = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([tag]) => tag);
  const description = feed.publication.description ?? "Release notes, engineering essays, and field notes from a tutor built to make learning inspectable.";
  const tagUrl = (tag: string) => `/?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(tag ? { tag } : {}) })}`;
  return "<!doctype html>" + renderToStaticMarkup(<Layout title={`${feed.publication.name} · Keating`} description={description} canonical={indexUrl(feed)} feed={feed}>
    <div className="index"><header className="hero"><div className="hero-top"><div><h1>{feed.publication.name}</h1><p className="intro">{description}</p></div><span className="count">{feed.posts.length} {feed.posts.length === 1 ? "post" : "posts"}</span></div>
      <p className="protocol"><a href="https://standard.site" className="protocol-mark">▤ STANDARD.SITE</a><span>Published from {feed.source.repo}</span></p>
    </header>
    {feed.posts.length > 0 && <div className="filters"><form action="/" role="search"><label htmlFor="search">Search posts</label><div className="search-row"><input id="search" name="q" type="search" defaultValue={query} placeholder="Search titles, descriptions, and tags…" />{selectedTag && <input type="hidden" name="tag" value={selectedTag} />}<button type="submit">Search</button></div></form>
      <nav className="tags" aria-label="Filter by tag"><a className={`tag-filter ${!selectedTag ? "active" : ""}`} aria-current={!selectedTag ? "true" : undefined} href={tagUrl("")}>All posts</a>{tags.map(tag => <a className={`tag-filter ${selectedTag === tag ? "active" : ""}`} aria-current={selectedTag === tag ? "true" : undefined} href={tagUrl(tag)} key={tag}>{tag}</a>)}</nav>
    </div>}
    {posts.length ? <div className="post-list">{posts.map(post => <a className="post-link" href={post.path} key={post.uri}><time dateTime={post.publishedAt}>{date(post.publishedAt)}</time><div><h2>{post.title}</h2>{post.description && <p className="description">{post.description}</p>}<Tags tags={post.tags.slice(0, 4)} /></div><span className="arrow" aria-hidden="true">↗</span></a>)}</div>
      : <section className="state"><h2>{feed.posts.length ? "No matching posts" : "No posts published yet"}</h2><p>{feed.posts.length ? "Try a different search or choose another tag." : "New posts from this publication will appear here."}</p>{feed.posts.length > 0 && <a href="/">Show all posts</a>}</section>}
    </div>
  </Layout>);
}

// Posts can still reference assets and app pages on keating.help. Keep article
// links on this site, resolve content assets against their original app origin.
export function contentUrl(value: string, key: string, post: AtprotoBlogPost): string {
  const safe = defaultUrlTransform(value);
  if (!safe || safe.startsWith("#")) return safe;
  let url: URL;
  try { url = new URL(safe, `${APP_ORIGIN}${post.path}`); }
  catch { return ""; }
  if (key === "href" && [APP_ORIGIN, BLOG_ORIGIN].includes(url.origin) && /^\/blog(?:\/|$)/.test(url.pathname)) {
    return `${url.pathname}${url.search}${url.hash}`;
  }
  return url.toString();
}

export function renderPost(feed: AtprotoBlogFeed, post: AtprotoBlogPost): string {
  const discussion = blueskyPostUrl(post.bskyPostUri);
  return "<!doctype html>" + renderToStaticMarkup(<Layout title={`${post.title} · Keating`} description={post.description} canonical={documentUrl(feed, post)} feed={feed} post={post}>
    <div className="article-wrap"><a className="back" href="/">← All posts</a><header className="article-header">
      <div className="article-meta"><time dateTime={post.publishedAt}>{date(post.publishedAt)}</time><span aria-hidden="true">/</span><span className="protocol-mark">STANDARD.SITE</span>{post.updatedAt && <span>Updated {date(post.updatedAt)}</span>}</div>
      <h1>{post.title}</h1>{post.description && <p className="intro">{post.description}</p>}<Tags tags={post.tags} />
    </header>{post.coverImageUrl && <img className="cover" src={post.coverImageUrl} alt="" />}
    <article className="article"><div className="prose">{post.bodyFormat === "plaintext" ? <div className="plaintext">{post.body}</div> : <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} urlTransform={(url, key) => contentUrl(url, key, post)}>{post.body}</ReactMarkdown>}</div>
      <footer className="article-footer"><span className="record">Source: {post.uri}</span>{discussion && <a href={discussion} rel="noreferrer" className="discuss">Discuss on Bluesky ↗</a>}</footer>
    </article></div>
  </Layout>);
}

export function renderError(status: number): string {
  const missing = status === 404;
  const title = missing ? "Post not found" : "Posts are not available";
  return "<!doctype html>" + renderToStaticMarkup(<Layout title={`${title} · Keating`} description={title}><div className="article-wrap"><a className="back" href="/">← All posts</a><section className="state" role="alert"><h1>{title}</h1><p>{missing ? "This document is not present in Keating’s Standard.site publication." : "The blog source is unavailable. Please try again shortly."}</p>{!missing && <a href="" className="retry">Retry loading posts</a>}</section></div></Layout>);
}
