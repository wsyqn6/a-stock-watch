import * as vscode from 'vscode';
import { Store } from './store';
import { StockViewProvider } from './stockViewProvider';
import { StatusBarController } from './statusBarController';
import { searchStock, searchEastmoney, SearchResult } from './search';
import { MoveAlarm } from './moveAlarm';
import { TelegraphView } from './telegraphView';

interface PickItem extends vscode.QuickPickItem {
  result?: SearchResult;
}

export function activate(context: vscode.ExtensionContext): void {
  const store = Store.migrateLegacy(context);
  const statusBar = new StatusBarController(store);
  statusBar.start();
  context.subscriptions.push(statusBar);

  const alarm = new MoveAlarm(store);
  alarm.start();
  context.subscriptions.push(alarm);

  const provider = new StockViewProvider(store, () => {
    void statusBar.refreshNow();
  });
  context.subscriptions.push(provider);

  const applyBossMode = (): void => {
    const boss = !!vscode.workspace.getConfiguration('aStockWatch').get('bossMode');
    void vscode.commands.executeCommand('setContext', 'aStockWatch.bossMode', boss);
    provider.setBossMode(boss);
    statusBar.setBoss(boss);
  };
  applyBossMode();

  const applyTelegraph = (): void => {
    const show = !!vscode.workspace.getConfiguration('aStockWatch').get('showTelegraph');
    void vscode.commands.executeCommand('setContext', 'aStockWatch.showTelegraph', show);
  };
  applyTelegraph();

  const telegraph = new TelegraphView();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(TelegraphView.viewType, telegraph),
    telegraph,
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aStockWatch.watchlist')) {
        store.reload();
        provider.refreshNow();
        void statusBar.refreshNow();
      }
      if (e.affectsConfiguration('aStockWatch.statusBar')) {
        store.reload();
        void statusBar.refreshNow();
      }
      if (e.affectsConfiguration('aStockWatch.pinned')) {
        store.reload();
        provider.refreshNow();
      }
      if (
        e.affectsConfiguration('aStockWatch.showMarketBar') ||
        e.affectsConfiguration('aStockWatch.marketIndex')
      ) {
        provider.refreshNow();
      }
      if (e.affectsConfiguration('aStockWatch.showIpo')) {
        void provider.refreshIpo();
      }
      if (e.affectsConfiguration('aStockWatch.bossMode')) {
        applyBossMode();
      }
      if (e.affectsConfiguration('aStockWatch.showTelegraph')) {
        applyTelegraph();
        if (telegraph.visible) {
          telegraph.start();
        }
      }
      if (e.affectsConfiguration('aStockWatch.telegraphIntervalSec') && telegraph.visible) {
        telegraph.start();
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('a-stock-watch.show', () => {
      void vscode.commands.executeCommand('aStockWatchContainer.focus');
      void vscode.commands.executeCommand('aStockWatch.focus');
    }),
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(StockViewProvider.viewType, provider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('a-stock-watch.add', () => {
      const qp = vscode.window.createQuickPick<PickItem>();
      qp.placeholder = '搜索代码 / 拼音缩写 / 名称，或直接输入 6 位代码';
      qp.items = [];
      qp.ignoreFocusOut = false;

      let searchSeq = 0;
      qp.onDidChangeValue(async (value) => {
        qp.ignoreFocusOut = value.trim() !== '';
        const seq = ++searchSeq;
        if (!value.trim()) {
          qp.items = [];
          return;
        }
        let found: SearchResult[] = [];
        try {
          found = await searchStock(value);
        } catch {
          found = [];
        }
        if (seq !== searchSeq) {
          return;
        }
        if (found.length === 0) {
          try {
            found = await searchEastmoney(value);
          } catch {
            found = [];
          }
          if (seq !== searchSeq) {
            return;
          }
        }
        qp.items = found.map((r) => ({
          label: `${r.name}  ${r.code}`,
          detail: r.symbol,
          alwaysShow: true,
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

  context.subscriptions.push(
    vscode.commands.registerCommand('a-stock-watch.telegraphRefresh', () => telegraph.refresh()),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('a-stock-watch.ipoRefresh', () => provider.refreshIpo()),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('a-stock-watch.bossMode', () => {
      const cur = !!vscode.workspace.getConfiguration('aStockWatch').get('bossMode');
      void vscode.workspace
        .getConfiguration('aStockWatch')
        .update('bossMode', !cur, vscode.ConfigurationTarget.Global);
    }),
  );
}

export function deactivate(): void {}
