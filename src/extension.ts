import * as vscode from 'vscode';
import { Store } from './store';
import { StockViewProvider } from './stockViewProvider';
import { searchStock, SearchResult } from './search';

interface PickItem extends vscode.QuickPickItem {
  result?: SearchResult;
}

export function activate(context: vscode.ExtensionContext): void {
  const store = Store.migrateLegacy(context);
  const provider = new StockViewProvider(store);
  context.subscriptions.push(provider);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aStockWatch.watchlist')) {
        store.reload();
        provider.refreshNow();
      }
    }),
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(StockViewProvider.viewType, provider),
  );

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
        provider.notifyChanged();
      });

      qp.show();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('a-stock-watch.remove', async () => {
      const symbols = store.getAll();
      if (symbols.length === 0) {
        void vscode.window.showInformationMessage('自选股为空');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        symbols.map((s) => ({ label: s, value: s })),
        { placeHolder: '选择要删除的自选股' },
      );
      if (!picked) {
        return;
      }
      if (store.remove(picked.value)) {
        provider.notifyChanged();
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('a-stock-watch.sort', async () => {
      const pick = await vscode.window.showQuickPick(
        [
          { label: '手动顺序', description: '拖拽排好的顺序', value: 'manual' },
          { label: '按代码', value: 'code' },
          { label: '按名称', value: 'name' },
          { label: '按涨跌幅 ↓', value: 'pctDesc' },
          { label: '按涨跌幅 ↑', value: 'pctAsc' },
        ],
        { placeHolder: '选择排序方式' },
      );
      if (pick) {
        provider.setSortMode(pick.value as 'manual' | 'code' | 'name' | 'pctDesc' | 'pctAsc');
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('a-stock-watch.edit', () => {
      const editing = provider.toggleEditMode();
      void vscode.commands.executeCommand('setContext', 'aStockWatch.editing', editing);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('a-stock-watch.refresh', () => provider.refreshNow()),
  );
}

export function deactivate(): void {}
