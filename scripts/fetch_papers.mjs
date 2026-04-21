import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const PUBMED_SEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_FETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
const HEADERS = { "User-Agent": "EMDRMindBot/1.0 (research aggregator)" };

const SEARCH_QUERIES = [
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
  return d.toISOString().split("T")[0].replace(/-/g, "/");
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

async function searchPapers(query, retmax = 30) {
  const url = `${PUBMED_SEARCH}?db=pubmed&term=${encodeURIComponent(query)}&retmax=${retmax}&sort=date&retmode=json`;
  try {
    const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
    const data = await resp.json();
    return data?.esearchresult?.idlist || [];
  } catch (e) {
    console.error(`[WARN] Search failed: ${e.message}`);
    return [];
  }
}

async function fetchDetails(pmids) {
  if (!pmids.length) return [];
  const ids = pmids.join(",");
  const url = `${PUBMED_FETCH}?db=pubmed&id=${ids}&retmode=xml`;
  try {
    const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60000) });
    const xml = await resp.text();
    return parseXml(xml);
  } catch (e) {
    console.error(`[ERROR] Fetch failed: ${e.message}`);
    return [];
  }
}

function parseXml(xml) {
  const papers = [];
  const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
  let match;
  while ((match = articleRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractXml(block, "ArticleTitle");
    const journal = extractXml(block, "Title");
    const abstract = extractAbstract(block);
    const pmid = extractXml(block, "PMID");
    const year = extractXml(block, "Year");
    const month = extractXml(block, "Month");
    const day = extractXml(block, "Day");
    const dateStr = [year, month, day].filter(Boolean).join(" ");
    const url = pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : "";
    const keywords = [];
    const kwRegex = /<Keyword>([\s\S]*?)<\/Keyword>/g;
    let kw;
    while ((kw = kwRegex.exec(block)) !== null) keywords.push(kw[1].trim());
    if (title && pmid) {
      papers.push({ pmid, title, journal, date: dateStr, abstract, url, keywords });
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

function extractAbstract(block) {
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

async function main() {
  const opts = parseArgs();
  const docsDir = resolve(ROOT, "docs");
  const existingPmids = getExistingPmids(docsDir);
  console.error(`[INFO] Found ${existingPmids.size} existing PMIDs from recent reports`);

  const lookback = getDateNDaysAgo(opts.days);
  const dateFilter = `"${lookback}"[Date - Publication] : "3000"[Date - Publication]`;

  const allPmids = new Set();
  for (const q of SEARCH_QUERIES) {
    const fullQuery = `(${q}) AND ${dateFilter}`;
    const ids = await searchPapers(fullQuery, 30);
    for (const id of ids) allPmids.add(id);
    await new Promise((r) => setTimeout(r, 400));
  }

  const newPmids = [...allPmids].filter((id) => !existingPmids.has(id));
  console.error(`[INFO] Total unique PMIDs: ${allPmids.size}, new (not in recent reports): ${newPmids.length}`);

  const pmidsToFetch = newPmids.slice(0, opts.maxPapers);
  let papers = [];
  if (pmidsToFetch.length) {
    for (let i = 0; i < pmidsToFetch.length; i += 50) {
      const batch = pmidsToFetch.slice(i, i + 50);
      const batchPapers = await fetchDetails(batch);
      papers.push(...batchPapers);
      if (i + 50 < pmidsToFetch.length) await new Promise((r) => setTimeout(r, 500));
    }
  }

  const result = {
    date: getTaipeiDateStr(),
    count: papers.length,
    papers,
  };

  const outPath = resolve(ROOT, opts.output);
  writeFileSync(outPath, JSON.stringify(result, null, 2), "utf-8");
  console.error(`[INFO] Saved ${papers.length} papers to ${opts.output}`);
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  process.exit(1);
});
