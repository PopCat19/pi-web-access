import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { activityMonitor } from "./activity.js";
import type { SearchResult, SearchResponse, SearchOptions } from "./perplexity.js";

const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");

interface WebSearchConfig {
	searxngUrl?: string;
}

let cachedConfig: WebSearchConfig | null = null;

function loadConfig(): WebSearchConfig {
	if (cachedConfig) return cachedConfig;
	if (!existsSync(CONFIG_PATH)) {
		cachedConfig = {};
		return cachedConfig;
	}

	const content = readFileSync(CONFIG_PATH, "utf-8");
	try {
		cachedConfig = JSON.parse(content) as WebSearchConfig;
		return cachedConfig;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
	}
}

function getSearxngUrl(): string | null {
	const config = loadConfig();
	const url = (process.env.SEARXNG_URL ?? config.searxngUrl);
	return url ? url.replace(/\/$/, "") + "/search" : null;
}

export function isSearxngAvailable(): boolean {
	const config = loadConfig();
	return !!(process.env.SEARXNG_URL ?? config.searxngUrl);
}

export async function searchWithSearxng(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
	const activityId = activityMonitor.logStart({ type: "api", query });
	const baseUrl = getSearxngUrl();

	if (!baseUrl) {
		throw new Error(
			"SearXNG URL not found. Either:\n" +
			"  1. Set \"searxngUrl\" in ~/.pi/web-search.json\n" +
			"  2. Set SEARXNG_URL environment variable"
		);
	}

	const url = new URL(baseUrl);
	url.searchParams.set("q", query);
	url.searchParams.set("format", "json");

	if (options.numResults) {
		// SearXNG doesn't have a direct num_results param in the same way, but it has pages.
		// Usually 1 page is enough for initial results.
	}

	if (options.recencyFilter) {
		const timeRangeMap: Record<string, string> = {
			day: "day",
			week: "week",
			month: "month",
			year: "year",
		};
		const range = timeRangeMap[options.recencyFilter];
		if (range) url.searchParams.set("time_range", range);
	}

	let response: Response;
	try {
		response = await fetch(url.toString(), {
			method: "GET",
			signal: options.signal,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) {
			activityMonitor.logComplete(activityId, 0);
		} else {
			activityMonitor.logError(activityId, message);
		}
		throw err;
	}

	if (!response.ok) {
		activityMonitor.logComplete(activityId, response.status);
		const errorText = await response.text();
		throw new Error(`SearXNG API error ${response.status}: ${errorText}`);
	}

	let data: any;
	try {
		data = await response.json();
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`SearXNG API returned invalid JSON: ${message}`);
	}

	const results: SearchResult[] = (data.results || []).map((r: any) => ({
		title: r.title || r.pretty_url || "Source",
		url: r.url,
		snippet: r.content || "",
	})).slice(0, options.numResults ?? 10);

	// Construct answer from results (similar to Exa's behavior)
	let answer = data.infoboxes?.[0]?.content || "";
	if (!answer && results.length > 0) {
		const parts: string[] = [];
		for (let i = 0; i < results.length; i++) {
			const res = results[i];
			if (res.snippet) {
				parts.push(`${res.snippet.trim()}\nSource: ${res.title} (${res.url})`);
			}
		}
		if (parts.length > 0) {
			answer = parts.join("\n\n");
		} else {
			answer = `Found ${results.length} results for "${query}" via SearXNG.`;
		}
	}

	activityMonitor.logComplete(activityId, response.status);
	return { answer, results };
}
