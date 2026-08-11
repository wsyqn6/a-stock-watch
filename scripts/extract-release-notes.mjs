import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function extractReleaseNotes(changelog, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const header = new RegExp(`^## \\[${escaped}\\](?:.*)$`, 'm');
  const start = header.exec(changelog);
  if (!start) return '';
  const rest = changelog.slice(start.index + start[0].length);
  const next = /^## /m.exec(rest);
  const body = (next ? rest.slice(0, next.index) : rest).trim();
  return body ? `${body}\n` : '';
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [version, out] = process.argv.slice(2);
  const body = extractReleaseNotes(readFileSync('CHANGELOG.md', 'utf8'), version);
  if (!body) {
    console.log(`::warning::CHANGELOG.md has no section for [${version}]; release body will be empty`);
  }
  writeFileSync(out, body);
}
