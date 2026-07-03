<script setup lang="ts">
// Full-screen cross-repo PR list, a sibling of WikiBrowseOverlay / AccountingOverlay.
// Driven by usePrsView (the /prs route). Fetches /api/prs (open PRs for the repos set
// in Settings, aggregated server-side via `gh`) on open and on the reload button, and
// groups them by repo. Read-only: a row click opens the PR on GitHub in a new tab.
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { usePrsView } from "../composables/usePrsView";

type CiState = "passing" | "failing" | "pending" | "none";
interface PrItem {
  number: number;
  title: string;
  author: string;
  updatedAt: string;
  isDraft: boolean;
  url: string;
  review: string | null;
  ci: CiState;
}
interface RepoPrs {
  repo: string;
  prs?: PrItem[];
  error?: string;
  truncated?: boolean;
}

const { isOpen, close } = usePrsView();

const repos = ref<RepoPrs[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
let reqId = 0;

async function load(): Promise<void> {
  const id = ++reqId;
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch("/api/prs");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (id === reqId) repos.value = Array.isArray(data.repos) ? data.repos : [];
  } catch (e) {
    if (id === reqId) error.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (id === reqId) loading.value = false;
  }
}

// Re-fetch each time the view is entered (open PRs change as work lands elsewhere).
watch(isOpen, (open) => open && load(), { immediate: true });

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
const CI_TITLE: Record<CiState, string> = { passing: "Checks passing", failing: "Checks failing", pending: "Checks running", none: "No checks" };
const REVIEW_LABEL: Record<string, string> = { APPROVED: "approved", CHANGES_REQUESTED: "changes requested", REVIEW_REQUIRED: "review required" };

function openPr(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape" && isOpen.value) close();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div v-if="isOpen" class="prs-overlay" role="region" aria-label="Pull requests">
    <header class="prs-head">
      <span class="prs-title">Pull requests</span>
      <button type="button" class="prs-reload" :disabled="loading" title="Reload" aria-label="Reload PR list" @click="load">↻</button>
      <span v-if="loading" class="prs-status">Loading…</span>
    </header>
    <div class="prs-content">
      <p v-if="error" class="prs-msg prs-error">{{ error }}</p>
      <p v-else-if="!loading && repos.length === 0" class="prs-msg">
        No repositories configured. Add <code>owner/repo</code> entries under Settings (⚙) → Pull request repos.
      </p>
      <section v-for="r in repos" :key="r.repo" class="prs-repo">
        <h2 class="prs-repo-name">
          {{ r.repo }}
          <span v-if="r.prs" class="prs-count">{{ r.prs.length }}</span>
        </h2>
        <p v-if="r.error" class="prs-msg prs-error">{{ r.error }}</p>
        <p v-else-if="r.prs && r.prs.length === 0" class="prs-msg prs-empty">No open PRs</p>
        <ul v-else-if="r.prs" class="prs-list">
          <li v-for="pr in r.prs" :key="pr.number">
            <button type="button" class="prs-row" @click="openPr(pr.url)">
              <span class="prs-ci" :class="`ci-${pr.ci}`" role="img" :aria-label="CI_TITLE[pr.ci]" :title="CI_TITLE[pr.ci]" />
              <span class="prs-num">#{{ pr.number }}</span>
              <span class="prs-name">{{ pr.title }}</span>
              <span v-if="pr.isDraft" class="prs-tag prs-draft">draft</span>
              <span v-if="pr.review" class="prs-tag" :class="`rev-${pr.review}`">{{ REVIEW_LABEL[pr.review] ?? pr.review.toLowerCase() }}</span>
              <span class="prs-meta">{{ pr.author }} · {{ relativeTime(pr.updatedAt) }}</span>
            </button>
          </li>
        </ul>
        <p v-if="r.truncated" class="prs-msg prs-empty">Showing the first {{ r.prs?.length ?? 0 }} — this repo has more open PRs.</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.prs-overlay {
  position: fixed;
  top: 40px;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 50;
  background: var(--bg-deep);
  display: flex;
  flex-direction: column;
}
.prs-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}
.prs-title {
  font-weight: 650;
  font-size: 14px;
  color: var(--text);
}
.prs-reload {
  border: 1px solid var(--border);
  background: var(--bg-base);
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 6px;
  width: 26px;
  height: 24px;
  font-size: 14px;
}
.prs-reload:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}
.prs-reload:disabled {
  opacity: 0.5;
  cursor: default;
}
.prs-status {
  font-size: 12px;
  color: var(--text-muted);
}
.prs-content {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 12px 16px 64px;
}
.prs-msg {
  padding: 24px 4px;
  color: var(--text-muted);
  font-size: 13px;
}
.prs-error {
  color: var(--err);
}
.prs-empty {
  padding: 8px 4px;
}
.prs-repo {
  margin-bottom: 20px;
}
.prs-repo-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin: 6px 0;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}
.prs-count {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 400;
}
.prs-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.prs-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 7px 8px;
  border-radius: 6px;
  font-size: 13px;
}
.prs-row:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.prs-ci {
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--text-dim);
}
.ci-passing {
  background: #3fae6b;
}
.ci-failing {
  background: var(--err-text, #e0556b);
}
.ci-pending {
  background: var(--amber, #e0a030);
}
.prs-num {
  flex: 0 0 auto;
  font-family: ui-monospace, monospace;
  color: var(--text-dim);
}
.prs-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prs-tag {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.prs-draft {
  color: var(--text-dim);
}
.rev-APPROVED {
  color: #3fae6b;
  border-color: #3fae6b;
}
.rev-CHANGES_REQUESTED {
  color: var(--err-text, #e0556b);
  border-color: var(--err-text, #e0556b);
}
.prs-meta {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--text-dim);
}
</style>
