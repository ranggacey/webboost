import dns from "node:dns/promises";
import net from "node:net";
import lighthouse from "lighthouse";
import puppeteer from "puppeteer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Strategy = "mobile" | "desktop";
type Scope = "page" | "site";
type LighthouseAudit = {
  score?: number | null;
  displayValue?: string;
  description?: string;
  details?: { overallSavingsMs?: number; overallSavingsBytes?: number };
};
type LighthouseResult = {
  categories?: Record<string, { score?: number | null }>;
  audits?: Record<string, LighthouseAudit>;
};

const MAX_ACTIVE_AUDITS = 2;
const RATE_LIMIT_WINDOW = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;
const AUDIT_TIMEOUT = 65_000;
const SITE_PAGE_LIMIT = 3;
let activeAudits = 0;
const requestLog = new Map<string, number[]>();

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  const [first, second] = parts;
  return first === 0 || first === 10 || first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
}

function isPrivateIpv6(address: string) {
  const value = address.toLowerCase();
  return value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:");
}

function isBlockedHostname(hostname: string) {
  const value = hostname.toLowerCase().replace(/\.$/, "");
  if (value === "localhost" || value.endsWith(".localhost") || value.endsWith(".local") || value.endsWith(".internal")) return true;
  const addressType = net.isIP(value);
  return addressType === 4 ? isPrivateIpv4(value) : addressType === 6 ? isPrivateIpv6(value) : false;
}

async function validatePublicUrl(input: unknown) {
  if (typeof input !== "string" || input.length > 2_000) throw new Error("URL tidak valid.");
  const parsed = new URL(input);
  if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) throw new Error("URL harus memakai http atau https.");
  if (parsed.username || parsed.password || parsed.port && !["80", "443"].includes(parsed.port) || isBlockedHostname(parsed.hostname)) {
    throw new Error("Alamat website tersebut tidak bisa dianalisis.");
  }
  const addresses = await dns.lookup(parsed.hostname, { all: true });
  if (addresses.some(({ address }) => isPrivateIpv4(address) || isPrivateIpv6(address))) throw new Error("Alamat website tersebut tidak bisa dianalisis.");
  return parsed.toString();
}

function score(category: { score?: number | null } | undefined) {
  return Math.round((category?.score ?? 0) * 100);
}

function formatSavings(audit: LighthouseAudit) {
  const bytes = audit.details?.overallSavingsBytes ?? 0;
  const milliseconds = audit.details?.overallSavingsMs ?? 0;
  if (bytes >= 1_000_000) return `Hemat sekitar ${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `Hemat sekitar ${Math.round(bytes / 1_000)} KB`;
  if (milliseconds >= 100) return `Potensi lebih cepat ${(milliseconds / 1_000).toFixed(1)} detik`;
  return audit.displayValue ?? "Perlu diperbaiki";
}

function issueFromAudit(
  audit: LighthouseAudit | undefined,
  definition: { id: string; title: string; description: string; solution: string; tag: string },
) {
  if (!audit || audit.score === null || audit.score === undefined || audit.score >= 0.9) return null;
  return {
    auditId: definition.id,
    severity: audit.score <= 0.5 ? "Prioritas tinggi" : "Prioritas sedang",
    severityClass: audit.score <= 0.5 ? "severity-high" : "severity-medium",
    title: definition.title,
    description: audit.displayValue ? `${definition.description} (${audit.displayValue})` : definition.description,
    detail: audit.description ?? "Temuan ini berasal dari pemeriksaan Lighthouse.",
    impact: formatSavings(audit),
    solution: definition.solution,
    tag: definition.tag,
    score: audit.score,
  };
}

function getClientId(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function enforceLimits(clientId: string) {
  if (clientId === "unknown" && process.env.NODE_ENV !== "production") {
    if (activeAudits >= MAX_ACTIVE_AUDITS) return "Server sedang penuh. Tunggu sampai audit lain selesai.";
    activeAudits += 1;
    return null;
  }
  const now = Date.now();
  const recent = (requestLog.get(clientId) ?? []).filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) return "Terlalu banyak audit dari alamat ini. Coba lagi sebentar.";
  if (activeAudits >= MAX_ACTIVE_AUDITS) return "Server sedang penuh. Tunggu sampai audit lain selesai.";
  requestLog.set(clientId, [...recent, now]);
  activeAudits += 1;
  return null;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Audit terlalu lama. Website mungkin terlalu berat atau tidak merespons.")), milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function discoverSiteUrls(targetUrl: string) {
  const origin = new URL(targetUrl).origin;
  const sitemapCandidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  for (const sitemapUrl of sitemapCandidates) {
    try {
      const response = await fetch(sitemapUrl, { redirect: "error", signal: AbortSignal.timeout(4_000) });
      if (!response.ok) continue;
      const xml = await response.text();
      const urls = [...xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)]
        .map((match) => match[1].replaceAll("&amp;", "&").trim())
        .filter((url) => {
          try { return new URL(url).origin === origin; } catch { return false; }
        });
      if (urls.length > 0) return [...new Set([targetUrl, ...urls])].slice(0, SITE_PAGE_LIMIT);
    } catch {
      // A missing or inaccessible sitemap should not prevent a homepage audit.
    }
  }
  return [targetUrl];
}

async function runAudit(targetUrl: string, strategy: Strategy, browser: Awaited<ReturnType<typeof puppeteer.launch>>, timeout = AUDIT_TIMEOUT) {
  const browserUrl = new URL(browser.wsEndpoint());
  const isMobile = strategy === "mobile";
  const result = await withTimeout(lighthouse(targetUrl, {
    port: Number(browserUrl.port),
    output: "json",
    logLevel: "error",
    onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
    formFactor: isMobile ? "mobile" : "desktop",
    screenEmulation: isMobile
      ? { mobile: true, width: 390, height: 844, deviceScaleFactor: 1, disabled: false }
      : { mobile: false, width: 1440, height: 900, deviceScaleFactor: 1, disabled: false },
  }), timeout);
  if (!result?.lhr) throw new Error("Audit tidak menghasilkan laporan.");
  return result.lhr as unknown as LighthouseResult;
}

export async function POST(request: Request) {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  const limited = enforceLimits(getClientId(request));
  if (limited) return Response.json({ error: limited }, { status: 429 });

  try {
    const body = (await request.json()) as { url?: unknown; strategy?: unknown; scope?: unknown };
    const targetUrl = await validatePublicUrl(body.url);
    const strategy: Strategy = body.strategy === "desktop" ? "desktop" : "mobile";
    const scope: Scope = body.scope === "site" ? "site" : "page";
    const chromePath = process.env.CHROME_EXECUTABLE_PATH;
    const launchOptions = {
      headless: true as const,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      ...(chromePath ? { executablePath: chromePath } : process.platform === "win32" ? { channel: "chrome" as const } : {}),
    };
    browser = await puppeteer.launch(launchOptions);
    const urls = scope === "site" ? await discoverSiteUrls(targetUrl) : [targetUrl];
    const pageResults: Array<{ url: string; lhr: LighthouseResult }> = [];
    for (const pageUrl of urls) {
      pageResults.push({ url: pageUrl, lhr: await runAudit(pageUrl, strategy, browser, scope === "site" ? 30_000 : AUDIT_TIMEOUT) });
    }
    const lhr = pageResults[0].lhr;
    const audits = lhr.audits ?? {};
    const definitions = [
      { id: "largest-contentful-paint", title: "Konten utama muncul terlalu lambat", description: "Elemen terbesar di halaman membutuhkan waktu terlalu lama untuk tampil", solution: "Kompres gambar utama dan kurangi file yang menghambat tampilan awal.", tag: "Kecepatan" },
      { id: "uses-optimized-images", title: "Gambar belum cukup ringan", description: "Beberapa gambar bisa dikompres agar halaman lebih cepat dibuka", solution: "Ubah gambar ke WebP atau AVIF dan gunakan ukuran yang sesuai.", tag: "Kecepatan" },
      { id: "modern-image-formats", title: "Format gambar bisa diperbarui", description: "Ada gambar yang masih memakai format lama", solution: "Gunakan WebP atau AVIF untuk mengurangi ukuran file tanpa mengubah tampilan.", tag: "Kecepatan" },
      { id: "render-blocking-resources", title: "Ada file yang menghambat tampilan awal", description: "CSS atau JavaScript tertentu harus selesai dimuat sebelum halaman terlihat", solution: "Tunda file yang tidak penting sampai halaman selesai tampil.", tag: "Kecepatan" },
      { id: "unused-javascript", title: "Ada JavaScript yang belum diperlukan", description: "Sebagian kode dimuat sebelum benar-benar dibutuhkan", solution: "Tunda script non-esensial sampai halaman selesai tampil atau sampai user berinteraksi.", tag: "Interaksi" },
      { id: "unused-css-rules", title: "Ada CSS yang belum digunakan", description: "Sebagian aturan CSS tidak dipakai di halaman ini", solution: "Hapus CSS yang tidak terpakai atau muat hanya pada halaman yang membutuhkannya.", tag: "Kecepatan" },
      { id: "meta-description", title: "Deskripsi halaman belum tersedia", description: "Google belum mendapat ringkasan singkat tentang isi halaman ini", solution: "Tambahkan meta description sepanjang 140–160 karakter.", tag: "SEO" },
      { id: "document-title", title: "Judul halaman belum optimal", description: "Judul halaman membantu pengunjung dan Google memahami isinya", solution: "Tulis judul yang jelas, spesifik, dan sesuai isi halaman.", tag: "SEO" },
      { id: "image-alt", title: "Beberapa gambar belum punya keterangan", description: "Pengunjung yang memakai screen reader tidak mendapat konteks dari gambar tertentu", solution: "Tambahkan alt text yang singkat dan menjelaskan isi atau fungsi gambar.", tag: "Aksesibilitas" },
      { id: "link-text", title: "Ada link yang kurang jelas", description: "Beberapa link belum menjelaskan ke mana pengunjung akan diarahkan", solution: "Gunakan teks link yang menjelaskan tujuan, bukan hanya ‘klik di sini’.", tag: "Aksesibilitas" },
    ];
    const uniqueIssues = new Map<string, NonNullable<ReturnType<typeof issueFromAudit>>>();
    for (const pageResult of pageResults) {
      for (const definition of definitions) {
        const issue = issueFromAudit(pageResult.lhr.audits?.[definition.id], definition);
        if (issue && !uniqueIssues.has(issue.auditId)) uniqueIssues.set(issue.auditId, issue);
      }
    }
    const issues = [...uniqueIssues.values()]
      .sort((left, right) => (left.score ?? 0) - (right.score ?? 0))
      .slice(0, 8)
      .map((issue, index) => ({ ...issue, number: String(index + 1).padStart(2, "0") }));

    const averageCategory = (category: string) => Math.round(pageResults.reduce((total, result) => total + score(result.lhr.categories?.[category]), 0) / pageResults.length);

    return Response.json({
      hostname: new URL(targetUrl).hostname.replace(/^www\./, ""),
      scope,
      pagesScanned: pageResults.length,
      strategy,
      score: averageCategory("performance"),
      categories: {
        performance: averageCategory("performance"),
        seo: averageCategory("seo"),
        accessibility: averageCategory("accessibility"),
        bestPractices: averageCategory("best-practices"),
      },
      metrics: {
        lcp: audits["largest-contentful-paint"]?.displayValue ?? "—",
        cls: audits["cumulative-layout-shift"]?.displayValue ?? "—",
        inp: audits["interaction-to-next-paint"]?.displayValue ?? "—",
        fcp: audits["first-contentful-paint"]?.displayValue ?? "—",
        ttfb: audits["server-response-time"]?.displayValue ?? "—",
      },
      issues,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Website tidak bisa dianalisis saat ini.";
    const status = message.includes("tidak valid") || message.includes("tidak bisa") ? 400 : 500;
    return Response.json({ error: message }, { status });
  } finally {
    activeAudits = Math.max(0, activeAudits - 1);
    await browser?.close().catch(() => undefined);
  }
}
