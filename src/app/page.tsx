"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type View = "home" | "scanning" | "report";
type ScanStage = "Membuka website" | "Mengukur kecepatan" | "Mencari masalah" | "Menyiapkan solusi";
type ReportIssue = {
  number: string;
  severity: string;
  severityClass: string;
  title: string;
  description: string;
  impact: string;
  solution: string;
  tag: string;
  detail?: string;
};
type ReportData = {
  hostname: string;
  strategy: "mobile" | "desktop";
  scope: "page" | "site";
  pagesScanned: number;
  score: number;
  categories: { performance: number; seo: number; accessibility: number; bestPractices: number };
  metrics: { lcp: string; cls: string; inp: string; fcp: string; ttfb: string };
  issues: ReportIssue[];
};

const scanStages: ScanStage[] = [
  "Membuka website",
  "Mengukur kecepatan",
  "Mencari masalah",
  "Menyiapkan solusi",
];

const issues: ReportIssue[] = [
  {
    number: "01",
    severity: "Dampak tinggi",
    severityClass: "severity-high",
    title: "Gambar utama terlalu besar",
    description: "Gambar paling besar di halaman membuat konten utama muncul lebih lambat.",
    impact: "Hemat sekitar 1,2 MB",
    solution: "Ubah gambar hero ke WebP atau AVIF, lalu kompres hingga di bawah 200 KB. Jangan aktifkan lazy-load untuk gambar utama.",
    tag: "Kecepatan",
  },
  {
    number: "02",
    severity: "Dampak sedang",
    severityClass: "severity-medium",
    title: "JavaScript dimuat terlalu awal",
    description: "Beberapa file baru dibutuhkan setelah halaman terlihat, tapi semuanya dimuat sejak awal.",
    impact: "Potensi lebih cepat 0,6 detik",
    solution: "Tunda script yang tidak penting sampai halaman selesai tampil atau sampai user berinteraksi dengan halaman.",
    tag: "Interaksi",
  },
  {
    number: "03",
    severity: "Dampak rendah",
    severityClass: "severity-low",
    title: "Deskripsi halaman belum tersedia",
    description: "Google belum mendapat ringkasan singkat tentang isi halaman ini.",
    impact: "SEO lebih mudah dipahami",
    solution: "Tambahkan meta description sepanjang 140–160 karakter yang menjelaskan manfaat utama halaman.",
    tag: "SEO",
  },
];

const demoReport: ReportData = {
  hostname: "contohwebsite.com",
  strategy: "mobile",
  scope: "page",
  pagesScanned: 1,
  score: 78,
  categories: { performance: 78, seo: 88, accessibility: 94, bestPractices: 91 },
  metrics: { lcp: "2,8 dtk", cls: "0,08", inp: "180 ms", fcp: "1,4 dtk", ttfb: "0,7 dtk" },
  issues,
};

function scoreLabel(score: number) {
  if (score >= 90) return "sangat sehat";
  if (score >= 75) return "cukup sehat";
  if (score >= 50) return "perlu perhatian";
  return "butuh banyak perbaikan";
}

function scoreMessage(score: number) {
  if (score >= 90) return "Bagus";
  if (score >= 75) return "Masih bisa ditingkatkan";
  if (score >= 50) return "Perlu diperbaiki";
  return "Perlu banyak perbaikan";
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h9M8.5 3.5 13 8l-4.5 4.5" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 2 1.65 6.35L20 10l-6.35 1.65L12 18l-1.65-6.35L4 10l6.35-1.65L12 2Z" />
      <path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m4 10.5 3.8 3.8L16 6" />
    </svg>
  );
}

function ScoreRing({ score, small = false }: { score: number; small?: boolean }) {
  return (
    <div className={`score-ring ${small ? "score-ring-small" : ""}`} style={{ "--score": `${score * 3.6}deg` } as React.CSSProperties}>
      <div className="score-ring-inner">
        <strong>{score}</strong>
        <span>/ 100</span>
      </div>
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [url, setUrl] = useState("");
  const [activeStage, setActiveStage] = useState(0);
  const [error, setError] = useState("");
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [strategy, setStrategy] = useState<"mobile" | "desktop">("mobile");
  const [scope, setScope] = useState<"page" | "site">("page");
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ hostname: string; score: number; strategy: "mobile" | "desktop"; date: string }>>([]);

  const hostname = useMemo(() => {
    try {
      return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
    } catch {
      return "contohwebsite.com";
    }
  }, [url]);

  useEffect(() => {
    if (view !== "scanning") return;

    let cancelled = false;
    const controller = new AbortController();
    const interval = window.setInterval(() => {
      setActiveStage((current) => Math.min(current + 1, scanStages.length - 2));
    }, 850);

    async function runAudit() {
      try {
        const data = demoMode
          ? await new Promise<ReportData>((resolve) => window.setTimeout(() => resolve(demoReport), 2_800))
          : await fetch("/api/audit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: url.startsWith("http") ? url : `https://${url}`, strategy, scope }),
              signal: controller.signal,
            }).then(async (response) => {
              const raw = await response.text();
              let payload: { error?: string } & Partial<ReportData> = {};

              try {
                payload = raw ? JSON.parse(raw) : {};
              } catch {
                throw new Error("Server audit mengembalikan hasil yang tidak valid. Coba jalankan ulang server.");
              }

              if (!response.ok) throw new Error(payload.error || "Website tidak bisa dianalisis saat ini.");
              return payload as ReportData;
            });

        if (cancelled) return;
        window.clearInterval(interval);
        setReportData(data);
        setHistory((current) => {
          const next = [{ hostname: data.hostname, score: data.score, strategy: data.strategy, date: new Date().toISOString() }, ...current.filter((item) => item.hostname !== data.hostname)].slice(0, 5);
          window.localStorage.setItem("cikweb-history", JSON.stringify(next));
          return next;
        });
        setExpandedIssue(null);
        setActiveStage(scanStages.length - 1);
        window.setTimeout(() => {
          if (!cancelled) setView("report");
        }, 450);
      } catch (auditError) {
        if (cancelled || (auditError instanceof DOMException && auditError.name === "AbortError")) return;
        setError(
          auditError instanceof TypeError
            ? "Server audit tidak merespons. Pastikan aplikasi server sedang berjalan."
            : auditError instanceof Error
              ? auditError.message
              : "Website tidak bisa dianalisis saat ini.",
        );
        setView("home");
      }
    }

    void runAudit();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [demoMode, scope, strategy, url, view]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("cikweb-history");
      if (saved) setHistory(JSON.parse(saved));
    } catch {
      setHistory([]);
    }
  }, []);

  function startScan(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const candidate = url.trim();
    const normalized = candidate.startsWith("http") ? candidate : `https://${candidate}`;

    try {
      const parsed = new URL(normalized);
      if (!parsed.hostname.includes(".")) throw new Error("invalid");
      setUrl(normalized);
      setError("");
      setReportData(null);
      setDemoMode(false);
      setExpandedIssue(null);
      setActiveStage(0);
      setView("scanning");
    } catch {
      setError("Masukkan alamat website yang valid, contohnya https://namabisnis.com");
    }
  }

  function resetScan() {
    setView("home");
    setUrl("");
    setActiveStage(0);
    setReportData(null);
    setDemoMode(false);
    setExpandedIssue(null);
  }

  function startDemoScan() {
    setUrl("https://contohwebsite.com");
    setError("");
    setReportData(null);
    setDemoMode(true);
    setStrategy("mobile");
    setScope("page");
    setExpandedIssue(null);
    setActiveStage(0);
    setView("scanning");
  }

  function scanHistoryItem(item: { hostname: string; strategy: "mobile" | "desktop" }) {
    setUrl(item.hostname);
    setStrategy(item.strategy);
    setError("");
    setReportData(null);
    setDemoMode(false);
    setActiveStage(0);
    setView("scanning");
  }

  const report = reportData ?? { ...demoReport, hostname };
  const reportIssues = report.issues.length > 0 ? report.issues : [{
    number: "01",
    severity: "Kondisi bagus",
    severityClass: "severity-low",
    title: "Tidak ada masalah besar ditemukan",
    description: "Website sudah memenuhi pemeriksaan utama untuk audit ini.",
    impact: "Pertahankan performa",
    solution: "Tetap pantau performa setelah ada perubahan besar pada halaman, gambar, atau script.",
    tag: "Kualitas",
  }];
  const reportDescription = report.issues.length > 0
    ? `Kami menemukan ${report.issues.length} hal yang bisa diperbaiki${report.scope === "site" ? " di halaman yang diperiksa" : " di halaman ini"}.`
    : "Tidak ada masalah besar yang ditemukan di halaman ini.";

  function downloadReport() {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `cikweb-${report.hostname}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <main className="site-shell">
      <div className="grain" aria-hidden="true" />
      <nav className="topbar page-width" aria-label="Navigasi utama">
        <button className="brand" onClick={resetScan} aria-label="Kembali ke halaman utama">
          <BrandMark />
          <span>cikweb</span>
        </button>
        <div className="nav-links">
          <a href="#cara-kerja">Cara kerja</a>
          <a href="#hasil">Contoh hasil</a>
          <button className="nav-scan" onClick={resetScan}>Cek website <ArrowIcon /></button>
        </div>
      </nav>

      {view === "home" && (
        <>
          <section className="hero page-width">
            <div className="hero-copy">
              <div className="eyebrow"><span className="eyebrow-dot" /> Cek kecepatan website</div>
              <h1>Cek website. Temukan <em>masalahnya.</em></h1>
              <p className="hero-lede">Masukkan URL untuk melihat apa yang membuat halaman lambat dan cara memperbaikinya.</p>

              <form className="scan-form" onSubmit={startScan}>
                <label htmlFor="website-url">Alamat website</label>
                <div className="input-row">
                  <div className="url-input-wrap">
                    <span className="url-prefix">https://</span>
                    <input
                      id="website-url"
                      value={url.replace(/^https?:\/\//, "")}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="websitekamu.com"
                      inputMode="url"
                      autoComplete="url"
                      aria-invalid={Boolean(error)}
                    />
                  </div>
                  <button className="primary-button" type="submit">Cek sekarang <ArrowIcon /></button>
                </div>
                <div className="scan-options" role="group" aria-label="Pilih perangkat audit"><span>Cek di</span><button type="button" className={strategy === "mobile" ? "selected" : ""} onClick={() => setStrategy("mobile")}>Mobile</button><button type="button" className={strategy === "desktop" ? "selected" : ""} onClick={() => setStrategy("desktop")}>Desktop</button></div>
                <div className="scan-options" role="group" aria-label="Pilih cakupan audit"><span>Audit</span><button type="button" className={scope === "page" ? "selected" : ""} onClick={() => setScope("page")}>Halaman ini</button><button type="button" className={scope === "site" ? "selected" : ""} onClick={() => setScope("site")}>Situs · 3 halaman</button></div>
                {error ? <p className="form-error" role="alert">{error}</p> : <p className="form-note"><SparkIcon /> Tanpa akun · audit untuk satu halaman</p>}
                {history.length > 0 && <div className="history-list"><span className="history-label">Audit terakhir</span>{history.slice(0, 3).map((item) => <button type="button" key={`${item.hostname}-${item.strategy}`} onClick={() => scanHistoryItem(item)}><span>{item.hostname}</span><small>{item.strategy}</small></button>)}</div>}
              </form>
            </div>

            <div className="hero-preview" aria-label="Contoh ringkasan audit">
              <div className="preview-sticker">LIVE PREVIEW <span>↗</span></div>
              <div className="preview-card">
                <div className="preview-card-top"><span>Contoh report</span><span className="preview-status"><i /> selesai</span></div>
                <div className="preview-score-row"><ScoreRing score={82} small /><div><span className="mini-label">KECEPATAN</span><h2>Masih bisa ditingkatkan</h2><p>Ada 3 temuan di halaman ini.</p></div></div>
                <div className="preview-bars">
                  <div><span>Kecepatan</span><b>82</b><i><u style={{ width: "82%" }} /></i></div>
                  <div><span>SEO dasar</span><b>91</b><i><u className="bar-olive" style={{ width: "91%" }} /></i></div>
                  <div><span>Aksesibilitas</span><b>94</b><i><u className="bar-moss" style={{ width: "94%" }} /></i></div>
                </div>
                <div className="preview-issue"><span className="issue-symbol">!</span><div><strong>3 hal perlu diperbaiki</strong><small>Gambar utama · JavaScript · SEO</small></div><ArrowIcon /></div>
              </div>
              <div className="preview-orbit orbit-one" />
              <div className="preview-orbit orbit-two" />
            </div>
          </section>

          <section className="proof-strip page-width" aria-label="Manfaat Cikweb">
            <span>Isi report</span>
            <div><CheckIcon /> Masalah paling penting di atas</div>
            <div><CheckIcon /> Penjelasan yang mudah dipahami</div>
            <div><CheckIcon /> Tanpa akun</div>
          </section>

          <section className="how-section page-width" id="cara-kerja">
            <div className="section-intro"><div className="eyebrow">Cara kerja</div><h2>Cek, pahami, <em>perbaiki.</em></h2></div>
            <div className="how-grid">
              <article><span className="step-number">01</span><div className="step-icon step-icon-scan"><span>⌕</span></div><h3>Masukkan URL</h3><p>Masukkan halaman yang ingin kamu cek.</p></article>
              <article><span className="step-number">02</span><div className="step-icon step-icon-find"><span>!</span></div><h3>Lihat masalah</h3><p>Kami tampilkan hal yang paling memengaruhi kecepatan halaman.</p></article>
              <article><span className="step-number">03</span><div className="step-icon step-icon-fix"><span>↗</span></div><h3>Perbaiki</h3><p>Ikuti langkah perbaikan yang kami sarankan.</p></article>
            </div>
          </section>

          <section className="sample-section page-width" id="hasil">
            <div className="sample-copy"><div className="eyebrow">Contoh hasil</div><h2>Bukan hanya <em>skor.</em></h2><p>Skor memberi gambaran cepat. Di bawahnya, kamu bisa melihat masalah dan langkah perbaikannya.</p><button className="text-button" onClick={startDemoScan}>Lihat contoh report <ArrowIcon /></button></div>
            <div className="sample-note"><span className="sample-note-mark">“</span><p>Gambar utama terlalu besar. Kompres gambar ini agar halaman lebih cepat tampil.</p><div><strong>Contoh temuan</strong><span>· prioritas tinggi</span></div></div>
          </section>
        </>
      )}

      {view === "scanning" && (
        <section className="scan-view page-width" aria-live="polite">
          <div className="scan-header"><div><div className="eyebrow"><span className="eyebrow-dot" /> Audit berjalan</div><h1>Mengecek<br /><em>{hostname}</em></h1></div><button className="quiet-button" onClick={resetScan}>Batalkan</button></div>
          <div className="scan-panel">
            <div className="scan-pulse"><div className="pulse-core"><SparkIcon /></div><span className="pulse-line pulse-line-one" /><span className="pulse-line pulse-line-two" /></div>
            <div className="scan-copy"><span className="mini-label">AUDIT WEBSITE</span><h2>Sedang memeriksa halaman.</h2><p>Biasanya selesai dalam 15–30 detik.</p></div>
            <div className="scan-stages">{scanStages.map((stage, index) => <div className={`scan-stage ${index < activeStage ? "done" : ""} ${index === activeStage ? "active" : ""}`} key={stage}><span className="stage-check">{index < activeStage ? <CheckIcon /> : index === activeStage ? <i /> : index + 1}</span><span>{stage}</span>{index === activeStage && <small>berjalan</small>}</div>)}</div>
          </div>
        </section>
      )}

      {view === "report" && (
        <section className="report-view page-width" id="report">
          <div className="report-topline"><button className="back-button" onClick={resetScan}>← Cek website lain</button><span className="report-date">Audit {report.strategy} · {report.pagesScanned} halaman</span></div>
          <div className="report-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> Hasil audit</div><h1><em>{report.hostname}</em> {scoreLabel(report.score)}.</h1><p>{reportDescription}</p></div><button className="outline-button" onClick={downloadReport}>Download JSON <span>↓</span></button></div>

          <div className="report-overview">
            <div className="overall-score"><div className="mini-label">SKOR KESELURUHAN</div><div className="overall-score-main"><ScoreRing score={report.score} /><div><h2>{scoreMessage(report.score)}</h2><p>Audit {report.strategy}</p></div></div><div className="score-caption"><span className="caption-dot" /> Skor Lighthouse</div></div>
            <div className="category-scores"><div className="mini-label">RINGKASAN KATEGORI</div><div className="category-grid"><div><span>Kecepatan</span><strong>{report.categories.performance}</strong><i><u style={{ width: `${report.categories.performance}%` }} /></i></div><div><span>SEO dasar</span><strong>{report.categories.seo}</strong><i><u className="bar-olive" style={{ width: `${report.categories.seo}%` }} /></i></div><div><span>Aksesibilitas</span><strong>{report.categories.accessibility}</strong><i><u className="bar-moss" style={{ width: `${report.categories.accessibility}%` }} /></i></div><div><span>Praktik terbaik</span><strong>{report.categories.bestPractices}</strong><i><u className="bar-sand" style={{ width: `${report.categories.bestPractices}%` }} /></i></div></div></div>
          </div>

          <div className="metrics-row"><div><span>LCP</span><strong>{report.metrics.lcp}</strong></div><div><span>CLS</span><strong>{report.metrics.cls}</strong></div><div><span>INP</span><strong>{report.metrics.inp}</strong></div><div><span>FCP</span><strong>{report.metrics.fcp}</strong></div><div><span>TTFB</span><strong>{report.metrics.ttfb}</strong></div></div>

          <div className="report-section-heading"><div><div className="eyebrow">Temuan</div><h2>Yang perlu <em>diperbaiki.</em></h2></div><span className="issue-count">{reportIssues.length} temuan</span></div>
          <div className="issues-list">{reportIssues.map((issue) => <article className="issue-card" key={issue.number}><div className="issue-number">{issue.number}</div><div className="issue-body"><div className="issue-meta"><span className={issue.severityClass}>{issue.severity}</span><span className="issue-tag">{issue.tag}</span></div><h3>{issue.title}</h3><p>{issue.description}</p><div className="solution-box"><div className="solution-label"><span><SparkIcon /> Yang bisa dilakukan</span><b>{issue.impact}</b></div><p>{issue.solution}</p></div>{expandedIssue === issue.number && <div className="issue-detail"><span>Detail pemeriksaan</span><p>{issue.detail ?? "Temuan ini berasal dari pemeriksaan Lighthouse."}</p></div>}</div><button className={`issue-open ${expandedIssue === issue.number ? "is-open" : ""}`} onClick={() => setExpandedIssue(expandedIssue === issue.number ? null : issue.number)} aria-label={`${expandedIssue === issue.number ? "Tutup" : "Lihat"} detail ${issue.title}`}>{expandedIssue === issue.number ? "×" : "↗"}</button></article>)}</div>

          <div className="report-footer-card"><div><span className="footer-spark"><SparkIcon /></span><div><h3>Mulai dari temuan paling atas.</h3><p>Masalah diurutkan berdasarkan dampaknya ke halaman.</p></div></div><button className="primary-button" onClick={resetScan}>Cek halaman lain <ArrowIcon /></button></div>
        </section>
      )}

      <footer className="footer page-width"><div className="brand"><BrandMark /><span>cikweb</span></div><span>ranggacey</span><span>© 2026 Cikweb</span></footer>
    </main>
  );
}
