import { afterEach, describe, expect, it } from 'bun:test';
import {
  fetchStockAnnouncements,
  fetchStockEvents,
  fetchStockNews,
  parseEastmoneyDate,
  stripJsonp,
} from '../src/stockNews';

afterEach(() => {
  // @ts-expect-error 还原全局 fetch
  delete globalThis.fetch;
});

describe('stripJsonp', () => {
  it('去除回调包装', () => {
    expect(stripJsonp('jQuery123({"a":1})')).toBe('{"a":1}');
  });
  it('无包装原样返回', () => {
    expect(stripJsonp('{"a":1}')).toBe('{"a":1}');
  });
});

describe('parseEastmoneyDate', () => {
  it('解析 YYYY-MM-DD HH:MM:SS', () => {
    expect(parseEastmoneyDate('2026-02-28 00:00:00')).toBeGreaterThan(0);
  });
  it('秒级时间戳转毫秒', () => {
    expect(parseEastmoneyDate('1700000000')).toBe(1700000000 * 1000);
  });
  it('毫秒级时间戳原样', () => {
    expect(parseEastmoneyDate('1700000000000')).toBe(1700000000000);
  });
  it('非法返回 0', () => {
    expect(parseEastmoneyDate('')).toBe(0);
    expect(parseEastmoneyDate('not-a-date')).toBe(0);
  });
});

describe('fetchStockNews', () => {
  it('解析东财个股新闻流', async () => {
    const body = JSON.stringify({
      result: {
        cmsArticleWebOld: [
          {
            code: '202405103073124',
            title: '<em>贵州茅台</em>上半年净利增23%',
            content: '摘要内容',
            date: '2024-05-10 15:30:00',
            mediaName: '东方财富',
          },
          {
            code: '202405093073000',
            title: '机构调研纪要',
            content: 'x',
            date: '1715260800',
            mediaName: '证券时报',
          },
        ],
      },
    });
    // @ts-expect-error mock
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => `jQuery123(${body})`,
    });
    const items = await fetchStockNews('600519');
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('贵州茅台上半年净利增23%');
    expect(items[0].url).toBe('http://finance.eastmoney.com/a/202405103073124.html');
    expect(items[0].source).toBe('东方财富');
    expect(items[1].time).toBe(1715260800 * 1000);
  });

  it('接口非 200 抛错', async () => {
    // @ts-expect-error mock
    globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => '' });
    await expect(fetchStockNews('600519')).rejects.toThrow();
  });
});

describe('fetchStockAnnouncements', () => {
  it('解析东财个股公告流', async () => {
    const body = {
      data: {
        list: [
          {
            art_code: 'AN202602271820099598',
            title_ch: '豪威集团:关于2022年员工持股计划的进展公告',
            notice_date: '2026-02-28 00:00:00',
            codes: [{ stock_code: '603501', short_name: '豪威集团' }],
            columns: [{ column_name: '员工持股计划' }, { column_name: '其它' }],
          },
        ],
      },
    };
    // @ts-expect-error mock
    globalThis.fetch = async () => ({ ok: true, json: async () => body });
    const items = await fetchStockAnnouncements('603501');
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain('员工持股计划');
    expect(items[0].types).toEqual(['员工持股计划', '其它']);
    expect(items[0].url).toBe(
      'https://data.eastmoney.com/notices/detail/603501/AN202602271820099598.html',
    );
    expect(parseEastmoneyDate(items[0].date)).toBeGreaterThan(0);
  });
});

describe('fetchStockEvents', () => {
  it('两源均失败时抛错而非返回空', async () => {
    // @ts-expect-error mock
    globalThis.fetch = async () => { throw new Error('network'); };
    await expect(fetchStockEvents('600519')).rejects.toThrow();
  });

  it('合并新闻与公告并按时间倒序', async () => {
    const newsBody = JSON.stringify({
      result: {
        cmsArticleWebOld: [
          { code: 'A1', title: '旧新闻', content: 'x', date: '2024-01-01 10:00:00', mediaName: '东方财富' },
        ],
      },
    });
    const annBody = {
      data: {
        list: [
          { art_code: 'AN1', title_ch: '新公告', notice_date: '2024-06-01 00:00:00', codes: [{ stock_code: '600519' }], columns: [{ column_name: '停牌' }] },
        ],
      },
    };
    // @ts-expect-error mock
    globalThis.fetch = async (url: string) => ({
      ok: true,
      text: async () => `cb(${newsBody})`,
      json: async () => annBody,
    });
    const items = await fetchStockEvents('600519');
    expect(items.length).toBe(2);
    expect(items[0].kind).toBe('公告');
    expect(items[1].kind).toBe('新闻');
  });
});
