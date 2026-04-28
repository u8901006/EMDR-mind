import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const PUBMED_SEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_FETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
const EUROPE_PMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const CROSSREF = "https://api.crossref.org/works";
const S2_SEARCH = "https://api.semanticscholar.org/graph/v1/paper/search";
const HEADERS = { "User-Agent": "EMDRMindBot/1.0 (research aggregator)" };

const PUBMED_QUERIES = [
  `(("Eye Movement Desensitization and Reprocessing"[Title/Abstract]) OR EMDR[Title/Abstract])`,
  `(("Eye Movement Desensitization and Reprocessing"[Title/Abstract]) OR EMDR[Title/Abstract]) AND (PTSD[Title/Abstract] OR "posttraumatic stress"[Title/Abstract] OR "post-traumatic stress"[Title/Abstract])`,
  `(("Eye Movement Desensitization and Reprocessing"[Title/Abstract]) OR EMDR[Title/Abstract]) AND ("complex PTSD"[Title/Abstract] OR CPTSD[Title/Abstract] OR dissociation[Title/Abstract] OR dissociative[Title/Abstract])`,
  `(("Eye Movement Desensitization and Reprocessing"[Title/Abstract]) OR EMDR[Title/Abstract]) AND (depression[Title/Abstract] OR depressive[Title/Abstract] OR anxiety[Title/Abstract])`,
  `(("Eye Movement Desensitization and Reprocessing"[Title/Abstract]) OR EMDR[Title/Abstract]) AND (child*[Title/Abstract] OR adolescent*[Title/Abstract] OR pediatric[Title/Abstract])`,
  `(("Eye Movement Desensitization and Reprocessing"[Title/Abstract]) OR EMDR[Title/Abstract]) AND (neurobiolog*[Title/Abstract] OR EEG[Title/Abstract] OR fMRI[Title/Abstract] OR neuroimaging[Title/Abstract])`,
  `(("Eye Movement Desensitization and Reprocessing"[Title/Abstract]) OR EMDR[Title/Abstract]) AND ("working memory"[Title/Abstract] OR mechanism*[Title/Abstract] OR "bilateral stimulation"[Title/Abstract] OR "memory reconsolidation"[Title/Abstract])`,
  `(("Eye Movement Desensitization and Reprocessing"[Title/Abstract]) OR EMDR[Title/Abstract]) AND (refugee*[Title/Abstract] OR community[Title/Abstract] OR "public mental health"[Title/Abstract] OR disaster*[Title/Abstract])`,
  `(("Eye Movement Desensitization and Reprocessing"[Title/Abstract]) OR EMDR[Title/Abstract]) AND ("randomized controlled trial"[Publication Type] OR randomized[Title/Abstract] OR "systematic review"[Title] OR meta-analysis[Title])`,
  `(("Eye Movement Desensitization and Reprocessing"[Title/Abstract]) OR EMDR[Title/Abstract]) AND ("chronic pain"[Title/Abstract] OR fibromyalgia[Title/Abstract] OR tinnitus[Title/Abstract])`,
  `(("Eye Movement Desensitization and Reprocessing"[Title/Abstract]) OR EMDR[Title/Abstract]) AND (addiction[Title/Abstract] OR substance[Title/Abstract] OR alcohol[Title/Abstract])`,
  `(("Eye Movement Desensitization and Reprocessing"[Title/Abstract]) OR EMDR[Title/Abstract]) AND ("borderline personality disorder"[Title/Abstract] OR BPD[Title/Abstract])`,
];

const EPMC_QUERIES = [
  `(EMDR OR "eye movement desensitization")`,
  `(EMDR OR "eye movement desensitization") AND (PTSD OR "posttraumatic stress")`,
  `(EMDR OR "eye movement desensitization") AND (dissociation OR "complex PTSD" OR CPTSD)`,
  `(EMDR OR "eye movement desensitization") AND (depression OR anxiety)`,
  `(EMDR OR "eye movement desensitization") AND (child* OR adolescent* OR pediatric)`,
  `("trauma-focused therapy" OR "trauma therapy" OR "trauma treatment") AND (PTSD OR "posttraumatic stress")`,
];

const CROSSREF_QUERIES = [
  `EMDR OR "eye movement desensitization and reprocessing"`,
  `EMDR AND (PTSD OR "posttraumatic stress" OR trauma)`,
  `"trauma-focused therapy" AND (randomized OR "systematic review" OR meta-analysis)`,
  `"bilateral stimulation" AND (memory OR trauma OR PTSD)`,
];

const S2_QUERIES = [
  `EMDR "eye movement desensitization" PTSD`,
  `"trauma-focused therapy" randomized`,
];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { days: 7, maxPapers: 60, output: "papers.json" };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days" && args[i + 1]) opts.days = parseInt(args[i + 1]);
    if (args[i] === "--max-papers" && args[i + 1]) opts.maxPapers = parseInt(args[i + 1]);
    if (args[i] === "--output" && args[i + 1]) opts.output = args[i + 1];
  }
  return opts;
}

function getDateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

function getTaipeiDateStr() {
  const now = new Date();
  const taipei = new Date(now.getTime() + 8 * 3600000);
  return taipei.toISOString().split("T")[0];
}

function getExistingPmids(docsDir) {
  const pmids = new Set();
  if (!existsSync(docsDir)) return pmids;
  const files = readdirSync(docsDir).filter((f) => f.startsWith("emdr-") && f.endsWith(".html"));
  const recent = files.sort().reverse().slice(0, 7);
  for (const f of recent) {
    const content = readFileSync(resolve(docsDir, f), "utf-8");
    const matches = content.matchAll(/data-pmid="(\d+)"/g);
    for (const m of matches) pmids.add(m[1]);
  }
  return pmids;
}

function getExistingDois(docsDir) {
  const dois = new Set();
  if (!existsSync(docsDir)) return dois;
  const files = readdirSync(docsDir).filter((f) => f.startsWith("emdr-") && f.endsWith(".html"));
  const recent = files.sort().reverse().slice(0, 7);
  for (const f of recent) {
    const content = readFileSync(resolve(docsDir, f), "utf-8");
    const matches = content.matchAll(/data-doi="([^"]+)"/g);
    for (const m of matches) dois.add(normalizeDoi(m[1]));
  }
  return dois;
}

function normalizeDoi(doi) {
  if (!doi) return "";
  return doi.toLowerCase().replace(/^https?:\/\/doi\.org\//i, "").trim();
}

function normalizeTitle(title) {
  if (!title) return "";
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url, options = {}, retries = 1) {
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeout || 30000) });
      if (resp.status === 429) {
        console.error(`[WARN] Rate limited on ${url.split('?')[0]}, skipping`);
        return null;
      }
      if (resp.status >= 500) {
        if (i < retries) {
          await delay(5000);
          continue;
        }
        return null;
      }
      return resp;
    } catch (e) {
      if (i < retries) {
        await delay(3000);
        continue;
      }
      return null;
    }
  }
  return null;
}

// ========== PubMed (existing) ==========

async function searchPubMed(query, retmax = 30) {
  const url = `${PUBMED_SEARCH}?db=pubmed&term=${encodeURIComponent(query)}&retmax=${retmax}&sort=date&retmode=json`;
  try {
    const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
    const data = await resp.json();
    return data?.esearchresult?.idlist || [];
  } catch (e) {
    console.error(`[WARN] PubMed search failed: ${e.message}`);
    return [];
  }
}

async function fetchPubMedDetails(pmids) {
  if (!pmids.length) return [];
  const ids = pmids.join(",");
  const url = `${PUBMED_FETCH}?db=pubmed&id=${ids}&retmode=xml`;
  try {
    const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60000) });
    const xml = await resp.text();
    return parsePubMedXml(xml);
  } catch (e) {
    console.error(`[ERROR] PubMed fetch failed: ${e.message}`);
    return [];
  }
}

function parsePubMedXml(xml) {
  const papers = [];
  const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
  let match;
  while ((match = articleRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractXml(block, "ArticleTitle");
    const journal = extractXml(block, "Title");
    const abstract = extractPubMedAbstract(block);
    const pmid = extractXml(block, "PMID");
    const year = extractXml(block, "Year");
    const month = extractXml(block, "Month");
    const day = extractXml(block, "Day");
    const dateStr = [year, month, day].filter(Boolean).join(" ");
    const url = pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : "";
    const doiMatch = block.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/);
    const doi = doiMatch ? doiMatch[1] : "";
    const keywords = [];
    const kwRegex = /<Keyword>([\s\S]*?)<\/Keyword>/g;
    let kw;
    while ((kw = kwRegex.exec(block)) !== null) keywords.push(kw[1].trim());
    if (title && pmid) {
      papers.push({ pmid, doi, title, journal, date: dateStr, abstract, url, keywords, authors: [], source: "PubMed" });
    }
  }
  return papers;
}

function extractXml(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  return m[1].replace(/<[^>]+>/g, "").trim();
}

function extractPubMedAbstract(block) {
  const parts = [];
  const re = /<AbstractText[^>]*Label="([^"]*)"[^>]*>([\s\S]*?)<\/AbstractText>/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    const text = m[2].replace(/<[^>]+>/g, "").trim();
    if (text) parts.push(`${m[1]}: ${text}`);
  }
  if (!parts.length) {
    const re2 = /<AbstractText>([\s\S]*?)<\/AbstractText>/g;
    while ((m = re2.exec(block)) !== null) {
      const text = m[1].replace(/<[^>]+>/g, "").trim();
      if (text) parts.push(text);
    }
  }
  return parts.join(" ").slice(0, 2000);
}

async function fetchFromPubMed(lookbackDate, existingPmids) {
  console.error("[INFO] Fetching from PubMed...");
  const lookbackPubmed = lookbackDate.replace(/-/g, "/");
  const dateFilter = `"${lookbackPubmed}"[Date - Publication] : "3000"[Date - Publication]`;

  const allPmids = new Set();
  for (const q of PUBMED_QUERIES) {
    const fullQuery = `(${q}) AND ${dateFilter}`;
    const ids = await searchPubMed(fullQuery, 30);
    for (const id of ids) allPmids.add(id);
    await delay(400);
  }

  const newPmids = [...allPmids].filter((id) => !existingPmids.has(id));
  console.error(`[INFO] PubMed: ${allPmids.size} total, ${newPmids.length} new`);

  let papers = [];
  if (newPmids.length) {
    for (let i = 0; i < newPmids.length; i += 50) {
      const batch = newPmids.slice(i, i + 50);
      const batchPapers = await fetchPubMedDetails(batch);
      papers.push(...batchPapers);
      if (i + 50 < newPmids.length) await delay(500);
    }
  }
  return papers;
}

// ========== Europe PMC ==========

async function fetchFromEuropePMC(lookbackDate) {
  console.error("[INFO] Fetching from Europe PMC...");
  const dateFrom = lookbackDate.replace(/-/g, "");
  const dateTo = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const dateFilter = `P_PDATE_D:[${dateFrom} TO ${dateTo}]`;

  let allPapers = [];
  for (const q of EPMC_QUERIES) {
    const fullQuery = `(${q}) AND ${dateFilter}`;
    const url = `${EUROPE_PMC}?query=${encodeURIComponent(fullQuery)}&resultType=core&pageSize=25&format=json&sort_date:y`;
    try {
      const resp = await fetchWithRetry(url, { headers: HEADERS, timeout: 30000 });
      if (!resp) continue;
      const data = await resp.json();
      const results = data?.resultList?.result || [];
      for (const r of results) {
        const pmid = r.pmid || "";
        const doi = r.doi || "";
        const title = r.title || "";
        const journal = r.journalTitle || "";
        const abstract = (r.abstractText || "").slice(0, 2000);
        const url_link = pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : (doi ? `https://doi.org/${doi}` : "");
        const year = r.pubYear || "";
        const month = r.month || "";
        const day = r.day || "";
        const dateStr = [year, month, day].filter(Boolean).join(" ");
        const authors = (r.authorString || "").split(", ").map(a => a.trim()).filter(Boolean);

        if (title) {
          allPapers.push({ pmid, doi, title, journal, date: dateStr, abstract, url: url_link, keywords: [], authors, source: "EuropePMC" });
        }
      }
    } catch (e) {
      console.error(`[WARN] Europe PMC query failed: ${e.message}`);
    }
    await delay(300);
  }

  console.error(`[INFO] Europe PMC: ${allPapers.length} papers`);
  return allPapers;
}

// ========== Crossref ==========

async function fetchFromCrossref(lookbackDate) {
  console.error("[INFO] Fetching from Crossref...");
  const mailto = "emdrmindbot@research.org";
  let allPapers = [];

  for (const q of CROSSREF_QUERIES) {
    const url = `${CROSSREF}?query=${encodeURIComponent(q)}&filter=from-pub-date:${lookbackDate},has-abstract:true,type:journal-article&rows=25&sort=published&order=desc&mailto=${mailto}`;
    try {
      const resp = await fetchWithRetry(url, { headers: HEADERS, timeout: 30000 });
      if (!resp) continue;
      const data = await resp.json();
      const items = data?.message?.items || [];
      for (const item of items) {
        const doi = item.DOI || "";
        const title = (item.title || [])[0] || "";
        const journal = (item["container-title"] || [])[0] || "";
        const abstractRaw = item.abstract || "";
        const abstract = abstractRaw.replace(/<[^>]+>/g, "").trim().slice(0, 2000);
        const url_link = doi ? `https://doi.org/${doi}` : "";
        const pubDate = item.published?.["date-parts"]?.[0] || [];
        const dateStr = pubDate.join(" ");
        const authors = (item.author || []).map(a => `${a.given || ""} ${a.family || ""}`.trim()).filter(Boolean);

        if (title) {
          allPapers.push({ pmid: "", doi, title, journal, date: dateStr, abstract, url: url_link, keywords: [], authors, source: "Crossref" });
        }
      }
    } catch (e) {
      console.error(`[WARN] Crossref query failed: ${e.message}`);
    }
    await delay(400);
  }

  console.error(`[INFO] Crossref: ${allPapers.length} papers`);
  return allPapers;
}

// ========== Semantic Scholar ==========

async function fetchFromSemanticScholar(lookbackDate) {
  console.error("[INFO] Fetching from Semantic Scholar...");
  const currentYear = new Date().getFullYear().toString();
  const lookback = new Date(lookbackDate);
  let allPapers = [];

  for (const q of S2_QUERIES) {
    const url = `${S2_SEARCH}?query=${encodeURIComponent(q)}&year=${currentYear}&fields=title,abstract,year,externalIds,citationCount,url,authors,journal&limit=25`;
    try {
      const resp = await fetchWithRetry(url, { headers: HEADERS, timeout: 30000 });
      if (!resp) continue;
      const data = await resp.json();
      const results = data?.data || [];
      for (const r of results) {
        const extIds = r.externalIds || {};
        const pmid = extIds.PubMed || "";
        const doi = extIds.Doi || "";
        const title = r.title || "";
        const abstract = (r.abstract || "").slice(0, 2000);
        const url_link = r.url || (doi ? `https://doi.org/${doi}` : "");
        const year = r.year?.toString() || "";
        const journal = r.journal?.name || "";
        const authors = (r.authors || []).map(a => a.name).filter(Boolean);

        if (title) {
          allPapers.push({ pmid, doi, title, journal, date: year, abstract, url: url_link, keywords: [], authors, source: "SemanticScholar" });
        }
      }
    } catch (e) {
      console.error(`[WARN] Semantic Scholar query failed: ${e.message}`);
    }
    await delay(2000);
  }

  const filtered = allPapers.filter(p => {
    if (!p.date) return true;
    const paperYear = parseInt(p.date);
    if (isNaN(paperYear)) return true;
    return paperYear >= lookback.getFullYear();
  });

  console.error(`[INFO] Semantic Scholar: ${filtered.length} papers (from ${allPapers.length} raw)`);
  return filtered;
}

// ========== Deduplication ==========

function dedupPapers(allPapers) {
  const seenDois = new Set();
  const seenPmids = new Set();
  const seenTitles = new Set();
  const unique = [];

  const sourcePriority = { PubMed: 0, EuropePMC: 1, Crossref: 2, SemanticScholar: 3 };
  const sorted = [...allPapers].sort((a, b) => {
    const pa = sourcePriority[a.source] ?? 9;
    const pb = sourcePriority[b.source] ?? 9;
    return pa - pb;
  });

  for (const paper of sorted) {
    const doi = normalizeDoi(paper.doi);
    const pmid = paper.pmid || "";
    const titleKey = normalizeTitle(paper.title);

    if (doi && seenDois.has(doi)) continue;
    if (pmid && seenPmids.has(pmid)) continue;
    if (titleKey && seenTitles.has(titleKey)) continue;

    if (doi) seenDois.add(doi);
    if (pmid) seenPmids.add(pmid);
    if (titleKey) seenTitles.add(titleKey);
    unique.push(paper);
  }

  return unique;
}

function filterAlreadyReported(papers, existingPmids, existingDois) {
  return papers.filter(p => {
    if (p.pmid && existingPmids.has(p.pmid)) return false;
    const doi = normalizeDoi(p.doi);
    if (doi && existingDois.has(doi)) return false;
    return true;
  });
}

// ========== Main ==========

async function main() {
  const opts = parseArgs();
  const docsDir = resolve(ROOT, "docs");
  const existingPmids = getExistingPmids(docsDir);
  const existingDois = getExistingDois(docsDir);
  console.error(`[INFO] Found ${existingPmids.size} existing PMIDs, ${existingDois.size} existing DOIs from recent reports`);

  const lookbackDate = getDateNDaysAgo(opts.days);

  const [pubmedResult, epmcResult, crossrefResult, s2Result] = await Promise.allSettled([
    fetchFromPubMed(lookbackDate, existingPmids),
    fetchFromEuropePMC(lookbackDate),
    fetchFromCrossref(lookbackDate),
    fetchFromSemanticScholar(lookbackDate),
  ]);

  const pubmedPapers = pubmedResult.status === "fulfilled" ? pubmedResult.value : [];
  const epmcPapers = epmcResult.status === "fulfilled" ? epmcResult.value : [];
  const crossrefPapers = crossrefResult.status === "fulfilled" ? crossrefResult.value : [];
  const s2Papers = s2Result.status === "fulfilled" ? s2Result.value : [];

  if (pubmedResult.status === "rejected") console.error(`[WARN] PubMed failed: ${pubmedResult.reason}`);
  if (epmcResult.status === "rejected") console.error(`[WARN] Europe PMC failed: ${epmcResult.reason}`);
  if (crossrefResult.status === "rejected") console.error(`[WARN] Crossref failed: ${crossrefResult.reason}`);
  if (s2Result.status === "rejected") console.error(`[WARN] Semantic Scholar failed: ${s2Result.reason}`);

  console.error(`\n[INFO] Raw totals: PubMed=${pubmedPapers.length}, EuropePMC=${epmcPapers.length}, Crossref=${crossrefPapers.length}, SemanticScholar=${s2Papers.length}`);

  const allRaw = [...pubmedPapers, ...epmcPapers, ...crossrefPapers, ...s2Papers];
  const deduped = dedupPapers(allRaw);
  console.error(`[INFO] After dedup: ${deduped.length} unique papers`);

  const newPapers = filterAlreadyReported(deduped, existingPmids, existingDois);
  console.error(`[INFO] After filtering reported: ${newPapers.length} new papers`);

  const withAbstract = newPapers.filter(p => p.abstract && p.abstract.length > 50);
  const withoutAbstract = newPapers.filter(p => !p.abstract || p.abstract.length <= 50);
  const prioritized = [...withAbstract, ...withoutAbstract].slice(0, opts.maxPapers);

  const sourceCounts = {};
  for (const p of prioritized) {
    sourceCounts[p.source] = (sourceCounts[p.source] || 0) + 1;
  }
  console.error(`[INFO] Final selection: ${prioritized.length} papers by source: ${JSON.stringify(sourceCounts)}`);

  const result = {
    date: getTaipeiDateStr(),
    count: prioritized.length,
    papers: prioritized,
  };

  const outPath = resolve(ROOT, opts.output);
  writeFileSync(outPath, JSON.stringify(result, null, 2), "utf-8");
  console.error(`[INFO] Saved ${prioritized.length} papers to ${opts.output}`);
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  process.exit(1);
});
