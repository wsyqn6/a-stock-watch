import * as vscode from 'vscode';
import { Store } from './store';
import { WatchlistProvider } from './watchlistProvider';
import { RefreshManager } from './refreshManager';
import { searchStock, SearchResult } from './search';

interface PickItem extends vscode.QuickPickItem {
  result?: SearchResult;
}

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
    vscode.commands.registerCommand('a-stock-watch.add', () => {
      const qp = vscode.window.createQuickPick<PickItem>();
      qp.placeholder = '搜索代码 / 拼音缩写 / 名称，或直接输入 6 位代码';
      qp.matchOnDescription = true;
      qp.matchOnDetail = true;
      qp.items = [];
      qp.ignoreFocusOut = true;

      let searchSeq = 0;
      qp.onDidChangeValue(async (value) => {
        const seq = ++searchSeq;
        if (!value.trim()) {
          qp.items = [];
          return;
        }
        let found: SearchResult[] = [];
        try {
          const results = await searchStock(value);
          if (seq !== searchSeq) {
            return;
          }
          found = results;
        } catch {
          if (seq !== searchSeq) {
            return;
          }
          found = [];
        }
        qp.items = found.map((r) => ({
          label: `${r.name}  ${r.code}`,
          detail: r.symbol,
          result: r,
        }));
      });

      qp.onDidAccept(async () => {
        const item = qp.selectedItems[0];
        qp.dispose();
        if (!item?.result) {
          return;
        }
        if (!store.add(item.result.symbol)) {
          void vscode.window.showInformationMessage(`${item.result.name} 已在自选股中`);
          return;
        }
        await refreshManager.refresh();
      });

      qp.show();
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