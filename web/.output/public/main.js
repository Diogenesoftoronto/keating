import React, { Suspense, use, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import ReactDOM from "react-dom/client";
import { Link, Outlet, RouterProvider, createHashHistory, createRootRoute, createRoute, createRouter, useNavigate } from "@tanstack/react-router";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { layoutWithLines, prepareWithSegments } from "@chenglou/pretext";
import { Download, FileText, Settings } from "lucide-react";
import { Agent } from "@mariozechner/pi-agent-core";
import { createAssistantMessageEventStream, getModel, getModels, getProviders, streamSimple } from "@mariozechner/pi-ai";
import { ApiKeyPromptDialog, AppStorage, CustomProvidersStore, IndexedDBStorageBackend, ProviderKeysStore, ProxyTab, SessionsStore, SettingsDialog, SettingsStore, SettingsTab, defaultConvertToLlm, getAppStorage, setAppStorage } from "@mariozechner/pi-web-ui";
import { i18n } from "@mariozechner/mini-lit";
import { Select } from "@mariozechner/mini-lit/dist/Select.js";
import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { DialogBase } from "@mariozechner/mini-lit/dist/DialogBase.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { Label } from "@mariozechner/mini-lit/dist/Label.js";
import { Ollama } from "ollama/browser";
import "@mariozechner/mini-lit/dist/ThemeToggle.js";
//#region src/components/Nav.tsx
function Nav({ showFeatures = false }) {
	const [mobileOpen, setMobileOpen] = useState(false);
	const navigate = useNavigate();
	return /* @__PURE__ */ jsx("nav", {
		className: "fixed top-0 left-0 right-0 z-50 bg-[#f4f1ea] border-b-2 border-[#1a1a1a]",
		children: /* @__PURE__ */ jsxs("div", {
			className: "max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between",
			children: [/* @__PURE__ */ jsxs(Link, {
				to: "/",
				className: "flex items-center gap-3",
				children: [
					/* @__PURE__ */ jsx("div", { className: "status-led" }),
					/* @__PURE__ */ jsx("span", {
						className: "text-lg sm:text-xl font-bold tracking-tight",
						children: "KEATING//"
					}),
					/* @__PURE__ */ jsx("span", {
						className: "font-terminal text-sm sm:text-lg text-[#d44a3d]",
						children: "v0.1.4"
					})
				]
			}), /* @__PURE__ */ jsxs("div", {
				className: "flex items-center gap-2 sm:gap-4 md:gap-6 lg:gap-8 font-terminal text-[10px] xs:text-xs sm:text-sm md:text-base lg:text-lg",
				children: [
					showFeatures && /* @__PURE__ */ jsx("a", {
						href: "#features",
						className: "hidden sm:block hover:text-[#d44a3d] transition-colors glitch-hover",
						children: "[FEATURES]"
					}),
					/* @__PURE__ */ jsx(Link, {
						to: "/tutorial",
						className: "hover:text-[#d44a3d] transition-colors glitch-hover",
						children: "[TUTORIAL]"
					}),
					/* @__PURE__ */ jsx(Link, {
						to: "/blog",
						className: "hover:text-[#d44a3d] transition-colors glitch-hover",
						children: "[BLOG]"
					}),
					/* @__PURE__ */ jsx(Link, {
						to: "/paper",
						className: "hover:text-[#d44a3d] transition-colors glitch-hover",
						children: "[PAPER]"
					}),
					/* @__PURE__ */ jsx("a", {
						href: "https://github.com/Diogenesoftoronto/keating",
						target: "_blank",
						rel: "noreferrer",
						className: "hidden md:block hover:text-[#d44a3d] transition-colors glitch-hover",
						children: "[GITHUB]"
					}),
					/* @__PURE__ */ jsx("button", {
						className: "btn-retro px-2 py-1 sm:px-4 sm:py-2 font-bold text-[10px] sm:text-sm min-h-[32px] sm:min-h-[44px]",
						onClick: () => navigate({ to: "/chat" }),
						children: "TRY_KEATING"
					})
				]
			})]
		})
	});
}
//#endregion
//#region src/components/Footer.tsx
function Footer() {
	return /* @__PURE__ */ jsx("footer", {
		className: "py-12 px-6 border-t-2 border-[#1a1a1a]",
		children: /* @__PURE__ */ jsxs("div", {
			className: "max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 font-terminal",
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "flex items-center gap-2 text-[#1a1a1a]/60",
					children: [/* @__PURE__ */ jsx("span", {
						className: "text-[#d44a3d]",
						children: "●"
					}), /* @__PURE__ */ jsx("span", { children: "KEATING_HYPERTEACHER" })]
				}),
				/* @__PURE__ */ jsx("p", {
					className: "text-sm text-[#1a1a1a]/60",
					children: "BUILT_ON_PI // MIT_LICENSE // 2025"
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "flex gap-6 text-[#1a1a1a]/60",
					children: [/* @__PURE__ */ jsx("a", {
						href: "https://github.com/Diogenesoftoronto/keating",
						className: "hover:text-[#d44a3d] transition-colors",
						children: "[GITHUB]"
					}), /* @__PURE__ */ jsx("a", {
						href: "https://keating.help",
						className: "hover:text-[#d44a3d] transition-colors",
						children: "[WEB]"
					})]
				})
			]
		})
	});
}
function SimpleFooter() {
	return /* @__PURE__ */ jsx("footer", {
		className: "py-8 px-6 border-t-2 border-[#1a1a1a]",
		children: /* @__PURE__ */ jsx("div", {
			className: "max-w-6xl mx-auto text-center font-terminal text-[#1a1a1a]/60",
			children: /* @__PURE__ */ jsx(Link, {
				to: "/",
				className: "hover:text-[#d44a3d] transition-colors",
				children: "[BACK_TO_HOME]"
			})
		})
	});
}
//#endregion
//#region src/components/BootSequence.tsx
var BOOT_LINES = [
	{
		text: "BIOS DATE 01/15/25 14:22:51 VER 0.1.3",
		delay: .1
	},
	{
		text: "CPU: NEURAL-CORE x64 @ 3.2GHz",
		delay: .3
	},
	{
		text: "MEMORY TEST: 16384K OK",
		delay: .5
	},
	{
		text: "",
		delay: .7
	},
	{
		text: "LOADING KEATING HYPERTEACHER MODULE...",
		delay: .9
	},
	{
		text: "INITIALIZING SOCRATIC PROTOCOLS... [OK]",
		delay: 1.2
	},
	{
		text: "MOUNTING KNOWLEDGE GRAPH... [OK]",
		delay: 1.5
	},
	{
		text: "CALIBRATING DIAGNOSTIC ENGINE... [OK]",
		delay: 1.8
	},
	{
		text: "",
		delay: 2.1
	},
	{
		text: "SYSTEM READY.",
		delay: 2.4
	}
];
function BootSequence() {
	const [visible, setVisible] = useState(false);
	const [fading, setFading] = useState(false);
	useEffect(() => {
		if (!(localStorage.getItem("keating_boot_shown") === "true")) {
			setVisible(true);
			const fadeTimer = setTimeout(() => setFading(true), 3e3);
			const hideTimer = setTimeout(() => {
				setVisible(false);
				localStorage.setItem("keating_boot_shown", "true");
			}, 3500);
			return () => {
				clearTimeout(fadeTimer);
				clearTimeout(hideTimer);
			};
		}
	}, []);
	if (!visible) return null;
	return /* @__PURE__ */ jsx("div", {
		className: "fixed inset-0 bg-[#0c0c0c] z-[60] font-terminal text-[#00ff00] p-8 overflow-hidden",
		style: {
			opacity: fading ? 0 : 1,
			transition: "opacity 0.5s"
		},
		children: /* @__PURE__ */ jsxs("div", {
			className: "crt max-w-2xl mx-auto mt-20 text-lg leading-relaxed",
			children: [BOOT_LINES.map((line, i) => /* @__PURE__ */ jsx("div", {
				className: "boot-line",
				style: { animationDelay: `${line.delay}s` },
				children: line.text
			}, i)), /* @__PURE__ */ jsx("div", {
				className: "boot-line cursor-blink",
				style: { animationDelay: "2.7s" },
				children: "_"
			})]
		})
	});
}
//#endregion
//#region src/components/Pretext.tsx
function Pretext({ text, font = "16px \"Inter\", sans-serif", lineHeight = 24, className = "", justify = true }) {
	const containerRef = useRef(null);
	const [width, setWidth] = useState(0);
	useEffect(() => {
		if (!containerRef.current) return;
		const updateWidth = () => {
			if (containerRef.current) setWidth(containerRef.current.clientWidth);
		};
		updateWidth();
		const observer = new ResizeObserver(updateWidth);
		observer.observe(containerRef.current);
		return () => observer.disconnect();
	}, []);
	const prepared = useMemo(() => prepareWithSegments(text, font), [text, font]);
	const { lines } = useMemo(() => {
		if (width <= 0 || !text.trim()) return { lines: [] };
		try {
			return layoutWithLines(prepared, width, lineHeight);
		} catch (e) {
			console.error("Pretext layout error:", e);
			return { lines: [] };
		}
	}, [
		prepared,
		width,
		lineHeight,
		text
	]);
	if (!text.trim() || lines.length === 0) return /* @__PURE__ */ jsx("div", {
		ref: containerRef,
		className,
		children: text
	});
	return /* @__PURE__ */ jsx("div", {
		ref: containerRef,
		className: `pretext-container ${className}`,
		style: {
			font,
			lineHeight: `${lineHeight}px`
		},
		children: lines.map((line, i) => {
			const isLastLine = i === lines.length - 1;
			const shouldJustify = justify && !isLastLine && lines.length > 1;
			return /* @__PURE__ */ jsxs("div", {
				className: "pretext-line",
				style: {
					height: lineHeight,
					textAlign: shouldJustify ? "justify" : "left",
					overflow: "hidden",
					whiteSpace: "nowrap",
					position: "relative"
				},
				children: [line.text, shouldJustify && /* @__PURE__ */ jsx("span", {
					style: {
						display: "inline-block",
						width: "100%"
					},
					"aria-hidden": "true"
				})]
			}, i);
		})
	});
}
//#endregion
//#region src/pages/Landing.tsx
var INSTALL_TABS = [
	{
		id: "npm",
		label: "[NPM]"
	},
	{
		id: "bun",
		label: "[BUN]"
	},
	{
		id: "pnpm",
		label: "[PNPM]"
	},
	{
		id: "curl",
		label: "[CURL]"
	},
	{
		id: "agent",
		label: "[AGENT]",
		isAgent: true
	}
];
var TAB_FILENAMES = {
	npm: "install.npm",
	bun: "install.bun",
	pnpm: "install.pnpm",
	curl: "install.curl",
	agent: "AGENT_INSTRUCTIONS.txt"
};
var TAB_COPY_TEXT = {
	npm: "$ npm install -g @interleavelove/keating\n# Requires Node.js 18+ and API key in ~/.keating/.env",
	bun: "$ bun add -g @interleavelove/keating\n# Fastest option. Requires Bun 1.0+ and API key",
	pnpm: "$ pnpm add -g @interleavelove/keating\n# Disk-efficient. Requires pnpm and API key",
	curl: "$ curl -fsSL https://raw.githubusercontent.com/Diogenesoftoronto/keating/main/scripts/install/install.sh | bash\n# Standalone install. No package manager needed.",
	agent: `Install Keating hyperteacher CLI with one of these methods. All require setting a Google API key for the AI backend.

Option 1: NPM (most common)
npm install -g @interleavelove/keating

Option 2: Bun (fastest)
bun add -g @interleavelove/keating

Option 3: PNPM (disk efficient)
pnpm add -g @interleavelove/keating

Option 4: Curl (standalone)
curl -fsSL https://raw.githubusercontent.com/Diogenesoftoronto/keating/main/scripts/install/install.sh | bash

Required: API Key Setup
1. Get a Gemini API key from Google AI Studio
2. Create ~/.keating/.env with: GOOGLE_API_KEY=your_key
3. Or set GOOGLE_API_KEY as environment variable`
};
function Landing() {
	const navigate = useNavigate();
	const [activeTab, setActiveTab] = useState("npm");
	const [copied, setCopied] = useState(false);
	function handleCopy() {
		navigator.clipboard.writeText(TAB_COPY_TEXT[activeTab]).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	}
	return /* @__PURE__ */ jsxs("div", {
		className: "retro-layout",
		children: [
			/* @__PURE__ */ jsx(BootSequence, {}),
			/* @__PURE__ */ jsx(Nav, { showFeatures: true }),
			/* @__PURE__ */ jsx("section", {
				className: "pt-20 sm:pt-24 pb-12 sm:pb-20 px-6",
				children: /* @__PURE__ */ jsxs("div", {
					className: "max-w-4xl mx-auto",
					children: [
						/* @__PURE__ */ jsx("div", {
							className: "coords mb-4",
							children: "42.3601° N, 71.0589° W // WELLESLEY, MA"
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "paper-fold distressed-border p-8 mb-8",
							children: [
								/* @__PURE__ */ jsxs("h1", {
									className: "text-4xl md:text-6xl font-bold mb-6 leading-none tracking-tight",
									children: [
										"THE HYPERTEACHER",
										/* @__PURE__ */ jsx("br", {}),
										/* @__PURE__ */ jsx("span", {
											className: "font-terminal text-[#d44a3d] text-5xl md:text-7xl",
											children: "THINK_FOR_YOURSELF"
										})
									]
								}),
								/* @__PURE__ */ jsx("div", {
									className: "max-w-2xl",
									children: /* @__PURE__ */ jsx(Pretext, {
										text: "Keating doesn't give answers. It forces you to reconstruct understanding from memory. No hand-holding. No spoon-feeding. Just the Socratic method powered by silicon.",
										font: "18px 'Inter', sans-serif",
										lineHeight: 28,
										className: "mb-6 opacity-90"
									})
								}),
								/* @__PURE__ */ jsx("div", {
									className: "stamp",
									children: "COGNITIVE EMPOWERMENT"
								})
							]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "terminal-window p-4 mb-8 terminal-glow",
							children: [/* @__PURE__ */ jsxs("div", {
								className: "flex items-center gap-2 mb-2 border-b border-[#00ff00]/30 pb-2",
								children: [
									/* @__PURE__ */ jsx("span", { className: "w-3 h-3 rounded-full bg-[#ff5f56]" }),
									/* @__PURE__ */ jsx("span", { className: "w-3 h-3 rounded-full bg-[#ffbd2e]" }),
									/* @__PURE__ */ jsx("span", { className: "w-3 h-3 rounded-full bg-[#27ca40]" }),
									/* @__PURE__ */ jsx("span", {
										className: "ml-4 text-sm opacity-60",
										children: "root@keating:~"
									})
								]
							}), /* @__PURE__ */ jsx("p", {
								className: "font-terminal text-xl md:text-2xl leading-relaxed typewriter",
								children: "\"That the powerful play goes on, and you may contribute a verse.\""
							})]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "flex flex-col sm:flex-row gap-4",
							children: [/* @__PURE__ */ jsx("button", {
								className: "btn-retro px-8 py-4 font-bold text-lg min-h-[56px]",
								onClick: () => navigate({ to: "/chat" }),
								children: "INITIALIZE_SESSION →"
							}), /* @__PURE__ */ jsx("a", {
								href: "#install",
								className: "btn-retro px-8 py-4 font-bold text-lg text-center min-h-[56px] flex items-center justify-center",
								children: "BUILD_FROM_SOURCE"
							})]
						})
					]
				})
			}),
			/* @__PURE__ */ jsx("section", {
				id: "features",
				className: "py-20 px-6 border-t-2 border-[#1a1a1a]",
				children: /* @__PURE__ */ jsxs("div", {
					className: "max-w-4xl mx-auto",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "flex items-center gap-4 mb-12",
						children: [/* @__PURE__ */ jsx("span", {
							className: "font-terminal text-[#d44a3d]",
							children: "$ cat MANIFESTO.txt"
						}), /* @__PURE__ */ jsx("div", { className: "flex-1 h-px bg-[#1a1a1a]/20" })]
					}), /* @__PURE__ */ jsx("div", {
						className: "grid md:grid-cols-2 gap-8 pt-3",
						children: [
							{
								n: "01",
								title: "DIAGNOSE",
								body: "Before teaching, Keating maps what you actually know. No wasted cycles on mastered concepts. Like a debugger for your knowledge graph."
							},
							{
								n: "02",
								title: "RECONSTRUCT",
								body: "You don't memorize—you rebuild. From memory, from first principles. Struggle is the feature, not the bug. That's how neural pathways form."
							},
							{
								n: "03",
								title: "TRANSFER",
								body: "Prove it in unfamiliar territory. Real understanding shows when you can apply knowledge in contexts you've never seen."
							},
							{
								n: "04",
								title: "PRESERVE",
								body: "Penalize rote echoing. Reward novel analogies. Your voice matters, not the AI's. If you parrot, Keating will know."
							}
						].map(({ n, title, body }) => /* @__PURE__ */ jsxs("div", {
							className: "paper-fold distressed-border p-6 tape",
							children: [/* @__PURE__ */ jsxs("div", {
								className: "font-terminal text-2xl text-[#d44a3d] mb-3",
								children: [
									"[",
									n,
									"] ",
									title
								]
							}), /* @__PURE__ */ jsx("div", {
								className: "text-sm",
								children: /* @__PURE__ */ jsx(Pretext, {
									text: body,
									font: "14px 'Inter', sans-serif",
									lineHeight: 20,
									justify: true
								})
							})]
						}, n))
					})]
				})
			}),
			/* @__PURE__ */ jsx("section", {
				className: "py-20 px-6 bg-[#1a1a1a] text-[#f4f1ea]",
				children: /* @__PURE__ */ jsxs("div", {
					className: "max-w-4xl mx-auto",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "flex items-center gap-4 mb-12",
						children: [/* @__PURE__ */ jsx("span", {
							className: "font-terminal text-[#d44a3d]",
							children: "$ ./keating --protocol"
						}), /* @__PURE__ */ jsx("div", { className: "flex-1 h-px bg-[#f4f1ea]/20" })]
					}), /* @__PURE__ */ jsx("div", {
						className: "space-y-6 font-terminal",
						children: [
							{
								n: "01",
								title: "INPUT_QUERY",
								body: "Ask anything. Math, philosophy, code, art. Keating doesn't lecture—it investigates."
							},
							{
								n: "02",
								title: "RUN_DIAGNOSTIC",
								body: "Instead of answering, Keating probes. What's solid? What's shaky? Where are the gaps?"
							},
							{
								n: "03",
								title: "FORCE_RECONSTRUCTION",
								body: "Guided questions. You rebuild the concept yourself. No shortcuts."
							},
							{
								n: "04",
								title: "TEST_TRANSFER",
								body: "Apply to new context. Can you actually use this knowledge, or did you just memorize?"
							}
						].map(({ n, title, body }) => /* @__PURE__ */ jsxs("div", {
							className: "flex gap-4 p-4 border border-[#f4f1ea]/20",
							children: [/* @__PURE__ */ jsx("div", {
								className: "text-[#d44a3d] text-2xl",
								children: n
							}), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
								className: "text-lg text-[#00ff00]",
								children: title
							}), /* @__PURE__ */ jsx("div", {
								className: "text-sm text-[#f4f1ea]/60",
								children: body
							})] })]
						}, n))
					})]
				})
			}),
			/* @__PURE__ */ jsx("section", {
				id: "install",
				className: "py-20 px-6 border-t-2 border-[#1a1a1a]",
				children: /* @__PURE__ */ jsxs("div", {
					className: "max-w-4xl mx-auto",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "flex items-center gap-4 mb-8",
							children: [/* @__PURE__ */ jsx("span", {
								className: "font-terminal text-[#d44a3d]",
								children: "$ ./install.sh"
							}), /* @__PURE__ */ jsx("div", { className: "flex-1 h-px bg-[#1a1a1a]/20" })]
						}),
						/* @__PURE__ */ jsx("div", {
							className: "flex gap-2 mb-4 font-terminal flex-wrap",
							children: INSTALL_TABS.map((tab) => {
								const isActive = activeTab === tab.id;
								const isAgent = tab.isAgent;
								return /* @__PURE__ */ jsx("button", {
									className: [
										"install-tab px-3 py-3 md:px-4 md:py-2 border-2 min-h-[44px] text-sm md:text-base transition",
										isAgent ? isActive ? "border-[#d44a3d] bg-[#d44a3d] text-[#f4f1ea]" : "border-[#d44a3d] text-[#d44a3d] hover:bg-[#d44a3d] hover:text-[#f4f1ea]" : isActive ? "border-[#1a1a1a] bg-[#1a1a1a] text-[#f4f1ea]" : "border-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-[#f4f1ea]",
										isActive ? "active" : ""
									].filter(Boolean).join(" "),
									onClick: () => setActiveTab(tab.id),
									children: tab.label
								}, tab.id);
							})
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "terminal-window p-4 terminal-glow mb-6 overflow-x-auto",
							children: [
								/* @__PURE__ */ jsxs("div", {
									className: "flex items-center justify-between gap-2 mb-2 border-b border-[#00ff00]/30 pb-2 min-w-0",
									children: [/* @__PURE__ */ jsxs("div", {
										className: "flex items-center gap-2 min-w-0",
										children: [
											/* @__PURE__ */ jsx("span", { className: "w-3 h-3 rounded-full bg-[#ff5f56] shrink-0" }),
											/* @__PURE__ */ jsx("span", { className: "w-3 h-3 rounded-full bg-[#ffbd2e] shrink-0" }),
											/* @__PURE__ */ jsx("span", { className: "w-3 h-3 rounded-full bg-[#27ca40] shrink-0" }),
											/* @__PURE__ */ jsx("span", {
												className: "ml-2 text-sm opacity-60 truncate",
												children: TAB_FILENAMES[activeTab]
											})
										]
									}), /* @__PURE__ */ jsx("button", {
										className: `copy-btn shrink-0 ml-4 px-3 py-1 border border-[#00ff00]/50 text-[#00ff00] font-terminal text-sm transition ${copied ? "bg-[#00ff00]/30" : ""}`,
										onClick: handleCopy,
										children: copied ? "[COPIED!]" : "[COPY]"
									})]
								}),
								activeTab === "npm" && /* @__PURE__ */ jsxs("code", {
									className: "font-terminal text-base sm:text-lg block whitespace-pre-wrap break-all",
									children: [
										/* @__PURE__ */ jsx("span", {
											className: "text-[#00ff00]",
											children: "$"
										}),
										" ",
										"npm install -g @interleavelove/keating",
										"\n",
										/* @__PURE__ */ jsx("span", {
											className: "text-[#888]",
											children: "# Requires Node.js 18+ and API key in ~/.keating/.env"
										})
									]
								}),
								activeTab === "bun" && /* @__PURE__ */ jsxs("code", {
									className: "font-terminal text-base sm:text-lg block whitespace-pre-wrap break-all",
									children: [
										/* @__PURE__ */ jsx("span", {
											className: "text-[#00ff00]",
											children: "$"
										}),
										" ",
										"bun add -g @interleavelove/keating",
										"\n",
										/* @__PURE__ */ jsx("span", {
											className: "text-[#888]",
											children: "# Fastest option. Requires Bun 1.0+ and API key"
										})
									]
								}),
								activeTab === "pnpm" && /* @__PURE__ */ jsxs("code", {
									className: "font-terminal text-base sm:text-lg block whitespace-pre-wrap break-all",
									children: [
										/* @__PURE__ */ jsx("span", {
											className: "text-[#00ff00]",
											children: "$"
										}),
										" ",
										"pnpm add -g @interleavelove/keating",
										"\n",
										/* @__PURE__ */ jsx("span", {
											className: "text-[#888]",
											children: "# Disk-efficient. Requires pnpm and API key"
										})
									]
								}),
								activeTab === "curl" && /* @__PURE__ */ jsxs("code", {
									className: "font-terminal text-base sm:text-lg block whitespace-pre-wrap break-all",
									children: [
										/* @__PURE__ */ jsx("span", {
											className: "text-[#00ff00]",
											children: "$"
										}),
										" ",
										"curl -fsSL https://raw.githubusercontent.com/Diogenesoftoronto/keating/main/scripts/install/install.sh ",
										/* @__PURE__ */ jsx("span", {
											className: "text-[#00ff00]",
											children: "|"
										}),
										" bash",
										"\n",
										/* @__PURE__ */ jsx("span", {
											className: "text-[#888]",
											children: "# Standalone install. No package manager needed."
										})
									]
								}),
								activeTab === "agent" && /* @__PURE__ */ jsxs("div", {
									className: "font-terminal text-base leading-relaxed break-words",
									children: [
										/* @__PURE__ */ jsx("p", {
											className: "text-[#00ff00] mb-2",
											children: "$ cat AGENT_INSTRUCTIONS.txt"
										}),
										/* @__PURE__ */ jsx("p", {
											className: "text-[#f4f1ea] mb-4",
											children: "Install Keating hyperteacher CLI with one of these methods. All require setting a Google API key for the AI backend."
										}),
										/* @__PURE__ */ jsx("p", {
											className: "text-[#d44a3d] mb-1",
											children: "Option 1: NPM (most common)"
										}),
										/* @__PURE__ */ jsx("p", {
											className: "text-[#f4f1ea]/80 mb-3 ml-4",
											children: "npm install -g @interleavelove/keating"
										}),
										/* @__PURE__ */ jsx("p", {
											className: "text-[#d44a3d] mb-1",
											children: "Option 2: Bun (fastest)"
										}),
										/* @__PURE__ */ jsx("p", {
											className: "text-[#f4f1ea]/80 mb-3 ml-4",
											children: "bun add -g @interleavelove/keating"
										}),
										/* @__PURE__ */ jsx("p", {
											className: "text-[#d44a3d] mb-1",
											children: "Option 3: PNPM (disk efficient)"
										}),
										/* @__PURE__ */ jsx("p", {
											className: "text-[#f4f1ea]/80 mb-3 ml-4",
											children: "pnpm add -g @interleavelove/keating"
										}),
										/* @__PURE__ */ jsx("p", {
											className: "text-[#d44a3d] mb-1",
											children: "Option 4: Curl (standalone)"
										}),
										/* @__PURE__ */ jsx("p", {
											className: "text-[#f4f1ea]/80 mb-3 ml-4",
											children: "curl -fsSL .../install.sh | bash"
										}),
										/* @__PURE__ */ jsx("p", {
											className: "text-[#00ff00] mb-1",
											children: "Required: API Key Setup"
										}),
										/* @__PURE__ */ jsx("p", {
											className: "text-[#f4f1ea]/80 mb-1 ml-4",
											children: "1. Get a Gemini API key from Google AI Studio"
										}),
										/* @__PURE__ */ jsx("p", {
											className: "text-[#f4f1ea]/80 mb-1 ml-4",
											children: "2. Create ~/.keating/.env with: GOOGLE_API_KEY=your_key"
										}),
										/* @__PURE__ */ jsx("p", {
											className: "text-[#f4f1ea]/80 ml-4",
											children: "3. Or set GOOGLE_API_KEY as environment variable"
										})
									]
								})
							]
						}),
						/* @__PURE__ */ jsx("div", {
							className: "marquee border-y-2 border-[#1a1a1a] py-2 bg-[#1a1a1a] text-[#f4f1ea]",
							children: /* @__PURE__ */ jsx("span", {
								className: "font-terminal",
								children: "*** AVAILABLE FOR macOS AND LINUX *** YOUR API KEYS STAY LOCAL *** NO CLOUD DEPENDENCY *** FREE AND OPEN SOURCE ***"
							})
						})
					]
				})
			}),
			/* @__PURE__ */ jsx(Footer, {})
		]
	});
}
//#endregion
//#region src/pages/Tutorial.tsx
var TABS = [
	{
		id: "browser",
		label: "[BROWSER]"
	},
	{
		id: "ollama",
		label: "[OLLAMA]"
	},
	{
		id: "llamacpp",
		label: "[LLAMA.CPP]"
	},
	{
		id: "litellm",
		label: "[LITELLM]"
	},
	{
		id: "cloud",
		label: "[CLOUD]"
	}
];
function Tutorial() {
	const [activeTab, setActiveTab] = useState("browser");
	return /* @__PURE__ */ jsxs("div", {
		className: "retro-layout",
		children: [
			/* @__PURE__ */ jsx(Nav, {}),
			/* @__PURE__ */ jsx("main", {
				className: "pt-28 pb-16 px-6",
				children: /* @__PURE__ */ jsxs("div", {
					className: "max-w-4xl mx-auto",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "paper-fold distressed-border p-8 mb-8",
							children: [/* @__PURE__ */ jsx("h1", {
								className: "text-3xl md:text-4xl font-bold mb-2",
								children: "Model Setup Guide"
							}), /* @__PURE__ */ jsx("p", {
								className: "text-[#64748b] font-terminal",
								children: "Choose how Keating runs AI models"
							})]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "grid md:grid-cols-2 gap-6 mb-8",
							children: [/* @__PURE__ */ jsxs("div", {
								className: "paper-fold distressed-border p-6 border-l-4 border-l-[#10b981]",
								children: [
									/* @__PURE__ */ jsxs("h2", {
										className: "text-xl font-bold mb-2 flex items-center gap-2",
										children: [/* @__PURE__ */ jsx("span", {
											className: "text-[#10b981]",
											children: "BROWSER"
										}), /* @__PURE__ */ jsx("span", {
											className: "text-xs bg-[#10b981]/10 text-[#10b981] px-2 py-1 rounded",
											children: "ZERO SETUP"
										})]
									}),
									/* @__PURE__ */ jsx("p", {
										className: "text-sm mb-3",
										children: "Runs entirely in your browser using WebGPU. No installation, no API keys, no server. Just open and chat."
									}),
									/* @__PURE__ */ jsxs("ul", {
										className: "text-sm space-y-1 text-[#64748b]",
										children: [
											/* @__PURE__ */ jsx("li", { children: "- Uses Transformers.js + ONNX models" }),
											/* @__PURE__ */ jsx("li", { children: "- Model cached in browser (~5GB)" }),
											/* @__PURE__ */ jsx("li", { children: "- Works offline after first load" }),
											/* @__PURE__ */ jsx("li", { children: "- Privacy: data never leaves device" })
										]
									})
								]
							}), /* @__PURE__ */ jsxs("div", {
								className: "paper-fold distressed-border p-6 border-l-4 border-l-[#6366f1]",
								children: [
									/* @__PURE__ */ jsxs("h2", {
										className: "text-xl font-bold mb-2 flex items-center gap-2",
										children: [/* @__PURE__ */ jsx("span", {
											className: "text-[#6366f1]",
											children: "LOCAL"
										}), /* @__PURE__ */ jsx("span", {
											className: "text-xs bg-[#6366f1]/10 text-[#6366f1] px-2 py-1 rounded",
											children: "REQUIRES SETUP"
										})]
									}),
									/* @__PURE__ */ jsx("p", {
										className: "text-sm mb-3",
										children: "Run any model locally with Ollama, llama.cpp, LiteLLM, or llmfit. More model choices, better performance."
									}),
									/* @__PURE__ */ jsxs("ul", {
										className: "text-sm space-y-1 text-[#64748b]",
										children: [
											/* @__PURE__ */ jsx("li", { children: "- Use any GGUF model" }),
											/* @__PURE__ */ jsx("li", { children: "- GPU acceleration (CUDA/Metal)" }),
											/* @__PURE__ */ jsx("li", { children: "- No internet required" }),
											/* @__PURE__ */ jsx("li", { children: "- Set endpoint in settings" })
										]
									})
								]
							})]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "paper-fold distressed-border overflow-hidden",
							children: [
								/* @__PURE__ */ jsx("div", {
									className: "flex border-b-2 border-[#1a1a1a] overflow-x-auto",
									children: TABS.map((tab) => /* @__PURE__ */ jsx("button", {
										className: `tab-btn font-terminal px-6 py-3 border-r-2 border-[#1a1a1a] whitespace-nowrap ${activeTab === tab.id ? "active" : ""}`,
										onClick: () => setActiveTab(tab.id),
										children: tab.label
									}, tab.id))
								}),
								activeTab === "browser" && /* @__PURE__ */ jsxs("div", {
									className: "p-6",
									children: [
										/* @__PURE__ */ jsx("h3", {
											className: "text-xl font-bold mb-4",
											children: "Browser WebGPU (Zero Setup)"
										}),
										/* @__PURE__ */ jsx("p", {
											className: "mb-4",
											children: "The simplest option — just use Keating in a supported browser. No installation required."
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "terminal-window p-4 mb-4 text-sm overflow-x-auto",
											children: [
												/* @__PURE__ */ jsx("p", {
													className: "text-[#00ff00] mb-2",
													children: "# Requirements:"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "ml-4 break-words",
													children: "Chrome 113+ / Edge 113+ / Firefox Nightly (WebGPU flag)"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "ml-4",
													children: "GPU with WebGPU support (most modern GPUs)"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "ml-4",
													children: "~5GB free disk space for model cache"
												})
											]
										}),
										/* @__PURE__ */ jsx("div", {
											className: "space-y-4",
											children: [
												"Open Keating web app in Chrome or Edge",
												"Select \"Gemma 4 E4B (Browser)\" as model",
												"Wait for model to download and cache (~5GB, one-time)",
												"Chat! Works offline for future sessions"
											].map((step, i) => /* @__PURE__ */ jsxs("div", {
												className: "flex gap-3",
												children: [/* @__PURE__ */ jsxs("span", {
													className: "font-terminal text-[#d44a3d] shrink-0",
													children: [
														"0",
														i + 1,
														"."
													]
												}), /* @__PURE__ */ jsx("span", { children: step })]
											}, i))
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "mt-6 p-4 bg-[#10b981]/10 border-l-4 border-[#10b981]",
											children: [/* @__PURE__ */ jsx("p", {
												className: "font-terminal text-[#10b981]",
												children: "NO_API_KEY_REQUIRED"
											}), /* @__PURE__ */ jsx("p", {
												className: "text-sm mt-1",
												children: "Your conversations never leave your device. Completely private."
											})]
										})
									]
								}),
								activeTab === "ollama" && /* @__PURE__ */ jsxs("div", {
									className: "p-6",
									children: [
										/* @__PURE__ */ jsx("h3", {
											className: "text-xl font-bold mb-4",
											children: "Ollama"
										}),
										/* @__PURE__ */ jsx("p", {
											className: "mb-4",
											children: "Popular local LLM runner with excellent GPU support. Works with any GGUF model."
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "terminal-window p-4 mb-4 text-sm overflow-x-auto",
											children: [
												/* @__PURE__ */ jsx("p", {
													className: "text-[#00ff00] mb-2",
													children: "# Install Ollama:"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-[#f4f1ea] break-all",
													children: "curl -fsSL https://ollama.com/install.sh | sh"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-[#00ff00] mt-3 mb-2",
													children: "# Pull a model:"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-[#f4f1ea]",
													children: "ollama pull gemma3:4b"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-[#00ff00] mt-3 mb-2",
													children: "# Start server (runs on port 11434):"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-[#f4f1ea]",
													children: "ollama serve"
												})
											]
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "space-y-4",
											children: [
												/* @__PURE__ */ jsxs("div", {
													className: "flex gap-3",
													children: [/* @__PURE__ */ jsx("span", {
														className: "font-terminal text-[#d44a3d] shrink-0",
														children: "01."
													}), /* @__PURE__ */ jsxs("span", { children: [
														"Install Ollama from",
														" ",
														/* @__PURE__ */ jsx("a", {
															href: "https://ollama.com",
															target: "_blank",
															rel: "noreferrer",
															className: "text-[#6366f1] underline",
															children: "ollama.com"
														})
													] })]
												}),
												/* @__PURE__ */ jsxs("div", {
													className: "flex gap-3",
													children: [/* @__PURE__ */ jsx("span", {
														className: "font-terminal text-[#d44a3d] shrink-0",
														children: "02."
													}), /* @__PURE__ */ jsxs("span", { children: [
														"Pull your preferred model:",
														" ",
														/* @__PURE__ */ jsx("code", {
															className: "bg-[#1a1a1a] text-[#00ff00] px-1",
															children: "ollama pull gemma3:4b"
														})
													] })]
												}),
												/* @__PURE__ */ jsxs("div", {
													className: "flex gap-3",
													children: [/* @__PURE__ */ jsx("span", {
														className: "font-terminal text-[#d44a3d] shrink-0",
														children: "03."
													}), /* @__PURE__ */ jsx("span", { children: "In Keating settings, add custom provider:" })]
												})
											]
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "mt-4 ml-8 terminal-window p-4 text-sm overflow-x-auto",
											children: [
												/* @__PURE__ */ jsx("p", {
													className: "text-[#00ff00]",
													children: "Provider: ollama"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-[#00ff00]",
													children: "Base URL: http://localhost:11434"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-[#00ff00]",
													children: "Model: gemma3:4b (or your model name)"
												})
											]
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "mt-6 p-4 bg-[#6366f1]/10 border-l-4 border-[#6366f1]",
											children: [/* @__PURE__ */ jsx("p", {
												className: "font-terminal text-[#6366f1]",
												children: "GPU_ACCELERATION"
											}), /* @__PURE__ */ jsx("p", {
												className: "text-sm mt-1",
												children: "Ollama auto-detects CUDA (NVIDIA) and Metal (macOS). No API key needed for local."
											})]
										})
									]
								}),
								activeTab === "llamacpp" && /* @__PURE__ */ jsxs("div", {
									className: "p-6",
									children: [
										/* @__PURE__ */ jsx("h3", {
											className: "text-xl font-bold mb-4",
											children: "llama.cpp"
										}),
										/* @__PURE__ */ jsx("p", {
											className: "mb-4",
											children: "Lightweight C++ inference. Maximum control and performance. Runs any GGUF model."
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "terminal-window p-4 mb-4 text-sm overflow-x-auto",
											children: [
												/* @__PURE__ */ jsx("p", {
													className: "text-[#00ff00] mb-2",
													children: "# Clone and build:"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-[#f4f1ea]",
													children: "git clone https://github.com/ggerganov/llama.cpp"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-[#f4f1ea]",
													children: "cd llama.cpp && make"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-[#00ff00] mt-3 mb-2",
													children: "# Download a GGUF model:"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-[#f4f1ea] break-all",
													children: "wget https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-UD-Q4_K_XL.gguf"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-[#00ff00] mt-3 mb-2",
													children: "# Run server:"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-[#f4f1ea]",
													children: "./llama-server -m gemma-4-E4B-it-UD-Q4_K_XL.gguf --port 8080"
												})
											]
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "space-y-4",
											children: [
												/* @__PURE__ */ jsxs("div", {
													className: "flex gap-3",
													children: [/* @__PURE__ */ jsx("span", {
														className: "font-terminal text-[#d44a3d] shrink-0",
														children: "01."
													}), /* @__PURE__ */ jsxs("span", { children: [
														"Build llama.cpp from",
														" ",
														/* @__PURE__ */ jsx("a", {
															href: "https://github.com/ggerganov/llama.cpp",
															target: "_blank",
															rel: "noreferrer",
															className: "text-[#6366f1] underline",
															children: "GitHub"
														})
													] })]
												}),
												/* @__PURE__ */ jsxs("div", {
													className: "flex gap-3",
													children: [/* @__PURE__ */ jsx("span", {
														className: "font-terminal text-[#d44a3d] shrink-0",
														children: "02."
													}), /* @__PURE__ */ jsx("span", { children: "Download a GGUF model from HuggingFace" })]
												}),
												/* @__PURE__ */ jsxs("div", {
													className: "flex gap-3",
													children: [/* @__PURE__ */ jsx("span", {
														className: "font-terminal text-[#d44a3d] shrink-0",
														children: "03."
													}), /* @__PURE__ */ jsx("span", { children: "Start the server with your model" })]
												}),
												/* @__PURE__ */ jsxs("div", {
													className: "flex gap-3",
													children: [/* @__PURE__ */ jsx("span", {
														className: "font-terminal text-[#d44a3d] shrink-0",
														children: "04."
													}), /* @__PURE__ */ jsxs("span", { children: [
														"In Keating settings, add custom provider pointing to",
														" ",
														/* @__PURE__ */ jsx("code", {
															className: "bg-[#1a1a1a] text-[#00ff00] px-1",
															children: "http://localhost:8080"
														})
													] })]
												})
											]
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "mt-6 p-4 bg-[#d97706]/10 border-l-4 border-[#d97706]",
											children: [/* @__PURE__ */ jsx("p", {
												className: "font-terminal text-[#d97706]",
												children: "TIP"
											}), /* @__PURE__ */ jsxs("p", {
												className: "text-sm mt-1",
												children: [
													"Use",
													" ",
													/* @__PURE__ */ jsx("code", {
														className: "bg-[#1a1a1a] text-[#00ff00] px-1",
														children: "-ngl 99"
													}),
													" to offload all layers to GPU. Use",
													" ",
													/* @__PURE__ */ jsx("code", {
														className: "bg-[#1a1a1a] text-[#00ff00] px-1",
														children: "-c 8192"
													}),
													" for larger context."
												]
											})]
										})
									]
								}),
								activeTab === "litellm" && /* @__PURE__ */ jsxs("div", {
									className: "p-6",
									children: [
										/* @__PURE__ */ jsx("h3", {
											className: "text-xl font-bold mb-4",
											children: "LiteLLM"
										}),
										/* @__PURE__ */ jsx("p", {
											className: "mb-4",
											children: "Unified API proxy that works with 100+ LLM providers. Exposes an OpenAI-compatible endpoint."
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "terminal-window p-4 mb-4 text-sm overflow-x-auto",
											children: [
												/* @__PURE__ */ jsx("p", {
													className: "text-[#00ff00] mb-2",
													children: "# Install:"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-[#f4f1ea]",
													children: "pip install litellm"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-[#00ff00] mt-3 mb-2",
													children: "# Run with a local model:"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-[#f4f1ea]",
													children: "litellm --model ollama/gemma3:4b"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-[#00ff00] mt-3 mb-2",
													children: "# Or with API keys (env vars):"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-[#f4f1ea]",
													children: "export OPENAI_API_KEY=sk-..."
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-[#f4f1ea]",
													children: "export ANTHROPIC_API_KEY=sk-ant-..."
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-[#f4f1ea]",
													children: "litellm --port 4000"
												})
											]
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "space-y-4",
											children: [
												/* @__PURE__ */ jsxs("div", {
													className: "flex gap-3",
													children: [/* @__PURE__ */ jsx("span", {
														className: "font-terminal text-[#d44a3d] shrink-0",
														children: "01."
													}), /* @__PURE__ */ jsxs("span", { children: [
														"Install:",
														" ",
														/* @__PURE__ */ jsx("code", {
															className: "bg-[#1a1a1a] text-[#00ff00] px-1",
															children: "pip install litellm"
														})
													] })]
												}),
												/* @__PURE__ */ jsxs("div", {
													className: "flex gap-3",
													children: [/* @__PURE__ */ jsx("span", {
														className: "font-terminal text-[#d44a3d] shrink-0",
														children: "02."
													}), /* @__PURE__ */ jsx("span", { children: "Set API keys as environment variables (if using cloud providers)" })]
												}),
												/* @__PURE__ */ jsxs("div", {
													className: "flex gap-3",
													children: [/* @__PURE__ */ jsx("span", {
														className: "font-terminal text-[#d44a3d] shrink-0",
														children: "03."
													}), /* @__PURE__ */ jsxs("span", { children: [
														"Start proxy:",
														" ",
														/* @__PURE__ */ jsx("code", {
															className: "bg-[#1a1a1a] text-[#00ff00] px-1",
															children: "litellm --port 4000"
														})
													] })]
												}),
												/* @__PURE__ */ jsxs("div", {
													className: "flex gap-3",
													children: [/* @__PURE__ */ jsx("span", {
														className: "font-terminal text-[#d44a3d] shrink-0",
														children: "04."
													}), /* @__PURE__ */ jsxs("span", { children: [
														"Point Keating to",
														" ",
														/* @__PURE__ */ jsx("code", {
															className: "bg-[#1a1a1a] text-[#00ff00] px-1",
															children: "http://localhost:4000"
														})
													] })]
												})
											]
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "mt-6 p-4 bg-[#10b981]/10 border-l-4 border-[#10b981]",
											children: [/* @__PURE__ */ jsx("p", {
												className: "font-terminal text-[#10b981]",
												children: "UNIFIED_API"
											}), /* @__PURE__ */ jsx("p", {
												className: "text-sm mt-1",
												children: "LiteLLM gives you one OpenAI-compatible endpoint that can route to any provider (local or cloud)."
											})]
										})
									]
								}),
								activeTab === "cloud" && /* @__PURE__ */ jsxs("div", {
									className: "p-6",
									children: [
										/* @__PURE__ */ jsx("h3", {
											className: "text-xl font-bold mb-4",
											children: "Cloud Providers"
										}),
										/* @__PURE__ */ jsx("p", {
											className: "mb-4",
											children: "Use managed AI services for best performance and model variety. Requires API keys."
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "mb-6 p-4 bg-[#4285f4]/5 border border-[#4285f4]/20",
											children: [
												/* @__PURE__ */ jsx("h4", {
													className: "font-bold text-[#4285f4] mb-2",
													children: "Google AI Studio (Gemini)"
												}),
												/* @__PURE__ */ jsxs("ol", {
													className: "space-y-2 text-sm",
													children: [
														/* @__PURE__ */ jsxs("li", { children: [
															"1. Go to",
															" ",
															/* @__PURE__ */ jsx("a", {
																href: "https://aistudio.google.com/app/apikey",
																target: "_blank",
																rel: "noreferrer",
																className: "text-[#4285f4] underline",
																children: "aistudio.google.com/app/apikey"
															})
														] }),
														/* @__PURE__ */ jsx("li", { children: "2. Sign in and click \"Create API Key\"" }),
														/* @__PURE__ */ jsx("li", { children: "3. Copy key (starts with \"AIza...\")" }),
														/* @__PURE__ */ jsx("li", { children: "4. Paste in Keating settings" })
													]
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-xs text-[#64748b] mt-2",
													children: "Free tier: 15 req/min, 1M tokens/day"
												})
											]
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "mb-6 p-4 bg-[#d44a3d]/5 border border-[#d44a3d]/20",
											children: [
												/* @__PURE__ */ jsx("h4", {
													className: "font-bold text-[#d44a3d] mb-2",
													children: "Synthetic"
												}),
												/* @__PURE__ */ jsxs("ol", {
													className: "space-y-2 text-sm",
													children: [
														/* @__PURE__ */ jsx("li", { children: "1. Create or copy your Synthetic API key" }),
														/* @__PURE__ */ jsxs("li", { children: [
															"2. In Keating settings, add a custom provider named",
															" ",
															/* @__PURE__ */ jsx("code", {
																className: "bg-[#1a1a1a] text-[#00ff00] px-1",
																children: "synthetic"
															})
														] }),
														/* @__PURE__ */ jsxs("li", { children: [
															"3. Set the provider type to",
															" ",
															/* @__PURE__ */ jsx("code", {
																className: "bg-[#1a1a1a] text-[#00ff00] px-1",
																children: "Synthetic (OpenAI Compatible)"
															})
														] }),
														/* @__PURE__ */ jsxs("li", { children: [
															"4. Use",
															" ",
															/* @__PURE__ */ jsx("code", {
																className: "bg-[#1a1a1a] text-[#00ff00] px-1",
																children: "https://api.synthetic.new/openai/v1"
															}),
															" ",
															"as the base URL"
														] })
													]
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-xs text-[#64748b] mt-2",
													children: "Use this when you want Synthetic's hosted models through an OpenAI-compatible endpoint."
												})
											]
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "mb-6 p-4 bg-[#d97706]/5 border border-[#d97706]/20",
											children: [
												/* @__PURE__ */ jsx("h4", {
													className: "font-bold text-[#d97706] mb-2",
													children: "Anthropic (Claude)"
												}),
												/* @__PURE__ */ jsxs("ol", {
													className: "space-y-2 text-sm",
													children: [
														/* @__PURE__ */ jsxs("li", { children: [
															"1. Go to",
															" ",
															/* @__PURE__ */ jsx("a", {
																href: "https://console.anthropic.com/",
																target: "_blank",
																rel: "noreferrer",
																className: "text-[#d97706] underline",
																children: "console.anthropic.com"
															})
														] }),
														/* @__PURE__ */ jsx("li", { children: "2. Create account and navigate to API Keys" }),
														/* @__PURE__ */ jsx("li", { children: "3. Click \"Create Key\" and copy" }),
														/* @__PURE__ */ jsx("li", { children: "4. Paste in Keating settings" })
													]
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-xs text-[#64748b] mt-2",
													children: "Pricing: Claude Sonnet $3/M input, $15/M output"
												})
											]
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "p-4 bg-[#10a37f]/5 border border-[#10a37f]/20",
											children: [
												/* @__PURE__ */ jsx("h4", {
													className: "font-bold text-[#10a37f] mb-2",
													children: "OpenAI (GPT)"
												}),
												/* @__PURE__ */ jsxs("ol", {
													className: "space-y-2 text-sm",
													children: [
														/* @__PURE__ */ jsxs("li", { children: [
															"1. Go to",
															" ",
															/* @__PURE__ */ jsx("a", {
																href: "https://platform.openai.com/api-keys",
																target: "_blank",
																rel: "noreferrer",
																className: "text-[#10a37f] underline",
																children: "platform.openai.com/api-keys"
															})
														] }),
														/* @__PURE__ */ jsx("li", { children: "2. Create account and click \"Create new secret key\"" }),
														/* @__PURE__ */ jsx("li", { children: "3. Copy immediately (shown only once)" }),
														/* @__PURE__ */ jsx("li", { children: "4. Paste in Keating settings" })
													]
												}),
												/* @__PURE__ */ jsx("p", {
													className: "text-xs text-[#64748b] mt-2",
													children: "Pricing: GPT-4o $2.50/M input, $10/M output"
												})
											]
										})
									]
								})
							]
						}),
						/* @__PURE__ */ jsxs("section", {
							className: "mt-8 bg-[#1a1a1a] text-[#f4f1ea] p-6 border-l-4 border-[#d44a3d]",
							children: [/* @__PURE__ */ jsx("h3", {
								className: "font-terminal text-xl text-[#d44a3d] mb-3",
								children: "SECURITY_NOTE"
							}), /* @__PURE__ */ jsxs("p", {
								className: "text-sm",
								children: [
									"API keys are stored locally in your browser's IndexedDB (web) or",
									" ",
									/* @__PURE__ */ jsx("code", {
										className: "text-[#00ff00]",
										children: "~/.keating/.env"
									}),
									" (CLI). They never leave your device. Never commit keys to git."
								]
							})]
						})
					]
				})
			}),
			/* @__PURE__ */ jsx(SimpleFooter, {})
		]
	});
}
//#endregion
//#region src/pages/Blog.tsx
var BADGE_CLASSES = {
	fix: "bg-[#d97706]/10 text-[#d97706]",
	release: "bg-[#10b981]/10 text-[#10b981]",
	feature: "bg-[#10b981]/10 text-[#10b981]",
	pwa: "bg-[#6366f1]/10 text-[#6366f1]",
	update: "bg-[#d97706]/10 text-[#d97706]",
	tech: "bg-[#6366f1]/10 text-[#6366f1]",
	devlog: "bg-[#d97706]/10 text-[#d97706]"
};
function Code({ children }) {
	return /* @__PURE__ */ jsx("code", {
		className: "bg-[#1a1a1a] text-[#f4f1ea] px-1 rounded text-sm",
		children
	});
}
function CodeBlock({ children }) {
	return /* @__PURE__ */ jsx("div", {
		className: "code-block mb-4 overflow-x-auto",
		children: /* @__PURE__ */ jsx("pre", {
			className: "whitespace-pre-wrap break-words",
			children
		})
	});
}
var POSTS = [
	{
		date: "2026-04-10",
		badge: {
			label: "RELEASE",
			color: "release"
		},
		title: "From Stubs to Reality: AI-Powered Pedagogical Verification",
		body: /* @__PURE__ */ jsxs(Fragment, { children: [
			/* @__PURE__ */ jsx("div", {
				className: "mb-4",
				children: /* @__PURE__ */ jsx(Pretext, {
					text: "Today we've completed a major architectural shift: moving from deterministic mathematical stubs to true AI-powered verification across our core pedagogical engines.",
					font: "16px 'Inter', sans-serif",
					lineHeight: 24
				})
			}),
			/* @__PURE__ */ jsx("h3", {
				className: "font-bold mt-4 mb-2",
				children: "What's New?"
			}),
			/* @__PURE__ */ jsxs("ul", {
				className: "text-sm space-y-4 ml-4 mb-4",
				children: [
					/* @__PURE__ */ jsxs("li", { children: [/* @__PURE__ */ jsx("div", {
						className: "font-bold mb-1 underline decoration-[#d44a3d]",
						children: "Real-Time Animation Generation:"
					}), /* @__PURE__ */ jsx(Pretext, {
						text: "The animation engine no longer relies on hardcoded ManimJS templates. It now uses the pi agent to generate custom, context-aware visual teaching beats for any topic.",
						font: "14px 'Inter', sans-serif",
						lineHeight: 20,
						justify: false
					})] }),
					/* @__PURE__ */ jsxs("li", { children: [/* @__PURE__ */ jsx("div", {
						className: "font-bold mb-1 underline decoration-[#d44a3d]",
						children: "Realistic Teaching Simulations:"
					}), /* @__PURE__ */ jsx(Pretext, {
						text: "Our synthetic benchmarks now use LLM-backed simulations to evaluate teaching outcomes (mastery, retention, confusion) instead of algebraic approximations.",
						font: "14px 'Inter', sans-serif",
						lineHeight: 20,
						justify: false
					})] }),
					/* @__PURE__ */ jsxs("li", { children: [/* @__PURE__ */ jsx("div", {
						className: "font-bold mb-1 underline decoration-[#d44a3d]",
						children: "Dynamic Learner Profiles:"
					}), /* @__PURE__ */ jsx(Pretext, {
						text: "Learner state updates are now driven by AI-inferred pedagogical shifts based on historical performance and feedback.",
						font: "14px 'Inter', sans-serif",
						lineHeight: 20,
						justify: false
					})] }),
					/* @__PURE__ */ jsxs("li", { children: [/* @__PURE__ */ jsx("div", {
						className: "font-bold mb-1 underline decoration-[#d44a3d]",
						children: "Research Paper Integration:"
					}), /* @__PURE__ */ jsx(Pretext, {
						text: "The formal account of the Keating metaharness is now served directly in the web application with a dedicated [PAPER] section and PDF download.",
						font: "14px 'Inter', sans-serif",
						lineHeight: 20,
						justify: false
					})] })
				]
			}),
			/* @__PURE__ */ jsx("div", {
				className: "text-sm text-[#64748b] mt-6",
				children: /* @__PURE__ */ jsx(Pretext, {
					text: "These changes ensure that Keating's 'self-improvement' loop is grounded in actual semantic understanding rather than pre-baked formulas.",
					font: "italic 14px 'Inter', sans-serif",
					lineHeight: 20
				})
			})
		] })
	},
	{
		date: "2026-04-10",
		badge: {
			label: "TECH",
			color: "tech"
		},
		title: "Power Move: Migrating to Nitro + Vite",
		body: /* @__PURE__ */ jsxs(Fragment, { children: [
			/* @__PURE__ */ jsxs("p", {
				className: "mb-4",
				children: [
					"We've leveled up the Keating server stack by migrating to ",
					/* @__PURE__ */ jsx(Code, { children: "Nitro" }),
					" and",
					" ",
					/* @__PURE__ */ jsx(Code, { children: "Vite" }),
					". This provides a high-performance, completely runtime-agnostic engine that integrates directly with our build pipeline."
				]
			}),
			/* @__PURE__ */ jsx("h3", {
				className: "font-bold mt-4 mb-2",
				children: "Why Nitro?"
			}),
			/* @__PURE__ */ jsxs("ul", {
				className: "text-sm space-y-2 ml-4 mb-4",
				children: [
					/* @__PURE__ */ jsxs("li", { children: [/* @__PURE__ */ jsx("strong", { children: "Universal Deployment:" }), " Nitro allows Keating to run seamlessly on Node.js, Bun, or even edge workers with zero code changes."] }),
					/* @__PURE__ */ jsxs("li", { children: [/* @__PURE__ */ jsx("strong", { children: "Vite Integration:" }), " The server and client now share a unified build process, making the developer experience much smoother."] }),
					/* @__PURE__ */ jsxs("li", { children: [
						/* @__PURE__ */ jsx("strong", { children: "Optimized Output:" }),
						" The new build generates a standalone",
						" ",
						/* @__PURE__ */ jsx(Code, { children: ".output" }),
						" directory that bundle everything needed to run the Web UI, reducing overhead."
					] })
				]
			}),
			/* @__PURE__ */ jsxs("p", {
				className: "text-sm text-[#64748b]",
				children: [
					"The CLI has been updated to launch this new engine automatically—just run",
					" ",
					/* @__PURE__ */ jsx(Code, { children: "keating web" }),
					" and experience the speed."
				]
			})
		] })
	},
	{
		date: "2026-04-09",
		badge: {
			label: "FIX",
			color: "fix"
		},
		title: "Chat Model Selector Now Reflects the Actual Choice",
		body: /* @__PURE__ */ jsxs(Fragment, { children: [
			/* @__PURE__ */ jsxs("p", {
				className: "mb-4",
				children: [
					"Fixed the web UI bug where the chat window kept showing",
					" ",
					/* @__PURE__ */ jsx(Code, { children: "gemini-3.1-pro-preview" }),
					" even after picking a different model. The selected model now updates the agent state directly, so the chat button and the runtime stay in sync."
				]
			}),
			/* @__PURE__ */ jsx("h3", {
				className: "font-bold mt-4 mb-2",
				children: "What Changed"
			}),
			/* @__PURE__ */ jsxs("ul", {
				className: "text-sm space-y-2 ml-4 mb-4",
				children: [
					/* @__PURE__ */ jsxs("li", { children: [/* @__PURE__ */ jsx("strong", { children: "State Sync:" }), " Selecting a model now writes the chosen model back into the active agent state instead of leaving the old Gemini placeholder in place."] }),
					/* @__PURE__ */ jsxs("li", { children: [/* @__PURE__ */ jsx("strong", { children: "Immediate Rerender:" }), " The model button in the chat window refreshes as soon as a new model is chosen."] }),
					/* @__PURE__ */ jsxs("li", { children: [/* @__PURE__ */ jsx("strong", { children: "Browser Path:" }), " The local browser model is now represented as a real model object, so the UI can display it explicitly instead of pretending everything is Gemini."] })
				]
			}),
			/* @__PURE__ */ jsx("p", {
				className: "text-sm text-[#64748b]",
				children: "This fixes the mismatch between the picker and the chat header, which made it look like model changes were being ignored."
			})
		] })
	},
	{
		date: "2026-04-09",
		badge: {
			label: "RELEASE",
			color: "release"
		},
		title: "v0.1.3 - Synthetic Provider Support and Mobile UI Polish",
		body: /* @__PURE__ */ jsxs(Fragment, { children: [
			/* @__PURE__ */ jsxs("p", {
				className: "mb-4",
				children: [
					"Keating now exposes Synthetic as a first-class custom provider in the Pi settings flow. The provider is configured as an OpenAI-compatible endpoint at",
					" ",
					/* @__PURE__ */ jsx(Code, { children: "https://api.synthetic.new/openai/v1" }),
					", with matching setup guidance in the tutorial."
				]
			}),
			/* @__PURE__ */ jsx("h3", {
				className: "font-bold mt-4 mb-2",
				children: "Key Changes"
			}),
			/* @__PURE__ */ jsxs("ul", {
				className: "text-sm space-y-2 ml-4 mb-4",
				children: [
					/* @__PURE__ */ jsxs("li", { children: [/* @__PURE__ */ jsx("strong", { children: "Synthetic Provider:" }), " Added a dedicated custom-provider entry so users can select Synthetic directly from the provider picker."] }),
					/* @__PURE__ */ jsxs("li", { children: [/* @__PURE__ */ jsx("strong", { children: "Setup Guide:" }), " Updated the tutorial with the exact provider name, type, and base URL."] }),
					/* @__PURE__ */ jsxs("li", { children: [/* @__PURE__ */ jsx("strong", { children: "Mobile Polish:" }), " Increased touch targets and spacing across the homepage, model selector, settings dialog, and install tabs."] })
				]
			}),
			/* @__PURE__ */ jsx("p", {
				className: "text-sm text-[#64748b]",
				children: "This release keeps the UI consistent with the current provider flow while making the browser experience less cramped on small screens."
			})
		] })
	},
	{
		date: "2025-04-05",
		badge: {
			label: "FIX",
			color: "fix"
		},
		title: "Chat Panel Fix & Model Loading Animation",
		body: /* @__PURE__ */ jsxs(Fragment, { children: [
			/* @__PURE__ */ jsx("p", {
				className: "mb-4",
				children: "Fixed the text disappearing issue in the chat panel that occurred after sending messages. Also added a one-time model loading animation when the browser model initializes."
			}),
			/* @__PURE__ */ jsx("h3", {
				className: "font-bold mt-4 mb-2",
				children: "Bug Fix: Chat Panel Lifecycle"
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mb-4",
				children: "The root cause was Lit re-rendering replacing the ChatPanel element on every state update. Separated the static header from the dynamic chat panel with distinct DOM containers. The header renders via Lit's templating, while the ChatPanel is appended once and never replaced."
			}),
			/* @__PURE__ */ jsx("h3", {
				className: "font-bold mt-4 mb-2",
				children: "New: Model Loading Overlay"
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mb-4",
				children: "When using the browser model (Gemma 4 E4B), a loading overlay now appears showing real-time download progress. This only shows once — the first time the model is loaded. Subsequent visits skip the overlay since the model is cached locally."
			}),
			/* @__PURE__ */ jsx(CodeBlock, { children: `// Model loading state communicated via custom events
localModel.subscribe((state) => {
  if (state.loading) showLoadingOverlay(state.loadingProgress);
  if (state.loaded) hideLoadingOverlay();
});` }),
			/* @__PURE__ */ jsx("p", {
				className: "text-sm text-[#64748b]",
				children: "The overlay includes a progress bar, percentage display, and explains that the ~2GB download only happens once."
			})
		] })
	},
	{
		date: "2025-04-05",
		badge: {
			label: "FEATURE",
			color: "feature"
		},
		title: "Installable PWA with Full Browser Model Integration",
		body: /* @__PURE__ */ jsxs(Fragment, { children: [
			/* @__PURE__ */ jsx("p", {
				className: "mb-4",
				children: "Keating is now a fully installable Progressive Web App. Install it from your browser and run it offline with the browser model. The WebGPU-powered Gemma 4 E4B model streams tokens in real-time directly in your browser."
			}),
			/* @__PURE__ */ jsx("h3", {
				className: "font-bold mt-4 mb-2",
				children: "Key Changes"
			}),
			/* @__PURE__ */ jsxs("ul", {
				className: "text-sm space-y-2 ml-4 mb-4",
				children: [
					/* @__PURE__ */ jsxs("li", { children: [/* @__PURE__ */ jsx("strong", { children: "Browser Model → Agent:" }), " The local Gemma model is now fully wired into the Agent infrastructure. Token streaming works via a custom stream function that dispatches between WebGPU and cloud providers."] }),
					/* @__PURE__ */ jsxs("li", { children: [
						/* @__PURE__ */ jsx("strong", { children: "Automatic Fallback:" }),
						" On load, the app checks for WebGPU support. If unavailable, it automatically falls back to ",
						/* @__PURE__ */ jsx(Code, { children: "gemini-3.1-pro-preview" }),
						"."
					] }),
					/* @__PURE__ */ jsxs("li", { children: [/* @__PURE__ */ jsx("strong", { children: "Model Selector:" }), " The model selector now shows WebGPU status in real-time. Browser option is disabled with a clear message when WebGPU isn't available."] }),
					/* @__PURE__ */ jsxs("li", { children: [/* @__PURE__ */ jsx("strong", { children: "PWA Manifest:" }), " Added service worker with intelligent caching for WASM files and model weights from HuggingFace CDN."] })
				]
			}),
			/* @__PURE__ */ jsx("h3", {
				className: "font-bold mt-4 mb-2",
				children: "How It Works"
			}),
			/* @__PURE__ */ jsx(CodeBlock, { children: `// Hybrid stream function dispatches based on model selection
const hybridStreamFn = async (model, context, options) => {
  if (selectedModelId === 'browser' && webGpuAvailable) {
    return createBrowserStreamFn()(model, context, options);
  }
  return streamSimple(model, context, options);
};` }),
			/* @__PURE__ */ jsx("p", {
				className: "text-sm text-[#64748b]",
				children: "Install: Visit keating.help in Chrome/Edge and click \"Install\" in the address bar, or use the browser's menu → \"Install app\"."
			})
		] })
	},
	{
		date: "2025-04-05",
		badge: {
			label: "UPDATE",
			color: "update"
		},
		title: "Default Cloud Model: Gemini 3.1 Pro Preview",
		body: /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs("p", {
			className: "mb-4",
			children: [
				"Updated the default cloud model from ",
				/* @__PURE__ */ jsx(Code, { children: "gemini-2.5-pro" }),
				" to",
				" ",
				/* @__PURE__ */ jsx(Code, { children: "gemini-3.1-pro-preview" }),
				". This gives access to the latest Gemini capabilities when WebGPU is unavailable."
			]
		}), /* @__PURE__ */ jsx("p", {
			className: "text-sm text-[#64748b]",
			children: "The model selector UI has been updated to reflect this change, showing \"Gemini 3.1 Pro Preview\" instead of the previous version."
		})] })
	},
	{
		date: "2025-04-05",
		badge: {
			label: "TECH",
			color: "tech"
		},
		title: "Robust WebGPU Detection",
		body: /* @__PURE__ */ jsxs(Fragment, { children: [
			/* @__PURE__ */ jsx("p", {
				className: "mb-4",
				children: "The model selector now performs async WebGPU detection before rendering. This prevents the UI from showing the browser option when it won't actually work."
			}),
			/* @__PURE__ */ jsx(CodeBlock, { children: `async checkWebGpu(): Promise<boolean> {
  if (!navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}` }),
			/* @__PURE__ */ jsx("p", {
				className: "text-sm text-[#64748b]",
				children: "If WebGPU is unavailable, the browser model option shows \"WebGPU not available\" and is grayed out."
			})
		] })
	},
	{
		date: "2025-01-15",
		badge: {
			label: "FEATURE",
			color: "feature"
		},
		title: "Local Model Support via WebGPU",
		body: /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("p", {
			className: "mb-4",
			children: "Keating now runs entirely in your browser using WebGPU. Run Gemma 4 E4B locally without any API keys. The model loads progressively and caches in your browser for subsequent sessions."
		}), /* @__PURE__ */ jsx("p", {
			className: "text-sm text-[#64748b]",
			children: "Requires Chrome 113+ or Edge 113+ with WebGPU support. Model size: ~5GB cached locally."
		})] })
	},
	{
		date: "2025-01-10",
		badge: {
			label: "RELEASE",
			color: "release"
		},
		title: "v0.1.0 - Initial Public Release",
		body: /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("p", {
			className: "mb-4",
			children: "First public release of Keating hyperteacher. Built on the Pi agent framework with support for Google Gemini, Anthropic Claude, and OpenAI GPT models. Features Socratic teaching methodology with diagnostic-first approach."
		}), /* @__PURE__ */ jsxs("ul", {
			className: "text-sm space-y-1 ml-4",
			children: [
				/* @__PURE__ */ jsx("li", { children: "- Chat-based teaching interface" }),
				/* @__PURE__ */ jsx("li", { children: "- Multi-provider support" }),
				/* @__PURE__ */ jsx("li", { children: "- Local session persistence" }),
				/* @__PURE__ */ jsx("li", { children: "- Dark mode support" })
			]
		})] })
	},
	{
		date: "2025-01-05",
		badge: {
			label: "DEV LOG",
			color: "devlog"
		},
		title: "The Hyperteacher Philosophy",
		body: /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("p", {
			className: "mb-4",
			children: "Keating is named after John Keating from Dead Poets Society, who taught that the purpose of education is not to fill minds but to ignite them. Our AI doesn't give answers — it forces you to reconstruct understanding from memory."
		}), /* @__PURE__ */ jsx("p", {
			className: "text-sm text-[#64748b]",
			children: "Core principle: struggle is the feature, not the bug. Neural pathways form through effort."
		})] })
	}
];
function Blog() {
	return /* @__PURE__ */ jsxs("div", {
		className: "retro-layout",
		children: [
			/* @__PURE__ */ jsx(Nav, {}),
			/* @__PURE__ */ jsx("main", {
				className: "pt-28 pb-16 px-6",
				children: /* @__PURE__ */ jsxs("div", {
					className: "max-w-4xl mx-auto",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "paper-fold distressed-border p-8 mb-8",
							children: [/* @__PURE__ */ jsx("h1", {
								className: "text-3xl md:text-4xl font-bold mb-2",
								children: "Keating Updates"
							}), /* @__PURE__ */ jsx("p", {
								className: "text-[#64748b] font-terminal",
								children: "Development log and release notes"
							})]
						}),
						/* @__PURE__ */ jsx("div", {
							className: "space-y-6",
							children: POSTS.map((post, i) => /* @__PURE__ */ jsxs("article", {
								className: "paper-fold distressed-border p-6 post-card",
								children: [
									/* @__PURE__ */ jsxs("div", {
										className: "flex items-center gap-3 mb-3",
										children: [/* @__PURE__ */ jsx("span", {
											className: "font-terminal text-[#d44a3d]",
											children: post.date
										}), /* @__PURE__ */ jsx("span", {
											className: `text-xs px-2 py-1 rounded ${BADGE_CLASSES[post.badge.color]}`,
											children: post.badge.label
										})]
									}),
									/* @__PURE__ */ jsx("h2", {
										className: "text-xl font-bold mb-3",
										children: post.title
									}),
									post.body
								]
							}, i))
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "mt-12 p-6 bg-[#1a1a1a] text-[#f4f1ea]",
							children: [/* @__PURE__ */ jsx("h3", {
								className: "font-terminal text-lg mb-2",
								children: "STAY_UPDATED"
							}), /* @__PURE__ */ jsxs("p", {
								className: "text-sm text-[#f4f1ea]/70",
								children: [
									"Follow development on",
									" ",
									/* @__PURE__ */ jsx("a", {
										href: "https://github.com/Diogenesoftoronto/keating",
										className: "text-[#d44a3d] underline",
										children: "GitHub"
									}),
									" ",
									"or watch the repository for release notifications."
								]
							})]
						})
					]
				})
			}),
			/* @__PURE__ */ jsx(SimpleFooter, {})
		]
	});
}
//#endregion
//#region src/components/custom-provider-dialog.ts
var KeatingCustomProviderDialog = class KeatingCustomProviderDialog extends DialogBase {
	provider;
	initialType;
	onSaveCallback;
	name = "";
	type = "openai-completions";
	baseUrl = "";
	apiKey = "";
	modalWidth = "min(800px, 90vw)";
	modalHeight = "min(700px, 90vh)";
	static async open(provider, initialType, onSave) {
		const dialog = new KeatingCustomProviderDialog();
		dialog.provider = provider;
		dialog.initialType = initialType;
		dialog.onSaveCallback = onSave;
		document.body.appendChild(dialog);
		dialog.initializeFromProvider();
		dialog.open();
		dialog.requestUpdate();
	}
	initializeFromProvider() {
		if (this.provider) {
			this.name = this.provider.name;
			this.type = this.provider.type;
			this.baseUrl = this.provider.baseUrl;
			this.apiKey = this.provider.apiKey || "";
		} else {
			this.name = "";
			this.type = this.initialType || "openai-completions";
			this.baseUrl = "";
			this.updateDefaultBaseUrl();
			this.apiKey = "";
		}
	}
	updateDefaultBaseUrl() {
		if (this.baseUrl) return;
		this.baseUrl = {
			ollama: "http://localhost:11434",
			"llama.cpp": "http://localhost:8080",
			vllm: "http://localhost:8000",
			lmstudio: "http://localhost:1234",
			"openai-completions": "",
			"openai-responses": "",
			"anthropic-messages": "",
			synthetic: "https://api.synthetic.new/openai/v1"
		}[this.type] || "";
	}
	async save() {
		if (!this.name || !this.baseUrl) {
			alert(i18n("Please fill in all required fields"));
			return;
		}
		try {
			const storage = getAppStorage();
			const provider = {
				id: this.provider?.id || crypto.randomUUID(),
				name: this.name,
				type: this.type,
				baseUrl: this.baseUrl,
				apiKey: this.apiKey || void 0,
				models: this.provider?.models || []
			};
			await storage.customProviders.set(provider);
			if (this.provider?.name && this.provider.name !== this.name) await storage.providerKeys.delete(this.provider.name);
			if (this.apiKey) await storage.providerKeys.set(this.name, this.apiKey);
			else await storage.providerKeys.delete(this.name);
			this.onSaveCallback?.();
			this.close();
		} catch (error) {
			console.error("Failed to save provider:", error);
			alert(i18n("Failed to save provider"));
		}
	}
	renderContent() {
		return html`
			<div class="flex flex-col h-full overflow-hidden">
				<div class="p-6 flex-shrink-0 border-b border-border">
					<h2 class="text-lg font-semibold text-foreground">
						${this.provider ? i18n("Edit Provider") : i18n("Add Provider")}
					</h2>
				</div>

				<div class="flex-1 overflow-y-auto p-6">
					<div class="flex flex-col gap-4">
						<div class="flex flex-col gap-2">
							${Label({
			htmlFor: "provider-name",
			children: i18n("Provider Name")
		})}
							${Input({
			value: this.name,
			placeholder: i18n("e.g., My Ollama Server"),
			onInput: (e) => {
				this.name = e.target.value;
				this.requestUpdate();
			}
		})}
						</div>

						<div class="flex flex-col gap-2">
							${Label({
			htmlFor: "provider-type",
			children: i18n("Provider Type")
		})}
							${Select({
			value: this.type,
			options: [
				{
					value: "ollama",
					label: "Ollama"
				},
				{
					value: "llama.cpp",
					label: "llama.cpp"
				},
				{
					value: "vllm",
					label: "vLLM"
				},
				{
					value: "lmstudio",
					label: "LM Studio"
				},
				{
					value: "openai-completions",
					label: "OpenAI Completions Compatible"
				},
				{
					value: "openai-responses",
					label: "OpenAI Responses Compatible"
				},
				{
					value: "anthropic-messages",
					label: "Anthropic Messages Compatible"
				},
				{
					value: "synthetic",
					label: "Synthetic (OpenAI Compatible)"
				}
			].map((pt) => ({
				value: pt.value,
				label: pt.label
			})),
			onChange: (value) => {
				this.type = value;
				this.baseUrl = "";
				this.updateDefaultBaseUrl();
				this.requestUpdate();
			},
			width: "100%"
		})}
						</div>

						<div class="flex flex-col gap-2">
							${Label({
			htmlFor: "base-url",
			children: i18n("Base URL")
		})}
							${Input({
			value: this.baseUrl,
			placeholder: "e.g., https://api.synthetic.new/openai/v1",
			onInput: (e) => {
				this.baseUrl = e.target.value;
				this.requestUpdate();
			}
		})}
						</div>

						<div class="flex flex-col gap-2">
							${Label({
			htmlFor: "api-key",
			children: i18n("API Key (Optional)")
		})}
							${Input({
			type: "password",
			value: this.apiKey,
			placeholder: i18n("Leave empty if not required"),
			onInput: (e) => {
				this.apiKey = e.target.value;
				this.requestUpdate();
			}
		})}
						</div>
					</div>
				</div>

				<div class="p-6 flex-shrink-0 border-t border-border flex justify-end gap-2">
					${Button({
			onClick: () => this.close(),
			variant: "ghost",
			children: i18n("Cancel")
		})}
					${Button({
			onClick: () => this.save(),
			variant: "default",
			disabled: !this.name || !this.baseUrl,
			children: i18n("Save")
		})}
				</div>
			</div>
		`;
	}
};
customElements.define("keating-custom-provider-dialog", KeatingCustomProviderDialog);
//#endregion
//#region src/components/providers-models-tab.ts
var AUTO_DISCOVERY_TYPES$1 = new Set([
	"ollama",
	"llama.cpp",
	"vllm",
	"lmstudio"
]);
var KeatingProvidersModelsTab = @customElement("keating-providers-models-tab") class extends SettingsTab {
	customProviders = [];
	async connectedCallback() {
		super.connectedCallback();
		await this.loadCustomProviders();
	}
	async loadCustomProviders() {
		try {
			this.customProviders = await getAppStorage().customProviders.getAll();
		} catch (error) {
			console.error("Failed to load custom providers:", error);
		}
	}
	getTabName() {
		return "Providers & Models";
	}
	renderKnownProviders() {
		return html`
			<div class="flex flex-col gap-6">
				<div>
					<h3 class="text-sm font-semibold text-foreground mb-2">Cloud Providers</h3>
					<p class="text-sm text-muted-foreground mb-4">
						Cloud LLM providers with predefined models. API keys are stored locally in your browser.
					</p>
				</div>
				<div class="flex flex-col gap-6">
					${getProviders().map((provider) => html`<provider-key-input .provider=${provider}></provider-key-input>`)}
				</div>
			</div>
		`;
	}
	renderCustomProviders() {
		return html`
			<div class="flex flex-col gap-6">
				<div class="flex items-center justify-between">
					<div>
						<h3 class="text-sm font-semibold text-foreground mb-2">Custom Providers</h3>
						<p class="text-sm text-muted-foreground">
							User-configured servers with auto-discovered or manually defined models.
						</p>
					</div>
					${Select({
			placeholder: i18n("Add Provider"),
			options: [
				{
					value: "ollama",
					label: "Ollama"
				},
				{
					value: "llama.cpp",
					label: "llama.cpp"
				},
				{
					value: "vllm",
					label: "vLLM"
				},
				{
					value: "lmstudio",
					label: "LM Studio"
				},
				{
					value: "openai-completions",
					label: i18n("OpenAI Completions Compatible")
				},
				{
					value: "openai-responses",
					label: i18n("OpenAI Responses Compatible")
				},
				{
					value: "anthropic-messages",
					label: i18n("Anthropic Messages Compatible")
				},
				{
					value: "synthetic",
					label: "Synthetic (OpenAI Compatible)"
				}
			],
			onChange: (value) => this.addCustomProvider(value),
			variant: "outline",
			size: "sm"
		})}
				</div>

				${this.customProviders.length === 0 ? html`
							<div class="text-sm text-muted-foreground text-center py-8">
								No custom providers configured. Click 'Add Provider' to get started.
							</div>
						` : html`
							<div class="flex flex-col gap-4">
								${this.customProviders.map((provider) => html`
										<custom-provider-card
											.provider=${provider}
											.isAutoDiscovery=${AUTO_DISCOVERY_TYPES$1.has(provider.type)}
											.onEdit=${(p) => this.editProvider(p)}
											.onDelete=${(p) => this.deleteProvider(p)}
										></custom-provider-card>
									`)}
							</div>
						`}
			</div>
		`;
	}
	async addCustomProvider(type) {
		await KeatingCustomProviderDialog.open(void 0, type, async () => {
			await this.loadCustomProviders();
			this.requestUpdate();
		});
	}
	async editProvider(provider) {
		await KeatingCustomProviderDialog.open(provider, void 0, async () => {
			await this.loadCustomProviders();
			this.requestUpdate();
		});
	}
	async deleteProvider(provider) {
		if (!confirm("Are you sure you want to delete this provider?")) return;
		try {
			const storage = getAppStorage();
			await storage.customProviders.delete(provider.id);
			await storage.providerKeys.delete(provider.name);
			await this.loadCustomProviders();
			this.requestUpdate();
		} catch (error) {
			console.error("Failed to delete provider:", error);
		}
	}
	render() {
		return html`
			<div class="flex flex-col gap-8">
				${this.renderKnownProviders()}
				<div class="border-t border-border"></div>
				${this.renderCustomProviders()}
			</div>
		`;
	}
};
//#endregion
//#region src/stores/local-model.ts
var MODEL_ID = "onnx-community/gemma-4-E4B-it-ONNX";
var LocalModelStore = class {
	state = {
		loaded: false,
		loading: false,
		loadingProgress: 0,
		error: null,
		model: null,
		processor: null,
		transformers: null
	};
	listeners = /* @__PURE__ */ new Set();
	subscribe(listener) {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}
	notify() {
		this.listeners.forEach((l) => l(this.state));
	}
	async load() {
		if (this.state.loaded || this.state.loading) return;
		this.state = {
			...this.state,
			loading: true,
			loadingProgress: 0,
			error: null
		};
		this.notify();
		try {
			console.log("Loading transformers.js and model:", MODEL_ID);
			const { AutoProcessor, AutoModelForCausalLM, env } = await import("@huggingface/transformers");
			env.allowLocalModels = false;
			env.useBrowserCache = true;
			const processor = await AutoProcessor.from_pretrained(MODEL_ID);
			this.state = {
				loaded: true,
				loading: false,
				loadingProgress: 100,
				error: null,
				model: await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
					dtype: "q4f16",
					device: "webgpu",
					progress_callback: (progress) => {
						if (progress.status === "progress" || progress.status === "progress_total") {
							const pct = Math.round(progress.progress ?? 0);
							this.state = {
								...this.state,
								loadingProgress: pct
							};
							this.notify();
							console.log(`Loading: ${pct}%`);
						}
					}
				}),
				processor,
				transformers: {
					AutoProcessor,
					AutoModelForCausalLM,
					env
				}
			};
			this.notify();
			console.log("Local model loaded successfully");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.state = {
				loaded: false,
				loading: false,
				loadingProgress: 0,
				error: message,
				model: null,
				processor: null
			};
			this.notify();
			console.error("Failed to load local model:", message);
		}
	}
	async generate(prompt, options, onToken) {
		if (!this.state.model || !this.state.processor) throw new Error("Model not loaded");
		const messages = [{
			role: "user",
			content: [{
				type: "text",
				text: prompt
			}]
		}];
		const formattedPrompt = this.state.processor.apply_chat_template(messages, { add_generation_prompt: true });
		const inputs = await this.state.processor(formattedPrompt, { add_special_tokens: false });
		const { TextStreamer } = await import("@huggingface/transformers");
		const streamer = new TextStreamer(this.state.processor.tokenizer, {
			skip_prompt: true,
			skip_special_tokens: true,
			callback_function: onToken ? (text) => onToken(text) : void 0
		});
		const outputs = await this.state.model.generate({
			...inputs,
			max_new_tokens: options?.max_length ?? 512,
			temperature: options?.temperature ?? .7,
			do_sample: true,
			streamer
		});
		return this.state.processor.batch_decode(outputs.slice(null, [inputs.input_ids.dims.at(-1), null]), { skip_special_tokens: true })[0] ?? "";
	}
	getState() {
		return this.state;
	}
};
var localModel = new LocalModelStore();
//#endregion
//#region src/lib/provider-models.ts
var AUTO_DISCOVERY_TYPES = new Set([
	"ollama",
	"llama.cpp",
	"vllm",
	"lmstudio"
]);
var OPENAI_COMPATIBLE_TYPES = new Set([
	"openai-completions",
	"openai-responses",
	"synthetic"
]);
function trimTrailingSlash(value) {
	return value.replace(/\/+$/, "");
}
function modelCost() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0
	};
}
function toContextWindow(value, fallback = 0) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed)) return parsed;
	}
	return fallback;
}
function inferInputModes(model) {
	const supported = /* @__PURE__ */ new Set();
	if (Array.isArray(model?.input)) {
		for (const entry of model.input) if (entry === "image" || entry === "text") supported.add(entry);
	}
	if (Array.isArray(model?.input_modalities)) {
		for (const entry of model.input_modalities) if (entry === "image" || entry === "text") supported.add(entry);
	}
	if (Array.isArray(model?.modalities)) {
		for (const entry of model.modalities) if (entry === "image" || entry === "text") supported.add(entry);
	}
	if (model?.vision === true) supported.add("image");
	if (supported.size === 0) supported.add("text");
	return Array.from(supported);
}
function inferReasoning(model) {
	if (typeof model?.reasoning === "boolean") return model.reasoning;
	if (typeof model?.supports_reasoning === "boolean") return model.supports_reasoning;
	if (Array.isArray(model?.capabilities)) return model.capabilities.includes("thinking");
	const name = String(model?.id ?? model?.name ?? "").toLowerCase();
	return name.includes("thinking") || name.includes("reasoning");
}
function manualProviderApi(type) {
	switch (type) {
		case "openai-responses": return "openai-responses";
		case "anthropic-messages": return "anthropic-messages";
		default: return "openai-completions";
	}
}
async function fetchJson(url, apiKey) {
	const headers = { "Content-Type": "application/json" };
	if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
	const response = await fetch(url, {
		method: "GET",
		headers
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	return await response.json();
}
async function discoverOpenAiCompatibleModels(provider) {
	const baseUrl = trimTrailingSlash(provider.baseUrl);
	const candidateBaseUrls = baseUrl.endsWith("/v1") ? [baseUrl] : [baseUrl, `${baseUrl}/v1`];
	let lastError;
	for (const apiBaseUrl of candidateBaseUrls) try {
		const payload = await fetchJson(`${apiBaseUrl}/models`, provider.apiKey);
		return {
			apiBaseUrl,
			models: (Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : []).map((record) => {
				const id = String(record?.id ?? record?.name ?? "").trim();
				if (!id) return null;
				const contextWindow = toContextWindow(record?.context_window ?? record?.context_length ?? record?.max_context_length ?? record?.max_model_len);
				const maxTokens = toContextWindow(record?.max_tokens ?? record?.max_output_tokens, contextWindow || 4096);
				return {
					id,
					name: String(record?.name ?? id),
					api: manualProviderApi(provider.type),
					provider: provider.name,
					baseUrl: apiBaseUrl,
					reasoning: inferReasoning(record),
					input: inferInputModes(record),
					cost: modelCost(),
					contextWindow,
					maxTokens
				};
			}).filter((model) => model !== null)
		};
	} catch (error) {
		lastError = error;
	}
	throw lastError instanceof Error ? lastError : /* @__PURE__ */ new Error(`Failed to discover models for ${provider.name}`);
}
async function discoverOllamaModels(baseUrl) {
	const ollama = new Ollama({ host: baseUrl });
	const { models } = await ollama.list();
	return (await Promise.all(models.map(async (model) => {
		const details = await ollama.show({ model: model.name });
		const capabilities = details.capabilities || [];
		if (!capabilities.includes("tools")) return null;
		const modelInfo = details.model_info || {};
		const contextWindow = toContextWindow(modelInfo[`${modelInfo["general.architecture"] || ""}.context_length`], 8192);
		return {
			id: model.name,
			name: model.name,
			api: "openai-completions",
			provider: "",
			baseUrl: `${trimTrailingSlash(baseUrl)}/v1`,
			reasoning: capabilities.includes("thinking"),
			input: ["text"],
			cost: modelCost(),
			contextWindow,
			maxTokens: contextWindow
		};
	}))).filter((model) => model !== null);
}
async function discoverLlamaCppModels(baseUrl, apiKey) {
	const payload = await fetchJson(`${trimTrailingSlash(baseUrl)}/v1/models`, apiKey);
	return (Array.isArray(payload?.data) ? payload.data : []).map((model) => {
		const contextWindow = toContextWindow(model?.context_length, 8192);
		return {
			id: String(model.id),
			name: String(model.id),
			api: "openai-completions",
			provider: "",
			baseUrl: `${trimTrailingSlash(baseUrl)}/v1`,
			reasoning: false,
			input: ["text"],
			cost: modelCost(),
			contextWindow,
			maxTokens: toContextWindow(model?.max_tokens, 4096)
		};
	});
}
async function discoverVllmModels(baseUrl, apiKey) {
	const payload = await fetchJson(`${trimTrailingSlash(baseUrl)}/v1/models`, apiKey);
	return (Array.isArray(payload?.data) ? payload.data : []).map((model) => {
		const contextWindow = toContextWindow(model?.max_model_len, 8192);
		return {
			id: String(model.id),
			name: String(model.id),
			api: "openai-completions",
			provider: "",
			baseUrl: `${trimTrailingSlash(baseUrl)}/v1`,
			reasoning: false,
			input: ["text"],
			cost: modelCost(),
			contextWindow,
			maxTokens: Math.min(contextWindow, 4096)
		};
	});
}
async function discoverLmStudioModels(baseUrl) {
	const payload = await fetchJson(`${trimTrailingSlash(baseUrl)}/v1/models`);
	return (Array.isArray(payload?.data) ? payload.data : []).map((model) => {
		const contextWindow = toContextWindow(model?.context_length ?? model?.max_context_length, 8192);
		return {
			id: String(model?.id),
			name: String(model?.name ?? model?.id),
			api: "openai-completions",
			provider: "",
			baseUrl: `${trimTrailingSlash(baseUrl)}/v1`,
			reasoning: inferReasoning(model),
			input: inferInputModes(model),
			cost: modelCost(),
			contextWindow,
			maxTokens: toContextWindow(model?.max_tokens, contextWindow)
		};
	});
}
async function discoverCustomProviderModels(provider) {
	if (AUTO_DISCOVERY_TYPES.has(provider.type)) {
		let models;
		switch (provider.type) {
			case "ollama":
				models = await discoverOllamaModels(provider.baseUrl);
				break;
			case "llama.cpp":
				models = await discoverLlamaCppModels(provider.baseUrl, provider.apiKey);
				break;
			case "vllm":
				models = await discoverVllmModels(provider.baseUrl, provider.apiKey);
				break;
			case "lmstudio":
				models = await discoverLmStudioModels(provider.baseUrl);
				break;
			default: models = [];
		}
		return models.map((model) => ({
			...model,
			provider: provider.name
		}));
	}
	if (OPENAI_COMPATIBLE_TYPES.has(provider.type)) return (await discoverOpenAiCompatibleModels(provider)).models;
	return (provider.models || []).map((model) => ({
		...model,
		provider: provider.name,
		baseUrl: model.baseUrl || provider.baseUrl,
		api: model.api || manualProviderApi(provider.type)
	}));
}
async function getCustomProviders() {
	return await getAppStorage().customProviders.getAll();
}
async function syncCustomProviderKeys() {
	const storage = getAppStorage();
	const providers = await getCustomProviders();
	await Promise.all(providers.map(async (provider) => {
		if (provider.apiKey) await storage.providerKeys.set(provider.name, provider.apiKey);
	}));
}
async function getProviderApiKey(providerName) {
	const storedKey = await getAppStorage().providerKeys.get(providerName);
	if (storedKey) return storedKey;
	return (await getCustomProviders()).find((provider) => provider.name === providerName)?.apiKey;
}
async function getSelectableModels() {
	const models = [];
	for (const provider of getProviders()) models.push(...getModels(provider));
	const customProviders = await getCustomProviders();
	const customModels = await Promise.all(customProviders.map(async (provider) => {
		try {
			return await discoverCustomProviderModels(provider);
		} catch (error) {
			console.warn(`Skipping unavailable provider ${provider.name}:`, error);
			return [];
		}
	}));
	models.push(...customModels.flat());
	return models;
}
//#endregion
//#region src/components/model-selector.ts
var BROWSER_MODEL = {
	id: "gemma-4-e4b",
	name: "Gemma 4 E4B (Browser)",
	api: "browser",
	provider: "browser",
	baseUrl: "",
	reasoning: false,
	input: ["text"],
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0
	},
	contextWindow: 0,
	maxTokens: 0
};
function modelKey(model) {
	return `${model.provider}::${model.api}::${model.id}`;
}
var KeatingModelSelector = class KeatingModelSelector extends HTMLElement {
	currentModel = null;
	onSelect;
	selectedKey = modelKey(BROWSER_MODEL);
	localModelState = null;
	webGpuAvailable = false;
	searchQuery = "";
	unsubscribe;
	loadingModels = true;
	loadError = "";
	models = [];
	static async open(currentModel, onSelect) {
		const dialog = new KeatingModelSelector();
		dialog.currentModel = currentModel;
		dialog.onSelect = onSelect;
		dialog.selectedKey = currentModel ? modelKey(currentModel) : modelKey(BROWSER_MODEL);
		document.body.appendChild(dialog);
	}
	constructor() {
		super();
		this.attachShadow({ mode: "open" });
	}
	async connectedCallback() {
		this.webGpuAvailable = await this.checkWebGpu();
		this.unsubscribe = localModel.subscribe((state) => {
			this.localModelState = state;
			this.render();
		});
		await this.loadModels();
		this.render();
	}
	disconnectedCallback() {
		this.unsubscribe?.();
	}
	async checkWebGpu() {
		if (!navigator.gpu) return false;
		try {
			return await navigator.gpu.requestAdapter() !== null;
		} catch {
			return false;
		}
	}
	async loadModels() {
		this.loadingModels = true;
		this.loadError = "";
		this.render();
		try {
			const models = await getSelectableModels();
			const knownProviders = new Set(getProviders());
			const selectable = models.map((model) => ({
				key: modelKey(model),
				model,
				group: model.provider === "browser" ? "browser" : knownProviders.has(model.provider) ? "cloud" : "custom"
			}));
			if (this.webGpuAvailable) selectable.unshift({
				key: modelKey(BROWSER_MODEL),
				model: BROWSER_MODEL,
				group: "browser"
			});
			const deduped = /* @__PURE__ */ new Map();
			for (const model of selectable) deduped.set(model.key, model);
			this.models = Array.from(deduped.values());
			if (!this.models.some((entry) => entry.key === this.selectedKey) && this.models[0]) this.selectedKey = this.models[0].key;
		} catch (error) {
			this.loadError = error instanceof Error ? error.message : String(error);
			this.models = this.webGpuAvailable ? [{
				key: modelKey(BROWSER_MODEL),
				model: BROWSER_MODEL,
				group: "browser"
			}] : [];
		} finally {
			this.loadingModels = false;
		}
	}
	getFilteredModels() {
		const query = this.searchQuery.trim().toLowerCase();
		if (!query) return this.models;
		return this.models.filter(({ model }) => {
			return `${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(query);
		});
	}
	renderGroup(title, group, models) {
		if (models.length === 0) return "";
		return `
      <div class="category">${title}</div>
      ${models.map((entry) => this.renderModelOption(entry)).join("")}
    `;
	}
	renderModelOption(entry) {
		const { model, key } = entry;
		const isSelected = this.selectedKey === key;
		const isBrowser = model.provider === "browser";
		const statusHtml = this.renderStatus(model);
		const disabled = isBrowser && !this.webGpuAvailable;
		const badges = [
			isBrowser ? "<span class=\"badge badge-browser\">WebGPU</span>" : "",
			entry.group === "cloud" ? "<span class=\"badge badge-key\">Cloud</span>" : "",
			entry.group === "custom" ? "<span class=\"badge badge-local\">Custom</span>" : "",
			model.input.includes("image") ? "<span class=\"badge badge-vision\">Vision</span>" : "",
			model.reasoning ? "<span class=\"badge badge-thinking\">Thinking</span>" : ""
		].filter(Boolean).join("");
		const providerLabel = isBrowser ? "Runs in this browser" : `Provider: ${model.provider}`;
		return `
      <div class="model-option ${isSelected ? "selected" : ""} ${disabled ? "disabled" : ""}" data-model-key="${key}">
        <input type="radio" name="model" value="${key}" class="model-radio" ${isSelected ? "checked" : ""} ${disabled ? "disabled" : ""}>
        <div class="model-info">
          <div class="model-name">${model.name}</div>
          <div class="model-desc">${providerLabel}</div>
          <div class="model-id">${model.id}</div>
          <div class="badges">${badges}</div>
          ${statusHtml}
        </div>
      </div>
    `;
	}
	renderStatus(model) {
		if (model.provider !== "browser") return "";
		if (!this.webGpuAvailable) return `<div class="status status-error">WebGPU not available</div>`;
		if (this.localModelState?.loading) return `
        <div class="status status-loading">Loading browser model... ${this.localModelState.loadingProgress}%</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${this.localModelState.loadingProgress}%"></div>
        </div>
      `;
		if (this.localModelState?.loaded) return `<div class="status status-loaded">Model ready</div>`;
		if (this.localModelState?.error) return `<div class="status status-error">${this.localModelState.error}</div>`;
		return `<div class="status">Loads on demand when selected</div>`;
	}
	bindEvents() {
		this.shadowRoot?.querySelector("#cancel")?.addEventListener("click", () => this.remove());
		this.shadowRoot?.querySelector("#search")?.addEventListener("input", (event) => {
			const input = event.target;
			this.searchQuery = input.value;
			const cursorPos = input.selectionStart ?? this.searchQuery.length;
			this.render();
			const newInput = this.shadowRoot?.querySelector("#search");
			if (newInput) {
				newInput.focus();
				newInput.setSelectionRange(cursorPos, cursorPos);
			}
		});
		this.shadowRoot?.querySelector("#refresh")?.addEventListener("click", async () => {
			await this.loadModels();
			this.render();
		});
		this.shadowRoot?.querySelector("#select")?.addEventListener("click", async () => {
			const selected = this.models.find((entry) => entry.key === this.selectedKey)?.model;
			if (!selected) return;
			if (selected.provider === "browser" && !this.localModelState?.loaded) {
				await localModel.load();
				if (!localModel.getState().loaded) {
					this.render();
					return;
				}
			}
			this.onSelect?.(selected);
			this.remove();
		});
		this.shadowRoot?.querySelectorAll(".model-option").forEach((element) => {
			element.addEventListener("click", () => {
				if (element.classList.contains("disabled")) return;
				this.selectedKey = element.dataset.modelKey || this.selectedKey;
				this.render();
			});
		});
	}
	render() {
		if (!this.shadowRoot) return;
		const filtered = this.getFilteredModels();
		const browserModels = filtered.filter((entry) => entry.group === "browser");
		const cloudModels = filtered.filter((entry) => entry.group === "cloud");
		const customModels = filtered.filter((entry) => entry.group === "custom");
		this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          z-index: 1000;
          font-family: "Space Mono", monospace;
        }
        .dialog {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: #f4f1ea;
          border: 2px solid #1a1a1a;
          border-radius: 0.5rem;
          padding: 1.5rem;
          width: min(720px, 92vw);
          max-height: 85vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        h2 {
          margin: 0;
          font-size: 1.25rem;
          font-weight: 600;
        }
        .subtitle {
          font-size: 0.75rem;
          color: #64748b;
          margin: 0;
        }
        .toolbar {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        .toolbar input {
          flex: 1;
          min-width: 220px;
          padding: 0.75rem 1rem;
          border: 2px solid #1a1a1a;
          border-radius: 0.375rem;
          background: #fffdf8;
          font: inherit;
        }
        .toolbar button,
        .buttons button {
          padding: 0.75rem 1.25rem;
          border-radius: 0.375rem;
          border: 2px solid #1a1a1a;
          background: #f4f1ea;
          cursor: pointer;
          font: inherit;
        }
        .toolbar button:hover,
        .buttons button:hover {
          background: #1a1a1a;
          color: #f4f1ea;
        }
        .buttons button.primary {
          background: #d44a3d;
          border-color: #d44a3d;
          color: #fff;
        }
        .buttons button.primary:hover {
          background: #a33a30;
          border-color: #a33a30;
        }
        .content {
          overflow-y: auto;
          border: 1px solid #d6d3cc;
          background: #fffdf8;
          padding: 0.5rem 0;
        }
        .category {
          position: sticky;
          top: 0;
          z-index: 1;
          background: #fff8ef;
          border-top: 1px solid #d6d3cc;
          border-bottom: 1px solid #d6d3cc;
          padding: 0.5rem 1rem;
          font-size: 0.7rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #64748b;
        }
        .category:first-of-type {
          border-top: none;
        }
        .model-option {
          display: flex;
          gap: 0.75rem;
          align-items: flex-start;
          padding: 1rem;
          border-bottom: 1px solid #ece8de;
          cursor: pointer;
        }
        .model-option:hover:not(.disabled),
        .model-option.selected {
          background: #f7f2ea;
        }
        .model-option.disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .model-radio {
          margin-top: 0.25rem;
        }
        .model-info {
          min-width: 0;
          flex: 1;
        }
        .model-name {
          font-weight: 700;
          font-size: 0.95rem;
        }
        .model-desc,
        .model-id,
        .status {
          color: #64748b;
          font-size: 0.75rem;
          margin-top: 0.2rem;
          word-break: break-word;
        }
        .badges {
          display: flex;
          gap: 0.4rem;
          flex-wrap: wrap;
          margin-top: 0.4rem;
        }
        .badge {
          font-size: 0.65rem;
          padding: 0.125rem 0.5rem;
          border-radius: 9999px;
          font-weight: 600;
        }
        .badge-key {
          background: #e8ecff;
          color: #3043a6;
        }
        .badge-browser {
          background: #d1fae5;
          color: #047857;
        }
        .badge-local,
        .badge-vision,
        .badge-thinking {
          background: #f4e4d8;
          color: #8b4513;
        }
        .status-loading { color: #3043a6; }
        .status-loaded { color: #047857; }
        .status-error { color: #b91c1c; }
        .progress-bar {
          width: 100%;
          height: 4px;
          background: #e2e8f0;
          border-radius: 9999px;
          margin-top: 0.4rem;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: #3043a6;
        }
        .empty,
        .loading,
        .error {
          padding: 1rem;
          color: #64748b;
          font-size: 0.85rem;
        }
        .error { color: #b91c1c; }
        .buttons {
          display: flex;
          justify-content: flex-end;
          gap: 0.75rem;
        }
        @media (max-width: 640px) {
          .dialog {
            width: 95vw;
            padding: 1rem;
          }
          .toolbar {
            flex-direction: column;
          }
          .toolbar input {
            min-width: 0;
          }
          .buttons {
            flex-direction: column;
          }
        }
      </style>
      <div class="dialog">
        <div>
          <h2>Select Model</h2>
          <p class="subtitle">Built-in providers and discovered custom-provider models.</p>
        </div>
        <div class="toolbar">
          <input id="search" type="text" placeholder="Search models or providers" value="${this.searchQuery}">
          <button id="refresh" type="button">Refresh</button>
        </div>
        <div class="content">
          ${this.loadingModels ? "<div class=\"loading\">Loading models…</div>" : this.loadError ? `<div class="error">${this.loadError}</div>` : filtered.length === 0 ? "<div class=\"empty\">No models matched the current search.</div>" : `
                ${this.renderGroup("Browser", "browser", browserModels)}
                ${this.renderGroup("Cloud", "cloud", cloudModels)}
                ${this.renderGroup("Custom Providers", "custom", customModels)}
              `}
        </div>
        <div class="buttons">
          <button id="cancel" type="button">Cancel</button>
          <button id="select" class="primary" type="button">Use Selected Model</button>
        </div>
      </div>
    `;
		this.bindEvents();
	}
};
customElements.define("keating-model-selector", KeatingModelSelector);
//#endregion
//#region src/keating/storage.ts
/**
* Browser-compatible Keating storage using IndexedDB
* Replaces Node.js filesystem operations from src/core/
*/
var DB_NAME = "keating-db";
var DB_VERSION = 1;
var STORES = {
	LESSON_PLANS: "lesson-plans",
	LESSON_MAPS: "lesson-maps",
	ANIMATIONS: "animations",
	VERIFICATIONS: "verifications",
	BENCHMARKS: "benchmarks",
	EVOLUTIONS: "evolutions",
	POLICIES: "policies",
	FEEDBACK: "feedback",
	LEARNER_STATE: "learner-state"
};
var KeatingStorage = class {
	db = null;
	dbPromise = null;
	async init() {
		if (this.db) return;
		if (this.dbPromise) {
			await this.dbPromise;
			return;
		}
		this.dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);
			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				this.db = request.result;
				resolve(this.db);
			};
			request.onupgradeneeded = (event) => {
				const db = event.target.result;
				Object.values(STORES).forEach((storeName) => {
					if (!db.objectStoreNames.contains(storeName)) {
						const store = db.createObjectStore(storeName, { keyPath: "id" });
						store.createIndex("topic", "topic", { unique: false });
						store.createIndex("createdAt", "createdAt", { unique: false });
					}
				});
			};
		});
		await this.dbPromise;
	}
	async getStore(storeName, mode = "readonly") {
		await this.init();
		if (!this.db) throw new Error("Database not initialized");
		return this.db.transaction(storeName, mode).objectStore(storeName);
	}
	async getAll(storeName) {
		const store = await this.getStore(storeName);
		return new Promise((resolve, reject) => {
			const request = store.getAll();
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}
	async getByTopic(storeName, topic) {
		const index = (await this.getStore(storeName)).index("topic");
		return new Promise((resolve, reject) => {
			const request = index.getAll(topic);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}
	async put(storeName, data) {
		const store = await this.getStore(storeName, "readwrite");
		return new Promise((resolve, reject) => {
			const request = store.put(data);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}
	generateId() {
		return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}
	async saveLessonPlan(topic, content, metadata) {
		const plan = {
			id: this.generateId(),
			topic,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			content,
			metadata
		};
		await this.put(STORES.LESSON_PLANS, plan);
		return plan;
	}
	async getLessonPlans(topic) {
		if (topic) return this.getByTopic(STORES.LESSON_PLANS, topic);
		return this.getAll(STORES.LESSON_PLANS);
	}
	async saveLessonMap(topic, mmdContent, svgContent) {
		const map = {
			id: this.generateId(),
			topic,
			createdAt: Date.now(),
			mmdContent,
			svgContent
		};
		await this.put(STORES.LESSON_MAPS, map);
		return map;
	}
	async getLessonMaps(topic) {
		if (topic) return this.getByTopic(STORES.LESSON_MAPS, topic);
		return this.getAll(STORES.LESSON_MAPS);
	}
	async saveAnimation(topic, storyboard, scene, manifest) {
		const animation = {
			id: this.generateId(),
			topic,
			createdAt: Date.now(),
			storyboard,
			scene,
			manifest
		};
		await this.put(STORES.ANIMATIONS, animation);
		return animation;
	}
	async getAnimations(topic) {
		if (topic) return this.getByTopic(STORES.ANIMATIONS, topic);
		return this.getAll(STORES.ANIMATIONS);
	}
	async saveVerification(topic, checklist) {
		const verification = {
			id: this.generateId(),
			topic,
			createdAt: Date.now(),
			checklist,
			completed: false
		};
		await this.put(STORES.VERIFICATIONS, verification);
		return verification;
	}
	async getVerifications(topic) {
		if (topic) return this.getByTopic(STORES.VERIFICATIONS, topic);
		return this.getAll(STORES.VERIFICATIONS);
	}
	async saveBenchmark(score, report, topic, trace) {
		const benchmark = {
			id: this.generateId(),
			topic,
			createdAt: Date.now(),
			score,
			trace,
			report
		};
		await this.put(STORES.BENCHMARKS, benchmark);
		return benchmark;
	}
	async getBenchmarks(topic) {
		if (topic) return this.getByTopic(STORES.BENCHMARKS, topic);
		return this.getAll(STORES.BENCHMARKS);
	}
	async saveEvolution(bestScore, policy, report, topic, trace) {
		const evolution = {
			id: this.generateId(),
			topic,
			createdAt: Date.now(),
			bestScore,
			policy,
			trace,
			report
		};
		await this.put(STORES.EVOLUTIONS, evolution);
		return evolution;
	}
	async getEvolutions(topic) {
		if (topic) return this.getByTopic(STORES.EVOLUTIONS, topic);
		return this.getAll(STORES.EVOLUTIONS);
	}
	async savePolicy(content, active = true) {
		if (active) {
			const policies = await this.getAll(STORES.POLICIES);
			for (const p of policies) if (p.active) {
				p.active = false;
				p.updatedAt = Date.now();
				await this.put(STORES.POLICIES, p);
			}
		}
		const policy = {
			id: this.generateId(),
			createdAt: Date.now(),
			updatedAt: Date.now(),
			content,
			active
		};
		await this.put(STORES.POLICIES, policy);
		return policy;
	}
	async getActivePolicy() {
		return (await this.getAll(STORES.POLICIES)).find((p) => p.active) || null;
	}
	async getPolicies() {
		return this.getAll(STORES.POLICIES);
	}
	async recordFeedback(topic, signal) {
		const entry = {
			id: this.generateId(),
			topic,
			signal,
			createdAt: Date.now()
		};
		await this.put(STORES.FEEDBACK, entry);
		const state = await this.getLearnerState();
		state.feedbackHistory.push(entry);
		if (!state.topicsExplored.includes(topic)) state.topicsExplored.push(topic);
		state.lastSessionAt = Date.now();
		state.sessionsCount = (state.sessionsCount || 0) + 1;
		await this.saveLearnerState(state);
		return entry;
	}
	async getFeedback(topic) {
		if (topic) return this.getByTopic(STORES.FEEDBACK, topic);
		return this.getAll(STORES.FEEDBACK);
	}
	async getLearnerState() {
		const store = await this.getStore(STORES.LEARNER_STATE);
		return new Promise((resolve, reject) => {
			const request = store.get("learner-state");
			request.onsuccess = () => {
				resolve(request.result || {
					topicsExplored: [],
					feedbackHistory: [],
					strengths: [],
					weaknesses: [],
					sessionsCount: 0
				});
			};
			request.onerror = () => reject(request.error);
		});
	}
	async saveLearnerState(state) {
		const store = await this.getStore(STORES.LEARNER_STATE, "readwrite");
		return new Promise((resolve, reject) => {
			const request = store.put({
				...state,
				id: "learner-state"
			});
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}
	async listArtifacts() {
		const [plans, maps, animations, benchmarks, evolutions] = await Promise.all([
			this.getLessonPlans(),
			this.getLessonMaps(),
			this.getAnimations(),
			this.getBenchmarks(),
			this.getEvolutions()
		]);
		return [
			...plans.map((p) => ({
				id: p.id,
				label: `Plan: ${p.topic}`,
				type: "plan",
				createdAt: p.createdAt
			})),
			...maps.map((m) => ({
				id: m.id,
				label: `Map: ${m.topic}`,
				type: "map",
				createdAt: m.createdAt
			})),
			...animations.map((a) => ({
				id: a.id,
				label: `Animation: ${a.topic}`,
				type: "animation",
				createdAt: a.createdAt
			})),
			...benchmarks.map((b) => ({
				id: b.id,
				label: `Benchmark: ${b.topic || "general"} (${b.score.toFixed(2)})`,
				type: "benchmark",
				createdAt: b.createdAt
			})),
			...evolutions.map((e) => ({
				id: e.id,
				label: `Evolution: ${e.topic || "general"} (${e.bestScore.toFixed(2)})`,
				type: "evolution",
				createdAt: e.createdAt
			}))
		].sort((a, b) => b.createdAt - a.createdAt);
	}
};
var DEFAULT_BROWSER_POLICY = `# Keating Hyperteacher Policy

## Teaching Approach
- Diagnose before teaching
- Guide with questions, not lectures
- Encourage reconstruction over memorization
- Test knowledge transfer to new contexts
- Preserve learner voice and articulation

## Response Style
- Be patient and encouraging
- Celebrate genuine understanding
- Gently redirect rote responses
- Adapt to learner pace
`;
//#endregion
//#region src/keating/core.ts
function clamp(value, min = 0, max = 1) {
	return Math.max(min, Math.min(max, value));
}
function mean(values) {
	if (values.length === 0) return 0;
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}
function slugify(text) {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function titleCase(text) {
	return text.split(/\s+/).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}
var Prng = class {
	state;
	constructor(seed) {
		this.state = seed;
	}
	next() {
		this.state = this.state * 1103515245 + 12345 & 2147483647;
		return this.state / 2147483647;
	}
	int(min, max) {
		return Math.floor(min + this.next() * (max - min + 1));
	}
};
var TOPICS = {
	derivative: {
		slug: "derivative",
		title: "Derivative",
		domain: "math",
		summary: "The derivative measures how a quantity changes at an instant.",
		intuition: ["Start with average change over an interval, then shrink the interval toward a point.", "Connect slope-of-a-graph intuition to motion: velocity is the derivative of position."],
		formalCore: ["Define the derivative as the limit of the difference quotient.", "Explain differentiability as a stronger condition than continuity."],
		prerequisites: [
			"functions",
			"limits",
			"slope"
		],
		misconceptions: ["A derivative is not just plugging into a formula; it is an instantaneous rate of change.", "Continuity does not guarantee differentiability."],
		examples: ["Differentiate x^2 and interpret the result geometrically.", "Use position and velocity for a moving particle."],
		exercises: ["Estimate a derivative from a table of values.", "Compare a secant line and a tangent line."],
		reflections: ["Why does shrinking the interval change average rate into instantaneous rate?", "What physical quantity becomes easier to reason about once you have derivatives?"],
		diagramNodes: [
			"Prerequisites",
			"Intuition",
			"Limit",
			"Derivative",
			"Applications",
			"Exercises"
		],
		formalism: .85,
		visualizable: true,
		interdisciplinaryHooks: [
			"motion",
			"optimization",
			"scientific models"
		]
	},
	entropy: {
		slug: "entropy",
		title: "Entropy",
		domain: "science",
		summary: "Entropy tracks how many micro-configurations are compatible with what we observe macroscopically.",
		intuition: ["Contrast neat-looking states with the many more ways disorder can be arranged.", "Use information-theoretic intuition: surprising events carry more information."],
		formalCore: ["Relate thermodynamic entropy to multiplicity and log-counting.", "Show the bridge to Shannon entropy for distributions."],
		prerequisites: [
			"probability",
			"energy",
			"microstate vs macrostate"
		],
		misconceptions: ["Entropy is not simply 'chaos'; it is a count of compatible arrangements.", "Higher entropy does not mean less structure everywhere."],
		examples: ["Mixing two gases in a box.", "Comparing a fair coin to a biased coin."],
		exercises: ["Rank systems by relative entropy change.", "Explain why logarithms appear in entropy formulas."],
		reflections: ["When does entropy feel like information instead of physics?", "How does coarse-graining shape the meaning of entropy?"],
		diagramNodes: [
			"Multiplicity",
			"Macrostate",
			"Entropy",
			"Information",
			"Arrow of Time"
		],
		formalism: .78,
		visualizable: true,
		interdisciplinaryHooks: [
			"information theory",
			"statistical mechanics",
			"machine learning"
		]
	},
	bayes: {
		slug: "bayes-rule",
		title: "Bayes' Rule",
		domain: "math",
		summary: "Bayes' rule updates beliefs when new evidence arrives.",
		intuition: ["Start with prior belief and then scale it by how compatible the evidence is with each hypothesis.", "Use base-rate reasoning to avoid overreacting to a positive test."],
		formalCore: ["Derive Bayes' rule from conditional probability.", "Separate prior, likelihood, evidence, and posterior."],
		prerequisites: [
			"conditional probability",
			"fractions",
			"base rates"
		],
		misconceptions: ["A highly accurate test can still produce many false positives.", "Posterior probability is not the same as likelihood."],
		examples: ["Medical testing with rare disease prevalence.", "Spam filtering using prior and evidence."],
		exercises: ["Compute a posterior from a confusion matrix.", "Explain the difference between P(A|B) and P(B|A)."],
		reflections: ["How do priors encode context rather than bias in the pejorative sense?", "When should you distrust your own posterior?"],
		diagramNodes: [
			"Prior",
			"Evidence",
			"Likelihood",
			"Posterior",
			"Decision"
		],
		formalism: .8,
		visualizable: true,
		interdisciplinaryHooks: [
			"diagnostics",
			"scientific inference",
			"epistemology"
		]
	},
	recursion: {
		slug: "recursion",
		title: "Recursion",
		domain: "code",
		summary: "Recursion solves a problem by having a function call itself on a smaller subproblem until it reaches a base case.",
		intuition: ["Think of Russian nesting dolls: open one to find a smaller version of the same thing inside.", "Every recursive process needs a stopping point (base case) and a way to get closer to it."],
		formalCore: ["A recursive function calls itself with arguments that converge toward a base case.", "The call stack stores each invocation's local state until the base case returns."],
		prerequisites: [
			"functions",
			"call stack",
			"conditional branching"
		],
		misconceptions: ["Stack overflow is not the same as infinite recursion; it is the consequence of unbounded recursion hitting memory limits.", "Recursion is not inherently slower than iteration; tail-call optimization can make them equivalent."],
		examples: ["Factorial: n! = n * (n-1)! with base case 0! = 1.", "Fibonacci sequence computed recursively, then improved with memoization."],
		exercises: ["Trace the call stack for factorial(4) by hand.", "Convert a recursive function to an iterative one using an explicit stack."],
		reflections: ["When is recursion clearer than iteration, and when is it a trap?", "How does memoization change the computational cost of naive recursion?"],
		diagramNodes: [
			"Base Case",
			"Recursive Case",
			"Call Stack",
			"Return Path",
			"Subproblem"
		],
		formalism: .75,
		visualizable: true,
		interdisciplinaryHooks: [
			"mathematical induction",
			"fractal geometry",
			"divide and conquer algorithms"
		]
	}
};
var DOMAIN_KEYWORDS = {
	function: "code",
	algorithm: "code",
	programming: "code",
	code: "code",
	class: "code",
	database: "code",
	theorem: "math",
	proof: "math",
	calculus: "math",
	algebra: "math",
	evolution: "science",
	quantum: "science",
	relativity: "science",
	ethics: "philosophy",
	logic: "philosophy",
	court: "law",
	statute: "law",
	democracy: "politics",
	memory: "psychology",
	diagnosis: "medicine",
	painting: "arts",
	music: "arts",
	war: "history",
	revolution: "history"
};
function guessDomain(slug) {
	const words = slug.split("-");
	for (const word of words) if (DOMAIN_KEYWORDS[word]) return DOMAIN_KEYWORDS[word];
	return "general";
}
function buildFallbackTopic(rawTopic) {
	const title = titleCase(rawTopic.trim());
	const slug = slugify(rawTopic);
	const domain = guessDomain(slug);
	return {
		slug,
		title,
		domain,
		summary: `${title} taught through intuition first, then structure, then transfer.`,
		intuition: [`Explain ${title} in concrete language before formal vocabulary.`, `Anchor ${title} in one memorable metaphor and one real-world example.`],
		formalCore: [`State the core definition or thesis of ${title}.`, `Separate assumptions, mechanism, and scope of ${title}.`],
		prerequisites: ["basic vocabulary", "one motivating example"],
		misconceptions: [`${title} is not just a slogan; it has structure, assumptions, and trade-offs.`, `Confusing an example of ${title} with the whole concept usually causes shallow understanding.`],
		examples: [`Give one scientific or mathematical example connected to ${title}.`],
		exercises: [`Ask the learner to explain ${title} in their own words.`],
		reflections: [`What would mastery of ${title} let you predict, compute, or judge better?`, `Where would ${title} likely break down or become controversial?`],
		diagramNodes: [
			"Motivation",
			"Definition",
			"Mechanism",
			"Examples",
			"Limits",
			"Transfer"
		],
		formalism: domain === "math" ? .75 : domain === "code" ? .7 : .55,
		visualizable: true,
		interdisciplinaryHooks: [
			"comparison",
			"application",
			"critique"
		]
	};
}
function resolveTopic(query) {
	const normalized = slugify(query);
	return TOPICS[normalized] ?? TOPICS[normalized.replace(/-rule$/, "")] ?? buildFallbackTopic(query);
}
function benchmarkTopics(focusTopic) {
	if (focusTopic?.trim()) return [resolveTopic(focusTopic)];
	return Object.values(TOPICS);
}
var DEFAULT_POLICY = {
	name: "keating-default",
	analogyDensity: .6,
	socraticRatio: .55,
	formalism: .5,
	retrievalPractice: .7,
	exerciseCount: 4,
	diagramBias: .45,
	reflectionBias: .5,
	interdisciplinaryBias: .4,
	challengeRate: .35
};
function clampPolicy(policy) {
	return {
		...policy,
		analogyDensity: clamp(policy.analogyDensity),
		socraticRatio: clamp(policy.socraticRatio),
		formalism: clamp(policy.formalism),
		retrievalPractice: clamp(policy.retrievalPractice),
		exerciseCount: Math.max(1, Math.min(8, policy.exerciseCount)),
		diagramBias: clamp(policy.diagramBias),
		reflectionBias: clamp(policy.reflectionBias),
		interdisciplinaryBias: clamp(policy.interdisciplinaryBias),
		challengeRate: clamp(policy.challengeRate)
	};
}
function prerequisiteBullets(topic) {
	return topic.prerequisites.map((item) => `Recall ${item} and connect it to ${topic.title}.`);
}
function misconceptionBullets(topic) {
	return topic.misconceptions.map((item) => `Address misconception: ${item}`);
}
function practiceBullets(topic, exerciseCount) {
	const bullets = [...topic.exercises];
	while (bullets.length < exerciseCount) bullets.push(`Invent a new example that makes ${topic.title} easier to explain.`);
	return bullets.slice(0, exerciseCount).map((item) => `Practice: ${item}`);
}
function buildLessonPlan(topicName, policy) {
	const topic = resolveTopic(topicName);
	const phases = [
		{
			id: "orient",
			title: "Orientation",
			purpose: "Assess prerequisites and frame the core question.",
			bullets: [`State the big question: ${topic.summary}`, ...prerequisiteBullets(topic)]
		},
		{
			id: "intuition",
			title: "Intuition",
			purpose: "Teach the concept concretely before pushing notation or abstract framing.",
			bullets: topic.intuition.map((item) => `Intuition: ${item}`)
		},
		{
			id: "formal-core",
			title: "Formal Core",
			purpose: "Escalate into rigorous structure once intuition has traction.",
			bullets: topic.formalCore.map((item) => `Formal: ${item}`)
		},
		{
			id: "misconceptions",
			title: "Misconception Repair",
			purpose: "Anticipate predictable mistakes before they calcify.",
			bullets: misconceptionBullets(topic)
		},
		{
			id: "examples",
			title: "Worked Examples",
			purpose: "Move between examples so the learner sees the invariant structure.",
			bullets: topic.examples.map((item) => `Example: ${item}`)
		},
		{
			id: "practice",
			title: "Guided Practice",
			purpose: "Force retrieval and re-expression, not passive agreement.",
			bullets: practiceBullets(topic, policy.exerciseCount)
		},
		{
			id: "transfer",
			title: "Transfer and Reflection",
			purpose: "Bridge the concept across domains and make the learner summarize what changed.",
			bullets: [...topic.reflections.map((item) => `Reflect: ${item}`), `Bridge ${topic.title} into: ${topic.interdisciplinaryHooks.join(", ")}.`]
		}
	];
	if (policy.diagramBias >= .55) phases.splice(4, 0, {
		id: "diagram",
		title: "Diagram",
		purpose: "Compress the concept into a visual structure before free recall.",
		bullets: [`Map the concept using nodes: ${topic.diagramNodes.join(" -> ")}.`, `Ask the learner to narrate the diagram without reading from it.`]
	});
	if (policy.socraticRatio >= .6) {
		phases[0].bullets.unshift(`Open with a diagnostic question instead of a lecture on ${topic.title}.`);
		phases[5].bullets.unshift(`Pause after each practice step and ask the learner to predict the next move.`);
	}
	if (topic.domain === "code") {
		const exIdx = phases.findIndex((p) => p.id === "examples");
		if (exIdx !== -1) phases.splice(exIdx + 1, 0, {
			id: "live-code",
			title: "Live Code",
			purpose: "Write and trace runnable code so the learner sees the concept execute.",
			bullets: [
				`Write a minimal runnable example demonstrating ${topic.title}.`,
				"Step through execution line by line, narrating state changes.",
				"Ask the learner to predict output before running."
			]
		});
	}
	return {
		topic,
		policy,
		phases
	};
}
function lessonPlanToMarkdown(plan) {
	const lines = [
		`# Lesson Plan: ${plan.topic.title}`,
		"",
		`- Domain: ${plan.topic.domain}`,
		`- Policy: ${plan.policy.name}`,
		`- Summary: ${plan.topic.summary}`,
		""
	];
	for (const phase of plan.phases) {
		lines.push(`## ${phase.title}`);
		lines.push(phase.purpose);
		lines.push("");
		for (const bullet of phase.bullets) lines.push(`- ${bullet}`);
		lines.push("");
	}
	return `${lines.join("\n").trim()}\n`;
}
function buildConceptMap(topicName) {
	const topic = resolveTopic(topicName);
	const nodes = topic.diagramNodes;
	return `graph TD
    A[${topic.title}] --> B[Core Concepts]
    A --> C[Applications]
    A --> D[Related Topics]

    B --> B1[${nodes[0] || "Prerequisites"}]
    B --> B2[${nodes[1] || "Intuition"}]
    B --> B3[${nodes[2] || "Formal Structure"}]

    C --> C1[Practical Use]
    C --> C2[Real-world Examples]

    D --> D1[${topic.interdisciplinaryHooks[0] || "Connections"}]
    D --> D2[Advanced Topics]

    style A fill:#d44a3d,color:#fff
    style B fill:#3043a6,color:#fff
    style C fill:#047857,color:#fff
    style D fill:#64748b,color:#fff`;
}
function buildLearnerPopulation(seed, count) {
	const prng = new Prng(seed);
	const learners = [];
	for (let index = 0; index < count; index += 1) learners.push({
		id: `learner-${seed}-${index}`,
		priorKnowledge: prng.next(),
		abstractionComfort: prng.next(),
		analogyNeed: prng.next(),
		dialoguePreference: prng.next(),
		diagramAffinity: prng.next(),
		persistence: prng.next(),
		transferDesire: prng.next(),
		anxiety: prng.next()
	});
	return learners;
}
function simulateTeaching(policy, topic, learner) {
	const intuitionFit = 1 - Math.abs(policy.analogyDensity - learner.analogyNeed);
	const rigorTarget = clamp((topic.formalism + learner.abstractionComfort) / 2);
	const rigorFit = 1 - Math.abs(policy.formalism - rigorTarget);
	const dialogueFit = 1 - Math.abs(policy.socraticRatio - learner.dialoguePreference);
	const diagramTarget = topic.visualizable ? learner.diagramAffinity : .2;
	const diagramFit = 1 - Math.abs(policy.diagramBias - diagramTarget);
	const practiceNeed = clamp(1 - learner.priorKnowledge + learner.anxiety * .2);
	const practiceFit = 1 - Math.abs(policy.exerciseCount / 5 - practiceNeed);
	const reflectionFit = 1 - Math.abs(policy.reflectionBias - learner.transferDesire);
	const overload = clamp(policy.formalism * .35 + policy.exerciseCount / 5 * .15 + policy.challengeRate * .3 - learner.persistence * .2 + learner.anxiety * .25 - learner.priorKnowledge * .15);
	const masteryGain = clamp(.14 + intuitionFit * .18 + rigorFit * .2 + dialogueFit * .12 + diagramFit * .09 + practiceFit * .12 + (1 - overload) * .18);
	const retention = clamp(masteryGain * (.55 + policy.retrievalPractice * .45));
	const engagement = clamp(.12 + intuitionFit * .16 + dialogueFit * .16 + diagramFit * .1 + reflectionFit * .14 + (1 - overload) * .18);
	const transfer = clamp(retention * (.55 + policy.interdisciplinaryBias * .25 + learner.transferDesire * .2));
	const confusion = clamp(.04 + overload * .55 + Math.abs(policy.formalism - learner.abstractionComfort) * .18 + Math.abs(policy.challengeRate - learner.persistence) * .12);
	const score = clamp(masteryGain * .34 + retention * .2 + engagement * .16 + transfer * .18 - confusion * .18, 0, 1);
	const explanation = [];
	if (intuitionFit >= .8) explanation.push("analogy pacing matched the learner well");
	if (rigorFit >= .8) explanation.push("formal depth fit the learner's abstraction comfort");
	if (practiceFit >= .75) explanation.push("exercise load matched the learner's need for repetition");
	if (reflectionFit >= .75) explanation.push("reflection and transfer demands aligned with the learner");
	if (overload >= .55) explanation.push("challenge and formal load pushed the learner toward overload");
	if (diagramFit <= .45) explanation.push("diagram emphasis mismatched the learner's visual preference");
	if (explanation.length === 0) explanation.push("the lesson was balanced but not strongly optimized for this learner");
	return {
		learner,
		topic,
		masteryGain,
		retention,
		engagement,
		transfer,
		confusion,
		score,
		breakdown: {
			intuitionFit,
			rigorFit,
			dialogueFit,
			diagramFit,
			practiceFit,
			reflectionFit,
			overload
		},
		explanation
	};
}
function classifyDominantSignal(simulations, kind) {
	const metrics = {
		intuitionFit: mean(simulations.map((entry) => entry.breakdown.intuitionFit)),
		rigorFit: mean(simulations.map((entry) => entry.breakdown.rigorFit)),
		dialogueFit: mean(simulations.map((entry) => entry.breakdown.dialogueFit)),
		diagramFit: mean(simulations.map((entry) => entry.breakdown.diagramFit)),
		practiceFit: mean(simulations.map((entry) => entry.breakdown.practiceFit)),
		reflectionFit: mean(simulations.map((entry) => entry.breakdown.reflectionFit)),
		overload: mean(simulations.map((entry) => entry.breakdown.overload))
	};
	const [name] = Object.entries(metrics).sort((left, right) => kind === "strength" ? right[1] - left[1] : left[1] - right[1])[0] ?? ["unknown"];
	return name;
}
function summarizeTopic(topic, simulations, traceLimit) {
	const ranked = [...simulations].sort((left, right) => right.score - left.score);
	return {
		topic,
		learnerCount: simulations.length,
		meanScore: mean(simulations.map((entry) => entry.score)) * 100,
		meanMasteryGain: mean(simulations.map((entry) => entry.masteryGain)),
		meanRetention: mean(simulations.map((entry) => entry.retention)),
		meanEngagement: mean(simulations.map((entry) => entry.engagement)),
		meanTransfer: mean(simulations.map((entry) => entry.transfer)),
		meanConfusion: mean(simulations.map((entry) => entry.confusion)),
		topLearners: ranked.slice(0, traceLimit),
		strugglingLearners: ranked.slice(-traceLimit).reverse(),
		dominantStrength: classifyDominantSignal(simulations, "strength"),
		dominantWeakness: classifyDominantSignal(simulations, "weakness")
	};
}
function runBenchmarkSuite(policy, focusTopic, seed = 20260401, traceLimit = 3) {
	const topicBenchmarks = benchmarkTopics(focusTopic).map((topic, index) => {
		return summarizeTopic(topic, buildLearnerPopulation(seed + index * 97, 18).map((learner) => simulateTeaching(policy, topic, learner)), traceLimit);
	});
	const weakest = [...topicBenchmarks].sort((left, right) => left.meanScore - right.meanScore)[0];
	return {
		policy,
		suiteName: focusTopic ? `focused:${focusTopic}` : "core-suite",
		topicBenchmarks,
		overallScore: mean(topicBenchmarks.map((entry) => entry.meanScore)),
		weakestTopic: weakest?.topic.title ?? "n/a"
	};
}
function benchmarkToMarkdown(result) {
	const lines = [
		`# Benchmark Report: ${result.policy.name}`,
		"",
		`- Suite: ${result.suiteName}`,
		`- Overall score: ${result.overallScore.toFixed(2)}`,
		`- Weakest topic: ${result.weakestTopic}`,
		"",
		"| Topic | Score | Mastery | Retention | Engagement | Transfer | Confusion |",
		"| --- | ---: | ---: | ---: | ---: | ---: | ---: |"
	];
	for (const benchmark of result.topicBenchmarks) lines.push(`| ${benchmark.topic.title} | ${benchmark.meanScore.toFixed(2)} | ${benchmark.meanMasteryGain.toFixed(2)} | ${benchmark.meanRetention.toFixed(2)} | ${benchmark.meanEngagement.toFixed(2)} | ${benchmark.meanTransfer.toFixed(2)} | ${benchmark.meanConfusion.toFixed(2)} |`);
	lines.push("");
	lines.push("## Interpretation");
	lines.push("");
	lines.push(`- The policy currently underperforms most on ${result.weakestTopic}, which is a useful anchor for mutation and curriculum repair.`);
	lines.push("");
	return `${lines.join("\n")}\n`;
}
function mutateScalar(prng, value, amplitude = .18) {
	return clamp(value + (prng.next() * 2 - 1) * amplitude);
}
function mutatePolicy(parent, prng, iteration) {
	return clampPolicy({
		...parent,
		name: `keating-candidate-${iteration}`,
		analogyDensity: mutateScalar(prng, parent.analogyDensity),
		socraticRatio: mutateScalar(prng, parent.socraticRatio),
		formalism: mutateScalar(prng, parent.formalism),
		retrievalPractice: mutateScalar(prng, parent.retrievalPractice),
		exerciseCount: parent.exerciseCount + prng.int(-1, 1),
		diagramBias: mutateScalar(prng, parent.diagramBias),
		reflectionBias: mutateScalar(prng, parent.reflectionBias),
		interdisciplinaryBias: mutateScalar(prng, parent.interdisciplinaryBias),
		challengeRate: mutateScalar(prng, parent.challengeRate)
	});
}
function policyVector(policy) {
	return [
		policy.analogyDensity,
		policy.socraticRatio,
		policy.formalism,
		policy.retrievalPractice,
		policy.exerciseCount / 5,
		policy.diagramBias,
		policy.reflectionBias,
		policy.interdisciplinaryBias,
		policy.challengeRate
	];
}
function euclideanDistance(a, b) {
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
	return Math.sqrt(sum / a.length);
}
function noveltyScore(existingPolicies, candidate) {
	if (existingPolicies.length === 0) return 1;
	const candidateVec = policyVector(candidate);
	let minDist = Infinity;
	for (const existing of existingPolicies) {
		const dist = euclideanDistance(candidateVec, policyVector(existing));
		minDist = Math.min(minDist, dist);
	}
	return minDist;
}
function diffPolicy(before, after) {
	return [
		"analogyDensity",
		"socraticRatio",
		"formalism",
		"retrievalPractice",
		"exerciseCount",
		"diagramBias",
		"reflectionBias",
		"interdisciplinaryBias",
		"challengeRate"
	].map((field) => {
		const previous = before[field];
		const next = after[field];
		return {
			field,
			before: previous,
			after: next,
			delta: typeof previous === "number" && typeof next === "number" ? next - previous : 0
		};
	}).filter((entry) => entry.delta !== 0);
}
function evolvePolicy(basePolicy, focusTopic, iterations = 12, seed = 20260401) {
	const baseline = runBenchmarkSuite(basePolicy, focusTopic, seed);
	let best = baseline;
	const acceptedCandidates = [];
	const exploredCandidates = [];
	const prng = new Prng(seed + 17);
	const seen = [basePolicy];
	for (let iteration = 1; iteration <= iterations; iteration += 1) {
		const candidatePolicy = mutatePolicy(best.policy, prng, iteration);
		const novelty = noveltyScore(seen, candidatePolicy);
		const candidateBenchmark = runBenchmarkSuite(candidatePolicy, focusTopic, seed + iteration * 11);
		const parameterDelta = diffPolicy(best.policy, candidatePolicy);
		const bestWeakest = Math.min(...best.topicBenchmarks.map((entry) => entry.meanScore));
		const candidateWeakest = Math.min(...candidateBenchmark.topicBenchmarks.map((entry) => entry.meanScore));
		const improves = candidateBenchmark.overallScore > best.overallScore;
		const safe = candidateWeakest >= bestWeakest - 1.5;
		const novelEnough = novelty >= .05;
		const candidate = {
			policy: candidatePolicy,
			benchmark: candidateBenchmark,
			parentName: best.policy.name,
			iteration,
			novelty,
			accepted: false,
			decision: {
				improves,
				safe,
				novelEnough,
				scoreDelta: candidateBenchmark.overallScore - best.overallScore,
				weakestTopicDelta: candidateWeakest - bestWeakest,
				reasons: []
			},
			parameterDelta
		};
		if (improves) candidate.decision.reasons.push(`overall score improved by ${candidate.decision.scoreDelta.toFixed(2)}`);
		else candidate.decision.reasons.push(`overall score regressed by ${Math.abs(candidate.decision.scoreDelta).toFixed(2)}`);
		if (safe) candidate.decision.reasons.push(`weakest-topic score stayed within tolerance (${candidate.decision.weakestTopicDelta.toFixed(2)})`);
		else candidate.decision.reasons.push(`weakest-topic score fell too far (${candidate.decision.weakestTopicDelta.toFixed(2)})`);
		if (novelEnough) candidate.decision.reasons.push(`novelty ${novelty.toFixed(3)} cleared the 0.05 threshold`);
		else candidate.decision.reasons.push(`novelty ${novelty.toFixed(3)} was too close to archived policies`);
		if (improves && safe && novelEnough) {
			candidate.accepted = true;
			best = candidateBenchmark;
			acceptedCandidates.push(candidate);
		}
		exploredCandidates.push(candidate);
		seen.push(candidate.policy);
	}
	return {
		baseline,
		best,
		acceptedCandidates,
		exploredCandidates,
		bestPolicy: best.policy
	};
}
function evolutionToMarkdown(run) {
	const lines = [
		`# Evolution Report: ${run.best.policy.name}`,
		"",
		`- Baseline score: ${run.baseline.overallScore.toFixed(2)}`,
		`- Best score: ${run.best.overallScore.toFixed(2)}`,
		`- Accepted candidates: ${run.acceptedCandidates.length}`,
		`- Explored candidates: ${run.exploredCandidates.length}`,
		"",
		"## Accepted Candidates",
		""
	];
	if (run.acceptedCandidates.length === 0) lines.push("- No candidate cleared both the novelty and safety gates in this run.");
	else for (const candidate of run.acceptedCandidates) lines.push(`- Iteration ${candidate.iteration}: ${candidate.policy.name} scored ${candidate.benchmark.overallScore.toFixed(2)} with novelty ${candidate.novelty.toFixed(3)}.`);
	lines.push("");
	lines.push("## Best Policy Parameters");
	lines.push("");
	lines.push(`- analogyDensity: ${run.bestPolicy.analogyDensity.toFixed(3)}`);
	lines.push(`- socraticRatio: ${run.bestPolicy.socraticRatio.toFixed(3)}`);
	lines.push(`- formalism: ${run.bestPolicy.formalism.toFixed(3)}`);
	lines.push(`- exerciseCount: ${run.bestPolicy.exerciseCount}`);
	lines.push(`- diagramBias: ${run.bestPolicy.diagramBias.toFixed(3)}`);
	lines.push("");
	return `${lines.join("\n")}\n`;
}
function heuristicPromptEvaluation(promptContent) {
	const body = promptContent.toLowerCase();
	const objectives = {
		voice_divergence: clamp(.35 + (body.includes("own words") ? .18 : 0) + (body.includes("personal") ? .15 : 0)),
		diagnosis: clamp(.4 + (body.includes("prerequisite") ? .16 : 0) + (body.includes("misconception") ? .12 : 0)),
		verification: clamp(.2 + (body.includes("verify") ? .18 : 0) + (body.includes("source") ? .15 : 0)),
		retrieval: clamp(.35 + (body.includes("retrieval") ? .18 : 0) + (body.includes("recall") ? .12 : 0)),
		transfer: clamp(.3 + (body.includes("transfer") ? .18 : 0) + (body.includes("bridge") ? .12 : 0)),
		structure: clamp(.45 + (body.includes("diagnose") ? .09 : 0) + (body.includes("reflect") ? .09 : 0))
	};
	const feedback = [];
	if (objectives.voice_divergence < .7) feedback.push("Add an explicit requirement that the learner restate the idea in their own words.");
	if (objectives.diagnosis < .7) feedback.push("Strengthen diagnosis of prerequisite gaps and misconceptions before teaching.");
	if (objectives.verification < .7) feedback.push("Include a step that distinguishes verified claims from claims that still need checking.");
	if (objectives.retrieval < .7) feedback.push("Add a retrieval checkpoint that requires reconstruction rather than agreement.");
	if (objectives.transfer < .7) feedback.push("Bridge the concept into a different domain or practical context before ending.");
	return {
		score: objectives.voice_divergence * 14 + objectives.diagnosis * 20 + objectives.verification * 18 + objectives.retrieval * 18 + objectives.transfer * 16 + objectives.structure * 14,
		objectives,
		feedback
	};
}
function evaluatePrompt(promptContent) {
	return heuristicPromptEvaluation(promptContent);
}
function diagnoseBenchmark(benchmark) {
	const suggestions = [];
	const weakest = [...benchmark.topicBenchmarks].sort((a, b) => a.meanScore - b.meanScore)[0];
	if (weakest && weakest.meanScore < 55) suggestions.push({
		area: `Topic: ${weakest.topic.title}`,
		metric: "meanScore",
		value: weakest.meanScore,
		suggestion: `Consider enriching the topic definition for "${weakest.topic.title}" with better intuition hooks or clearer misconceptions.`
	});
	const allConfusion = mean(benchmark.topicBenchmarks.map((t) => t.meanConfusion));
	if (allConfusion > .3) suggestions.push({
		area: "Learner Confusion",
		metric: "meanConfusion",
		value: allConfusion,
		suggestion: "Reduce cognitive load by pacing analogies more slowly or breaking formal content into smaller chunks."
	});
	const allTransfer = mean(benchmark.topicBenchmarks.map((t) => t.meanTransfer));
	if (allTransfer < .35) suggestions.push({
		area: "Knowledge Transfer",
		metric: "meanTransfer",
		value: allTransfer,
		suggestion: "Strengthen interdisciplinary hooks and add explicit transfer exercises."
	});
	return suggestions;
}
//#endregion
//#region src/keating/browser-tools.ts
var KEATING_SYSTEM_PROMPT = `You are Keating, a hyperteacher designed for cognitive empowerment.

Your purpose is NOT to provide answers, but to ensure humans remain the authors of their own understanding.

Core principles:
1. **Diagnosis First**: Before teaching, understand what the learner already knows and where their gaps lie.
2. **Reconstruction Over Regurgitation**: Make learners reconstruct ideas from memory, not merely agree with explanations.
3. **Transfer Testing**: Ask learners to carry ideas into new settings to prove genuine understanding.
4. **Voice Preservation**: Penalize rote echoing. Reward novel analogies and personal articulation.
5. **Socratic Patience**: Guide with questions, not lectures. Let insights emerge from the learner.

*"That you are here—that life exists and identity, that the powerful play goes on, and you may contribute a verse."*

Your role is to ensure every learner is equipped to contribute their own verse.

## Available Commands
Use these slash commands to help learners:

- \`/plan <topic>\` - Generate a structured lesson plan for a topic
- \`/map <topic>\` - Create a visual Mermaid concept map
- \`/animate <topic>\` - Generate an animation storyboard
- \`/verify <topic>\` - Create a fact-checking checklist
- \`/bench\` - Run a synthetic learner benchmark
- \`/evolve\` - Improve the teaching policy through evolution
- \`/feedback <up|down|confused> [topic]\` - Record learning feedback
- \`/policy\` - Show the current teaching policy
- \`/outputs\` - Browse all saved artifacts
- \`/state\` - Show your learner profile
- \`/improve\` - Get improvement suggestions from benchmark diagnosis
- \`/trace\` - Browse benchmark and evolution traces
- \`/prompt-eval\` - Evaluate a prompt template for teaching effectiveness
`;
function createSimpleTool(name, description, execute) {
	return {
		name,
		label: name,
		description,
		parameters: {
			type: "object",
			properties: {},
			additionalProperties: true
		},
		execute: async (params) => {
			return {
				success: true,
				message: await execute(params)
			};
		}
	};
}
async function createKeatingTools(storage) {
	return [
		createSimpleTool("plan", "Generate a structured lesson plan for a topic. Usage: /plan <topic>", async (params) => {
			const topic = params.topic || "";
			if (!topic) return "Please specify a topic. Usage: /plan <topic>";
			const policy = await storage.getActivePolicy();
			const plan = buildLessonPlan(topic, policy ? {
				name: policy.id,
				analogyDensity: .6,
				socraticRatio: .55,
				formalism: .5,
				retrievalPractice: .7,
				exerciseCount: 4,
				diagramBias: .45,
				reflectionBias: .5,
				interdisciplinaryBias: .4,
				challengeRate: .35
			} : DEFAULT_POLICY);
			const markdown = lessonPlanToMarkdown(plan);
			await storage.saveLessonPlan(topic, markdown, {
				domain: plan.topic.domain,
				phaseCount: plan.phases.length
			});
			return `📚 Lesson plan created for "${topic}"\n\n${markdown}\n\n[Saved to browser storage]`;
		}),
		createSimpleTool("map", "Generate a Mermaid concept map for a topic. Usage: /map <topic>", async (params) => {
			const topic = params.topic || "";
			if (!topic) return "Please specify a topic. Usage: /map <topic>";
			const mapContent = buildConceptMap(topic);
			await storage.saveLessonMap(topic, mapContent);
			return `🗺️ Concept map for "${topic}"\n\n\`\`\`mermaid\n${mapContent}\n\`\`\`\n\n[Saved to browser storage]`;
		}),
		createSimpleTool("animate", "Generate an animation storyboard for a topic. Usage: /animate <topic>", async (params) => {
			const topic = params.topic || "";
			if (!topic) return "Please specify a topic. Usage: /animate <topic>";
			const resolved = resolveTopic(topic);
			const storyboard = `# Animation Storyboard: ${resolved.title}

## Scene 1: Introduction (0-2s)
- **Visual**: Title card with "${resolved.title}"
- **Transition**: Fade in
- **Audio**: Brief hook from summary

## Scene 2: Intuition Phase (2-8s)
- **Visual**: ${resolved.intuition[0] || "Animated diagram showing key concept"}
- **Duration**: 6s
- **Narration**: Concrete example before formal language

## Scene 3: Formal Structure (8-15s)
- **Visual**: ${resolved.formalCore[0] || "Step-by-step formal definition"}
- **Duration**: 7s
- **Highlight**: Key definitions and relationships

## Scene 4: Misconception Repair (15-20s)
- **Visual**: Common mistake vs correct understanding
- **Duration**: 5s
- **Overlay**: Warning indicators

## Scene 5: Examples (20-28s)
- **Visual**: ${resolved.examples[0] || "Worked example"}
- **Duration**: 8s
- **Step-through**: Incremental reveal

## Scene 6: Transfer (28-35s)
- **Visual**: Bridge to ${resolved.interdisciplinaryHooks.slice(0, 2).join(", ")}
- **Duration**: 7s
- **Transition**: Fade out with summary
`;
			const scene = `// Scene: ${resolved.title}
// Manim-web compatible scene definition

class ${resolved.slug.replace(/-/g, "_").replace(/^(.)/, (c) => c.toUpperCase())}Scene extends Scene {
  construct() {
    // Scene 1: Introduction
    this.play(FadeIn(title("${resolved.title}")));
    
    // Scene 2: Intuition
    this.play(Create(intuitionDiagram));
    
    // Scene 3: Formal
    this.play(Write(formalDefinition));
    
    // Scene 4: Misconceptions
    this.play(Indicate(commonMistake), Transform(commonMistake, correctVersion));
    
    // Scene 5: Examples
    this.play(Create(exampleVisual));
    
    // Scene 6: Transfer
    this.play(FadeOut(title("${resolved.title}")));
  }
}`;
			const manifest = JSON.stringify({
				topic: resolved.title,
				slug: resolved.slug,
				domain: resolved.domain,
				scenes: [
					"intro",
					"intuition",
					"formal",
					"misconceptions",
					"examples",
					"transfer"
				],
				duration: 35,
				generatedAt: (/* @__PURE__ */ new Date()).toISOString()
			}, null, 2);
			await storage.saveAnimation(topic, storyboard, scene, manifest);
			return `🎬 Animation storyboard for "${topic}"\n\n${storyboard}\n\n[Saved to browser storage]`;
		}),
		createSimpleTool("verify", "Generate a fact-checking checklist for a topic. Usage: /verify <topic>", async (params) => {
			const topic = params.topic || "";
			if (!topic) return "Please specify a topic. Usage: /verify <topic>";
			const resolved = resolveTopic(topic);
			const checklist = `# Verification Checklist: ${resolved.title}

Before teaching this topic, verify your knowledge:

## Core Facts
- [ ] I can define ${resolved.title} precisely
- [ ] I know 3+ real-world applications
- [ ] I understand the limitations

## Common Misconceptions
${resolved.misconceptions.map((m) => `- [ ] I can explain why "${m}" is wrong`).join("\n")}
- [ ] I have counterexamples ready

## Prerequisites
${resolved.prerequisites.map((p) => `- [ ] Learners need: ${p}`).join("\n")}
- [ ] I can assess prerequisite knowledge
- [ ] I have bridge materials if needed

## Edge Cases
- [ ] I know where ${resolved.title} doesn't apply
- [ ] I can handle "what if" questions
- [ ] I understand advanced extensions

## Sources Verified
- [ ] Primary sources checked
- [ ] Multiple sources agree
- [ ] Recent developments included

---
Complete this checklist before teaching ${resolved.title}.
`;
			await storage.saveVerification(topic, checklist);
			return `✅ Verification checklist for "${topic}"\n\n${checklist}\n\n[Saved to browser storage]`;
		}),
		createSimpleTool("bench", "Run a synthetic learner benchmark. Usage: /bench [topic]", async (params) => {
			const topic = params.topic;
			const policy = await storage.getActivePolicy();
			const result = runBenchmarkSuite(policy ? {
				name: policy.id,
				analogyDensity: .6,
				socraticRatio: .55,
				formalism: .5,
				retrievalPractice: .7,
				exerciseCount: 4,
				diagramBias: .45,
				reflectionBias: .5,
				interdisciplinaryBias: .4,
				challengeRate: .35
			} : DEFAULT_POLICY, topic);
			const report = benchmarkToMarkdown(result);
			await storage.saveBenchmark(result.overallScore, report, topic, JSON.stringify(result.trace, null, 2));
			return `📊 Benchmark complete!\n\n**Overall Score:** ${result.overallScore.toFixed(2)}/100\n\n${report}`;
		}),
		createSimpleTool("evolve", "Evolve and improve the teaching policy. Usage: /evolve [topic]", async (params) => {
			const topic = params.topic;
			const policy = await storage.getActivePolicy();
			const run = evolvePolicy(policy ? {
				name: policy.id,
				analogyDensity: .6,
				socraticRatio: .55,
				formalism: .5,
				retrievalPractice: .7,
				exerciseCount: 4,
				diagramBias: .45,
				reflectionBias: .5,
				interdisciplinaryBias: .4,
				challengeRate: .35
			} : DEFAULT_POLICY, topic);
			const report = evolutionToMarkdown(run);
			await storage.savePolicy(`# Evolved Teaching Policy\n\nGenerated: ${(/* @__PURE__ */ new Date()).toISOString()}\nScore: ${run.best.overallScore.toFixed(2)}/100\n\n## Parameters\n- analogyDensity: ${run.bestPolicy.analogyDensity.toFixed(3)}\n- socraticRatio: ${run.bestPolicy.socraticRatio.toFixed(3)}\n- formalism: ${run.bestPolicy.formalism.toFixed(3)}\n- exerciseCount: ${run.bestPolicy.exerciseCount}\n- diagramBias: ${run.bestPolicy.diagramBias.toFixed(3)}\n`, true);
			await storage.saveEvolution(run.best.overallScore, JSON.stringify(run.bestPolicy), report, topic, JSON.stringify(run.exploredCandidates, null, 2));
			return `🧬 Policy evolved!\n\n**Best Score:** ${run.best.overallScore.toFixed(2)}/100\n**Baseline:** ${run.baseline.overallScore.toFixed(2)}/100\n**Accepted:** ${run.acceptedCandidates.length}/${run.exploredCandidates.length} candidates\n\n${report}`;
		}),
		createSimpleTool("feedback", "Record learning feedback. Usage: /feedback <up|down|confused> [topic]", async (params) => {
			const signal = {
				up: "thumbs-up",
				down: "thumbs-down",
				confused: "confused"
			}[params.signal || ""];
			if (!signal) return "Invalid signal. Use: /feedback <up|down|confused> [topic]";
			const topic = params.topic || "general";
			await storage.recordFeedback(topic, signal);
			return `${signal === "thumbs-up" ? "👍" : signal === "thumbs-down" ? "👎" : "🤔"} Feedback recorded: ${signal} for "${topic}"`;
		}),
		createSimpleTool("policy", "Show the current teaching policy. Usage: /policy", async () => {
			return `📋 Current Teaching Policy\n\n\`\`\`markdown\n${(await storage.getActivePolicy())?.content || DEFAULT_BROWSER_POLICY}\n\`\`\``;
		}),
		createSimpleTool("outputs", "Browse all saved Keating artifacts. Usage: /outputs", async () => {
			const artifacts = await storage.listArtifacts();
			if (artifacts.length === 0) return "No artifacts yet. Use /plan, /map, /animate, /verify, /bench, or /evolve first.";
			const list = artifacts.slice(0, 20).map((a) => `- ${a.label} (${new Date(a.createdAt).toLocaleDateString()})`).join("\n");
			return `📚 Keating Artifacts (${artifacts.length} total)\n\n${list}`;
		}),
		createSimpleTool("state", "Show your learner profile and progress. Usage: /state", async () => {
			const state = await storage.getLearnerState();
			const upCount = state.feedbackHistory.filter((f) => f.signal === "thumbs-up").length;
			const downCount = state.feedbackHistory.filter((f) => f.signal === "thumbs-down").length;
			const confusedCount = state.feedbackHistory.filter((f) => f.signal === "confused").length;
			return `👤 Learner Profile

**Topics Explored:** ${state.topicsExplored.length}
${state.topicsExplored.slice(-10).map((t) => `- ${t}`).join("\n") || "None yet"}

**Feedback History:**
- 👍 ${upCount} positive
- 👎 ${downCount} negative
- 🤔 ${confusedCount} confused

${state.lastSessionAt ? `**Last Session:** ${new Date(state.lastSessionAt).toLocaleString()}` : "**First Session:** Welcome to Keating!"}`;
		}),
		createSimpleTool("improve", "Get improvement suggestions from benchmark diagnosis. Usage: /improve", async () => {
			const policy = await storage.getActivePolicy();
			const benchmark = runBenchmarkSuite(policy ? {
				name: policy.id,
				analogyDensity: .6,
				socraticRatio: .55,
				formalism: .5,
				retrievalPractice: .7,
				exerciseCount: 4,
				diagramBias: .45,
				reflectionBias: .5,
				interdisciplinaryBias: .4,
				challengeRate: .35
			} : DEFAULT_POLICY);
			const suggestions = diagnoseBenchmark(benchmark);
			if (suggestions.length === 0) return `✅ Benchmark looks healthy!\n\nOverall score: ${benchmark.overallScore.toFixed(2)}/100\n\nNo major improvement areas identified.`;
			const suggestionList = suggestions.map((s, i) => `### ${i + 1}. ${s.area}\n- **Metric**: ${s.metric} = ${s.value.toFixed(2)}\n- **Suggestion**: ${s.suggestion}`).join("\n\n");
			return `🔧 Improvement Suggestions\n\nBenchmark score: ${benchmark.overallScore.toFixed(2)}/100\n\n${suggestionList}`;
		}),
		createSimpleTool("trace", "Browse benchmark and evolution traces. Usage: /trace [type]", async (params) => {
			const type = params.type || "all";
			const benchmarks = await storage.getBenchmarks();
			const evolutions = await storage.getEvolutions();
			if (benchmarks.length === 0 && evolutions.length === 0) return "No traces yet. Use /bench or /evolve first.";
			const lines = ["📊 Keating Traces\n"];
			if (type === "all" || type === "benchmark") {
				lines.push("## Benchmarks");
				for (const b of benchmarks.slice(0, 10)) lines.push(`- ${b.topic || "general"}: ${b.score.toFixed(2)} (${new Date(b.createdAt).toLocaleDateString()})`);
				lines.push("");
			}
			if (type === "all" || type === "evolution") {
				lines.push("## Evolutions");
				for (const e of evolutions.slice(0, 10)) lines.push(`- ${e.topic || "general"}: ${e.bestScore.toFixed(2)} (${new Date(e.createdAt).toLocaleDateString()})`);
			}
			return lines.join("\n");
		}),
		createSimpleTool("prompt-eval", "Evaluate a prompt template for teaching effectiveness. Usage: /prompt-eval <prompt>", async (params) => {
			const promptContent = params.prompt || "";
			if (!promptContent) return "Please provide a prompt to evaluate. Usage: /prompt-eval <prompt>";
			const result = evaluatePrompt(promptContent);
			const objectiveList = Object.entries(result.objectives).map(([k, v]) => `- ${k}: ${v.toFixed(2)}`).join("\n");
			const feedbackSection = result.feedback.length > 0 ? `\n## Feedback\n${result.feedback.map((f) => `- ${f}`).join("\n")}` : "\n## Feedback\n- No major issues detected.";
			return `📝 Prompt Evaluation\n\n**Score:** ${result.score.toFixed(2)}/100\n\n## Objectives\n${objectiveList}${feedbackSection}`;
		})
	];
}
//#endregion
//#region src/hooks/useKeatingAgent.ts
var settingsStore = new SettingsStore();
var providerKeys = new ProviderKeysStore();
var sessions = new SessionsStore();
var customProviders = new CustomProvidersStore();
var backend = new IndexedDBStorageBackend({
	dbName: "keating",
	version: 1,
	stores: [
		settingsStore.getConfig(),
		providerKeys.getConfig(),
		sessions.getConfig(),
		SessionsStore.getMetadataConfig(),
		customProviders.getConfig()
	]
});
settingsStore.setBackend(backend);
providerKeys.setBackend(backend);
sessions.setBackend(backend);
customProviders.setBackend(backend);
setAppStorage(new AppStorage(settingsStore, providerKeys, sessions, customProviders, backend));
var keatingStorage = new KeatingStorage();
var DEFAULT_MODEL = getModel("google", "gemini-2.5-flash");
function createBrowserStreamFn() {
	return async (_model, context, options) => {
		const stream = createAssistantMessageEventStream();
		const abortSignal = options?.signal;
		const defaultFields = {
			api: "browser",
			provider: "browser",
			model: "gemma-4-e4b",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0
				}
			}
		};
		(async () => {
			try {
				if (abortSignal?.aborted) {
					stream.end({
						...defaultFields,
						role: "assistant",
						content: [],
						stopReason: "aborted",
						errorMessage: "Request aborted",
						timestamp: Date.now()
					});
					return;
				}
				const userMessages = context.messages.filter((m) => m.role === "user").map((m) => {
					const content = m.content;
					if (typeof content === "string") return content;
					return content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
				});
				const systemPrompt = context.systemPrompt || "";
				const conversationHistory = userMessages.join("\n\n");
				const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${conversationHistory}` : conversationHistory;
				const partialMessage = {
					...defaultFields,
					role: "assistant",
					content: [{
						type: "text",
						text: ""
					}],
					stopReason: "stop",
					timestamp: Date.now()
				};
				stream.push({
					type: "start",
					partial: partialMessage
				});
				const response = await localModel.generate(fullPrompt, {
					max_length: options?.maxTokens ?? 1024,
					temperature: options?.temperature ?? .7
				}, (token) => {
					const textBlock = partialMessage.content[0];
					if (textBlock.type === "text") textBlock.text += token;
					stream.push({
						type: "text_start",
						contentIndex: 0,
						partial: partialMessage
					});
				});
				if (abortSignal?.aborted) {
					stream.end({
						...defaultFields,
						role: "assistant",
						content: [{
							type: "text",
							text: response
						}],
						stopReason: "aborted",
						errorMessage: "Request aborted",
						timestamp: Date.now()
					});
					return;
				}
				stream.end({
					...defaultFields,
					role: "assistant",
					content: [{
						type: "text",
						text: response
					}],
					stopReason: "stop",
					timestamp: Date.now()
				});
			} catch (error) {
				stream.end({
					...defaultFields,
					role: "assistant",
					content: [],
					stopReason: "error",
					errorMessage: error instanceof Error ? error.message : String(error),
					timestamp: Date.now()
				});
			}
		})();
		return stream;
	};
}
function hybridStreamFn(model, context, options) {
	if (model.provider === "browser") return createBrowserStreamFn()(model, context, options);
	return streamSimple(model, context, options);
}
var initPromise = null;
function getInitPromise() {
	if (!initPromise) initPromise = Promise.all([syncCustomProviderKeys(), keatingStorage.init()]).then(() => {});
	return initPromise;
}
function useKeatingAgent() {
	use(getInitPromise());
	const [title] = useState("Keating");
	const agentRef = useRef(null);
	const selectedModelRef = useRef(DEFAULT_MODEL);
	const [isPending, startTransition] = useTransition();
	const openSettings = useCallback(() => {
		SettingsDialog.open([new KeatingProvidersModelsTab(), new ProxyTab()]);
	}, []);
	async function loadBrowserModel() {
		const state = localModel.getState();
		if (!state.loaded && !state.loading) await localModel.load();
		if (!localModel.getState().loaded) throw new Error(localModel.getState().error ?? "Failed to load browser model");
	}
	const createAgent = useCallback(async (panel, initialState) => {
		const tools = await createKeatingTools(keatingStorage);
		const agent = new Agent({
			initialState: {
				systemPrompt: KEATING_SYSTEM_PROMPT,
				model: initialState?.model ?? selectedModelRef.current,
				thinkingLevel: "medium",
				messages: [],
				tools,
				...initialState
			},
			convertToLlm: defaultConvertToLlm,
			streamFn: hybridStreamFn
		});
		agent.getApiKey = (provider) => getProviderApiKey(provider);
		agentRef.current = agent;
		await panel.setAgent(agent, {
			onApiKeyRequired: async (provider) => {
				if (provider === "browser") return true;
				if (await getProviderApiKey(provider)) return true;
				return ApiKeyPromptDialog.prompt(provider);
			},
			onModelSelect: () => KeatingModelSelector.open(agent.state.model, (model) => {
				startTransition(async () => {
					if (model.provider === "browser") await loadBrowserModel();
					selectedModelRef.current = model;
					const current = agent.state;
					await createAgent(panel, {
						...current,
						model,
						messages: [...current.messages]
					});
				});
			})
		});
	}, []);
	return {
		title,
		isPending,
		openSettings,
		chatPanelRef: useCallback((node) => {
			if (node) if (!agentRef.current) createAgent(node).catch(console.error);
			else node.setAgent(agentRef.current, {
				onApiKeyRequired: async (provider) => {
					if (provider === "browser") return true;
					if (await getProviderApiKey(provider)) return true;
					return ApiKeyPromptDialog.prompt(provider);
				},
				onModelSelect: () => KeatingModelSelector.open(agentRef.current.state.model, (model) => {
					startTransition(async () => {
						if (model.provider === "browser") await loadBrowserModel();
						selectedModelRef.current = model;
						const current = agentRef.current.state;
						await createAgent(node, {
							...current,
							model,
							messages: [...current.messages]
						});
					});
				})
			}).catch(console.error);
		}, [createAgent])
	};
}
//#endregion
//#region src/components/settings.ts
var PROVIDERS = [
	{
		id: "google",
		name: "Google AI",
		keyPlaceholder: "AIza..."
	},
	{
		id: "anthropic",
		name: "Anthropic",
		keyPlaceholder: "sk-ant-..."
	},
	{
		id: "openai",
		name: "OpenAI",
		keyPlaceholder: "sk-..."
	}
];
var KeatingSettings = class extends HTMLElement {
	keys = {};
	constructor() {
		super();
		this.attachShadow({ mode: "open" });
		this.loadKeys();
	}
	async loadKeys() {
		const storage = getAppStorage();
		if (!storage) {
			this.render();
			return;
		}
		for (const provider of PROVIDERS) {
			const key = await storage.providerKeys.get(provider.id);
			this.keys[provider.id] = key ?? "";
		}
		this.render();
	}
	render() {
		if (!this.shadowRoot) return;
		this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 1000;
        }
        .dialog {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: white;
          border-radius: 1rem;
          padding: 1.5rem;
          width: 90%;
          max-width: 500px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
        }
        h2 {
          margin: 0 0 1rem;
          font-size: 1.25rem;
          font-weight: 600;
        }
        .providers {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .provider {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        label {
          font-size: 0.875rem;
          font-weight: 500;
        }
        input {
          padding: 0.75rem 1rem;
          border: 1px solid #e2e8f0;
          border-radius: 0.375rem;
          font-size: 16px;
          min-height: 44px;
          width: 100%;
          box-sizing: border-box;
        }
        input:focus {
          outline: none;
          border-color: #6366f1;
          box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.1);
        }
        .hint {
          font-size: 0.75rem;
          color: #64748b;
        }
        .buttons {
          display: flex;
          justify-content: flex-end;
          gap: 0.75rem;
          margin-top: 1.5rem;
        }
        @media (max-width: 480px) {
          .buttons {
            flex-direction: column;
          }
          .buttons button {
            width: 100%;
          }
        }
        button {
          padding: 0.75rem 1.25rem;
          border-radius: 0.5rem;
          border: 1px solid #e2e8f0;
          background: white;
          cursor: pointer;
          font-size: 0.875rem;
          min-height: 44px;
          min-width: 44px;
        }
        button:hover {
          background: #f8fafc;
        }
        button.primary {
          background: #6366f1;
          color: white;
          border-color: #6366f1;
        }
        button.primary:hover {
          background: #4f46e5;
        }
      </style>
      <div class="dialog">
        <h2>API Keys</h2>
        <div class="providers">
          ${PROVIDERS.map((p) => `
            <div class="provider">
              <label for="${p.id}">${p.name}</label>
              <input type="password" id="${p.id}"
                     placeholder="${p.keyPlaceholder}"
                     value="${this.keys[p.id] || ""}">
              <div class="hint">Your API key is stored locally in your browser</div>
            </div>
          `).join("")}
        </div>
        <div class="buttons">
          <button id="cancel">Cancel</button>
          <button id="save" class="primary">Save</button>
        </div>
      </div>
    `;
		this.bindEvents();
	}
	bindEvents() {
		this.shadowRoot?.querySelector("#cancel")?.addEventListener("click", () => {
			this.remove();
		});
		this.shadowRoot?.querySelector("#save")?.addEventListener("click", async () => {
			const storage = getAppStorage();
			if (!storage) {
				this.remove();
				return;
			}
			for (const provider of PROVIDERS) {
				const input = this.shadowRoot?.querySelector(`#${provider.id}`);
				if (input) {
					const key = input.value.trim();
					if (key) await storage.providerKeys.set(provider.id, key);
					else await storage.providerKeys.delete(provider.id);
				}
			}
			this.dispatchEvent(new CustomEvent("keys-saved"));
			this.remove();
		});
	}
};
customElements.define("keating-settings", KeatingSettings);
//#endregion
//#region src/pages/Chat.tsx
function ChatContent() {
	const { title, openSettings, chatPanelRef } = useKeatingAgent();
	return /* @__PURE__ */ jsxs("div", {
		className: "w-full h-full flex flex-col bg-background text-foreground overflow-hidden",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "flex items-center justify-between border-b border-border shrink-0 px-4 py-2 h-14",
			children: [/* @__PURE__ */ jsx("span", {
				className: "text-lg font-semibold",
				children: title
			}), /* @__PURE__ */ jsxs("div", {
				className: "flex items-center gap-1",
				children: [/* @__PURE__ */ jsx("theme-toggle", {}), /* @__PURE__ */ jsx("button", {
					className: "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-8 w-8",
					title: "Settings",
					onClick: openSettings,
					children: /* @__PURE__ */ jsx(Settings, { size: 16 })
				})]
			})]
		}), /* @__PURE__ */ jsx("pi-chat-panel", {
			ref: chatPanelRef,
			style: {
				flex: 1,
				overflow: "hidden",
				display: "block"
			}
		})]
	});
}
function Chat() {
	return /* @__PURE__ */ jsx(Suspense, {
		fallback: /* @__PURE__ */ jsx("div", {
			className: "w-full h-screen flex flex-col bg-background text-foreground overflow-hidden",
			children: /* @__PURE__ */ jsx("div", {
				className: "flex-1 flex items-center justify-center text-muted-foreground text-sm",
				children: "Initializing…"
			})
		}),
		children: /* @__PURE__ */ jsx(ChatContent, {})
	});
}
//#endregion
//#region src/pages/Paper.tsx
function Paper() {
	return /* @__PURE__ */ jsxs("div", {
		className: "retro-layout",
		children: [
			/* @__PURE__ */ jsx(Nav, {}),
			/* @__PURE__ */ jsx("main", {
				className: "pt-28 pb-16 px-6",
				children: /* @__PURE__ */ jsxs("div", {
					className: "max-w-4xl mx-auto",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "paper-fold distressed-border p-8 mb-8",
						children: [/* @__PURE__ */ jsx("h1", {
							className: "text-3xl md:text-4xl font-bold mb-4",
							children: "Keating: A Metaharness for Agency-Preserving AI Instruction"
						}), /* @__PURE__ */ jsxs("div", {
							className: "flex flex-col md:flex-row md:items-center justify-between gap-4",
							children: [/* @__PURE__ */ jsxs("div", {
								className: "text-[#64748b] font-terminal",
								children: [
									/* @__PURE__ */ jsx("span", {
										className: "text-[#d44a3d]",
										children: "AUTHOR:"
									}),
									" Dio the Debugger ",
									/* @__PURE__ */ jsx("br", {}),
									/* @__PURE__ */ jsx("span", {
										className: "text-[#d44a3d] leading-7",
										children: "DATE:"
									}),
									" April 3, 2026"
								]
							}), /* @__PURE__ */ jsxs("a", {
								href: "/study.pdf",
								download: true,
								className: "inline-flex items-center justify-center gap-2 bg-[#d44a3d] text-[#f4f1ea] px-6 py-3 font-bold hover:bg-[#b33e33] transition-colors",
								children: [/* @__PURE__ */ jsx(Download, { size: 20 }), "DOWNLOAD PDF"]
							})]
						})]
					}), /* @__PURE__ */ jsxs("article", {
						className: "paper-fold distressed-border p-8 md:p-12 leading-relaxed",
						children: [
							/* @__PURE__ */ jsxs("div", {
								className: "flex items-center gap-2 mb-8 text-[#64748b] font-terminal text-sm border-b border-[#64748b]/20 pb-4",
								children: [/* @__PURE__ */ jsx(FileText, { size: 16 }), "ABSTRACT"]
							}),
							/* @__PURE__ */ jsx("div", {
								className: "text-lg md:text-xl font-serif italic text-[#2c3e50] mb-8",
								children: /* @__PURE__ */ jsx(Pretext, {
									text: "AI tutors can scale explanation, but scaling explanation is not the same as scaling learning. A tutoring system that answers fluently may still weaken the learner's own reconstruction of a concept.",
									font: "italic 20px 'Georgia', serif",
									lineHeight: 32
								})
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "space-y-8 text-[#1a1a1a] font-serif",
								children: [
									/* @__PURE__ */ jsx(Pretext, {
										text: "Keating is designed around that distinction. It is not a single tutoring chatbot; it is a metaharness for teaching, a control layer that organizes planning, prompting, retrieval, transfer, verification, and evaluation around the live teaching exchange.",
										font: "18px 'Georgia', serif",
										lineHeight: 28
									}),
									/* @__PURE__ */ jsx(Pretext, {
										text: "We analyze two evidence layers: an archival trace set of 22 raw sessions curated to 16 topic x learner pairs, and a synthetic benchmark implemented directly in the repository. The archival set yields a normalized overall score of 0.61 (95% bootstrap interval 0.515-0.705), with strong topic heterogeneity: Special Relativity is highest at 0.75 and Stoicism lowest at 0.425.",
										font: "18px 'Georgia', serif",
										lineHeight: 28
									}),
									/* @__PURE__ */ jsx(Pretext, {
										text: "The synthetic layer shows that the current Keating policy, although evolved on Derivative alone, improves the full 14-topic harness by 6.703 points over the default policy across 200/200 seeds, with derivative-only evolution improving in 29/30 reruns.",
										font: "18px 'Georgia', serif",
										lineHeight: 28
									}),
									/* @__PURE__ */ jsx(Pretext, {
										text: "The contribution of this paper is therefore twofold: a formal account of a teaching metaharness and a reproducible benchmark-and-analysis stack for studying agency-preserving instruction. The present evidence supports systems and methodology claims; a human randomized trial remains the necessary next step for causal pedagogical claims.",
										font: "18px 'Georgia', serif",
										lineHeight: 28
									})
								]
							}),
							/* @__PURE__ */ jsx("div", {
								className: "mt-12 pt-8 border-t border-[#64748b]/20",
								children: /* @__PURE__ */ jsx("p", {
									className: "text-sm text-[#64748b] font-terminal uppercase tracking-widest text-center",
									children: "— End of Abstract —"
								})
							})
						]
					})]
				})
			}),
			/* @__PURE__ */ jsx(SimpleFooter, {})
		]
	});
}
//#endregion
//#region src/App.tsx
var rootRoute = createRootRoute({ component: () => /* @__PURE__ */ jsx(Outlet, {}) });
var indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: Landing
});
var chatRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/chat",
	component: Chat
});
var tutorialRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/tutorial",
	component: Tutorial
});
var blogRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/blog",
	component: Blog
});
var paperRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/paper",
	component: Paper
});
var router = createRouter({
	routeTree: rootRoute.addChildren([
		indexRoute,
		chatRoute,
		tutorialRoute,
		blogRoute,
		paperRoute
	]),
	history: createHashHistory()
});
function App() {
	return /* @__PURE__ */ jsx(RouterProvider, { router });
}
//#endregion
//#region src/main-react.tsx
ReactDOM.createRoot(document.getElementById("root")).render(/* @__PURE__ */ jsx(React.StrictMode, { children: /* @__PURE__ */ jsx(App, {}) }));
//#endregion
export {};
