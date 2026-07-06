import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ProcessRow {
  pid: number;
  ppid: number;
  rssKb: number;
}

export function parsePsRows(output: string): ProcessRow[] {
  return output
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((cols) => cols.length >= 3 && cols.every(Number.isFinite))
    .map(([pid, ppid, rssKb]) => ({ pid, ppid, rssKb }));
}

export function sumProcessTreeRss(rows: ProcessRow[], rootPid: number): number {
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    const list = children.get(row.ppid) ?? [];
    list.push(row);
    children.set(row.ppid, list);
  }
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  let total = 0;
  const stack = [rootPid];
  const seen = new Set<number>();
  while (stack.length) {
    const pid = stack.pop();
    if (pid === undefined || seen.has(pid)) continue;
    seen.add(pid);
    total += byPid.get(pid)?.rssKb ?? 0;
    for (const child of children.get(pid) ?? []) stack.push(child.pid);
  }
  return total;
}

export async function currentProcessRows(): Promise<ProcessRow[]> {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,rss="], { maxBuffer: 1024 * 1024 * 4 });
  return parsePsRows(stdout);
}
