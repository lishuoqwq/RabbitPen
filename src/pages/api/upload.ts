export const prerender = false;
export const trailingSlash = "always";

const DEFAULT_OWNER = "lishuoqwq";
const DEFAULT_REPO = "RabbitPen";
const DEFAULT_BRANCH = "main";
const DEFAULT_BASE_PATH = "src/content/posts";

function getEnvValue(key: string): string | undefined;
function getEnvValue(key: string, fallback: string): string;
function getEnvValue(key: string, fallback?: string) {
	return (import.meta.env[key] as string | undefined) ?? fallback;
}

const sanitizeRelativePath = (input: string) => {
	const normalized = input.replace(/\\/g, "/").replace(/^\/+/, "");
	const parts = normalized.split("/").filter(Boolean);
	if (parts.length === 0) {
		throw new Error("目标路径为空");
	}
	for (const part of parts) {
		if (part === "." || part === "..") {
			throw new Error("目标路径包含非法段");
		}
	}
	return parts.join("/");
};

const normalizeFileName = (value: string) => {
	const trimmed = value.trim().replace(/\\/g, "/");
	const base = trimmed.split("/").filter(Boolean).join("/");
	if (!base) {
		throw new Error("文件名不能为空");
	}
	const hasExtension = /\.(md|mdx)$/i.test(base);
	return hasExtension ? base : `${base}.md`;
};

const fetchGithub = async (url: string, options: RequestInit, token: string) => {
	const headers = new Headers(options.headers);
	headers.set("Authorization", `Bearer ${token}`);
	headers.set("Accept", "application/vnd.github+json");
	headers.set("X-GitHub-Api-Version", "2022-11-28");
	headers.set("User-Agent", "Firefly-Uploader");
	return fetch(url, { ...options, headers });
};

const getExistingSha = async (
	token: string,
	owner: string,
	repo: string,
	path: string,
	branch: string,
) => {
	const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(
		branch,
	)}`;
	const response = await fetchGithub(url, { method: "GET" }, token);
	if (response.status === 404) return null;
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`读取文件失败：${text || response.status}`);
	}
	const payload = (await response.json()) as { sha?: string };
	return payload.sha ?? null;
};

const putFile = async (
	token: string,
	owner: string,
	repo: string,
	path: string,
	branch: string,
	content: string,
	message: string,
	sha?: string | null,
) => {
	const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
	const body = JSON.stringify({
		message,
		content,
		branch,
		...(sha ? { sha } : {}),
	});
	const response = await fetchGithub(
		url,
		{
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body,
		},
		token,
	);
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`写入 GitHub 失败：${text || response.status}`);
	}
	return (await response.json()) as {
		content?: { path?: string };
		commit?: { sha?: string; html_url?: string };
	};
};

export async function POST({ request }: { request: Request }) {
	try {
		const formData = await request.formData();
		const file = formData.get("file");
		if (!(file instanceof File)) {
			return new Response(
				JSON.stringify({ message: "未找到上传文件" }),
				{ status: 400 },
			);
		}

		const rawName = formData.get("filename");
		const filename = normalizeFileName(
			typeof rawName === "string" && rawName.trim() ? rawName : file.name,
		);
		if (!/\.(md|mdx)$/i.test(filename)) {
			return new Response(
				JSON.stringify({ message: "仅支持 .md 或 .mdx 文件" }),
				{ status: 400 },
			);
		}

		const owner = getEnvValue("GITHUB_OWNER", DEFAULT_OWNER);
		const repo = getEnvValue("GITHUB_REPO", DEFAULT_REPO);
		const branch = getEnvValue("GITHUB_BRANCH", DEFAULT_BRANCH);
		const basePath = getEnvValue("GITHUB_BASE_PATH", DEFAULT_BASE_PATH);

		const targetPath = sanitizeRelativePath(`${basePath}/${filename}`);
		const token = getEnvValue("GITHUB_TOKEN");
		if (!token) {
			return new Response(
				JSON.stringify({ message: "缺少 GITHUB_TOKEN 配置" }),
				{ status: 500 },
			);
		}

		const requiredPassword = getEnvValue("UPLOAD_PASSWORD");
		const providedPassword = formData.get("password");
		if (requiredPassword) {
			if (typeof providedPassword !== "string" || providedPassword !== requiredPassword) {
				return new Response(
					JSON.stringify({ message: "上传口令错误" }),
					{ status: 401 },
				);
			}
		} else if (!import.meta.env.DEV) {
			return new Response(
				JSON.stringify({ message: "生产环境必须配置 UPLOAD_PASSWORD" }),
				{ status: 403 },
			);
		}

		const arrayBuffer = await file.arrayBuffer();
		const content = Buffer.from(arrayBuffer).toString("base64");
		const messageRaw = formData.get("message");
		const message =
			typeof messageRaw === "string" && messageRaw.trim()
				? messageRaw.trim()
				: `chore: 上传文章 ${filename}`;

		const sha = await getExistingSha(token, owner, repo, targetPath, branch);
		const result = await putFile(
			token,
			owner,
			repo,
			targetPath,
			branch,
			content,
			message,
			sha,
		);

		return new Response(
			JSON.stringify({
				path: result.content?.path ?? targetPath,
				commitSha: result.commit?.sha ?? null,
				commitUrl: result.commit?.html_url ?? null,
			}),
			{ status: 200 },
		);
	} catch (error) {
		return new Response(
			JSON.stringify({
				message: error instanceof Error ? error.message : "上传失败",
			}),
			{ status: 500 },
		);
	}
}
