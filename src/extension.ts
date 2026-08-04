import * as vscode from 'vscode';
import { Store } from './store';
import { WatchlistProvider } from './watchlistProvider';
import { RefreshManager } from './refreshManager';
import { normalizeCode } from './stockCode';

export function activate(context: vscode.ExtensionContext): void {
  const store = Store.load(context.globalState);
  const provider = new WatchlistProvider();

  const customView = vscode.window.createTreeView('aStockWatch', {
    treeDataProvider: provider,
  });
  const refreshManager = new RefreshManager(store, provider, customView);
  refreshManager.start();

  context.subscriptions.push(customView, provider, refreshManager);

  context.subscriptions.push(
    vscode.commands.registerCommand('a-stock-watch.add', async () => {
      const input = await vscode.window.showInputBox({
        prompt: '输入 6 位股票/可转债代码',
        placeHolder: '例如 600519、000001、123456',
        validateInput: (raw) => {
          const res = normalizeCode(raw);
          if (!res.ok) {
            return res.reason;
          }
          if (store.has(res.code)) {
            return '该股票已在自选列表';
          }
          return undefined;
        },
        ignoreFocusOut: true,
      });
      if (!input) {
        return;
      }
      const res = normalizeCode(input);
      if (!res.ok) {
        void vscode.window.showWarningMessage(res.reason);
        return;
      }
      if (!store.add(res.code)) {
        return;
      }
      await refreshManager.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('a-stock-watch.remove', async (symbol: string) => {
      if (typeof symbol !== 'string' || !store.remove(symbol)) {
        return;
      }
      await refreshManager.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('a-stock-watch.refresh', () => refreshManager.refresh()),
  );

  void refreshManager.refresh();
}

export function deactivate(): void {}