import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const candidates = [".vercel/output/static", "dist"];
const resolvedCandidates = candidates.map((candidate) =>
	path.resolve(candidate),
);
const siteDir = resolvedCandidates.find((candidate) => existsSync(candidate));

if (!siteDir) {
	console.error(
		"Pagefind: build output not found. Run astro build before running pagefind.",
	);
	process.exit(1);
}

const result = spawnSync("pagefind", ["--site", siteDir], {
	stdio: "inherit",
	shell: process.platform === "win32",
});

if (typeof result.status === "number") {
	process.exit(result.status);
}

process.exit(1);
