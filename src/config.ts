import * as vscode from 'vscode';

const SECTION = 'aStockWatch';

/** 集中配置读取：默认值与 package.json contributes.configuration 对齐，单一来源。 */
export const config = {
  refreshIntervalSec(): number {
    return vscode.workspace.getConfiguration(SECTION).get<number>('refreshIntervalSec', 3);
  },
  showMarketBar(): boolean {
    return vscode.workspace.getConfiguration(SECTION).get<boolean>('showMarketBar', true);
  },
  marketIndex(): string {
    return vscode.workspace.getConfiguration(SECTION).get<string>('marketIndex', 'sh000001');
  },
  showIpo(): boolean {
    return vscode.workspace.getConfiguration(SECTION).get<boolean>('showIpo', true);
  },
  showTelegraph(): boolean {
    return vscode.workspace.getConfiguration(SECTION).get<boolean>('showTelegraph', false);
  },
  telegraphIntervalSec(): number {
    return vscode.workspace.getConfiguration(SECTION).get<number>('telegraphIntervalSec', 30);
  },
  bigMoveAlert(): boolean {
    return vscode.workspace.getConfiguration(SECTION).get<boolean>('bigMoveAlert', false);
  },
  bigMoveAlertPct(): number {
    return vscode.workspace.getConfiguration(SECTION).get<number>('bigMoveAlertPct', 5);
  },
  bigMoveAlertCooldownMin(): number {
    return vscode.workspace.getConfiguration(SECTION).get<number>('bigMoveAlertCooldownMin', 30);
  },
  bossMode(): boolean {
    return vscode.workspace.getConfiguration(SECTION).get<boolean>('bossMode', false);
  },
  bossModeTitle(): string {
    return vscode.workspace.getConfiguration(SECTION).get<string>('bossModeTitle', '文档');
  },
};
