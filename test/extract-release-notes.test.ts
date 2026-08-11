import { describe, expect, it } from 'bun:test';
import { extractReleaseNotes } from '../scripts/extract-release-notes.mjs';

const changelog = `# 更新日志

## [0.1.10] - 2026-08-10

### 修复

- K线十字光标不再带中空圆环

## [0.1.1] - 2026-08-01

### 修复

- 前缀碰撞测试
`;

describe('extractReleaseNotes', () => {
  it('extracts the section for the matching version', () => {
    const body = extractReleaseNotes(changelog, '0.1.10');
    expect(body).toContain('### 修复');
    expect(body).toContain('K线十字光标不再带中空圆环');
    expect(body).not.toContain('前缀碰撞测试');
  });

  it('does not prefix-match a shorter version', () => {
    const body = extractReleaseNotes(changelog, '0.1.1');
    expect(body).toContain('前缀碰撞测试');
    expect(body).not.toContain('K线十字光标');
  });

  it('returns empty when the version has no section', () => {
    expect(extractReleaseNotes(changelog, '9.9.9')).toBe('');
  });
});
