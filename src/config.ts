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
  showStockNews(): boolean {
    return vscode.workspace.getConfiguration(SECTION).get<boolean>('showStockNews', true);
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

/**
 * 配置写入目标：沿用该键已在使用的配置作用域。
 * 作用域为 window 的键若被写进工作区设置，固定写 Global 会被静默遮蔽（读取仍取工作区值），
 * 表现为增删自选、切换老板模式等操作看似成功、重载后回退。
 */
export function configWriteTarget(key: string): vscode.ConfigurationTarget {
  const inspected = vscode.workspace.getConfiguration(SECTION).inspect(key);
  if (inspected?.workspaceFolderValue !== undefined) {
    return vscode.ConfigurationTarget.WorkspaceFolder;
  }
  if (inspected?.workspaceValue !== undefined) {
    return vscode.ConfigurationTarget.Workspace;
  }
  return vscode.ConfigurationTarget.Global;
}
