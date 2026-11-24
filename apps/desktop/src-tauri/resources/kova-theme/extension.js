const vscode = require("vscode");

function currentTheme() {
  return vscode.workspace.getConfiguration("workbench").get("colorTheme") || "Kova Dark";
}

function updateItem(item) {
  item.text = `$(color-mode) ${currentTheme()}`;
  item.tooltip = "Kova: сменить тему";
}

function activate(context) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = "kova.switchTheme";
  updateItem(item);
  item.show();
  context.subscriptions.push(item);

  context.subscriptions.push(
    vscode.commands.registerCommand("kova.switchTheme", async () => {
      const pick = await vscode.window.showQuickPick(
        [
          { label: "Kova Dark", description: "тёмная тёплая" },
          { label: "Kova Light", description: "светлая тёплая" },
          { label: "Системная", description: "по теме Windows" },
        ],
        { placeHolder: "Тема Kova" },
      );
      if (!pick) return;

      if (pick.label === "Системная") {
        await vscode.workspace
          .getConfiguration("window")
          .update("autoDetectColorScheme", true, vscode.ConfigurationTarget.Global);
        return;
      }

      await vscode.workspace
        .getConfiguration("window")
        .update("autoDetectColorScheme", false, vscode.ConfigurationTarget.Global);
      await vscode.workspace
        .getConfiguration("workbench")
        .update("colorTheme", pick.label, vscode.ConfigurationTarget.Global);
      updateItem(item);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("workbench.colorTheme")) updateItem(item);
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
