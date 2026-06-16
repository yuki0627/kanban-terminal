<script setup lang="ts">
import { computed } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";

// Plugin viewComponent for presentDocument. Receives the high-fidelity toolResult
// in `selectedResult` (mirrors MulmoClaude's plugin view contract). `sendTextMessage`
// + `updateResult` are part of the shared contract but unused here — declared so
// they don't fall through as stray attributes.
interface MarkdownData {
  markdown?: string;
  title?: string;
}
interface ToolResult {
  uuid: string;
  toolName: string;
  data?: MarkdownData;
}

const props = defineProps<{
  selectedResult: ToolResult;
  sendTextMessage?: (text: string) => void;
}>();
defineEmits<{ updateResult: [result: ToolResult] }>();

// Render markdown -> sanitized HTML. marked handles GFM tables; DOMPurify strips
// anything unsafe before it reaches v-html.
const html = computed(() => {
  const md = props.selectedResult?.data?.markdown ?? "";
  const raw = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(raw);
});
</script>

<template>
  <!-- DOMPurify-sanitized above; v-html required to render it. -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <article class="markdown-body" v-html="html" />
</template>

<!-- Markdown element styling (unscoped: targets v-html output). -->
<style>
.markdown-body table {
  border-collapse: collapse;
  margin: 8px 0;
}
.markdown-body th,
.markdown-body td {
  border: 1px solid #2a2a4e;
  padding: 4px 10px;
  text-align: left;
}
.markdown-body th {
  background: #1d2b4e;
}
.markdown-body code {
  background: #1d2b4e;
  padding: 1px 5px;
  border-radius: 4px;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.9em;
}
.markdown-body pre {
  background: #0d1124;
  padding: 10px 12px;
  border-radius: 6px;
  overflow-x: auto;
}
.markdown-body pre code {
  background: none;
  padding: 0;
}
.markdown-body a {
  color: #4a8cff;
}
.markdown-body h1,
.markdown-body h2,
.markdown-body h3 {
  margin: 12px 0 6px;
}
</style>
